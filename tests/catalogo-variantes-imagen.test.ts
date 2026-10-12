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

/** Imagen sintética: arriba rojo, abajo azul. */
async function dosFranjas(ancho: number, alto: number): Promise<Buffer> {
  const arriba = await sharp({ create: { width: ancho, height: alto / 2, channels: 3, background: '#ff0000' } }).png().toBuffer()
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#0000ff' } })
    .composite([{ input: arriba, left: 0, top: 0 }])
    .png()
    .toBuffer()
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
const esBlanco = (c: number[]) => c.every((n) => n > 240)
const esOscuro = (c: number[]) => c.every((n) => n < 40)
const por = (r: Awaited<ReturnType<typeof generarVariantesCatalogo>>, n: string) => r.variantes.find((v) => v.nombre === n)!

test('genera tarjeta 600², ficha 1200² y compartir 1200×630, todas WebP', async () => {
  const original = await dosMitades(2400, 1600)
  const r = await generarVariantesCatalogo(original, { x: 400, y: 0, w: 1600, h: 1600 })
  assert.deepEqual([por(r, 'tarjeta').ancho, por(r, 'tarjeta').alto], [600, 600])
  assert.deepEqual([por(r, 'ficha').ancho, por(r, 'ficha').alto], [1200, 1200])
  assert.deepEqual([por(r, 'compartir').ancho, por(r, 'compartir').alto], [1200, 630])
  for (const v of r.variantes) {
    const m = await sharp(v.buffer).metadata()
    assert.equal(m.format, 'webp')
    assert.deepEqual([m.width, m.height], [v.ancho, v.alto])
  }
  assert.deepEqual([r.ancho, r.alto], [2400, 1600])
  assert.deepEqual(r.encuadre, { x: 400, y: 0, w: 1600, h: 1600, giro: 0, fondo: '#ffffff' })
})

test('el encuadre elige DE VERDAD la zona: izquierda → rojo, derecha → azul', async () => {
  const original = await dosMitades(2000, 1000)
  const izq = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 800, h: 800 })
  const der = await generarVariantesCatalogo(original, { x: 1200, y: 0, w: 800, h: 800 })
  assert.ok(esRojo(await colorEn(por(izq, 'tarjeta').buffer, 0.5, 0.5)))
  assert.ok(esAzul(await colorEn(por(der, 'tarjeta').buffer, 0.5, 0.5)))
})

test('la tarjeta de compartir muestra la foto ENTERA (nada recortado) centrada sobre un fondo desenfocado', async () => {
  // Arriba rojo, abajo azul, cuadrada: en compartir deben verse AMBOS colores en la columna central.
  const original = await dosFranjas(1000, 1000)
  const r = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 1000, h: 1000 })
  const compartir = por(r, 'compartir').buffer
  assert.ok(esRojo(await colorEn(compartir, 0.5, 0.05)), 'el rojo de arriba sigue visible')
  assert.ok(esAzul(await colorEn(compartir, 0.5, 0.95)), 'el azul de abajo sigue visible')
  // Los lados son el fondo desenfocado de la misma foto: una mezcla que no es blanca.
  const lado = await colorEn(compartir, 0.02, 0.5)
  assert.ok(!esBlanco(lado), 'los lados no son un hueco blanco')
})

test('GIRO: girar 90° mueve lo que estaba a la izquierda arriba, y las dimensiones se intercambian', async () => {
  // Foto 2000×1000, izquierda roja y derecha azul. Girada 90° (horario) queda 1000×2000: ROJO ARRIBA, AZUL ABAJO.
  const original = await dosMitades(2000, 1000)
  const arriba = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 1000, h: 1000, giro: 90 })
  const abajo = await generarVariantesCatalogo(original, { x: 0, y: 1000, w: 1000, h: 1000, giro: 90 })
  assert.ok(esRojo(await colorEn(por(arriba, 'tarjeta').buffer, 0.5, 0.5)))
  assert.ok(esAzul(await colorEn(por(abajo, 'tarjeta').buffer, 0.5, 0.5)))
  assert.equal(arriba.encuadre.giro, 90)
  // 180°: la izquierda pasa a la derecha.
  const medio = await generarVariantesCatalogo(original, { x: 0, y: 0, w: 1000, h: 1000, giro: 180 })
  assert.ok(esAzul(await colorEn(por(medio, 'tarjeta').buffer, 0.5, 0.5)), '180°: a la izquierda ahora hay azul')
  // Sin girar, el encuadre de abajo se saldría de la foto.
  await assert.rejects(generarVariantesCatalogo(original, { x: 0, y: 1000, w: 1000, h: 1000 }), ErrorDeImagen)
})

