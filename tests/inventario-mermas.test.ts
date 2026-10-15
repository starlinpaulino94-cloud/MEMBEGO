import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETIQUETA_GRUPO,
  EXPLICACION_GRUPO,
  FILTRO_SIN_MOTIVO,
  GRUPOS_DE_MERMA,
  filaPorMotivo,
  grupoDeClase,
  ordenarPorMotivo,
  participacion,
  totalDeGrupo,
  valorDeMovimiento,
  type FilaPorMotivo,
} from '../src/modules/inventory/mermas'
import { CLASES_DE_MOTIVO, SIN_MOTIVO_CODIFICADO } from '../src/modules/inventory/motivos'
import { parsearCosto, type Costo } from '../src/modules/inventory/costos'
import { consultaDeFiltrosMermas, leerFiltrosMermas } from '../src/modules/inventory/filtros'
import { mermasToCsv } from '../src/modules/inventory/exportacion'
import type { MermasVista, MovimientoDeMerma } from '../src/modules/inventory/mermas-queries'

const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, t)
  return r.valor
}

const fila = (codigo: string | null, unidades: number, valor: Costo | null, extra: Partial<FilaPorMotivo> = {}): FilaPorMotivo => ({
  ...filaPorMotivo({ codigo, movimientos: 1, unidades, valor, unidadesSinCosto: valor === null ? null : 0 }),
  ...extra,
})

// ── Grupos ───────────────────────────────────────────────────────────────────

test('cada clase de motivo cae en un grupo: faltantes y bajas son lo perdido; el sobrante y el daño van aparte', () => {
  assert.equal(grupoDeClase('FALTANTE'), 'PERDIDA')
  assert.equal(grupoDeClase('BAJA'), 'PERDIDA')
  assert.equal(grupoDeClase('SOBRANTE'), 'SOBRANTE')
  assert.equal(grupoDeClase('DANO'), 'DANO')
  for (const clase of CLASES_DE_MOTIVO) assert.ok(GRUPOS_DE_MERMA.includes(grupoDeClase(clase)), clase)
  for (const g of GRUPOS_DE_MERMA) assert.ok(ETIQUETA_GRUPO[g] && EXPLICACION_GRUPO[g], g)
  assert.match(EXPLICACION_GRUPO.DANO, /no se suma a lo perdido/, 'la pantalla explica por qué lo dañado va aparte')
})

// ── Orden ────────────────────────────────────────────────────────────────────

test('ordenarPorMotivo: de lo que más vale a lo que menos; a igual valor, más unidades; «Otro» y «sin motivo» al final de su empate', () => {
  const orden = (filas: FilaPorMotivo[]) => ordenarPorMotivo(filas).map((f) => f.codigo)
  assert.deepEqual(orden([fila('THEFT', 2, c('10')), fila('EXPIRED', 6, c('30')), fila('LOST', 1, c('5'))]), ['EXPIRED', 'THEFT', 'LOST'])
  // Igual valor: más unidades primero.
  assert.deepEqual(orden([fila('THEFT', 2, c('10')), fila('LOST', 5, c('10'))]), ['LOST', 'THEFT'])
  // Igual valor y unidades: lo concreto antes que «Otro» y que lo que no tiene motivo.
  assert.deepEqual(orden([fila(null, 2, c('10')), fila('OTHER', 2, c('10')), fila('THEFT', 2, c('10'))]), ['THEFT', 'OTHER', null])
  // Sin costo (valor 0) queda detrás de lo que sí vale algo, aunque tenga más unidades.
  assert.deepEqual(orden([fila('LOST', 50, BigInt(0)), fila('THEFT', 1, c('1'))]), ['THEFT', 'LOST'])
  // Un valor que no se conoce (null) queda detrás de un cero conocido, aunque tenga más unidades: no se confunden.
  assert.deepEqual(orden([fila('LOST', 50, null), fila('THEFT', 1, BigInt(0))]), ['THEFT', 'LOST'])
  // Sin permiso de costos: por unidades, y a igual cantidad por nombre (no por el orden en que llegaron).
  assert.deepEqual(orden([fila('THEFT', 2, null), fila('EXPIRED', 6, null), fila('COUNT_DIFFERENCE', 2, null)]), ['EXPIRED', 'COUNT_DIFFERENCE', 'THEFT'])
  assert.deepEqual(orden([fila('THEFT', 2, null), fila('COUNT_DIFFERENCE', 2, null)]), orden([fila('COUNT_DIFFERENCE', 2, null), fila('THEFT', 2, null)]), 'el orden no depende del de entrada')
  // No toca el arreglo que recibe.
  const original = [fila('THEFT', 1, c('1')), fila('EXPIRED', 9, c('9'))]
  ordenarPorMotivo(original)
  assert.deepEqual(original.map((f) => f.codigo), ['THEFT', 'EXPIRED'])
})

