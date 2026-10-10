import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROUTE_PROTECTION } from '../src/types'
import { ESPACIO_DE, MARCA_FIN, MARCA_INICIO, rutasDe, sinClasificar, tablaMarkdown } from '../scripts/docs/rutas-por-espacio'

/**
 * SEPARACIÓN LANDING · APP — F6: cada ruta pertenece a un espacio, y el documento lo dice.
 *
 * La tabla de `docs/SEPARACION_LANDING_APP.md` sale de `scripts/docs/rutas-por-espacio.ts`. Si esta prueba falla porque
 * la tabla cambió: `bun run docs:rutas` la regenera. Si falla porque hay una ruta sin espacio: hay que decidir de cuál es
 * (landing que informa, app donde se opera, panel…) y anotarlo en `ESPACIO_DE`.
 */

const rutas = rutasDe()

test('toda página y todo handler de src/app pertenece a un espacio', () => {
  assert.ok(rutas.length > 400, 'el generador debe ver todas las rutas')
  const sin = sinClasificar(rutas).map((r) => `${r.url} (${r.archivo})`)
  assert.deepEqual(sin, [], 'una ruta o un grupo de rutas nuevo no tiene espacio: clasifícalo en ESPACIO_DE (scripts/docs/rutas-por-espacio.ts)')
})

test('cada espacio clasificado se usa: no hay entradas muertas en el mapa', () => {
  const usados = new Set(rutas.map((r) => r.archivo.replace(/^src\/app\//, '').split('/')[0]))
  const muertas = Object.keys(ESPACIO_DE).filter((k) => !usados.has(k))
  assert.deepEqual(muertas, [], 'una carpeta clasificada ya no existe: quítala de ESPACIO_DE')
})

test('la tabla del documento es la que sale del código', () => {
  const doc = readFileSync('docs/SEPARACION_LANDING_APP.md', 'utf8')
  const a = doc.indexOf(MARCA_INICIO)
  const b = doc.indexOf(MARCA_FIN)
  assert.ok(a >= 0 && b > a, 'el documento debe tener las marcas de la tabla de rutas')
  const enElDoc = doc.slice(a, b + MARCA_FIN.length)
  assert.equal(enElDoc, tablaMarkdown(rutas), 'la tabla de rutas del documento está desfasada: corre `bun run docs:rutas`')
})

test('los espacios no se cruzan: lo protegido nunca es landing, enlaces ni acceso, y la landing nunca está bajo un prefijo protegido', () => {
  const protegido = (url: string) => ROUTE_PROTECTION.some((r) => url === r.prefix || url.startsWith(r.prefix + '/'))
  for (const r of rutas.filter((x) => x.espacio === 'landing' || x.espacio === 'enlaces' || x.espacio === 'acceso')) {
    assert.equal(protegido(r.url), false, `${r.url} (${r.espacio}) está bajo un prefijo protegido de ROUTE_PROTECTION`)
  }
  for (const r of rutas.filter((x) => protegido(x.url))) {
    assert.ok(r.espacio === 'cliente' || r.espacio === 'paneles', `${r.url} es protegida pero está clasificada como ${r.espacio}`)
  }
})

test('lo operativo del cliente está bajo /cliente (salvo las dos pantallas de membresías, que se quedan por la app móvil)', () => {
  const fuera = rutas
    .filter((r) => r.espacio === 'cliente')
    .map((r) => r.url)
    .filter((u) => !u.startsWith('/cliente/'))
    .sort()
  assert.deepEqual(fuera, ['/membresia/[membresiaId]', '/mis-membresias'])
})

test('la landing no tiene rutas de carrito, pago ni checkout', () => {
  const operativas = rutas.filter((r) => r.espacio === 'landing' && /\/(carrito|checkout|pagar|pago)(\/|$)/.test(r.url)).map((r) => r.url)
  assert.deepEqual(operativas, [])
})
