import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManifiestoTabla, type FilaManifiesto } from '../src/components/excursiones/ManifiestoTabla'
import { RankingEquipoTabla, type FilaRanking } from '../src/components/excursiones/RankingEquipoTabla'

/**
 * EL MANIFIESTO DEL DÍA Y EL RANKING DEL EQUIPO, EN LA TABLA DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-04, T-10).
 *
 * El manifiesto tenía un `take: 500` que cortaba el día sin decirlo: con 600 salidas, los totales de arriba contaban 500 y nadie lo
 * sabía. Ahora la consulta devuelve el total real y la pantalla avisa. La consulta contra la base se verificó en el entorno de QA.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const fila = (extra: Partial<FilaManifiesto> = {}): FilaManifiesto => ({
  id: 'r1',
  hora: '08:30',
  cliente: 'Ana Pérez',
  telefono: '809-555-0100',
  excursion: 'Isla Saona',
  esCombo: false,
  totalItems: 0,
  itemsCompletados: 0,
  totalPasajeros: 4,
  presentes: 0,
  checkinAt: null,
  ...extra,
})

const pinta = (filas: FilaManifiesto[]) => renderToStaticMarkup(h(ManifiestoTabla, { filas, dia: '2026-10-21' }) as never)

// ── Manifiesto ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('manifiesto · tabla de servidor: caption con el día, cliente como identificador con su enlace y el teléfono debajo', () => {
  const html = pinta([fila()])
  assert.match(html, /<caption[^>]*>[^<]*Manifiesto de las salidas del 2026-10-21/)
  assert.match(html, /scope="col"/)
  assert.match(html, /<th[^>]*scope="row"[^>]*>[\s\S]*href="\/admin\/excursiones\/reservas\/r1"[^>]*>Ana Pérez/)
  assert.match(html, /809-555-0100/)
})

test('manifiesto · el embarque se dice con texto, no solo con color', () => {
  assert.match(pinta([fila()]), />Sin embarcar</)
  assert.match(pinta([fila({ checkinAt: '2026-10-21T12:00:00Z', presentes: 4 })]), />Completo</)
  assert.match(pinta([fila({ checkinAt: '2026-10-21T12:00:00Z', presentes: 2 })]), />Parcial</)
})

test('manifiesto · en un combo cuenta las actividades, no solo la reserva', () => {
  const combo = { esCombo: true, totalItems: 3 }
  assert.match(pinta([fila({ ...combo })]), /Sin embarcar \(0\/3\)/)
  assert.match(pinta([fila({ ...combo, itemsCompletados: 2, checkinAt: '2026-10-21T12:00:00Z' })]), /Parcial[\s\S]*\(2\/3 acts\)/)
  assert.match(pinta([fila({ ...combo, itemsCompletados: 3, checkinAt: '2026-10-21T12:00:00Z' })]), /Completo[\s\S]*\(3\/3 acts\)/)
})

test('manifiesto · la excursión y la hora se ocultan en pantalla estrecha (la hora baja al cliente), pero cliente, pax y embarque no', () => {
  const html = pinta([fila()])
  const encabezado = (texto: string) => html.match(new RegExp(`<th[^>]*>${texto}</th>`))?.[0] ?? ''
  assert.match(encabezado('Excursión'), /hidden/)
  assert.match(encabezado('Hora'), /hidden/)
  assert.match(html, /md:hidden[^>]*>08:30</, 'la hora no se pierde: baja bajo el nombre del cliente')
  for (const siempre of ['Cliente', 'Pax', 'Embarque']) {
    assert.doesNotMatch(encabezado(siempre), /hidden/, siempre)
  }
})

test('manifiesto · «Pax» es presentes sobre pasajeros y va a la derecha', () => {
  const html = pinta([fila({ presentes: 3, totalPasajeros: 4 })])
  assert.match(html, /<td[^>]*text-right[^>]*>3\/4</)
})

test('manifiesto · sin salidas dice que no hay, con una sola celda que abarca todas las columnas y ninguna reserva', () => {
  const html = pinta([])
  assert.match(html, /No hay salidas registradas para ese día/)
  assert.equal((html.match(/<td/g) ?? []).length, 1)
  assert.match(html, /<td colSpan="5">/)
  assert.doesNotMatch(html, /\/admin\/excursiones\/reservas\//)
})

// ── La consulta y la pantalla de check-in ──────────────────────────────────────────────────────────────────────────

test('check-in · la consulta cuenta el total del día, expone si se truncó y no deja un take fijo suelto', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/checkin/queries.ts', 'utf8'))
  assert.match(src, /export const LIMITE_MANIFIESTO = 500/)
  assert.match(src, /take: LIMITE_MANIFIESTO/)
  assert.doesNotMatch(src, /take: \d+/, 'un take numérico suelto es el corte silencioso')
  assert.match(src, /tx\.reservaExc\.count\(\{ where: donde \}\)/, 'el total real del día')
  assert.match(src, /truncado: totalDelDia > filas\.length/)
  assert.match(src, /truncado: false/, 'el día vacío tampoco queda sin el campo')
  // La misma condición para traer las filas y para contarlas: si divergen, el aviso miente.
  assert.equal((src.match(/where: donde/g) ?? []).length, 2)
})

test('check-in · la pantalla avisa cuando no cupieron todas las salidas y usa la tabla de servidor', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/checkin/page.tsx', 'utf8'))
  assert.match(pagina, /\{truncado \? \(/)
  assert.match(pagina, /totalDelDia\.toLocaleString\('es-DO'\)/)
  assert.match(pagina, /LIMITE_MANIFIESTO/)
  assert.match(pagina, /<ManifiestoTabla filas=\{filas\} dia=\{elegido\}/)
  assert.doesNotMatch(pagina, /<table/)
})

// ── Ranking ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ranking = (extra: Partial<FilaRanking> = {}): FilaRanking => ({
  id: 'v1',
  nombre: 'Luis Gómez',
  codigo: 'LG01',
  captados: 12,
  ventas: 7,
  pasajeros: 21,
  ingresos: 4500,
  moneda: 'USD',
  ...extra,
})

test('ranking · caption, vendedor como identificador con su código, conteos a la derecha y la moneda en el encabezado', () => {
  const html = renderToStaticMarkup(h(RankingEquipoTabla, { filas: [ranking()], monedaDefecto: 'USD' }) as never)
  assert.match(html, /<caption[^>]*>[^<]*Equipo de vendedores en este período, por ingresos/)
  assert.match(html, /<th[^>]*scope="row"[^>]*>[\s\S]*href="\/admin\/excursiones\/vendedores\/v1"[^>]*>Luis Gómez/)
  assert.match(html, /LG01/)
  assert.match(html, /Ingresos \(USD\)/)
  assert.match(html, /<td[^>]*text-right[^>]*>12</)
})

test('ranking · los pasajeros (de menos prioridad) se ocultan en pantalla estrecha; el vendedor y los ingresos no', () => {
  const html = renderToStaticMarkup(h(RankingEquipoTabla, { filas: [ranking()], monedaDefecto: 'USD' }) as never)
  const encabezado = (texto: string) => html.match(new RegExp(`<th[^>]*>${texto}[^<]*</th>`))?.[0] ?? ''
  assert.match(encabezado('Pasajeros'), /hidden/)
  assert.doesNotMatch(encabezado('Vendedor'), /hidden/)
  assert.doesNotMatch(encabezado('Ingresos'), /hidden/)
})

test('ranking · cada fila conserva la moneda de sus ingresos', () => {
  const html = renderToStaticMarkup(
    h(RankingEquipoTabla, { filas: [ranking({ moneda: 'DOP', ingresos: 1000 }), ranking({ id: 'v2', nombre: 'Marta Ruiz', moneda: 'USD', ingresos: 20 })], monedaDefecto: 'USD' }) as never
  )
  assert.match(html, /RD\$|DOP/)
  assert.match(html, /US\$|USD/)
})

test('el panel de excursiones usa la tabla del ranking y ya no pinta una <table> a mano', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/page.tsx', 'utf8'))
  assert.match(pagina, /<RankingEquipoTabla filas=\{ranking\}/)
  assert.doesNotMatch(pagina, /<table/)
})