test('filaPorMotivo: la etiqueta del catálogo, «sin motivo codificado» si no hay código y el código tal cual si ya no existe', () => {
  assert.equal(filaPorMotivo({ codigo: 'EXPIRED', movimientos: 1, unidades: 1, valor: null, unidadesSinCosto: null }).etiqueta, 'Vencido')
  assert.equal(filaPorMotivo({ codigo: null, movimientos: 1, unidades: 1, valor: null, unidadesSinCosto: null }).etiqueta, SIN_MOTIVO_CODIFICADO)
  assert.equal(filaPorMotivo({ codigo: 'VIEJO', movimientos: 1, unidades: 1, valor: null, unidadesSinCosto: null }).etiqueta, 'VIEJO')
})

// ── Totales ──────────────────────────────────────────────────────────────────

test('totalDeGrupo: suma movimientos, unidades, valor y lo sin costo; si no se pueden ver costos, el total tampoco los trae', () => {
  const con = totalDeGrupo([
    { ...fila('EXPIRED', 6, c('30')), movimientos: 2 },
    { ...fila('LOST', 5, BigInt(0)), unidadesSinCosto: 5 },
  ])
  assert.deepEqual(con, { movimientos: 3, unidades: 11, valor: c('30'), unidadesSinCosto: 5 })
  const sin = totalDeGrupo([fila('EXPIRED', 6, null), fila('LOST', 5, null)])
  assert.deepEqual(sin, { movimientos: 2, unidades: 11, valor: null, unidadesSinCosto: null })
  assert.deepEqual(totalDeGrupo([]), { movimientos: 0, unidades: 0, valor: BigInt(0), unidadesSinCosto: 0 }, 'sin filas, cero (no «no se sabe»)')
})

test('participacion: el porcentaje con un decimal, redondeado a la mitad hacia arriba; sin total, 0; sirve para unidades y para dinero', () => {
  assert.equal(participacion(1, 3), 33.3)
  assert.equal(participacion(2, 3), 66.7)
  assert.equal(participacion(1, 8), 12.5)
  assert.equal(participacion(1, 16), 6.3, '6.25 sube')
  assert.equal(participacion(5, 5), 100)
  assert.equal(participacion(0, 7), 0)
  assert.equal(participacion(3, 0), 0, 'sin total no hay porcentaje')
  assert.equal(participacion(3, -1), 0)
  assert.equal(participacion(c('30'), c('45')), 66.7)
  assert.equal(participacion(c('0.0001'), c('3')), 0, 'una diezmilésima de tres no llega a una décima de punto')
})

test('valorDeMovimiento: unidades por el costo congelado; sin costo, null (nunca cero)', () => {
  assert.equal(valorDeMovimiento(4, c('5')), c('20'))
  assert.equal(valorDeMovimiento(3, c('1.3333')), c('3.9999'))
  assert.equal(valorDeMovimiento(4, null), null)
})

// ── Filtros de la URL ────────────────────────────────────────────────────────

