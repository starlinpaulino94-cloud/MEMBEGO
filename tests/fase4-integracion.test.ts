import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionCtaPlanes } from '../src/modules/marketplace/conversion'

// ── decisionCtaPlanes ─────────────────────────────────────────────────────────

test('empresa ajena: sin CTA (planes informativos)', () => {
  const cta = decisionCtaPlanes({
    esMiEmpresa: false,
    rutaVehiculo: '/cliente/vehiculos/nuevo?next=x',
    rutaPlanes: '/cliente/planes',
  })
  assert.equal(cta, null)
})

test('empresa propia y requisitos cumplidos: Ver planes', () => {
  const cta = decisionCtaPlanes({
    esMiEmpresa: true,
    requisitos: { canProceed: true, nextAction: null },
    rutaVehiculo: '/cliente/vehiculos/nuevo?next=x',
    rutaPlanes: '/cliente/planes',
  })
  assert.deepEqual(cta, { href: '/cliente/planes', label: 'Ver planes', gating: false })
})

test('car wash sin vehículo: CTA al onboarding de vehículo', () => {
  const cta = decisionCtaPlanes({
    esMiEmpresa: true,
    requisitos: {
      canProceed: false,
      nextAction: 'START_VEHICLE_ONBOARDING',
    },
    rutaVehiculo: '/cliente/vehiculos/nuevo?next=/cliente/empresas/x?sucursal=s1&origen=cerca',
    rutaPlanes: '/cliente/planes',
  })
  assert.deepEqual(cta, {
    href: '/cliente/vehiculos/nuevo?next=/cliente/empresas/x?sucursal=s1&origen=cerca',
    label: 'Registrar mi vehículo',
    gating: true,
  })
})

test('requisitos sin datos (fail-open): se muestra Ver planes', () => {
  const cta = decisionCtaPlanes({
    esMiEmpresa: true,
    requisitos: null,
    rutaVehiculo: '/cliente/vehiculos/nuevo?next=x',
    rutaPlanes: '/cliente/planes',
  })
  assert.equal(cta?.gating, false)
  assert.equal(cta?.label, 'Ver planes')
})

test('requisito de perfil: fallback a planes con gating', () => {
  const cta = decisionCtaPlanes({
    esMiEmpresa: true,
    requisitos: { canProceed: false, nextAction: 'START_PROFILE_COMPLETION' },
    rutaVehiculo: '/cliente/vehiculos/nuevo?next=x',
    rutaPlanes: '/cliente/planes',
  })
  assert.deepEqual(cta, { href: '/cliente/planes', label: 'Ver planes', gating: true })
})