test('FOTO ALEJADA: lo que la foto no cubre se rellena con el color de fondo elegido', async () => {
  // Foto 1000×500 toda roja/azul en mitades; marco cuadrado alejado al máximo = 1000×1000 con la foto centrada en vertical.
  const original = await dosMitades(1000, 500)
  const blanco = await generarVariantesCatalogo(original, { x: 0, y: -250, w: 1000, h: 1000 })
  const tarjeta = por(blanco, 'tarjeta').buffer
  assert.ok(esBlanco(await colorEn(tarjeta, 0.5, 0.05)), 'arriba, fondo blanco')
  assert.ok(esBlanco(await colorEn(tarjeta, 0.5, 0.95)), 'abajo, fondo blanco')
  assert.ok(esRojo(await colorEn(tarjeta, 0.1, 0.5)), 'la foto sigue en el centro: rojo a la izquierda')
  assert.ok(esAzul(await colorEn(tarjeta, 0.9, 0.5)), 'la foto sigue en el centro: azul a la derecha')
  // Con fondo oscuro.
  const oscuro = await generarVariantesCatalogo(original, { x: 0, y: -250, w: 1000, h: 1000, fondo: '#0f172a' })
  assert.ok(esOscuro(await colorEn(por(oscuro, 'tarjeta').buffer, 0.5, 0.05)) || (await colorEn(por(oscuro, 'tarjeta').buffer, 0.5, 0.05))[2] < 80)
  assert.equal(oscuro.encuadre.fondo, '#0f172a')
  // Foto movida: pegada abajo del marco → el fondo queda todo arriba.
  const abajo = await generarVariantesCatalogo(original, { x: 0, y: -500, w: 1000, h: 1000 })
  const t = por(abajo, 'tarjeta').buffer
  assert.ok(esBlanco(await colorEn(t, 0.5, 0.2)), 'el hueco queda arriba')
  assert.ok(!esBlanco(await colorEn(t, 0.3, 0.9)), 'la foto queda abajo')
})

test('foto alejada Y girada a la vez', async () => {
  // 1000×500 girada 90° = 500×1000. Marco cuadrado alejado = 1000×1000: foto centrada en horizontal (x=-250).
  const original = await dosMitades(1000, 500)
  const r = await generarVariantesCatalogo(original, { x: -250, y: 0, w: 1000, h: 1000, giro: 90 })
  const t = por(r, 'tarjeta').buffer
  assert.ok(esBlanco(await colorEn(t, 0.05, 0.5)), 'a la izquierda, fondo')
  assert.ok(esBlanco(await colorEn(t, 0.95, 0.5)), 'a la derecha, fondo')
  assert.ok(esRojo(await colorEn(t, 0.5, 0.1)), 'rojo arriba (la izquierda original girada)')
  assert.ok(esAzul(await colorEn(t, 0.5, 0.9)), 'azul abajo')
})

test('respeta la rotación EXIF: el encuadre se aplica sobre la imagen ORIENTADA', async () => {
  // Archivo en crudo 2000×1000 con orientación 6 (girar 90°): el navegador la ve 1000×2000.
  const original = await dosMitades(2000, 1000, 'jpeg', 6)
  const dims = await dimensionesOrientadas(original)
  assert.deepEqual(dims, { ancho: 1000, alto: 2000 })
  const r = await generarVariantesCatalogo(original, { x: 0, y: 1000, w: 1000, h: 1000 })
  assert.deepEqual([r.ancho, r.alto], [1000, 2000])
  await assert.rejects(generarVariantesCatalogo(await dosMitades(2000, 1000, 'jpeg'), { x: 0, y: 1000, w: 1000, h: 1000 }), ErrorDeImagen)
})

test('EXIF y giro se suman: orientación 6 (se ve 1000×2000) + giro 90° da una foto de 2000×1000', async () => {
  const original = await dosMitades(2000, 1000, 'jpeg', 6)
  // Foto 2000×1000 (ya girada), marco cuadrado alejado al máximo = 2000×2000 con la foto centrada en vertical.
  const ok = await generarVariantesCatalogo(original, { x: 0, y: -500, w: 2000, h: 2000, giro: 90 })
  assert.deepEqual([ok.ancho, ok.alto], [1000, 2000], 'las dimensiones que se guardan son las orientadas y SIN girar')
  assert.equal(ok.encuadre.giro, 90)
  assert.ok(esBlanco(await colorEn(por(ok, 'tarjeta').buffer, 0.5, 0.05)), 'sobra fondo arriba')
  // Sin el giro, ese mismo marco no sería válido: la foto orientada es 1000×2000, no 2000×1000.
  await assert.rejects(generarVariantesCatalogo(original, { x: 0, y: -500, w: 2000, h: 2000 }), ErrorDeImagen)
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

test('rechaza un encuadre que no es de fiar (con un mensaje que se puede enseñar)', async () => {
  const original = await dosMitades(1000, 1000)
  const malos = [
    null,
    {},
    { x: 0, y: 0, w: 2000, h: 2000 },
    { x: 0, y: 0, w: 900, h: 300 },
    { x: 0, y: 0, w: 500, h: 500, giro: 45 },
    { x: 0, y: 0, w: 500, h: 500, fondo: 'url(x)' },
  ]
  for (const malo of malos) {
    await assert.rejects(generarVariantesCatalogo(original, malo), (e: unknown) => e instanceof ErrorDeImagen && e.message.length > 0)
  }
})

test('un archivo que no es una imagen decodificable lanza (no devuelve basura)', async () => {
  await assert.rejects(generarVariantesCatalogo(Buffer.from('esto no es una imagen'), { x: 0, y: 0, w: 500, h: 500 }))
})
