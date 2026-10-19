import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CIFRAS_VACIAS,
  CLASES_EXCLUIDAS,
  ETIQUETA_EXCLUIDA,
  EXPLICACION_EXCLUIDA,
  ETIQUETA_ORDEN_MARGEN,
  ORDENES_MARGEN,
  ORDEN_MARGEN_POR_DEFECTO,
  calcularMargen,
  esClaseDeVenta,
  esOrdenMargen,
  excluidasVacias,
  filaDeMargen,
  formatearMontoFirmado,
  formatearPorcentaje,
  porcentajeFirmado,
  sumarCifras,
  totalDeMargen,
  type CifrasDeVenta,
} from '../src/modules/inventory/margen'
import { parsearCosto, type Costo } from '../src/modules/inventory/costos'
import { consultaDeFiltrosMargen, leerFiltrosMargen } from '../src/modules/inventory/filtros'
import { margenToCsv } from '../src/modules/inventory/exportacion'
import type { MargenVista } from '../src/modules/inventory/margen-queries'

const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, t)
  return r.valor
}
const CERO = BigInt(0)
/** Un monto negativo (un costo no puede serlo, pero un margen sí). */
const n = (t: string): Costo => -c(t)

const cifras = (extra: Partial<CifrasDeVenta> = {}): CifrasDeVenta => ({ ...CIFRAS_VACIAS, ...extra })

// ── Porcentaje con signo ─────────────────────────────────────────────────────

test('porcentajeFirmado: un decimal, con signo, redondeando la mitad alejándose de cero', () => {
  assert.equal(porcentajeFirmado(c('25'), c('100')), 25)
  assert.equal(porcentajeFirmado(c('1'), c('3')), 33.3)
  assert.equal(porcentajeFirmado(c('2'), c('3')), 66.7)
  // Justo en la mitad (12,25 %): sube a 12,3, y el negativo baja a −12,3 (simétrico).
  assert.equal(porcentajeFirmado(c('12.25'), c('100')), 12.3)
  assert.equal(porcentajeFirmado(n('12.25'), c('100')), -12.3)
  assert.equal(porcentajeFirmado(c('12.24'), c('100')), 12.2)
  assert.equal(porcentajeFirmado(n('12.24'), c('100')), -12.2)
  // Por debajo del costo: más de −100 % también es posible (se regaló y además costó).
  assert.equal(porcentajeFirmado(n('150'), c('100')), -150)
  assert.equal(porcentajeFirmado(CERO, c('100')), 0)
})

test('porcentajeFirmado: sin base no hay porcentaje (null), nunca 0 ni infinito', () => {
  assert.equal(porcentajeFirmado(c('10'), CERO), null)
  assert.equal(porcentajeFirmado(n('10'), CERO), null)
  assert.equal(porcentajeFirmado(c('10'), n('5')), null)
})

test('porcentajeFirmado: con montos enormes es exacto (enteros grandes, no coma flotante)', () => {
  // 99.999.999,99 de 100.000.000 sería 99,999999 % si se pasara por flotantes con error; con enteros es 100,0.
  assert.equal(porcentajeFirmado(c('99999999.99'), c('100000000')), 100)
  assert.equal(porcentajeFirmado(c('33333333.3333'), c('100000000')), 33.3)
  assert.equal(porcentajeFirmado(n('33333333.3333'), c('100000000')), -33.3)
})

// ── Margen ───────────────────────────────────────────────────────────────────

test('calcularMargen: ingresos menos costo, y el porcentaje sobre lo cobrado', () => {
  const r = calcularMargen(cifras({ unidades: 10, ingresos: c('1000'), costo: c('600') }))
  assert.equal(r.baseConCosto, c('1000'))
  assert.equal(r.margen, c('400'))
  assert.equal(r.margenPct, 40)
})

test('calcularMargen: vender por debajo del costo da un margen negativo (no se esconde en cero)', () => {
  const r = calcularMargen(cifras({ unidades: 4, ingresos: c('80'), costo: c('100') }))
  assert.equal(r.margen, n('20'))
  assert.equal(r.margenPct, -25)
})

test('calcularMargen: lo vendido sin costo conocido NO entra al margen (ni con costo cero, que lo inflaría al 100 %)', () => {
  // 10 unidades con costo (cobradas a 1000, costaron 600) y 5 sin costo (cobradas a 400).
  const r = calcularMargen(cifras({ unidades: 15, ingresos: c('1400'), costo: c('600'), unidadesSinCosto: 5, ingresosSinCosto: c('400') }))
  assert.equal(r.baseConCosto, c('1000'), 'la base es solo lo que tiene costo')
  assert.equal(r.margen, c('400'))
  assert.equal(r.margenPct, 40, 'no 57 %: no se mezclan los 400 sin costo')
  // Y lo que no tiene costo para nada: sin base, sin porcentaje, margen cero (no «ganancia total»).
  const todoSinCosto = calcularMargen(cifras({ unidades: 5, ingresos: c('400'), unidadesSinCosto: 5, ingresosSinCosto: c('400') }))
  assert.equal(todoSinCosto.margen, CERO)
  assert.equal(todoSinCosto.margenPct, null)
})

