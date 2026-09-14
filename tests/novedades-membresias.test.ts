/**
 * NOVEDADES · membresías y promociones vigentes.
 *
 * El feed enseñaba solo lo publicado en los últimos 14 días y NO enseñaba
 * membresías. Con eso, un negocio que lleva tres meses con el mismo plan y la
 * misma promoción tenía la pantalla vacía, y el cliente concluía que no había
 * nada que comprar. La quincena no describía el catálogo: lo escondía.
 *
 * Lo que se vigila aquí:
 *
 *  1. Que lo VIGENTE entre, y que lo reciente se MARQUE en vez de ser el filtro
 *     —si no, «Novedades» dejaría de significar algo—.
 *  2. Que las membresías salgan con precio y con qué incluyen: una fila sin
 *     cifras es la única del feed con la que no se puede decidir.
 *  3. Que las empresas de práctica NO se cuelen. Es regla fija del producto.
 *  4. Que los posts sigan caducando: una noticia vieja sí es vieja.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resumenDePlan } from '../src/modules/planes/resumen'

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const QUERIES = ['src', 'modules', 'social', 'queries.ts']
const FEED = ['src', 'components', 'cliente', 'FeedNovedades.tsx']

// ── La línea que explica el plan ─────────────────────────────────────────────

test('un plan con usos dice cuántos y por cuánto tiempo', () => {
  assert.equal(resumenDePlan(false, 4, 30), '4 usos · 30 días')
})

test('el singular se respeta en las dos cifras', () => {
  // La regla de la casa: `plural()`, nunca «1 usos» ni «1 días».
  assert.equal(resumenDePlan(false, 1, 1), '1 uso · 1 día')
})

test('el ilimitado no inventa un número', () => {
  assert.equal(resumenDePlan(true, 0, 30), 'Ilimitado · 30 días')
  // Aunque traiga usos declarados: si es ilimitado, el número sobra y
  // enseñarlo haría dudar de cuál de los dos manda.
  assert.equal(resumenDePlan(true, 4, 30), 'Ilimitado · 30 días')
})

test('cero usos no se escribe como «0 usos»', () => {
  // Un plan de solo vigencia (acceso, descuentos) sí da algo. «0 usos» lo
  // describiría como un plan que no da nada.
  assert.equal(resumenDePlan(false, 0, 30), '30 días')
})

// ── Lo vigente entra; lo reciente se marca ───────────────────────────────────

/** El cuerpo de `getNovedadesInicio`, y solo ese: el archivo tiene otras
 *  consultas de promociones con reglas propias que no se tocan aquí. */
function feedFuente(): string {
  const src = fuente(...QUERIES)
  const i = src.indexOf('export async function getNovedadesInicio')
  assert.ok(i > 0, 'no se encontró getNovedadesInicio')
  return src.slice(i, src.indexOf('\n}\n', i))
}

test('las promociones ya no se filtran por «publicadas esta quincena»', () => {
  const src = feedFuente()
  const i = src.indexOf('tx.promocion.findMany')
  const bloque = src.slice(i, src.indexOf('take: limit', i))
  assert.doesNotMatch(bloque, /publicadaEn: \{ gte: hace14dias \}/)
  // Lo que sí acota es la vigencia, que es lo que de verdad dice si sirve.
  assert.match(bloque, /vigenciaHasta/)
})

test('lo reciente se marca en vez de filtrar', () => {
  assert.match(feedFuente(), /nuevo: esNuevo\(/)
  assert.match(fuente(...FEED), /n\.nuevo &&/)
})

test('lo nuevo se ordena primero', () => {
  // Sin esto, un plan de hace seis meses empujaría fuera del corte la promoción
  // de ayer, y la pantalla dejaría de avisar de lo que sí es novedad.
  assert.match(feedFuente(), /if \(a\.nuevo !== b\.nuevo\) return a\.nuevo \? -1 : 1/)
})

test('los posts SÍ siguen caducando', () => {
  // Una noticia de hace tres meses es vieja, y un evento pasado no sirve. Lo
  // que se corrigió fue tratar un catálogo como si fuera un titular, no
  // convertir el feed en un archivo.
  const src = feedFuente()
  const i = src.indexOf('tx.companyPost.findMany')
  const bloque = src.slice(i, src.indexOf('take: limit', i))
  assert.match(bloque, /publicadaEn: \{ gte: hace14dias \}/)
  assert.match(bloque, /fechaEvento: \{ gte: now \}/)
})

// ── Membresías ───────────────────────────────────────────────────────────────

test('las membresías entran al feed desde los planes activos', () => {
  const src = feedFuente()
  assert.match(src, /tx\.plan\.findMany\(/)
  assert.match(src, /tipo: 'MEMBRESIA'/)
})

test('la fila de membresía enseña precio y qué incluye', () => {
  const src = feedFuente()
  assert.match(src, /precio: Number\(p\.precio\)/)
  assert.match(src, /incluye: resumenDePlan\(/)
  const feed = fuente(...FEED)
  assert.match(feed, /n\.tipo === 'MEMBRESIA'/)
  assert.match(feed, /formatMoneyRD\(n\.precio\)/)
})

test('la membresía tiene su rótulo y su acción propios', () => {
  // Sin entrada en TIPO_META caería en el de «Noticia», y la fila diría
  // «Leer más» sobre un plan que se compra.
  assert.match(fuente(...FEED), /MEMBRESIA: \{ label: 'Membresía'/)
})

test('la membresía abre su ficha, no una lista', () => {
  // Mandar a `/cliente/planes` obligaría a volver a buscar lo que se acaba de
  // tocar.
  assert.match(feedFuente(), /href: `\/plan\/\$\{p\.id\}`/)
})

// ── Reglas fijas del producto ────────────────────────────────────────────────

test('las empresas de práctica no se cuelan en el feed', () => {
  const src = feedFuente()
  assert.match(src, /company: \{ esDemo: false \}/)
  // Y se aplica a las TRES consultas, no solo a la nueva.
  assert.equal((src.match(/\.\.\.empresaReal/g) ?? []).length, 3)
})

test('las promociones archivadas o privadas no son novedad de nadie', () => {
  const src = feedFuente()
  assert.match(src, /archivada: false/)
  assert.match(src, /visibilidad: 'publica'/)
})

test('el feed sigue siendo de las empresas que se siguen', () => {
  // Es una decisión, no un olvido: sin ese límite la pantalla sería el catálogo
  // entero de MembeGo y dejaría de ser de nadie.
  assert.match(feedFuente(), /tx\.companyFollow\.findMany\(/)
})

test('un fallo del feed no rompe la pantalla', () => {
  const src = fuente(...QUERIES)
  const i = src.indexOf('export async function getNovedadesInicio')
  assert.match(src.slice(i), /catch \(e\) \{[\s\S]*?return \[\]/)
})

test('todo cruza empresas con motivo declarado', () => {
  assert.match(fuente(...QUERIES), /sinEmpresa\(\s*'social: novedades de empresas seguidas/)
})
