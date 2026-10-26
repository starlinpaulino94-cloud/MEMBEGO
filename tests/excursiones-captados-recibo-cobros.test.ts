import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { condicionesDeCaptados, hayFiltrosCaptados, leerFiltrosCaptados } from '../src/modules/excursiones/vendedores/lista'
import { CANALES_ATRIBUCION, CANAL_ATRIBUCION_LABEL } from '../src/modules/excursiones/atribucion/nucleo'
import { ClientesCaptadosTabla, type ClienteCaptadoFila } from '../src/components/excursiones/ClientesCaptadosTabla'
import {
  BonosLiquidacionTabla,
  ComisionesLiquidacionTabla,
  type BonoLiquidacion,
  type LineaLiquidacion,
} from '../src/components/excursiones/LiquidacionLineasTablas'

/**
 * CLIENTES CAPTADOS, RECIBO DE LA LIQUIDACIÓN Y COBROS DE LA RESERVA, EN LA TABLA DEL SISTEMA (auditoría admin · fase 7, tarea 7.1).
 *
 * Los captados ya paginaban en servidor, pero con un formulario de cliente y una paginación hechos a mano; el recibo y los cobros
 * eran `<table>` sueltas. Aquí: los filtros de la URL (con los nombres de siempre), el marcado de las tablas y que no quede
 * ninguna tabla cruda en esas pantallas.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const html = (n: unknown) => renderToStaticMarkup(n as never)

// ── Captados: filtros ───────────────────────────────────────────────────────────────────────────────────────────────

test('captados · sin parámetros no hay filtro; con basura tampoco; los nombres de siempre se siguen leyendo', () => {
  const vacio = { q: '', etapa: '', canal: '', desde: '', hasta: '' }
  assert.deepEqual(leerFiltrosCaptados({}), vacio)
  assert.deepEqual(leerFiltrosCaptados({ etapa: 'TODAS', canal: 'TODOS', desde: '2026-02-31' }), vacio, 'los valores «TODAS/TODOS» de antes son «sin filtro»')
  const f = leerFiltrosCaptados({ q: ' ana ', etapa: 'COMPRA', canal: 'WHATSAPP', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.deepEqual(f, { q: 'ana', etapa: 'COMPRA', canal: 'WHATSAPP', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.equal(hayFiltrosCaptados(vacio as never), false)
  assert.equal(hayFiltrosCaptados(f), true)
})

test('captados · etapa, canal y fechas producen sus condiciones; las fechas son días de la plataforma', () => {
  assert.deepEqual(condicionesDeCaptados(leerFiltrosCaptados({})), [])
  assert.deepEqual(condicionesDeCaptados(leerFiltrosCaptados({ etapa: 'RESERVA', canal: 'QR' })), [{ etapa: 'RESERVA' }, { canal: 'QR' }])
  assert.deepEqual(condicionesDeCaptados(leerFiltrosCaptados({ desde: '2026-10-01', hasta: '2026-10-31' })), [
    { createdAt: { gte: new Date('2026-10-01T04:00:00.000Z'), lte: new Date('2026-11-01T03:59:59.999Z') } },
  ])
})

test('cada canal que el sistema registra tiene su texto (antes todo lo que no era QR salía como «Enlace directo»)', () => {
  for (const canal of CANALES_ATRIBUCION) assert.ok(CANAL_ATRIBUCION_LABEL[canal], canal)
  assert.equal(CANAL_ATRIBUCION_LABEL.WHATSAPP, 'WhatsApp')
})

// ── Captados: tabla ─────────────────────────────────────────────────────────────────────────────────────────────────

const captado = (extra: Partial<ClienteCaptadoFila> = {}): ClienteCaptadoFila => ({
  id: 'a1',
  nombre: 'Ana Pérez',
  telefono: '809-555-0100',
  email: 'ana@example.com',
  etapa: 'RESERVA',
  canal: 'WHATSAPP',
  createdAt: '2026-10-05T15:30:00.000Z',
  ...extra,
})
const vacio = { titulo: 'Todavía no ha captado clientes' }
const sinResultados = { titulo: 'Ningún cliente captado coincide con los filtros' }
const pintaCaptados = (filas: ClienteCaptadoFila[], hayFiltros = false) =>
  html(h(ClientesCaptadosTabla, { filas, vacio, sinResultados, hayFiltros }))

test('captados · tabla: caption, cliente como identificador, etapa con texto, canal con su nombre y fecha en <time>', () => {
  const out = pintaCaptados([captado()])
  assert.match(out, /<caption[^>]*>[^<]*Clientes captados por el vendedor/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>Ana Pérez/)
  assert.match(out, />Reserva</)
  assert.match(out, />WhatsApp</)
  assert.match(out, /<time dateTime="2026-10-05T15:30:00.000Z"/)
  assert.match(out, /809-555-0100/)
})

test('captados · sin teléfono se muestra el correo; sin ninguno, «—»; sin canal se asume «Enlace directo»', () => {
  assert.match(pintaCaptados([captado({ telefono: null })]), /ana@example\.com/)
  assert.match(pintaCaptados([captado({ telefono: null, email: null })]), /aria-hidden="true">—/)
  assert.match(pintaCaptados([captado({ canal: null })]), />Enlace directo</)
})

test('captados · el contacto y el canal (de menos prioridad) se ocultan en pantalla estrecha; cliente, etapa y fecha no', () => {
  const out = pintaCaptados([captado()])
  const encabezado = (texto: string) => out.match(new RegExp(`<th[^>]*>${texto}</th>`))?.[0] ?? ''
  assert.match(encabezado('Teléfono o correo'), /hidden/)
  assert.match(encabezado('Canal'), /hidden/)
  for (const siempre of ['Cliente', 'Etapa del embudo', 'Fecha']) assert.doesNotMatch(encabezado(siempre), /hidden/, siempre)
})

test('captados · el vacío dice la verdad: no ha captado a nadie, o los filtros no encontraron a nadie', () => {
  assert.match(pintaCaptados([], false), /Todavía no ha captado clientes/)
  assert.match(pintaCaptados([], true), /Ningún cliente captado coincide con los filtros/)
})

test('captados · la consulta cuenta el total real, pagina en la base y distingue «no hay ninguno» de «el filtro los esconde»', () => {
  const src = sinComentarios(readFileSync('src/modules/excursiones/vendedores/queries.ts', 'utf8'))
  const cuerpo = src.slice(src.indexOf('export async function clientesCaptados'))
  assert.match(cuerpo, /skip: paginacion\.saltar/)
  assert.match(cuerpo, /take: paginacion\.tomar/)
  assert.match(cuerpo, /tx\.vendedorAtribucion\.count\(\{ where \}\)/)
  assert.match(cuerpo, /tx\.vendedorAtribucion\.count\(\{ where: base \}\)/)
  assert.match(cuerpo, /companyId, vendedorId, clienteId: \{ not: null \}/, 'siempre este vendedor, dentro de la empresa')
  assert.match(cuerpo, /\{ id: 'desc' \}/, 'orden estable')
  assert.doesNotMatch(cuerpo, /Math\.min\(100|limit/, 'ya no hay un límite propio escondido')
})

test('la ficha del vendedor usa BarraFiltros con fechas, su tabla de servidor y TablaPaginacion; ya no hay formulario de cliente', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/vendedores/[id]/page.tsx', 'utf8'))
  assert.match(pagina, /<BarraFiltros/)
  assert.match(pagina, /fechas=\{\[/)
  assert.match(pagina, /<ClientesCaptadosTabla/)
  assert.match(pagina, /<TablaPaginacion paginacion=\{paginacion\} total=\{captados\.total\} params=\{sp\} etiqueta="clientes captados"/)
  const tabla = sinComentarios(readFileSync('src/components/excursiones/ClientesCaptadosTabla.tsx', 'utf8'))
  assert.doesNotMatch(tabla, /'use client'|useState|useRouter|<table/)
})

// ── Recibo de la liquidación ────────────────────────────────────────────────────────────────────────────────────────

const linea = (extra: Partial<LineaLiquidacion> = {}): LineaLiquidacion => ({
  id: 'k1',
  venta: 'SAL-2026-0001',
  tipoCalculo: 'PORCENTAJE',
  desglose: '10 % de RD$ 1,000',
  createdAt: '2026-10-05T15:00:00.000Z',
  ajustes: [],
  neto: 100,
  monedaOriginal: 'DOP',
  netoOriginal: 100,
  conversion: {
    montoOriginal: 100,
    monedaOriginal: 'DOP',
    montoConvertido: 100,
    monedaDestino: 'DOP',
    tasa: 1,
    tasaLabel: '1:1 (Misma moneda)',
    esConversion: false,
    tasaConfigurada: true,
    esInversa: false,
  },
  ...extra,
})
const pintaLineas = (lineas: LineaLiquidacion[]) => html(h(ComisionesLiquidacionTabla, { lineas, moneda: 'DOP', total: '4500' }))

test('recibo · caption, venta como identificador, tipo con texto, neto a la derecha y el total en el pie', () => {
  const out = pintaLineas([linea()])
  assert.match(out, /<caption[^>]*>[^<]*Comisiones de ventas incluidas/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>[\s\S]*SAL-2026-0001/)
  assert.match(out, />% Porcentaje</)
  assert.match(out, /<td[^>]*text-right[^>]*>[\s\S]*100/)
  assert.match(out, /Total en efectivo o transferencia[\s\S]*4,?500/)
})

test('recibo · una comisión convertida dice la tasa y su monto original; la que no, no', () => {
  const convertida = linea({
    neto: 5800,
    monedaOriginal: 'USD',
    netoOriginal: 100,
    conversion: { ...linea().conversion, esConversion: true, monedaOriginal: 'USD', tasaLabel: '1 USD = 58 DOP', tasaConfigurada: false },
  })
  const out = pintaLineas([convertida])
  assert.match(out, /1 USD = 58 DOP/)
  assert.match(out, /Original:[\s\S]*100/)
  assert.match(out, /Tasa 1:1 no configurada/)
  assert.doesNotMatch(pintaLineas([linea()]), /Original:|Tasa 1:1/)
})

test('recibo · un premio en especie no suma dinero: dice «Premio en voucher» y no un neto', () => {
  const out = pintaLineas([linea({ tipoCalculo: 'PAQUETE_REGALO', neto: 0 })])
  assert.match(out, /Premio en voucher/)
  assert.match(out, />Paquete de regalo</)
})

test('recibo · los ajustes se listan con su signo y su motivo', () => {
  const out = pintaLineas([linea({ ajustes: [{ monto: -10, motivo: 'Reembolso parcial' }, { monto: 5, motivo: 'Corrección' }] })])
  assert.match(out, /Ajuste[\s\S]*Reembolso parcial/)
  assert.match(out, /Ajuste \+[\s\S]*Corrección/)
})

const bono = (extra: Partial<BonoLiquidacion> = {}): BonoLiquidacion => ({
  id: 'b1',
  descripcion: 'Meta de octubre',
  createdAt: '2026-10-31T12:00:00.000Z',
  monto: 2500,
  estado: 'PENDIENTE',
  ...extra,
})

test('recibo · bonos: caption, descripción como identificador, monto a la derecha y estado con texto', () => {
  const out = html(h(BonosLiquidacionTabla, { bonos: [bono(), bono({ id: 'b2', descripcion: 'Meta de septiembre', estado: 'PAGADO' })], moneda: 'DOP' }))
  assert.match(out, /<caption[^>]*>[^<]*Bonos por metas cumplidas/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>Meta de octubre/)
  assert.match(out, />Por liquidar</)
  assert.match(out, />Pagado</)
  assert.match(out, /<td[^>]*text-right[^>]*>[\s\S]*2,?500/)
})

test('el recibo y los cobros ya no pintan <table> a mano', () => {
  for (const ruta of [
    'src/app/(admin)/admin/excursiones/liquidaciones/[id]/page.tsx',
    'src/components/excursiones/ReservaPagos.tsx',
    'src/components/excursiones/LiquidacionLineasTablas.tsx',
    'src/components/excursiones/ClientesCaptadosTabla.tsx',
  ]) {
    assert.doesNotMatch(sinComentarios(readFileSync(ruta, 'utf8')), /<table/, ruta)
  }
  const recibo = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/liquidaciones/[id]/page.tsx', 'utf8'))
  assert.match(recibo, /<ComisionesLiquidacionTabla lineas=\{lineas\}/)
  assert.match(recibo, /<BonosLiquidacionTabla bonos=\{bonos\}/)
  const cobros = sinComentarios(readFileSync('src/components/excursiones/ReservaPagos.tsx', 'utf8'))
  assert.match(cobros, /<Tabla\b/)
  assert.match(cobros, /Anular/, 'anular un cobro sigue estando en la fila')
  assert.match(cobros, /ANULADO/, 'el cobro anulado se queda en la lista con su motivo')
})
