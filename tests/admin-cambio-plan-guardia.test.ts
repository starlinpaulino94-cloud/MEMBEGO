import test from 'node:test'
import assert from 'node:assert/strict'
import { motivoCambioDirectoBloqueado } from '../src/modules/membresia/cambio-plan-pendiente'

/**
 * M1 (revisión de calidad F2): el cambio directo del negocio no puede pasar por
 * encima de un cambio que el cliente ya solicitó. Si lo hiciera, el mismo
 * cambio quedaría con dos importes distintos (la vía directa cobra el plan
 * completo; la aprobación cobra la diferencia prorrateada).
 */

test('con una solicitud de cambio pendiente, la vía directa se bloquea', () => {
  // Given una membresía con un plan solicitado por el cliente.
  const planIdSolicitado = 'plan-gold'

  // When se decide si la vía directa puede aplicarse.
  const motivo = motivoCambioDirectoBloqueado(planIdSolicitado)

  // Then se bloquea con un motivo que manda a aprobar o rechazar la solicitud.
  assert.ok(motivo, 'debe bloquear la vía directa')
  assert.match(motivo, /apru/i)
})

test('sin solicitud pendiente, la vía directa sigue permitida', () => {
  // Given una membresía sin cambio solicitado (null o indefinido).
  // Then no hay bloqueo.
  assert.equal(motivoCambioDirectoBloqueado(null), null)
  assert.equal(motivoCambioDirectoBloqueado(undefined), null)
  assert.equal(motivoCambioDirectoBloqueado(''), null)
})
