import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rnHref } from '../apps/client/src/lib/rutas'

test('dynamic home cards preserve direct native destinations', () => {
  assert.equal(rnHref('/cliente/empresas/mi-negocio'), '/empresas/mi-negocio')
  assert.equal(rnHref('/cliente/promociones/promo-1'), '/promociones/promo-1')
  assert.equal(rnHref('/cliente/planes/plan-1'), '/planes/plan-1')
  assert.equal(rnHref('/cliente/membresia/membership-1'), '/membresia/membership-1')
})
