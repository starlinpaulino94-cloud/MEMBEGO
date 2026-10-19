/**
 * Lo que cambia en la membresía al aplicar un cambio de plan: una sola definición para el panel y la pasarela.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { datosDeCambioDePlan } from '../src/modules/membresia/cambio-plan-aplicar'
import { periodEnd } from '../src/lib/periodos'

const ahora = new Date('2026-10-17T15:00:00Z')
const cobro = new Date('2026-10-17T14:30:00Z')
const plan = { id: 'plan-b', vigenciaDias: 30, esIlimitado: false, lavadosIncluidos: 8 }

test('el cambio deja el plan nuevo, el periodo nuevo, los lavados del plan y borra el pedido', () => {
  const d = datosDeCambioDePlan({ nuevoPlan: plan, monto: 400, ahora })
  assert.deepEqual(
    { planId: d.planId, planIdSolicitado: d.planIdSolicitado, estado: d.estado, pagoConfirmado: d.pagoConfirmado, montoPagado: d.montoPagado, lavados: d.lavadosRestantes, rechazo: d.rechazadoReason },
    { planId: 'plan-b', planIdSolicitado: null, estado: 'ACTIVA', pagoConfirmado: true, montoPagado: 400, lavados: 8, rechazo: null }
  )
  assert.equal(d.fechaInicio, ahora)
  assert.equal(d.fechaVencimiento.getTime(), periodEnd(ahora, 30).getTime())
})

test('sin fecha de pago propia el pago es de ahora; con ella (la pasarela) es la del cobro', () => {
  assert.equal(datosDeCambioDePlan({ nuevoPlan: plan, monto: 400, ahora }).fechaPago, ahora)
  assert.equal(datosDeCambioDePlan({ nuevoPlan: plan, monto: 400, ahora, fechaPago: cobro }).fechaPago, cobro)
})

test('un plan ilimitado deja los lavados en 0', () => {
  assert.equal(datosDeCambioDePlan({ nuevoPlan: { ...plan, esIlimitado: true }, monto: 400, ahora }).lavadosRestantes, 0)
})

test('el panel y la pasarela aplican el cambio por la MISMA definición', () => {
  const admin = readFileSync(join('src', 'modules', 'admin', 'actions.ts'), 'utf8')
  assert.equal(admin.match(/datosDeCambioDePlan\(/g)?.length, 2, 'aprobar el cambio y confirmar el pago de un cambio')
  assert.doesNotMatch(admin, /montoPagado: pagoCambio\.aPagar/, 'el panel no vuelve a escribir a mano los campos del cambio prorrateado')
  const pasarela = readFileSync(join('src', 'modules', 'pagos', 'cambio-plan-cobrado.ts'), 'utf8')
  assert.match(pasarela, /datosDeCambioDePlan\(/)
  assert.doesNotMatch(pasarela, /cobrarConTarjeta|cobrarConCredencialGuardada|cobrarConToken/, 'entregar nunca recobra')
})

test('los tres caminos que crean un cobro guardan el plan que se paga', () => {
  const leer = (...r: string[]) => readFileSync(join('src', 'modules', 'pagos', ...r), 'utf8')
  assert.match(leer('cardnet3ds.ts'), /planDestinoId: monto\.planDestinoId \?\? null/)
  assert.match(leer('cardnetToken.ts'), /planDestinoId: monto\.planDestinoId \?\? null/)
  assert.match(leer('cardnetClienteInicio.ts'), /planDestinoId: target\.planDestinoId \?\? null/)
  assert.match(leer('cardnetClienteSesionStore.ts'), /planDestinoId: session\.planDestinoId/)
  // Y la app comprueba, antes de cobrar, que el plan que se paga sigue siendo el mismo.
  assert.match(leer('cardnetClienteAcciones.ts'), /planDestinoId \?\? null\) !== \(session\.planDestinoId \?\? null\)/)
  assert.match(leer('cardnetClienteInicio.ts'), /currentTarget\.target\.planDestinoId !== target\.planDestinoId/)
})
