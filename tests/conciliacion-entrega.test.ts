/**
 * La regla que separa «hay un cliente esperando» de «el registro quedó sin cerrar».
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ENTREGA_EN_CURSO_MS,
  MARGEN_DE_ENTREGA_MS,
  entregaEnCurso,
  productoYaEntregado,
  situacionDeEntrega,
} from '../src/modules/observabilidad/conciliacion-entrega'

const cobro = new Date('2026-10-01T15:00:00Z')
const ahora = new Date('2026-10-16T15:00:00Z')
const despues = (ms: number) => new Date(cobro.getTime() + ms)
const vieja = new Date(ahora.getTime() - 3_600_000)

test('una membresía activada a partir del cobro es un producto entregado', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(10_000) }, compra: null }), true)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(3 * 3_600_000) }, compra: null }), true, 'aunque se activara horas después, por otra vía')
})

test('un pago ANTERIOR de la misma membresía no prueba que ESTE cobro se entregó', () => {
  const anterior = new Date(cobro.getTime() - 2 * MARGEN_DE_ENTREGA_MS)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: anterior }, compra: null }), false)
})

test('sin pago confirmado, sin fecha o sin fecha del cobro no hay nada demostrado', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: false, fechaPago: despues(1000) }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: null }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: null, membership: { pagoConfirmado: true, fechaPago: despues(1000) }, compra: null }), false)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: null }), false)
})

test('una compra de promoción activada a partir del cobro también cuenta', () => {
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: { pagoConfirmado: true, fechaActivacion: despues(20_000) } }), true)
  assert.equal(productoYaEntregado({ activadoAt: cobro, membership: null, compra: { pagoConfirmado: true, fechaActivacion: null } }), false)
})

test('una entrega recién empezada no es un fallo; una vieja o una FALLIDA sí se revisan', () => {
  const reciente = new Date(ahora.getTime() - ENTREGA_EN_CURSO_MS + 5_000)
  assert.equal(entregaEnCurso('PENDIENTE', reciente, ahora), true)
  assert.equal(entregaEnCurso('PROCESANDO', reciente, ahora), true)
  assert.equal(entregaEnCurso('PENDIENTE', vieja, ahora), false)
  assert.equal(entregaEnCurso('FALLIDA', reciente, ahora), false, 'una entrega que ya falló nunca está «en curso»')
})

test('la situación decide la acción: esperando → reintentar; registro sin cerrar → marcar; en curso/entregada → nada', () => {
  const sinProducto = { activadoAt: cobro, membership: { pagoConfirmado: false, fechaPago: null }, compra: null }
  const conProducto = { activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(5_000) }, compra: null }
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'FALLIDA', actualizadoAt: vieja }, ahora), 'CLIENTE_ESPERANDO')
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'PROCESANDO', actualizadoAt: vieja }, ahora), 'CLIENTE_ESPERANDO', 'PROCESANDO atascado: antes era invisible')
  assert.equal(situacionDeEntrega({ ...conProducto, estado: 'PENDIENTE', actualizadoAt: vieja }, ahora), 'REGISTRO_SIN_CERRAR')
  assert.equal(situacionDeEntrega({ ...sinProducto, estado: 'PENDIENTE', actualizadoAt: new Date(ahora.getTime() - 1000) }, ahora), 'EN_CURSO')
  assert.equal(situacionDeEntrega({ ...conProducto, estado: 'COMPLETADA', actualizadoAt: vieja }, ahora), 'ENTREGADA')
})
