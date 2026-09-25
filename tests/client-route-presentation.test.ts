import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getClientRoutePresentation,
  requiresClientAuthentication,
} from '../apps/client/src/lib/client-route-presentation'

test('collection routes keep the authenticated navigation shell', () => {
  for (const pathname of ['/inicio', '/empresas', '/planes', '/promociones', '/ayuda', '/regalos']) {
    assert.equal(getClientRoutePresentation(pathname), 'navigation')
  }
})

test('details and flows use a bare presentation', () => {
  for (const pathname of [
    '/planes/plan-1',
    '/promociones/promo-1',
    '/membresia/membership-1',
    '/mis-promociones/promo-1',
    '/mis-promociones/promo-1/agendar',
    '/mis-excursiones/reserva-1',
    '/empresas/mi-negocio',
    '/ayuda/ticket-1',
    '/vehiculos/nuevo',
    '/regalos/enviar',
  ]) {
    assert.equal(getClientRoutePresentation(pathname), 'bare')
  }
})

test('anonymous users are redirected from client routes to login', () => {
  assert.equal(requiresClientAuthentication('/cuenta'), true)
  assert.equal(requiresClientAuthentication('/empresas/mi-negocio'), true)
  assert.equal(requiresClientAuthentication('/login'), false)
  assert.equal(requiresClientAuthentication('/establecer-contrasena/token'), false)
  assert.equal(requiresClientAuthentication('/'), false)
})
