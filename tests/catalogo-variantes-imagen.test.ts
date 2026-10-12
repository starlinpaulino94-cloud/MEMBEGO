import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { dimensionesOrientadas, generarVariantesCatalogo, ErrorDeImagen } from '../src/modules/catalog/variantes-imagen'

/** Imagen sintética: izquierda roja, derecha azul, para saber QUÉ parte se recortó. */
async function dosMitades(ancho: number, alto: number, formato: 'jpeg' | 'png' = 'png', orientacion?: number): Promise<Buffer> {
  const izquierda = await sharp({ create: { width: ancho / 2, height: alto, channels: 3, background: '#ff0000' } }).png().toBuffer()
  let img = sharp({ create: { width: ancho, height: alto, channels: 3, background: '#0000ff' } }).composite([
    { input: izquierda, left: 0, top: 0 },
  ])
  img = formato === 'jpeg' ? img.jpeg() : img.png()
  if (orientacion) img = img.withMetadata({ orientation: orientacion })
  return img.toBuffer()
}

async function colorEn(buf: Buffer, xFrac: number, yFrac: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const x = Math.min(info.width - 1, Math.floor(info.width * xFrac))
  const y = Math.min(info.height - 1, Math.floor(info.height * yFrac))
  const i = (y * info.width + x) * 3
  return [data[i], data[i + 1], data[i + 2]]
}
const esRojo = (c: number[]) => c[0] > 200 && c[2] < 60
const esAzul = (c: number[]) => c[2] > 200 && c[0] < 60

test('genera tarjeta 600², ficha 1200² y compartir 1200×630, todas WebP', async () => {
  const original = await dosMitades(2400, 1600)
  const r = await generarVariantesCatalogo(original, { x: 400, y: 0, w: 1600, h: 1600 })
  const por = Object.fromEntries(r.variantes.map((v) => [v.nombre, v]))
  assert.deepEqual([por.tarjeta.ancho, por.tarjeta.alto], [600, 600])
  assert.deepEqual([por.ficha.ancho, por.ficha.alto], [1200, 1200])
  assert.deepEqual([por.compartir.ancho, por.compartir.alto], [1200, 630])
  for (const v of r.variantes) assert.equal((await sharp(v.buffer).metadata()).format, 'webp')
  assert.deepEqual([r.ancho, r.alto], [2400, 1600])
})

test('el recorte elige DE VERDAD la zona: izquierda → rojo, derecha → azul', async () => {
  const original = await dosMitades(2000, 1000)
  const izq = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 800, h: 800 })
  const der = await generarVariantesCatalogo(original, { x: 1200, y: 0, w: 800, h: 800 })
  assert.ok(esRojo(await colorEn(izq.variantes[0].buffer, 0.5, 0.5)))
  assert.ok(esAzul(await colorEn(der.variantes[0].buffer, 0.5, 0.5)))
})

test('compartir es una franja CENTRADA del encuadre (lo que el editor dibuja como zona segura)', async () => {
  // Encuadre cuadrado: arriba verde, centro amarillo, abajo verde. La franja 1,91:1 solo ve el centro.
  const franjaCentral = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#ffff00' } }).png().toBuffer()
  const original = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#00ff00' } })
    .composite([{ input: franjaCentral, left: 0, top: 200 }])
    .png()
    .toBuffer()
  const r = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 1000, h: 1000 })
  const compartir = r.variantes.find((v) => v.nombre === 'compartir')!
  const ficha = r.variantes.find((v) => v.nombre === 'ficha')!
  // En la ficha cuadrada se ve el verde de arriba; en compartir, no.
  const arribaFicha = await colorEn(ficha.buffer, 0.5, 0.05)
  const arribaCompartir = await colorEn(compartir.buffer, 0.5, 0.05)
  assert.ok(arribaFicha[1] > 200 && arribaFicha[0] < 60, 'la ficha muestra el verde de arriba')
  assert.ok(arribaCompartir[0] > 200 && arribaCompartir[1] > 200, 'compartir solo ve la franja amarilla central')
})

test('respeta la rotación EXIF: el recorte se aplica sobre la imagen ORIENTADA', async () => {
  // Archivo en crudo 2000×1000 con orientación 6 (girar 90°): el navegador la ve 1000×2000.
  const original = await dosMitades(2000, 1000, 'jpeg', 6)
  const dims = await dimensionesOrientadas(original)
  assert.deepEqual(dims, { ancho: 1000, alto: 2000 })
  // Un recorte válido solo en la imagen orientada (1000×2000): 1000×1000 en la parte de abajo.
  const r = await generarVariantesCatalogo(original, { x: 0, y: 1000, w: 1000, h: 1000 })
  assert.deepEqual([r.ancho, r.alto], [1000, 2000])
  // Y el mismo recorte aplicado en crudo (2000×1000) se saldría: queda probado que no se usó.
  await assert.rejects(generarVariantesCatalogo(await dosMitades(2000, 1000, 'jpeg'), { x: 0, y: 1000, w: 1000, h: 1000 }), ErrorDeImagen)
})

test('las versiones salen sin metadatos (se va el GPS de las fotos de celular)', async () => {
  const original = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#888' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'no-debe-salir' } })
    .toBuffer()
  assert.ok((await sharp(original).metadata()).exif, 'el original sí trae EXIF')
  const r = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 800, h: 800 })
  for (const v of r.variantes) assert.equal((await sharp(v.buffer).metadata()).exif, undefined)
})

test('rechaza un recorte que no es de fiar (con un mensaje que se puede enseñar)', async () => {
  const original = await dosMitades(1000, 1000)
  for (const malo of [null, {}, { x: 0, y: 0, w: 2000, h: 2000 }, { x: 0, y: 0, w: 900, h: 300 }]) {
    await assert.rejects(generarVariantesCatalogo(original, malo), (e: unknown) => e instanceof ErrorDeImagen && e.message.length > 0)
  }
})

test('un archivo que no es una imagen decodificable lanza (no devuelve basura)', async () => {
  await assert.rejects(generarVariantesCatalogo(Buffer.from('esto no es una imagen'), { x: 0, y: 0, w: 500, h: 500 }))
})