test('calcularMargen: lo regalado (ingreso cero) con costo es una pérdida y no tiene porcentaje', () => {
  const r = calcularMargen(cifras({ unidades: 2, ingresos: CERO, costo: c('50') }))
  assert.equal(r.margen, n('50'))
  assert.equal(r.margenPct, null)
})

test('sumarCifras y totalDeMargen: el total es la suma de las filas y su margen se calcula del total, no de los porcentajes', () => {
  const a = cifras({ unidades: 10, ingresos: c('1000'), costo: c('900') }) // 10 %
  const b = cifras({ unidades: 1, ingresos: c('100'), costo: c('10'), unidadesSinCosto: 0 }) // 90 %
  const s = sumarCifras(a, b)
  assert.deepEqual(s, { unidades: 11, ingresos: c('1100'), costo: c('910'), unidadesSinCosto: 0, ingresosSinCosto: CERO })
  const t = totalDeMargen(s, 2)
  assert.equal(t.margen, c('190'))
  assert.equal(t.margenPct, 17.3, 'no el promedio de 10 % y 90 %')
  assert.equal(t.productos, 2)
  assert.deepEqual(sumarCifras(CIFRAS_VACIAS, CIFRAS_VACIAS), CIFRAS_VACIAS)
  assert.equal(totalDeMargen(CIFRAS_VACIAS, 0).margenPct, null)
})

test('filaDeMargen: conserva el producto y añade el margen', () => {
  const f = filaDeMargen({ varianteId: 'v1', producto: 'Jabón', sku: 'JAB', ...cifras({ unidades: 3, ingresos: c('300'), costo: c('150') }) })
  assert.deepEqual([f.varianteId, f.producto, f.sku, f.unidades, f.margen, f.margenPct], ['v1', 'Jabón', 'JAB', 3, c('150'), 50])
})

// ── Clases de venta y orden ──────────────────────────────────────────────────

test('lo que no entra al margen: tres clases, cada una con su etiqueta y su explicación, siempre en el mismo orden y en cero', () => {
  assert.deepEqual([...CLASES_EXCLUIDAS], ['REEMBOLSADO', 'OTRA_MONEDA', 'SIN_INGRESO'])
  for (const k of CLASES_EXCLUIDAS) assert.ok(ETIQUETA_EXCLUIDA[k] && EXPLICACION_EXCLUIDA[k], k)
  assert.deepEqual(excluidasVacias(), [
    { clase: 'REEMBOLSADO', unidades: 0, costo: CERO, unidadesSinCosto: 0 },
    { clase: 'OTRA_MONEDA', unidades: 0, costo: CERO, unidadesSinCosto: 0 },
    { clase: 'SIN_INGRESO', unidades: 0, costo: CERO, unidadesSinCosto: 0 },
  ])
  // Cada llamada trae objetos nuevos (quien los llena no ensucia a la siguiente).
  excluidasVacias()[0].unidades = 9
  assert.equal(excluidasVacias()[0].unidades, 0)
  assert.ok(esClaseDeVenta('MARGEN') && esClaseDeVenta('REEMBOLSADO') && esClaseDeVenta('OTRA_MONEDA') && esClaseDeVenta('SIN_INGRESO'))
  for (const raro of ['', 'margen', 'OTRO', null, undefined, 7, {}]) assert.equal(esClaseDeVenta(raro), false, String(raro))
})

test('orden: cinco órdenes con etiqueta, el de siempre es «más margen primero» y lo desconocido no vale', () => {
  assert.deepEqual([...ORDENES_MARGEN], ['margen', 'peor', 'porcentaje', 'ingresos', 'unidades'])
  assert.equal(ORDEN_MARGEN_POR_DEFECTO, 'margen')
  for (const o of ORDENES_MARGEN) {
    assert.ok(esOrdenMargen(o) && ETIQUETA_ORDEN_MARGEN[o], o)
  }
  for (const raro of ['', 'MARGEN', 'margen ', 'DROP TABLE', null, undefined, 3, ['margen']]) assert.equal(esOrdenMargen(raro), false, String(raro))
})

// ── Dinero con signo ─────────────────────────────────────────────────────────

