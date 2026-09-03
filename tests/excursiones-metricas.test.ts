import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rangoDePeriodo,
  rangoDelPanel,
  ticketPromedio,
  conversion,
  progresoMeta,
  validarMeta,
  calcularIngresosMeta,
} from '../src/modules/excursiones/metricas/nucleo'

/**
 * Excursiones · Fase 9 — el corte del período decide en qué mes cae cada
 * venta, y las metas deciden si alguien cobra un bono. Se prueba puro y con
 * instantes fijos.
 */

test('el mes corta en hora local, no en UTC', () => {
  // 31 de agosto, 9 de la noche en RD = 1 de septiembre 01:00 UTC. Esa venta
  // es de AGOSTO para el negocio, y el rango de agosto tiene que incluirla.
  const nocheDel31 = new Date('2026-09-01T01:00:00.000Z')
  const { desde, hasta } = rangoDePeriodo('MENSUAL', nocheDel31)
  assert.equal(desde.toISOString(), '2026-08-01T04:00:00.000Z') // 1 ago 00:00 local
  assert.ok(nocheDel31 >= desde && nocheDel31 <= hasta)
  // Y el primero de septiembre por la mañana ya es septiembre.
  const manianaDel1 = new Date('2026-09-01T14:00:00.000Z')
  assert.equal(rangoDePeriodo('MENSUAL', manianaDel1).desde.toISOString(), '2026-09-01T04:00:00.000Z')
})

test('la semana empieza el lunes, como la cuenta el negocio', () => {
  // Domingo 16 de agosto de 2026, media tarde en RD.
  const domingo = new Date('2026-08-16T18:00:00.000Z')
  const { desde, hasta } = rangoDePeriodo('SEMANAL', domingo)
  assert.equal(desde.toISOString(), '2026-08-10T04:00:00.000Z') // lunes 10
  assert.ok(domingo <= hasta)
  // El lunes siguiente ya es otra semana.
  const lunes = new Date('2026-08-17T18:00:00.000Z')
  assert.equal(rangoDePeriodo('SEMANAL', lunes).desde.toISOString(), '2026-08-17T04:00:00.000Z')
})

test('el día abarca la jornada local completa', () => {
  const { desde, hasta } = rangoDePeriodo('DIARIA', new Date('2026-08-17T18:00:00.000Z'))
  assert.equal(desde.toISOString(), '2026-08-17T04:00:00.000Z')
  assert.equal(hasta.toISOString(), '2026-08-18T03:59:59.999Z')
})

test('el selector del panel cae al mes cuando le dan algo que no conoce', () => {
  const ahora = new Date('2026-08-17T18:00:00.000Z')
  assert.equal(rangoDelPanel('HOY', ahora).label, 'Hoy')
  assert.equal(rangoDelPanel('inventado', ahora).label, 'Este mes')
})

test('sin ventas el ticket promedio es null, no cero', () => {
  assert.equal(ticketPromedio(0, 0), null)
  assert.equal(ticketPromedio(3000, 4), 750)
  assert.equal(conversion(0, 0), null) // nadie visitó: no hay 0% que acusar
  assert.equal(conversion(3, 12), 25)
})

test('el progreso solo pinta las métricas que la meta define', () => {
  const lineas = progresoMeta(
    { metaVentas: 10, metaPasajeros: null, metaIngresos: 50000, metaRegistros: null, metaReservas: null },
    { ventas: 4, pasajeros: 30, ingresos: 60000, registros: 12, reservas: 6, moneda: 'DOP' }
  )
  assert.deepEqual(lineas.map((l) => l.clave), ['ventas', 'ingresos'])
  assert.equal(lineas[0].pct, 40)
  assert.equal(lineas[0].cumplida, false)
  // Pasarse cuenta como cumplida y la barra se topa en 100.
  assert.equal(lineas[1].pct, 100)
  assert.equal(lineas[1].cumplida, true)
  assert.equal(lineas[1].esDinero, true)
})

test('una meta sin ninguna cifra no se guarda', () => {
  assert.equal(validarMeta({ vendedorId: 'juan', periodo: 'MENSUAL' }).ok, false)
  assert.equal(validarMeta({ periodo: 'MENSUAL', metaVentas: '10' }).ok, false)
  const r = validarMeta({ vendedorId: 'juan', periodo: 'MENSUAL', metaVentas: '10', metaIngresos: '50000' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.metaVentas, 10)
    assert.equal(r.datos.metaIngresos, 50000)
    assert.equal(r.datos.metaPasajeros, null)
  }
})

test('un rango exige sus dos fechas y en orden', () => {
  assert.equal(validarMeta({ vendedorId: 'j', periodo: 'RANGO', metaVentas: '5', desde: '2026-08-01' }).ok, false)
  assert.equal(
    validarMeta({ vendedorId: 'j', periodo: 'RANGO', metaVentas: '5', desde: '2026-08-31', hasta: '2026-08-01' }).ok,
    false
  )
  const r = validarMeta({
    vendedorId: 'j',
    periodo: 'RANGO',
    metaVentas: '5',
    desde: '2026-08-01',
    hasta: '2026-08-31',
  })
  assert.equal(r.ok, true)
})

test('calcularIngresosMeta: convierte ventas multimoneda a la moneda predeterminada con tasas de cambio', () => {
  const ventas = [
    { total: 100, moneda: 'USD' },
    { total: 5000, moneda: 'DOP' },
    { total: 50, moneda: 'USD' },
  ]
  const tasasCambio = { USD_DOP: 60 }

  // 100 * 60 = 6000 DOP + 5000 DOP + 50 * 60 = 3000 DOP => Total 14000 DOP
  const totalDop = calcularIngresosMeta(ventas, 'DOP', tasasCambio)
  assert.equal(totalDop, 14000)

  // A la inversa, de DOP a USD usando la misma tasa inversa
  const ventasSoloDop = [{ total: 6000, moneda: 'DOP' }]
  const totalUsd = calcularIngresosMeta(ventasSoloDop, 'USD', tasasCambio)
  assert.equal(totalUsd, 100)

  // Sin tasas configuradas, fallback 1:1
  const sinTasa = calcularIngresosMeta([{ total: 100, moneda: 'EUR' }], 'DOP', {})
  assert.equal(sinTasa, 100)

  // Sin ventas
  assert.equal(calcularIngresosMeta([], 'DOP', tasasCambio), 0)
})

test('progresoMeta: evalúa cumplimiento de meta de ingresos normalizada', () => {
  const meta = {
    metaVentas: null,
    metaPasajeros: null,
    metaIngresos: 10000,
    metaRegistros: null,
    metaReservas: null,
  }
  const reales = {
    ventas: 2,
    pasajeros: 4,
    ingresos: 12000, // Superó la meta gracias a conversión de tasas
    registros: 10,
    reservas: 5,
    moneda: 'DOP',
  }
  const progreso = progresoMeta(meta, reales)
  assert.equal(progreso.length, 1)
  assert.equal(progreso[0].clave, 'ingresos')
  assert.equal(progreso[0].real, 12000)
  assert.equal(progreso[0].meta, 10000)
  assert.equal(progreso[0].cumplida, true)
  assert.equal(progreso[0].pct, 100) // Topado a 100
})
