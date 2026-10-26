import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { finDelDia, inicioDelDia, leerFecha, leerId, leerOpcion } from '../src/modules/excursiones/lista-comun'
import { OFFSET_PLATAFORMA_MIN } from '../src/modules/excursiones/metricas/nucleo'
import { condicionesDeComisiones, hayFiltrosComisiones, leerFiltrosComisiones, tonoDeComision } from '../src/modules/excursiones/comisiones/lista'
import {
  condicionesDeLiquidaciones,
  hayFiltrosLiquidaciones,
  leerFiltrosLiquidaciones,
  tonoDeLiquidacion,
} from '../src/modules/excursiones/liquidaciones/lista'
import { validarPeriodo } from '../src/modules/excursiones/liquidaciones/nucleo'
import { ComisionesTabla, type ComisionFila } from '../src/components/excursiones/ComisionesTabla'
import { LiquidacionesTabla, type LiquidacionFila } from '../src/components/excursiones/LiquidacionesTabla'
import { BarraFiltros } from '../packages/ui/src/ui/barra-filtros'

/**
 * COMISIONES Y LIQUIDACIONES, COMO LISTADOS DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05, T-08).
 *
 * Eran listas de cliente con la consulta cortada en 300 y 200 filas sin avisar: lo que se buscaba se buscaba solo entre las más
 * recientes. Aquí: cómo se leen los filtros de la URL (incluidas las fechas), qué condiciones producen —con los bordes del día bien
 * puestos—, el marcado de las dos tablas y el de los campos de fecha de `BarraFiltros`. La consulta contra la base, incluido el
 * filtro por JSON de la regla general, se verificó en el entorno de QA.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const html = (n: unknown) => renderToStaticMarkup(n as never)

// ── La mecánica común de fechas y valores ────────────────────────────────────────────────────────────────────────────

test('leerFecha: solo una fecha que existe en el calendario; todo lo demás es «sin filtro»', () => {
  assert.equal(leerFecha('2026-10-21'), '2026-10-21')
  assert.equal(leerFecha(' 2026-10-21 '), '2026-10-21')
  assert.equal(leerFecha(['2026-10-01', '2026-11-01']), '2026-10-01')
  for (const mala of [undefined, '', '2026-02-31', '2026-13-01', '21/10/2026', '2026-1-1', 'ayer', '2026-10-21T00:00', "2026-10-21'; DROP"]) {
    assert.equal(leerFecha(mala), '', String(mala))
  }
  assert.equal(leerFecha('2028-02-29'), '2028-02-29', 'bisiesto')
  assert.equal(leerFecha('2027-02-29'), '')
})

test('leerOpcion y leerId: el valor si tiene la forma, si no vacío', () => {
  assert.equal(leerOpcion('PAGADA', ['PAGADA', 'ANULADA'] as const), 'PAGADA')
  assert.equal(leerOpcion('pagada', ['PAGADA'] as const), '', 'distingue mayúsculas: es un valor de la lista, no texto libre')
  assert.equal(leerOpcion(undefined, ['PAGADA'] as const), '')
  assert.equal(leerId('clx9abc_12-3'), 'clx9abc_12-3')
  assert.equal(leerId('x'.repeat(41)), '')
  assert.equal(leerId('a b'), '')
  assert.equal(leerId("a'; --"), '')
})

test('el día se acota con el desfase que se dé: 0 es UTC, −240 es la hora de la plataforma (UTC−4)', () => {
  assert.equal(inicioDelDia('2026-10-01').toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(finDelDia('2026-10-01').toISOString(), '2026-10-01T23:59:59.999Z')
  assert.equal(inicioDelDia('2026-10-01', OFFSET_PLATAFORMA_MIN).toISOString(), '2026-10-01T04:00:00.000Z')
  assert.equal(finDelDia('2026-10-01', OFFSET_PLATAFORMA_MIN).toISOString(), '2026-10-02T03:59:59.999Z')
})

// ── Comisiones: filtros y condiciones ────────────────────────────────────────────────────────────────────────────────

test('comisiones · sin parámetros no hay filtro; con basura tampoco; con valores buenos se leen', () => {
  const vacio = { q: '', vendedor: '', estado: '', tasa: '', desde: '', hasta: '' }
  assert.deepEqual(leerFiltrosComisiones({}), vacio)
  assert.deepEqual(leerFiltrosComisiones({ estado: 'NOEXISTE', tasa: 'otra', desde: '2026-02-31', vendedor: 'a b' }), vacio)
  const f = leerFiltrosComisiones({ q: '  SAL-12 ', vendedor: 'v1', estado: 'APROBADA', tasa: 'REGLA_GENERAL', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.deepEqual(f, { q: 'SAL-12', vendedor: 'v1', estado: 'APROBADA', tasa: 'REGLA_GENERAL', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.equal(hayFiltrosComisiones(vacio as never), false)
  assert.equal(hayFiltrosComisiones(f), true)
})

test('comisiones · cada filtro produce su condición; sin filtros no hay ninguna', () => {
  assert.deepEqual(condicionesDeComisiones(leerFiltrosComisiones({}), 'DOP'), [])
  const vendedor = condicionesDeComisiones(leerFiltrosComisiones({ vendedor: 'v1', estado: 'PAGADA' }), 'DOP')
  assert.deepEqual(vendedor, [{ vendedorId: 'v1' }, { estado: 'PAGADA' }])
})

test('comisiones · «con conversión» es la moneda distinta de la de la empresa, sin distinguir mayúsculas', () => {
  const [c] = condicionesDeComisiones(leerFiltrosComisiones({ tasa: 'CON_CONVERSION' }), 'DOP')
  assert.deepEqual(c, { NOT: { moneda: { equals: 'DOP', mode: 'insensitive' } } })
})

test('comisiones · «regla general» mira el snapshot como lo marcaba el listado: ámbito GENERAL o la regla por defecto', () => {
  const [c] = condicionesDeComisiones(leerFiltrosComisiones({ tasa: 'REGLA_GENERAL' }), 'DOP')
  assert.deepEqual(c, {
    OR: [
      { reglaSnapshot: { path: ['ambito'], equals: 'GENERAL' } },
      { reglaSnapshot: { path: ['reglaId'], equals: 'default-general' } },
    ],
  })
})

test('comisiones · las fechas son días de la plataforma: el primer día desde las 00:00 de allá, el último hasta las 23:59:59.999 de allá', () => {
  const [c] = condicionesDeComisiones(leerFiltrosComisiones({ desde: '2026-10-01', hasta: '2026-10-31' }), 'DOP')
  assert.deepEqual(c, { createdAt: { gte: new Date('2026-10-01T04:00:00.000Z'), lte: new Date('2026-11-01T03:59:59.999Z') } })
  // Una comisión de las 9 de la noche del 31 (01:00Z del 1 de noviembre) es del 31, y entra.
  const nueveDeLaNoche = new Date('2026-11-01T01:00:00.000Z')
  const rango = (c as { createdAt: { gte: Date; lte: Date } }).createdAt
  assert.ok(nueveDeLaNoche >= rango.gte && nueveDeLaNoche <= rango.lte)
  // Con solo un extremo, solo ese extremo.
  assert.deepEqual(condicionesDeComisiones(leerFiltrosComisiones({ desde: '2026-10-01' }), 'DOP'), [{ createdAt: { gte: new Date('2026-10-01T04:00:00.000Z') } }])
})

test('comisiones · el tono del chip: cada estado tiene el suyo del sistema de diseño y lo desconocido es neutro', () => {
  assert.equal(tonoDeComision('PAGADA'), 'exito')
  assert.equal(tonoDeComision('PENDIENTE_PAGO'), 'aviso')
  assert.equal(tonoDeComision('ANULADA'), 'neutro')
  assert.equal(tonoDeComision('LO_QUE_SEA'), 'neutro')
})

// ── Liquidaciones: filtros y condiciones ─────────────────────────────────────────────────────────────────────────────

test('liquidaciones · sin parámetros no hay filtro; con basura tampoco; con valores buenos se leen', () => {
  const vacio = { q: '', vendedor: '', estado: '', desde: '', hasta: '' }
  assert.deepEqual(leerFiltrosLiquidaciones({}), vacio)
  assert.deepEqual(leerFiltrosLiquidaciones({ estado: 'PENDIENTE', desde: 'x' }), vacio, 'PENDIENTE está en el comentario del esquema, no en el código')
  const f = leerFiltrosLiquidaciones({ q: 'PAY-2026', vendedor: 'v1', estado: 'PAGADA', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.deepEqual(f, { q: 'PAY-2026', vendedor: 'v1', estado: 'PAGADA', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.equal(hayFiltrosLiquidaciones(vacio as never), false)
  assert.equal(hayFiltrosLiquidaciones(f), true)
})

test('liquidaciones · el período se compara con el borde UTC con el que se guarda: «desde el 1» incluye el que empieza el 1', () => {
  const conds = condicionesDeLiquidaciones(leerFiltrosLiquidaciones({ vendedor: 'v1', estado: 'APROBADA', desde: '2026-10-01', hasta: '2026-10-31' }))
  assert.deepEqual(conds, [
    { vendedorId: 'v1' },
    { estado: 'APROBADA' },
    { periodoDesde: { gte: new Date('2026-10-01T00:00:00.000Z') } },
    { periodoHasta: { lte: new Date('2026-10-31T23:59:59.999Z') } },
  ])
  // La misma entrada que guarda el formulario cae dentro del rango del mismo día: si el guardado y el filtro divergen, falla aquí.
  const periodo = validarPeriodo({ vendedorId: 'v1', desde: '2026-10-01', hasta: '2026-10-31' })
  assert.ok(periodo.ok)
  if (periodo.ok) {
    assert.ok(periodo.datos.desde >= (conds[2] as { periodoDesde: { gte: Date } }).periodoDesde.gte)
    assert.ok(periodo.datos.hasta <= (conds[3] as { periodoHasta: { lte: Date } }).periodoHasta.lte)
  }
})

test('liquidaciones · sin filtros no hay condiciones; el tono del chip es el del estado', () => {
  assert.deepEqual(condicionesDeLiquidaciones(leerFiltrosLiquidaciones({})), [])
  assert.equal(tonoDeLiquidacion('PAGADA'), 'exito')
  assert.equal(tonoDeLiquidacion('BORRADOR'), 'aviso')
  assert.equal(tonoDeLiquidacion('RARA'), 'neutro')
})

// ── Las tablas ───────────────────────────────────────────────────────────────────────────────────────────────────────

const vacio = { titulo: 'Todavía no hay', descripcion: 'Nada todavía.' }
const sinResultados = { titulo: 'Ninguna coincide con los filtros' }

const comision = (extra: Partial<ComisionFila> = {}): ComisionFila => ({
  id: 'c1',
  vendedorId: 'v1',
  vendedor: 'Luis Gómez',
  vendedorCodigo: 'LG01',
  base: 1000,
  monto: 100,
  neto: 90,
  ajustes: [{ monto: -10, motivo: 'Reembolso parcial' }],
  moneda: 'DOP',
  desglose: '10 % de RD$ 1,000',
  estado: 'APROBADA',
  createdAt: '2026-10-05T15:00:00.000Z',
  venta: { id: 'vt1', numero: 'SAL-2026-0001', estado: 'CONFIRMADA' },
  liquidacion: null,
  ...extra,
})

const pintaComisiones = (filas: ComisionFila[], hayFiltros = false) =>
  html(h(ComisionesTabla, { filas, acciones: (c: ComisionFila) => h('button', { type: 'button' }, `acciones-${c.id}`), vacio, sinResultados, hayFiltros }))

test('comisiones · tabla: caption, vendedor como identificador con su código, venta enlazada, neto a la derecha y estado con texto', () => {
  const out = pintaComisiones([comision()])
  assert.match(out, /<caption[^>]*>[^<]*Comisiones de los vendedores/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>[\s\S]*href="\/admin\/excursiones\/vendedores\/v1"[^>]*>Luis Gómez/)
  assert.match(out, /LG01/)
  assert.match(out, /href="\/admin\/excursiones\/ventas\/vt1"[^>]*>SAL-2026-0001/)
  assert.match(out, />Aprobada</)
  assert.match(out, /<td[^>]*text-right[^>]*>[\s\S]*RD\$|<td[^>]*text-right[^>]*>[\s\S]*90/)
})

test('comisiones · la liquidación se enlaza, los ajustes se listan con su motivo y la regla general se dice', () => {
  const out = pintaComisiones([comision({ liquidacion: { id: 'l1', numero: 'PAY-2026-0007' }, esReglaPredeterminada: true })])
  assert.match(out, /href="\/admin\/excursiones\/liquidaciones\/l1"[^>]*>Liquidación PAY-2026-0007/)
  assert.match(out, /Ajuste[\s\S]*Reembolso parcial/)
  assert.match(out, /Regla general predeterminada/)
  assert.doesNotMatch(pintaComisiones([comision()]), /Regla general predeterminada/)
})

test('comisiones · sin venta se dice con «—»; el cálculo se oculta en pantalla estrecha y la columna de acciones solo la lee un lector', () => {
  const out = pintaComisiones([comision({ venta: null })])
  assert.match(out, /—/)
  const encabezado = (texto: string) => out.match(new RegExp(`<th[^>]*>(?:<span[^>]*>)?${texto}(?:</span>)?</th>`))?.[0] ?? ''
  assert.match(encabezado('Cálculo y desglose'), /hidden/)
  assert.doesNotMatch(encabezado('Vendedor'), /hidden/)
  assert.doesNotMatch(encabezado('Neto'), /hidden/)
  assert.match(out, /sr-only[^>]*>Acciones</)
})

test('comisiones · la celda de acciones la pone la página (la tabla no importa nada de cliente)', () => {
  assert.match(pintaComisiones([comision()]), /acciones-c1/)
  const fuente = sinComentarios(readFileSync('src/components/excursiones/ComisionesTabla.tsx', 'utf8'))
  assert.doesNotMatch(fuente, /'use client'|useState|<table|ComisionFilaAcciones/)
})

test('comisiones · el vacío dice la verdad: no hay comisiones, o los filtros no encontraron ninguna', () => {
  assert.match(pintaComisiones([], false), /Todavía no hay/)
  assert.doesNotMatch(pintaComisiones([], false), /Ninguna coincide/)
  assert.match(pintaComisiones([], true), /Ninguna coincide con los filtros/)
})

const liquidacion = (extra: Partial<LiquidacionFila> = {}): LiquidacionFila => ({
  id: 'l1',
  numero: 'PAY-2026-0007',
  vendedorId: 'v1',
  vendedor: 'Luis Gómez',
  vendedorCodigo: 'LG01',
  periodoDesde: '2026-10-01T00:00:00.000Z',
  periodoHasta: '2026-10-31T23:59:59.999Z',
  total: 4500,
  moneda: 'DOP',
  estado: 'PAGADA',
  pagadaAt: '2026-11-02T14:00:00.000Z',
  comisiones: 3,
  ...extra,
})

const pintaLiquidaciones = (filas: LiquidacionFila[], hayFiltros = false) =>
  html(h(LiquidacionesTabla, { filas, monedaDefecto: 'DOP', vacio, sinResultados, hayFiltros }))

test('liquidaciones · tabla: caption con la moneda, número como identificador con su enlace, vendedor, total con la moneda en el encabezado', () => {
  const out = pintaLiquidaciones([liquidacion()])
  assert.match(out, /<caption[^>]*>[^<]*Liquidaciones a vendedores[^<]*DOP/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>[\s\S]*href="\/admin\/excursiones\/liquidaciones\/l1"[^>]*>PAY-2026-0007/)
  assert.match(out, /Luis Gómez/)
  assert.match(out, /LG01/)
  assert.match(out, /Total \(DOP\)/)
  assert.match(out, />Pagada</)
  assert.match(out, /<td[^>]*text-right[^>]*>[\s\S]*4,?500/)
})

test('liquidaciones · período y cantidad de comisiones (menos importantes) se ocultan en pantalla estrecha; número, total y estado no', () => {
  const out = pintaLiquidaciones([liquidacion()])
  const encabezado = (texto: string) => out.match(new RegExp(`<th[^>]*>${texto}[^<]*</th>`))?.[0] ?? ''
  assert.match(encabezado('Período'), /hidden/)
  assert.match(encabezado('Comisiones'), /hidden/)
  for (const siempre of ['Número', 'Vendedor', 'Total', 'Estado']) assert.doesNotMatch(encabezado(siempre), /hidden/, siempre)
})

test('liquidaciones · el vacío dice la verdad', () => {
  assert.match(pintaLiquidaciones([], false), /Todavía no hay/)
  assert.match(pintaLiquidaciones([], true), /Ninguna coincide con los filtros/)
})

// ── BarraFiltros con fechas ──────────────────────────────────────────────────────────────────────────────────────────

const barra = (fechas?: { nombre: string; etiqueta: string; valor: string }[]) =>
  html(h(BarraFiltros, { fechas, hrefSin: (n: string) => `/x?sin=${n}`, hrefLimpiar: '/x' }))

test('BarraFiltros · cada fecha es un campo con su etiqueta enlazada, su nombre y su valor', () => {
  const out = barra([
    { nombre: 'desde', etiqueta: 'Desde', valor: '2026-10-01' },
    { nombre: 'hasta', etiqueta: 'Hasta', valor: '' },
  ])
  // El orden de los atributos no es contrato: se mira el campo por su id y se comprueba cada atributo por separado.
  const campo = (id: string) => out.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? ''
  assert.match(out, /<label for="filtro-desde"[^>]*>Desde<\/label>/)
  assert.match(campo('filtro-desde'), /type="date"/)
  assert.match(campo('filtro-desde'), /name="desde"/)
  assert.match(campo('filtro-desde'), /value="2026-10-01"/)
  assert.match(out, /<label for="filtro-hasta"[^>]*>Hasta<\/label>/)
  assert.match(campo('filtro-hasta'), /type="date"/)
  assert.match(campo('filtro-hasta'), /name="hasta"/)
  assert.match(campo('filtro-hasta'), /value=""/)
})

test('BarraFiltros · una fecha puesta sale como chip legible que se quita con un clic; una vacía no', () => {
  const out = barra([
    { nombre: 'desde', etiqueta: 'Desde', valor: '2026-10-01' },
    { nombre: 'hasta', etiqueta: 'Hasta', valor: '' },
  ])
  assert.match(out, /Desde: 01\/10\/2026/)
  assert.match(out, /href="\/x\?sin=desde"[^>]*aria-label="Quitar el filtro Desde: 01\/10\/2026"/)
  assert.doesNotMatch(out, /sin=hasta/)
})

test('BarraFiltros · sin fechas pinta lo mismo que antes: ningún campo de fecha', () => {
  assert.doesNotMatch(barra(), /type="date"/)
  assert.doesNotMatch(barra([]), /type="date"/)
})

// ── Las consultas y las pantallas ────────────────────────────────────────────────────────────────────────────────────

test('las dos consultas paginan en la base, cuentan el total real, buscan al vendedor por sus datos y filtran por empresa', () => {
  for (const [ruta, funcion, siguiente, modelo] of [
    ['src/modules/excursiones/comisiones/queries.ts', 'listarComisiones', 'resumenComisiones', 'comisionEntrada'],
    ['src/modules/excursiones/liquidaciones/queries.ts', 'listarLiquidaciones', 'liquidacionDetalle', 'liquidacion'],
  ] as const) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    const cuerpo = src.slice(src.indexOf(`export async function ${funcion}`), src.indexOf(`export async function ${siguiente}`))
    assert.ok(cuerpo.length > 200, `${funcion}: no encuentro el cuerpo`)
    assert.match(cuerpo, /skip: paginacion\.saltar/, funcion)
    assert.match(cuerpo, /take: paginacion\.tomar/, funcion)
    assert.match(cuerpo, new RegExp(`tx\\.${modelo}\\.count\\(\\{ where \\}\\)`), `${funcion}: el total real`)
    assert.match(cuerpo, /mode: 'insensitive'/, funcion)
    assert.match(cuerpo, /OR: \[\{ nombre: like \}, \{ apellido: like \}, \{ codigo: like \}\]/, `${funcion}: busca al vendedor`)
    assert.match(cuerpo, /where: Prisma\.\w+WhereInput = \{ companyId, AND: condiciones \}/, `${funcion}: siempre dentro de la empresa`)
    assert.match(cuerpo, /\{ id: 'desc' \}/, `${funcion}: orden estable para que las páginas no repitan ni se salten filas`)
    assert.doesNotMatch(cuerpo, /take: (200|300)\b/, `${funcion}: el tope silencioso`)
  }
  assert.doesNotMatch(readFileSync('src/modules/excursiones/comisiones/queries.ts', 'utf8'), /listadoComisiones/)
  assert.doesNotMatch(readFileSync('src/modules/excursiones/liquidaciones/queries.ts', 'utf8'), /listadoLiquidaciones/)
})

test('las pantallas usan BarraFiltros con fechas, su tabla de servidor y TablaPaginacion; las listas de cliente ya no existen', () => {
  for (const muerto of ['ComisionesLista', 'LiquidacionesLista']) {
    assert.ok(!existsSync(`src/components/excursiones/${muerto}.tsx`), `${muerto} sigue existiendo`)
  }
  for (const [ruta, tabla, etiqueta] of [
    ['src/app/(admin)/admin/excursiones/comisiones/page.tsx', '<ComisionesTabla', 'comisiones'],
    ['src/app/(admin)/admin/excursiones/liquidaciones/page.tsx', '<LiquidacionesTabla', 'liquidaciones'],
  ] as const) {
    const pagina = sinComentarios(readFileSync(ruta, 'utf8'))
    assert.match(pagina, /<BarraFiltros/, ruta)
    assert.match(pagina, /fechas=\{\[/, `${ruta}: filtro de fechas`)
    assert.ok(pagina.includes(tabla), ruta)
    assert.match(pagina, new RegExp(`<TablaPaginacion paginacion=\\{paginacion\\} total=\\{total\\} params=\\{sp\\} etiqueta="${etiqueta}"`), ruta)
    assert.doesNotMatch(pagina, /use client|useState/, ruta)
  }
  for (const tabla of ['ComisionesTabla', 'LiquidacionesTabla']) {
    assert.doesNotMatch(sinComentarios(readFileSync(`src/components/excursiones/${tabla}.tsx`, 'utf8')), /'use client'|useState|<table/, tabla)
  }
})

test('la celda de acciones de la comisión es de cliente y monta el detalle solo cuando se pide', () => {
  const fuente = sinComentarios(readFileSync('src/components/excursiones/ComisionFilaAcciones.tsx', 'utf8'))
  assert.match(fuente, /^'use client'/m)
  assert.match(fuente, /\{pedido \? <ComisionDetalleSheet/)
  assert.match(fuente, /<ComisionAcciones comisionId=\{comision\.id\}/)
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/excursiones/comisiones/page.tsx', 'utf8'))
  assert.match(pagina, /acciones=\{\(c\) => <ComisionFilaAcciones comision=\{c\} \/>\}/)
})
