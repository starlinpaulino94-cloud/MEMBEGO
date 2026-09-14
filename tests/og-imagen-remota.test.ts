/**
 * NINGUNA TARJETA OG LE PIDE UNA URL REMOTA A SATORI.
 *
 * `src/lib/share/og.tsx` ya lo dice en `fetchImageDataUrl`: la imagen se
 * descarga en nuestro código —con timeout, tope de tamaño y comprobación de
 * formato— y se incrusta como data URL, «cualquier problema → null y la tarjeta
 * cae al diseño degradado, nunca a una imagen rota».
 *
 * La ruta de promociones era la única que se saltaba la regla: pasaba
 * `og.imagenUrl` directo al `<img>`. Cuando esa URL no responde —bucket sin
 * lectura pública, formato que satori no rasteriza, enlace caducado— satori
 * LANZA, el endpoint devuelve 500, y quien mira ve una imagen rota: en el panel
 * y, peor, en WhatsApp. Es lo que se vio el 14-09-2026.
 *
 * Y el fallo estaba encadenado: la ruta ya había intentado descargar ESA MISMA
 * URL con `originalImageResponse`. Llegar al `<img>` significaba que la descarga
 * había fallado, así que el plan B pedía otra vez lo que acababa de no
 * funcionar.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..', 'src', 'app')

function rutasOg(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) rutasOg(p, out)
    else if (/^(opengraph|twitter)-image\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('hay rutas OG que revisar', () => {
  // Sin esto, un renombrado dejaría la prueba pasando sobre cero archivos.
  assert.ok(rutasOg(RAIZ).length >= 5, 'se esperaban al menos cinco tarjetas OG')
})

test('ningún <img> de una tarjeta OG recibe una URL, solo una data URL', () => {
  for (const ruta of rutasOg(RAIZ)) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    // Cada `src={...}` de un `<img>` en estos archivos. Lo que se admite es una
    // variable local —el resultado de `fetchImageDataUrl`—, nunca un campo de
    // los datos (`og.imagenUrl`, `empresa.logoUrl`, …), que es una URL remota.
    for (const m of src.matchAll(/<img[\s\S]{0,400}?src=\{([^}]+)\}/g)) {
      const expr = m[1].trim()
      assert.ok(
        !expr.includes('.'),
        `${ruta}: <img src={${expr}}> pasa una URL remota a satori. ` +
          'Descárgala antes con `fetchImageDataUrl` y pásale el resultado; ' +
          'si da null, cae al diseño sin foto.'
      )
    }
  }
})

test('quien tenga imagen usa el ayudante que la descarga', () => {
  for (const ruta of rutasOg(RAIZ)) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    if (!/<img/.test(src)) continue
    assert.match(
      src,
      /fetchImageDataUrl\(|shareCardResponse\(/,
      `${ruta}: pinta una imagen sin pasar por fetchImageDataUrl ni shareCardResponse`
    )
  }
})

test('la regla sigue escrita donde se aplica', () => {
  // Si alguien relaja `fetchImageDataUrl` para que propague el error en vez de
  // devolver null, estas pruebas seguirían pasando y las tarjetas volverían a
  // romperse. El contrato es el `null`.
  const og = readFileSync(join(__dirname, '..', 'src', 'lib', 'share', 'og.tsx'), 'utf8')
  assert.match(og, /nunca a una imagen rota/)
  const cuerpo = og.slice(og.indexOf('export async function fetchImageDataUrl'))
  const fn = cuerpo.slice(0, cuerpo.indexOf('\n}'))
  assert.match(fn, /catch\s*\{\s*return null/, 'un fallo de red debe dar null, no lanzar')
  assert.ok(!/throw/.test(fn), 'fetchImageDataUrl no debe lanzar nunca')
})

test('el tamaño del archivo no se mide por un número suelto', () => {
  // `OG_MAX_BYTES` es el mismo tope que se admite al subir: dos números
  // distintos dejarían imágenes que se pueden subir y no se pueden compartir.
  const og = readFileSync(join(__dirname, '..', 'src', 'lib', 'share', 'og.tsx'), 'utf8')
  assert.match(og, /buf\.length > OG_MAX_BYTES/)
})

test('la vista previa del panel apunta a la tarjeta real, no a otra imagen', () => {
  // Si apuntara a `imagenUrl` directamente, enseñaría algo distinto de lo que
  // recibe quien abre el enlace, que es justo lo que esta tarjeta existe para
  // evitar.
  const editar = readFileSync(
    join(__dirname, '..', 'src', 'app', '(admin)', 'admin', 'promociones', '[id]', 'editar', 'page.tsx'),
    'utf8'
  )
  assert.match(editar, /opengraph-image/)
})

test('los archivos OG existen donde la prueba los busca', () => {
  assert.ok(statSync(join(RAIZ, '(public)', 'promocion', '[clave]', 'opengraph-image.tsx')).isFile())
})
