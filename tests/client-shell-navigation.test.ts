import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESTINOS_CLIENTE_NATIVE } from '../apps/client/src/components/layout/destinos-cliente'
import { DESTINOS_CLIENTE } from '../src/components/layout/destinos-cliente'

/**
 * La app nativa expone LOS MISMOS cinco destinos del cliente que la web: ni uno más, ni
 * uno menos, y cada uno apunta a la misma ruta web. El ORDEN de las pestañas sí puede
 * diferir entre plataformas (la nativa pone Beneficios en segundo lugar desde `4e01131`,
 * la web pone Cuenta): es una decisión de cada barra, no del contrato de destinos.
 */
test('native shell exposes the same five customer destinations as Next', () => {
  assert.deepEqual(
    DESTINOS_CLIENTE_NATIVE.map((destination) => destination.label).sort(),
    ['Inicio', 'Cuenta', 'Mi QR', 'Beneficios', 'Menú'].sort()
  )
  assert.equal(DESTINOS_CLIENTE_NATIVE.length, 5)
  assert.deepEqual(
    DESTINOS_CLIENTE_NATIVE.map((d) => [d.label, d.webHref]).sort(),
    DESTINOS_CLIENTE.map((d) => [d.label, d.href]).sort(),
    'cada destino nativo apunta a la misma ruta web que su homólogo'
  )
})

test('benefits keeps the client web route identity', () => {
  const benefits = DESTINOS_CLIENTE_NATIVE.find(
    (destination) => destination.label === 'Beneficios'
  )

  assert.equal(benefits?.webHref, '/cliente/promociones')
  assert.equal(benefits?.href, '/(tabs)/beneficios')
})