test('formatearMontoFirmado: con signo menos de verdad en pantalla y «-» normal si se pide; cero y positivos sin signo', () => {
  assert.equal(formatearMontoFirmado(c('1234.5')), '1,234.50')
  assert.equal(formatearMontoFirmado(CERO), '0.00')
  assert.equal(formatearMontoFirmado(n('1234.5')), '−1,234.50')
  assert.equal(formatearMontoFirmado(n('1234.5'), '-'), '-1,234.50')
  assert.equal(formatearMontoFirmado(n('0.004')), '−0.00', 'redondea como el resto de los montos')
})

test('formatearPorcentaje: un decimal, el signo menos de verdad (el mismo de los montos) y «—» sin base', () => {
  assert.equal(formatearPorcentaje(40), '40.0 %')
  assert.equal(formatearPorcentaje(17.6), '17.6 %')
  assert.equal(formatearPorcentaje(0), '0.0 %')
  assert.equal(formatearPorcentaje(-10), '\u221210.0 %')
  assert.equal(formatearPorcentaje(-60.5), '\u221260.5 %')
  assert.equal(formatearPorcentaje(-150), '\u2212150.0 %')
  assert.equal(formatearPorcentaje(-10, '-'), '-10.0 %')
  assert.equal(formatearPorcentaje(null), '—', 'sin base no hay porcentaje: ni 0 ni 0.0 %')
  // El margen negativo se lee igual en dinero y en porcentaje.
  assert.equal(formatearMontoFirmado(n('40'))[0], formatearPorcentaje(-10)[0])
})

// ── Filtros de la URL ────────────────────────────────────────────────────────

test('leerFiltrosMargen: fechas válidas, sucursal, texto, orden conocido y página; lo raro se ignora', () => {
  const f = leerFiltrosMargen({ desde: '2026-09-01', hasta: '2026-09-30', sucursal: 'suc1', q: ' jabón ', orden: 'peor', pagina: '3' })
  assert.deepEqual(f, { desde: '2026-09-01', hasta: '2026-09-30', sucursalId: 'suc1', q: 'jabón', orden: 'peor', pagina: 3 })
  assert.deepEqual(leerFiltrosMargen({}), { orden: 'margen', pagina: 1 })
  const raro = leerFiltrosMargen({ desde: '2026-13-45', hasta: 'ayer', orden: 'DROP TABLE', pagina: '-4', q: '   ' })
  assert.deepEqual(raro, { orden: 'margen', pagina: 1 })
  assert.equal(leerFiltrosMargen({ orden: ['peor', 'margen'] }).orden, 'peor', 'el primer valor, como en las demás pantallas')
})

test('consultaDeFiltrosMargen: lo de siempre no ensucia la URL, la página 1 no se escribe, y leerla de vuelta da lo mismo', () => {
  assert.equal(consultaDeFiltrosMargen({ orden: 'margen', pagina: 1 }), '')
  const f = { desde: '2026-09-01', hasta: '2026-09-30', sucursalId: 'suc1', q: 'jabón líquido', orden: 'porcentaje' as const, pagina: 2 }
  const url = consultaDeFiltrosMargen(f)
  assert.equal(url, 'desde=2026-09-01&hasta=2026-09-30&sucursal=suc1&q=jab%C3%B3n+l%C3%ADquido&orden=porcentaje&pagina=2')
  const crudo = Object.fromEntries(new URLSearchParams(url))
  assert.deepEqual(leerFiltrosMargen(crudo), f)
  assert.equal(consultaDeFiltrosMargen(f, 1), 'desde=2026-09-01&hasta=2026-09-30&sucursal=suc1&q=jab%C3%B3n+l%C3%ADquido&orden=porcentaje')
  assert.equal(consultaDeFiltrosMargen({ ...f, orden: 'margen' }), 'desde=2026-09-01&hasta=2026-09-30&sucursal=suc1&q=jab%C3%B3n+l%C3%ADquido&pagina=2')
})

// ── CSV ──────────────────────────────────────────────────────────────────────

const ZONA = 'America/Santo_Domingo'
const AHORA = new Date(Date.UTC(2026, 9, 15, 16, 0))

function vista(extra: Partial<MargenVista> = {}): MargenVista {
  const f1 = filaDeMargen({ varianteId: 'v1', producto: 'Jabón · 1 L', sku: 'JAB-1', ...cifras({ unidades: 1500, ingresos: c('1234567.5'), costo: c('1000000') }) })
  const f2 = filaDeMargen({ varianteId: 'v2', producto: '=HYPERLINK("http://x")', sku: '+SKU', ...cifras({ unidades: 4, ingresos: c('80'), costo: c('100') }) })
  const f3 = filaDeMargen({ varianteId: 'v3', producto: 'Cera', sku: 'CER-1', ...cifras({ unidades: 5, ingresos: c('400'), unidadesSinCosto: 5, ingresosSinCosto: c('400') }) })
  const suma = [f1, f2, f3].reduce((t, f) => sumarCifras(t, f), CIFRAS_VACIAS)
  const excluidas = excluidasVacias()
  excluidas[0].unidades = 3
  excluidas[0].costo = c('30')
  return {
    desde: '2026-09-16',
    hasta: '2026-10-15',
    moneda: 'DOP',
    totales: totalDeMargen(suma, 3),
    filas: [f1, f2, f3],
    excluidas,
    pagina: 1,
    porPagina: 20000,
    ...extra,
  }
}