test('leerFiltrosMermas: fechas válidas, sucursal, motivo del catálogo o «sin», texto y página; lo raro se ignora', () => {
  assert.deepEqual(leerFiltrosMermas({}), { pagina: 1 })
  const f = leerFiltrosMermas({ desde: '2026-10-01', hasta: '2026-10-15', sucursal: 'suc1', motivo: 'THEFT', q: ' jabón ', pagina: '3' })
  assert.deepEqual(f, { desde: '2026-10-01', hasta: '2026-10-15', sucursalId: 'suc1', motivo: 'THEFT', q: 'jabón', pagina: 3 })
  assert.equal(leerFiltrosMermas({ motivo: FILTRO_SIN_MOTIVO }).motivo, FILTRO_SIN_MOTIVO)
  for (const raro of ['theft', 'NO_EXISTE', "THEFT' OR 1=1", '', '%', 'sin ']) assert.equal(leerFiltrosMermas({ motivo: raro }).motivo, undefined, JSON.stringify(raro))
  for (const mala of ['0', '-1', '1.5', 'x', '2001']) assert.equal(leerFiltrosMermas({ pagina: mala }).pagina, 1, `pagina=${mala}`)
  assert.equal(leerFiltrosMermas({ desde: 'ayer' }).desde, undefined)
  const alReves = leerFiltrosMermas({ desde: '2026-10-15', hasta: '2026-10-01' })
  assert.ok(alReves.desde && alReves.hasta && alReves.desde <= alReves.hasta)
  assert.equal(leerFiltrosMermas({ motivo: ['EXPIRED', 'THEFT'] }).motivo, 'EXPIRED', 'un valor repetido lee el primero, igual que la pantalla')
})

test('consultaDeFiltrosMermas: lo vacío no ensucia la URL, la página 1 no se escribe, y leerla de vuelta da lo mismo', () => {
  assert.equal(consultaDeFiltrosMermas({ pagina: 1 }), '')
  assert.equal(consultaDeFiltrosMermas({ pagina: 1, motivo: 'EXPIRED' }, 4), 'motivo=EXPIRED&pagina=4', 'otra página sin tocar los filtros')
  const todo = { desde: '2026-10-01', hasta: '2026-10-15', sucursalId: 's9', motivo: FILTRO_SIN_MOTIVO, q: 'a&b=c', pagina: 2 }
  assert.deepEqual(leerFiltrosMermas(Object.fromEntries(new URLSearchParams(consultaDeFiltrosMermas(todo)))), todo, 'un texto con & o = no se cuela como otro parámetro')
})

// ── CSV ──────────────────────────────────────────────────────────────────────

const ZONA = 'America/Santo_Domingo'
const AHORA = new Date(Date.UTC(2026, 9, 15, 16, 0))

function movimiento(extra: Partial<MovimientoDeMerma> = {}): MovimientoDeMerma {
  return {
    id: 'm1',
    creadoEn: new Date(Date.UTC(2026, 9, 10, 15, 30)),
    clase: 'FALTANTE',
    grupo: 'PERDIDA',
    codigo: 'THEFT',
    etiquetaMotivo: 'Robo o hurto',
    detalle: 'Se llevaron dos de la vitrina',
    varianteId: 'v1',
    producto: 'Jabón · 1 L',
    sku: 'JAB-1',
    sucursalNombre: 'Principal',
    unidades: 2,
    costo: c('1250.5'),
    valor: c('2501'),
    usuarioNombre: 'Ana',
    ...extra,
  }
}

function vista(conCostos: boolean, extra: Partial<MermasVista> = {}): MermasVista {
  const perdida = [fila('THEFT', 2, conCostos ? c('2501') : null), fila(null, 1, conCostos ? BigInt(0) : null, { unidadesSinCosto: conCostos ? 1 : null })]
  return {
    desde: '2026-09-16',
    hasta: '2026-10-15',
    conCostos,
    grupos: {
      PERDIDA: { filas: perdida, total: totalDeGrupo(perdida) },
      SOBRANTE: { filas: [], total: totalDeGrupo([]) },
      DANO: { filas: [], total: totalDeGrupo([]) },
    },
    movimientos: [movimiento({ costo: conCostos ? c('1250.5') : null, valor: conCostos ? c('2501') : null }), movimiento({ id: 'm2', codigo: null, etiquetaMotivo: SIN_MOTIVO_CODIFICADO, detalle: '=HYPERLINK("http://x")', producto: '+Cera', unidades: 1, costo: null, valor: null })],
    total: 2,
    pagina: 1,
    porPagina: 20000,
    ...extra,
  }
}

