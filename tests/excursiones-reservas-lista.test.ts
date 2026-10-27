import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LARGO_MAXIMO_BUSQUEDA,
  OPCIONES_VER_RESERVAS,
  condicionDeEstado,
  leerFiltrosReservas,
  tonoDeReserva,
} from '../src/modules/excursiones/reservas/lista'
import { ESTADOS_CERRADOS, ESTADOS_RESERVA, ESTADO_RESERVA_LABEL } from '../src/modules/excursiones/reservas/nucleo'
import { ReservasTabla, type ReservaFila } from '../src/components/excursiones/ReservasTabla'
import { TONOS_ESTADO } from '../packages/ui/src/ui/estado-chip'

/**
 * LAS RESERVAS DE PARQUES Y TOURS, COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Era una lista de cliente: 200 reservas, y la búsqueda y las «archivadas» filtraban esas 200 en el navegador (la 201 no existía
 * para nadie). Aquí se prueba lo que ahora decide el servidor —cómo se leen los filtros de la URL, qué condición producen— y el
 * marcado de la tabla; la consulta contra la base se verificó en el entorno de QA.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── Los filtros de la URL ────────────────────────────────────────────────────

test('sin parámetros: las abiertas y sin búsqueda', () => {
  assert.deepEqual(leerFiltrosReservas({}), { q: '', ver: 'abiertas' })
})

test('«todas» y cada estado se entienden; lo que no existe vuelve a «abiertas» en vez de romper la pantalla', () => {
  assert.equal(leerFiltrosReservas({ ver: 'todas' }).ver, 'todas')
  for (const e of ESTADOS_RESERVA) assert.equal(leerFiltrosReservas({ ver: e }).ver, e)
  for (const basura of ['', 'ARCHIVADAS', 'completada', "'; drop table", '%20']) {
    assert.equal(leerFiltrosReservas({ ver: basura }).ver, 'abiertas', basura)
  }
})

test('la búsqueda se recorta y se acota a un largo humano; un parámetro repetido cuenta una vez', () => {
  assert.equal(leerFiltrosReservas({ q: '  RX-0042  ' }).q, 'RX-0042')
  assert.equal(leerFiltrosReservas({ q: 'a'.repeat(500) }).q.length, LARGO_MAXIMO_BUSQUEDA)
  assert.deepEqual(leerFiltrosReservas({ q: ['uno', 'dos'], ver: ['PAGADA', 'todas'] }), { q: 'uno', ver: 'PAGADA' })
})

test('«abiertas» deja fuera exactamente los estados cerrados; «todas» no filtra; un estado filtra por él', () => {
  assert.deepEqual(condicionDeEstado('abiertas'), { estado: { notIn: [...ESTADOS_CERRADOS] } })
  assert.deepEqual(ESTADOS_CERRADOS.slice().sort(), ['CANCELADA', 'COMPLETADA', 'NO_SHOW'])
  assert.deepEqual(condicionDeEstado('todas'), {})
  assert.deepEqual(condicionDeEstado('PAGADA'), { estado: 'PAGADA' })
})

test('el selector ofrece «todas» y los siete estados con su texto; «abiertas» es el valor por defecto y no va en la lista', () => {
  assert.deepEqual(
    OPCIONES_VER_RESERVAS.map((o) => o.valor),
    ['todas', ...ESTADOS_RESERVA]
  )
  for (const e of ESTADOS_RESERVA) assert.equal(OPCIONES_VER_RESERVAS.find((o) => o.valor === e)?.etiqueta, ESTADO_RESERVA_LABEL[e])
})

test('cada estado tiene un tono del sistema de diseño; uno que no se conoce es neutro, no un error', () => {
  for (const e of ESTADOS_RESERVA) assert.ok((TONOS_ESTADO as readonly string[]).includes(tonoDeReserva(e)), e)
  assert.equal(tonoDeReserva('PAGADA'), 'exito')
  assert.equal(tonoDeReserva('PENDIENTE'), 'aviso')
  assert.equal(tonoDeReserva('NO_SHOW'), 'peligro')
  assert.equal(tonoDeReserva('CANCELADA'), 'neutro')
  assert.equal(tonoDeReserva('INVENTADO'), 'neutro')
})

// ── La tabla ─────────────────────────────────────────────────────────────────

const FILA: ReservaFila = {
  id: 'r1', numero: 'RX-0042', cliente: 'María Pérez', excursion: 'Isla Saona', fecha: new Date('2026-10-25T12:00:00Z'), hora: '08:30',
  pasajeros: 4, total: 12000, saldo: 4500, moneda: 'DOP', vendedor: null, estado: 'PARCIALMENTE_PAGADA',
}
const VACIO = { titulo: 'Todavía no hay reservas', descripcion: 'Crea la primera.' }
const SIN = { titulo: 'Ninguna reserva coincide con la búsqueda' }
const pinta = (filas: ReservaFila[] = [FILA], extra: Partial<Parameters<typeof ReservasTabla>[0]> = {}) =>
  renderToStaticMarkup(h(ReservasTabla, { filas, vacio: VACIO, sinResultados: SIN, hayFiltros: false, ...extra }) as never)

test('la tabla lleva caption y scope, y el número de la reserva es el identificador de la fila con su enlace al expediente', () => {
  const html = pinta()
  assert.match(html, /<caption class="sr-only">Reservas de excursiones, las más recientes primero<\/caption>/)
  assert.equal((html.match(/<th[^>]*scope="col"/g) ?? []).length, 9)
  assert.match(html, /<th[^>]*scope="row"[^>]*>\s*<a[^>]*href="\/admin\/excursiones\/reservas\/r1"[^>]*>RX-0042<\/a>/)
})

test('el dinero va a la derecha con cifras tabulares, en la moneda de la reserva; sin saldo se dice', () => {
  const html = pinta()
  assert.match(html, /<td[^>]*text-right tabular-nums[^>]*>[^<]*12[.,]000[^<]*<\/td>/)
  assert.match(html, /4[.,]500/)
  const sinSaldo = pinta([{ ...FILA, saldo: 0 }])
  assert.match(sinSaldo, /<span class="sr-only">Sin saldo<\/span>/)
})

test('la fecha va en <time>, el vendedor vacío es «Directa» y el estado se dice con texto', () => {
  const html = pinta()
  assert.match(html, /<time dateTime="2026-10-25T12:00:00\.000Z">/)
  assert.match(html, /· 08:30/)
  assert.match(html, />Directa</)
  assert.match(html, /Abonada/)
  assert.match(pinta([{ ...FILA, vendedor: 'Ana Gómez' }]), /Ana Gómez/)
})

test('en pantalla estrecha se ocultan las columnas de menos prioridad, NUNCA el estado ni el identificador', () => {
  const cabecera = pinta().slice(pinta().indexOf('<thead>'), pinta().indexOf('</thead>'))
  const th = (nombre: string) => cabecera.match(new RegExp(`<th[^>]*>${nombre}</th>`))?.[0] ?? ''
  assert.match(th('Excursión'), /max-md:hidden/)
  assert.match(th('Vendedor'), /max-md:hidden/)
  assert.match(th('Pax'), /max-lg:hidden/)
  for (const n of ['Número', 'Estado', 'Total']) assert.doesNotMatch(th(n), /max-md:hidden|max-lg:hidden/, n)
})

test('el vacío dice la verdad: no hay reservas, o el filtro no encontró ninguna', () => {
  const real = pinta([], { hayFiltros: false })
  assert.match(real, /Todavía no hay reservas/)
  const filtrado = pinta([], { hayFiltros: true })
  assert.match(filtrado, /Ninguna reserva coincide con la búsqueda/)
  assert.doesNotMatch(filtrado, /Todavía no hay reservas/)
})

// ── La consulta y la pantalla ────────────────────────────────────────────────

test('la consulta pagina en la base, cuenta el total y ya no corta en silencio a 200', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/reservas/queries.ts', 'utf8'))
  const lista = src.slice(src.indexOf('export async function listarReservas'), src.indexOf('export async function reservaDetalle'))
  assert.match(lista, /skip: paginacion\.saltar/)
  assert.match(lista, /take: paginacion\.tomar/)
  assert.match(lista, /tx\.reservaExc\.count\(\{ where \}\)/, 'el total real, para decir «N de M»')
  assert.doesNotMatch(lista, /take: 200/, 'el tope silencioso se fue')
  assert.doesNotMatch(src, /export async function listadoReservas/)
})

test('la búsqueda resuelve nombres en la base (cliente, excursión, vendedor), no en el navegador', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/reservas/queries.ts', 'utf8'))
  const lista = src.slice(src.indexOf('export async function listarReservas'))
  assert.match(lista, /tx\.cliente\.findMany/)
  assert.match(lista, /tx\.excursion\.findMany/)
  assert.match(lista, /tx\.vendedor\.findMany/)
  assert.match(lista, /mode: 'insensitive'/)
  // Todo dentro de la empresa: ningún id de otra empresa puede colarse por un nombre parecido.
  assert.equal((lista.match(/companyId/g) ?? []).length >= 6, true)
})

test('la pantalla usa BarraFiltros, la Tabla de servidor y TablaPaginacion; el componente de cliente ya no existe', () => {
  assert.ok(!existsSync('src/components/excursiones/ReservasLista.tsx'))
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/reservas/page.tsx', 'utf8'))
  assert.match(pagina, /<BarraFiltros/)
  assert.match(pagina, /<ReservasTabla/)
  assert.match(pagina, /<TablaPaginacion paginacion=\{paginacion\} total=\{total\}/)
  assert.match(pagina, /leerPaginacion\(sp\)/)
  assert.doesNotMatch(pagina, /ListaToolbar|use client|useState/)
  const tabla = sinComentarios(readFileSync('src/components/excursiones/ReservasTabla.tsx', 'utf8'))
  assert.doesNotMatch(tabla, /'use client'|useState|<table/)
})

test('un listado vacío por «abiertas» no dice «todavía no hay reservas» si las hay cerradas', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/reservas/page.tsx', 'utf8'))
  assert.match(pagina, /soloCerradas/)
  assert.match(pagina, /No hay reservas abiertas/)
  assert.match(pagina, /Ver todas/)
})