test('margenToCsv: resumen, lo que no entra y un renglón por producto; montos planos (sin miles), margen negativo con «-», lo incalculable VACÍO y nada que Excel evalúe', () => {
  const csv = margenToCsv(vista(), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Producto', 'jabón']], tope: 20000 })
  assert.ok(csv.startsWith('﻿'))
  assert.match(csv, /^Moneda;DOP$/m)
  assert.match(csv, /^Desde;2026-09-16$/m)
  assert.match(csv, /^Hasta;2026-10-15$/m)
  assert.match(csv, /^Filtro: Producto;jabón$/m)
  assert.match(csv, /^Productos vendidos;3$/m)
  assert.match(csv, /^Unidades vendidas;1509$/m)
  // Ingresos 1.234.567,50 + 80 + 400 = 1.235.047,50 sin separador de miles.
  assert.match(csv, /^Ingresos \(precio de la línea menos su descuento y sin impuestos\);1235047\.50$/m, 'sin separador de miles')
  assert.match(csv, /^Costo de lo vendido \(solo lo que tiene costo\);1000100\.00$/m)
  // Base con costo = 1.235.047,50 − 400 = 1.234.647,50; margen = 1.234.647,50 − 1.000.100 = 234.547,50.
  assert.match(csv, /^Margen;234547\.50$/m)
  assert.match(csv, /^Margen %;19\.0$/m)
  assert.match(csv, /^Unidades sin costo \(no entran al margen\);5$/m)
  assert.match(csv, /^Ingresos de esas unidades \(no entran al margen\);400\.00$/m)
  assert.match(csv, /^Pedidos reembolsados \(fuera del margen\): unidades;3$/m)
  assert.match(csv, /^Pedidos reembolsados \(fuera del margen\): costo;30\.00$/m)
  assert.match(csv, /^Pedidos en otra moneda \(fuera del margen\): unidades;0$/m)
  assert.match(csv, /^Datos completos;Si$/m)
  assert.match(csv, /^Producto;SKU;Unidades;Ingresos;Costo;Margen;Margen %;Unidades sin costo;Ingresos sin costo$/m)
  assert.match(csv, /^Jabón · 1 L;JAB-1;1500;1234567\.50;1000000\.00;234567\.50;19\.0;0;0\.00$/m)
  // Por debajo del costo: el margen es un número negativo normal (la hoja lo suma), no texto.
  assert.match(csv, /;4;80\.00;100\.00;-20\.00;-25\.0;0;0\.00$/m)
  // Sin costo conocido: el porcentaje no se inventa (vacío) y el margen es 0.00.
  assert.match(csv, /^Cera;CER-1;5;400\.00;0\.00;0\.00;;5;400\.00$/m)
  // El producto y el SKU con fórmula se neutralizan.
  assert.match(csv, /^"'=HYPERLINK\(""http:\/\/x""\)";'\+SKU;/m)
  assert.ok(!/(^|;)=HYPERLINK/m.test(csv))
})

test('margenToCsv: ningún texto que venga de la empresa llega al archivo sin neutralizar (ni la moneda)', () => {
  const csv = margenToCsv(vista({ moneda: '=1+1' }), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Producto', '@cmd']], tope: 20000 })
  assert.match(csv, /^Moneda;'=1\+1$/m)
  assert.match(csv, /^Filtro: Producto;'@cmd$/m)
  assert.ok(!/^Moneda;=/m.test(csv))
})

test('margenToCsv dice cuando la lista quedó cortada, y no cuando está completa', () => {
  const v = vista()
  const cortado = margenToCsv({ ...v, totales: { ...v.totales, productos: 25000 } }, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(cortado, /^Datos completos;"?NO - el archivo trae solo 20000 de 25000 productos/m)
  const completo = margenToCsv(v, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(completo, /^Datos completos;Si$/m)
  assert.match(completo, /^Productos en el archivo;3$/m)
})

test('margenToCsv sin ventas: resumen en ceros y sin porcentaje, sin renglones de producto', () => {
  const v = vista({ filas: [], totales: totalDeMargen(CIFRAS_VACIAS, 0), excluidas: excluidasVacias() })
  const csv = margenToCsv(v, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(csv, /^Productos vendidos;0$/m)
  assert.match(csv, /^Margen;0\.00$/m)
  assert.match(csv, /^Margen %;$/m, 'sin base no hay porcentaje: vacío, no 0')
  assert.match(csv, /^Datos completos;Si$/m)
})
