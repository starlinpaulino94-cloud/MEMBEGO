import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESTINOS_CLIENTE_NATIVE } from '../apps/client/src/components/layout/destinos-cliente'

test('native shell exposes the same five customer destinations as Next', () => {
  assert.deepEqual(
    DESTINOS_CLIENTE_NATIVE.map((destination) => destination.label),
    ['Inicio', 'Cuenta', 'Mi QR', 'Beneficios', 'Menú']
  )
})

test('benefits keeps the client web route identity', () => {
  const benefits = DESTINOS_CLIENTE_NATIVE.find(
    (destination) => destination.label === 'Beneficios'
  )

  assert.equal(benefits?.webHref, '/cliente/promociones')
  assert.equal(benefits?.href, '/(tabs)/beneficios')
})
