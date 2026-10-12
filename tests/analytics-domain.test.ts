import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  aNumero,
  completarSerie,
  costoPorClienteNuevo,
  embudo,
  ETIQUETA_CANAL_ANALITICA,
  kpi,
  porcentaje,
  retornoSobreCuota,
  ticketPromedio,
  tomaDeComision,
} from '../src/modules/analytics/domain'

test('kpi: la variación es contra el periodo anterior y es null si antes no hubo nada (no «+100 %» ni infinito)', () => {
  assert.deepEqual(kpi(150, 100), { valor: 150, anterior: 100, variacion: 50 })
  assert.deepEqual(kpi(50, 100), { valor: 50, anterior: 100, variacion: -50 })
  assert.equal(kpi(5, 0).variacion, null)
  assert.equal(kpi(0, 0).variacion, null)
})

test('ticket promedio: ventas ÷ pedidos con dos decimales; sin pedidos es 0, no NaN', () => {
  assert.equal(ticketPromedio(2320, 6), 386.67)
  assert.equal(ticketPromedio(0, 0), 0)
  assert.equal(ticketPromedio(100, 0), 0)
})

test('toma de comisión: comisión ÷ GMV en %, y null cuando no hubo ventas', () => {
  assert.equal(tomaDeComision(600, 2320), 25.86)
  assert.equal(tomaDeComision(0, 1000), 0)
  assert.equal(tomaDeComision(100, 0), null)
  assert.equal(tomaDeComision(100, -5), null)
})

test('retorno: ventas por cada peso pagado; null si no se pagó nada (dividir por cero no es «infinito»)', () => {
  assert.equal(retornoSobreCuota(2320, 600), 3.9)
  assert.equal(retornoSobreCuota(320, 100), 3.2)
  assert.equal(retornoSobreCuota(500, 0), null)
})

test('porcentaje y costo por cliente nuevo: null sin base', () => {
  assert.equal(porcentaje(5, 8), 62.5)
  assert.equal(porcentaje(1, 3), 33.3)
  assert.equal(porcentaje(0, 0), null)
  assert.equal(costoPorClienteNuevo(600, 4), 150)
  assert.equal(costoPorClienteNuevo(600, 0), null)
})

test('aNumero: lee Decimal, bigint, texto y number; lo que no es número es 0 (nunca NaN en pantalla)', () => {
  assert.equal(aNumero(new Prisma.Decimal('1234.5')), 1234.5)
  assert.equal(aNumero(BigInt(7)), 7)
  assert.equal(aNumero('12.30'), 12.3)
  assert.equal(aNumero(4), 4)
  for (const raro of [null, undefined, 'abc', NaN, Infinity, {}]) assert.equal(aNumero(raro), 0)
})

test('embudo: abiertos = creados − completados − cancelados − reembolsados; el reembolso cuenta como caído; tasa de cierre', () => {
  assert.deepEqual(embudo(9, 6, 1, 1), { creados: 9, completados: 6, cancelados: 2, abiertos: 1, tasaDeCierre: 66.7 })
  assert.deepEqual(embudo(0, 0, 0, 0), { creados: 0, completados: 0, cancelados: 0, abiertos: 0, tasaDeCierre: null })
  assert.equal(embudo(3, 3, 1, 0).abiertos, 0, 'nunca negativo')
})

test('completarSerie: todos los días del rango, con ceros donde no hubo ventas, y en el orden del rango', () => {
  const s = completarSerie(['2031-03-01', '2031-03-02', '2031-03-03'], [{ dia: '2031-03-03', pedidos: 2, ventas: 800 }, { dia: '2031-03-01', pedidos: 1, ventas: 400 }])
  assert.deepEqual(s, [
    { dia: '2031-03-01', pedidos: 1, ventas: 400 },
    { dia: '2031-03-02', pedidos: 0, ventas: 0 },
    { dia: '2031-03-03', pedidos: 2, ventas: 800 },
  ])
})

test('toda etiqueta de canal está en español y cubre los canales del esquema más «sin atribución»', () => {
  const canales = ['MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH', 'PROMOTION_CLAIM', 'CAMPAIGN', 'REFERRAL', 'QR_SCAN', 'SUPPLY_OFFER', 'DIRECT', 'SIN_ATRIBUCION']
  assert.deepEqual(Object.keys(ETIQUETA_CANAL_ANALITICA).sort(), [...canales].sort())
  for (const t of Object.values(ETIQUETA_CANAL_ANALITICA)) assert.ok(t.length > 3)
})
