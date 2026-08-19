import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rangoDeParametros,
  nombreReporte,
  filasDeVentas,
  filasDeComisiones,
  filasDeLiquidaciones,
  avisoDeTope,
} from '../src/modules/excursiones/reportes/nucleo'

/**
 * Excursiones · Fase 10 — lo que sale en el CSV es lo que el contador va a
 * cuadrar. Se prueba puro: qué período abarca y qué dice cada celda.
 */

const AHORA = new Date('2026-08-17T18:00:00.000Z')

test('sin parámetros el reporte es el mes en curso, en hora local', () => {
  const r = rangoDeParametros(null, null, AHORA)
  assert.equal(r.desde.toISOString(), '2026-08-01T04:00:00.000Z')
  assert.equal(r.hasta.toISOString(), '2026-09-01T03:59:59.999Z')
})

test('el último día del período entra entero', () => {
  const r = rangoDeParametros('2026-08-01', '2026-08-31', AHORA)
  // Una venta de las 9 de la noche del 31 en RD es del 1 de septiembre en UTC
  // y tiene que entrar igual.
  const nocheDel31 = new Date('2026-09-01T01:00:00.000Z')
  assert.ok(nocheDel31 >= r.desde && nocheDel31 <= r.hasta)
})

test('fechas al revés se enderezan, no devuelven un archivo vacío', () => {
  const r = rangoDeParametros('2026-08-31', '2026-08-01', AHORA)
  assert.equal(r.desde.toISOString(), '2026-08-01T04:00:00.000Z')
  assert.ok(r.hasta > r.desde)
})

test('una fecha inventada cae al mes en curso en vez de reventar', () => {
  const r = rangoDeParametros('ayer', '2026-08-31', AHORA)
  assert.equal(r.desde.toISOString(), '2026-08-01T04:00:00.000Z')
})

test('el archivo lleva su período en el nombre', () => {
  assert.equal(
    nombreReporte(rangoDeParametros('2026-08-01', '2026-08-31', AHORA)),
    'excursiones-2026-08-01_2026-08-31'
  )
})

test('una venta sin vendedor se escribe como directa, no como celda vacía', () => {
  const filas = filasDeVentas([
    {
      numero: 'SAL-000001', fecha: '17/8/2026', cliente: 'Ana', excursion: 'Saona',
      vendedor: null, vendedorCodigo: null, pasajeros: 3, total: 1180,
      moneda: 'DOP', estado: 'CONFIRMADA',
    },
  ])
  assert.equal(filas[0][4], 'Venta directa')
  assert.equal(filas[0][7], '1180.00') // dos decimales siempre
})

test('la comisión enseña la diferencia entre lo generado y lo que se paga', () => {
  const filas = filasDeComisiones([
    {
      fecha: '17/8/2026', vendedor: 'Juan', vendedorCodigo: 'RAF-00001', venta: 'SAL-000001',
      desglose: '10% sobre 1000', base: 1000, monto: 100, ajustes: -40, neto: 60,
      moneda: 'DOP', estado: 'APROBADA', liquidacion: null,
    },
  ])
  assert.equal(filas[0][6], '100.00') // generada
  assert.equal(filas[0][7], '-40.00') // ajustes
  assert.equal(filas[0][8], '60.00') // neto
  assert.equal(filas[0][11], '') // sin liquidación todavía
})

test('la liquidación exporta su referencia de pago', () => {
  const filas = filasDeLiquidaciones([
    {
      numero: 'PAY-2026-0001', vendedor: 'Juan', vendedorCodigo: 'RAF-00001',
      desde: '1/8/2026', hasta: '31/8/2026', comisiones: 3, total: 300,
      moneda: 'DOP', estado: 'PAGADA', metodo: 'TRANSFERENCIA',
      referencia: 'TRX-99120', pagada: '31/8/2026',
    },
  ])
  assert.equal(filas[0][10], 'TRX-99120')
  assert.equal(filas[0][6], '300.00')
})

test('si el período no cabe, el aviso va dentro del archivo', () => {
  assert.deepEqual(avisoDeTope(500, 10_000), [])
  const aviso = avisoDeTope(12_500, 10_000)
  assert.equal(aviso.length, 1)
  assert.match(String(aviso[0][0]), /12500 filas.*10000/)
})
