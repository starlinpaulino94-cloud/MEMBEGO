import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveNotificationHref } from '../apps/client/src/lib/notificacion-navegacion'

test('notification links map supported client pages into Expo routes', () => {
  assert.equal(resolveNotificationHref('/cliente/promociones?auto=campaign'), '/promociones')
  assert.deepEqual(resolveNotificationHref('/cliente/planes/plan-123'), {
    pathname: '/planes/[planId]',
    params: { planId: 'plan-123' },
  })
  assert.deepEqual(resolveNotificationHref('/cliente/membresia/membership-123'), {
    pathname: '/membresia/[membresiaId]',
    params: { membresiaId: 'membership-123' },
  })
  assert.deepEqual(resolveNotificationHref('/cliente/mis-promociones/regalo/invitado_123'), {
    pathname: '/mis-promociones/regalo/[invitadoId]',
    params: { invitadoId: 'invitado_123' },
  })
})

test('notification links cannot navigate to external or unsupported routes', () => {
  for (const href of [
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/toString',
    '/cliente/pedidos/pedido-123',
    '/cliente/promociones/%2F%2Fevil',
  ]) {
    assert.equal(resolveNotificationHref(href), null, href + ' must not resolve')
  }
})
