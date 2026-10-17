/**
 * La regla que separa «hay un cliente esperando» de «el registro quedó sin cerrar».
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMORA_SOSPECHOSA_MS,
  ENTREGA_EN_CURSO_MS,
  MARGEN_DE_ENTREGA_MS,
  describirDemora,
  entregaEnCurso,
  entregaRequierePersona,
  evidenciaDeEntrega,
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

test('la evidencia dice qué activación se usó y cuánto tardó tras el cobro', () => {
  const m = { pagoConfirmado: true, fechaPago: despues(3 * 3_600_000) }
  assert.deepEqual(evidenciaDeEntrega({ activadoAt: cobro, membership: m, compra: null }), { fuente: 'MEMBRESIA', fecha: m.fechaPago, demoraMs: 3 * 3_600_000 })
  const c = { pagoConfirmado: true, fechaActivacion: despues(5_000) }
  assert.deepEqual(evidenciaDeEntrega({ activadoAt: cobro, membership: null, compra: c }), { fuente: 'COMPRA', fecha: c.fechaActivacion, demoraMs: 5_000 })
  assert.equal(
    evidenciaDeEntrega({ activadoAt: cobro, membership: { pagoConfirmado: true, fechaPago: despues(-2 * MARGEN_DE_ENTREGA_MS) }, compra: null }),
    null,
    'sin evidencia no hay nada que describir'
  )
})

test('la demora se lee en palabras y la sospechosa empieza en un día', () => {
  assert.equal(describirDemora(5_000), 'unos segundos')
  assert.equal(describirDemora(60_000), '1 minuto')
  assert.equal(describirDemora(12 * 60_000), '12 minutos')
  assert.equal(describirDemora(3_600_000), '1 hora')
  assert.equal(describirDemora(2 * 3_600_000), '2 horas')
  assert.equal(describirDemora(3 * 86_400_000), '3 días')
  assert.equal(describirDemora(-5_000), 'unos segundos', 'dentro del margen de reloj no hay demora negativa')
  assert.equal(DEMORA_SOSPECHOSA_MS, 24 * 3_600_000)
})

test('un cambio de plan pagado necesita a una persona; una renovación automática no, aunque tenga un cambio pedido', () => {
  const cambio = { estado: 'ACTIVA', planIdSolicitado: 'plan-nuevo' }
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: cambio }), true)
  assert.equal(entregaRequierePersona({ canal: null, membership: cambio }), true)
  assert.equal(entregaRequierePersona({ canal: 'RENOVACION_AUTOMATICA', membership: cambio }), false, 'la renovación se entrega extendiendo')
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: { estado: 'ACTIVA', planIdSolicitado: null } }), false)
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: { estado: 'PENDIENTE', planIdSolicitado: 'plan-nuevo' } }), false, 'una activación normal sí se reintenta')
  assert.equal(entregaRequierePersona({ canal: 'APP', membership: null }), false)
})