test('mermasToCsv con costos: resumen por grupo, por motivo y detalle; sin separador de miles, lo sin costo vacío y nada que Excel evalúe', () => {
  const csv = mermasToCsv(vista(true), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Motivo', 'Robo o hurto']], tope: 20000 })
  assert.ok(csv.startsWith('﻿'))
  assert.match(csv, /^Desde;2026-09-16$/m)
  assert.match(csv, /^Hasta;2026-10-15$/m)
  assert.match(csv, /^Filtro: Motivo;Robo o hurto$/m)
  assert.match(csv, /^Lo perdido: movimientos;2$/m)
  assert.match(csv, /^Lo perdido: unidades;3$/m)
  assert.match(csv, /^Lo perdido: valor \(solo lo que tiene costo\);2501\.00$/m, 'sin separador de miles')
  assert.match(csv, /^Lo perdido: unidades SIN costo \(no suman al valor\);1$/m)
  assert.match(csv, /^Sobrantes: unidades;0$/m)
  assert.match(csv, /^Datos completos;Si$/m)
  assert.match(csv, /^Grupo;Motivo;Movimientos;Unidades;Valor;Unidades sin costo$/m)
  assert.match(csv, /^Lo perdido;Robo o hurto;1;2;2501\.00;0$/m)
  assert.match(csv, /^Lo perdido;Sin motivo codificado;1;1;0\.00;1$/m)
  assert.match(csv, /^Fecha y hora;Clase;Motivo;Detalle del motivo;Producto;SKU;Sucursal;Unidades;Costo unitario;Valor;Usuario$/m)
  assert.match(csv, /^2026-10-10 11:30:00;Faltante;Robo o hurto;Se llevaron dos de la vitrina;Jabón · 1 L;JAB-1;Principal;2;1250\.50;2501\.00;Ana$/m)
  assert.match(csv, /;Sin motivo codificado;"'=HYPERLINK\(""http:\/\/x""\)";'\+Cera;/, 'el detalle y el producto con fórmula se neutralizan')
  assert.match(csv, /;1;;;Ana$|;1;;;Sistema$/m, 'sin costo conocido: costo y valor VACÍOS, nunca cero')
  assert.ok(!/(^|;)=HYPERLINK/m.test(csv))
})

test('mermasToCsv sin costos: ninguna columna, total ni cuenta de dinero', () => {
  const csv = mermasToCsv(vista(false), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  // («Concepto;Valor» es el encabezado de la tabla de resumen, no dinero.)
  assert.doesNotMatch(csv.replace('Concepto;Valor', ''), /valor|Valor|SIN costo|Costo unitario|sin costo/)
  assert.match(csv, /^Lo perdido: unidades;3$/m)
  assert.match(csv, /^Grupo;Motivo;Movimientos;Unidades$/m)
  assert.match(csv, /^Fecha y hora;Clase;Motivo;Detalle del motivo;Producto;SKU;Sucursal;Unidades;Usuario$/m)
  assert.doesNotMatch(csv, /1250|2501/)
})

test('mermasToCsv sin costos: aunque el movimiento traiga costo, ni el costo ni el valor salen, y cada fila del detalle tiene sus 9 columnas', () => {
  const csv = mermasToCsv(vista(false, { movimientos: [movimiento()] }), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.doesNotMatch(csv, /1250|2501/)
  assert.match(csv, /^2026-10-10 11:30:00;Faltante;Robo o hurto;Se llevaron dos de la vitrina;Jabón · 1 L;JAB-1;Principal;2;Ana$/m)
})

test('mermasToCsv dice cuando el detalle quedó cortado, y no cuando está completo', () => {
  const cortado = mermasToCsv(vista(true, { total: 25000 }), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(cortado, /^Datos completos;"?NO - el archivo trae solo los 20000 movimientos más recientes de 25000/m)
  const completo = mermasToCsv(vista(true), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(completo, /^Datos completos;Si$/m)
  assert.match(completo, /^Movimientos en el archivo;2$/m)
})
