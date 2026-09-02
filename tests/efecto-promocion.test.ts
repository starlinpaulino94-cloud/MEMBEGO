/**
 * Efecto monetario de una promoción · pruebas del helper puro.
 * Ejecutar: npm test
 *
 * Este helper decide cuánto rebaja una promoción en la factura de un sistema
 * satélite. Equivocarse cuesta dinero en las dos direcciones: un porcentaje
 * cobrado como monto (o al revés) puede regalar el lavado o cobrarlo entero.
 * Por eso cada tipo con efecto automático tiene su prueba, y los que NO deben
 * tocar la factura tienen la suya afirmando `NONE`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { efectoPromocion } from '../src/lib/promociones'

test('descuento → PERCENT con el porcentaje', () => {
  assert.deepEqual(efectoPromocion('descuento', 20), {
    kind: 'PERCENT',
    value: 20,
    label: '-20%',
  })
})

test('happy_hour y temporada también son porcentaje', () => {
  assert.equal(efectoPromocion('happy_hour', 15).kind, 'PERCENT')
  assert.equal(efectoPromocion('temporada', 10).kind, 'PERCENT')
})

test('porcentaje mayor a 100 se recorta a 100', () => {
  const e = efectoPromocion('descuento', 150)
  assert.equal(e.kind, 'PERCENT')
  assert.equal(e.kind === 'PERCENT' && e.value, 100)
})

test('monto_fijo → AMOUNT en centavos (RD$ × 100)', () => {
  assert.deepEqual(efectoPromocion('monto_fijo', 100), {
    kind: 'AMOUNT',
    amountCents: 10000,
    label: 'RD$100',
  })
})

test('servicio_gratis → FREE (aunque no tenga descuento)', () => {
  assert.deepEqual(efectoPromocion('servicio_gratis', null), {
    kind: 'FREE',
    label: 'Servicio gratis',
  })
})

test('tipos sin rebaja automática → NONE, no se toca la factura', () => {
  for (const tipo of ['2x1', '3x2', 'upgrade', 'regalo', 'cupon', 'vip', 'general']) {
    assert.equal(efectoPromocion(tipo, 0).kind, 'NONE', `${tipo} debe ser NONE`)
  }
})

test('descuento 0 o nulo → NONE aunque el tipo sea de porcentaje/monto', () => {
  assert.equal(efectoPromocion('descuento', 0).kind, 'NONE')
  assert.equal(efectoPromocion('descuento', null).kind, 'NONE')
  assert.equal(efectoPromocion('monto_fijo', 0).kind, 'NONE')
})
