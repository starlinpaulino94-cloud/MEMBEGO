/**
 * Las reglas del barrido de entregas: cuándo reintentar, cuándo esperar, cuándo rendirse, y qué se avisa.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ESPERA_BASE_MS,
  ESPERA_MAX_MS,
  MAX_REINTENTOS_AUTOMATICOS,
  VENTANA_REINTENTO_DIAS,
  avisoDeEntregas,
  claveDeAvisoDelDia,
  decidirReintento,
  esperaTrasIntentos,
} from '../src/modules/pagos/barrido-entregas-reglas'

const ahora = new Date('2026-10-16T12:00:00Z')
const hace = (ms: number) => new Date(ahora.getTime() - ms)
const H = 3_600_000
const D = 24 * H

test('la espera se duplica con cada reintento y tiene tope de un día', () => {
  assert.equal(esperaTrasIntentos(0), 0, 'el primer reintento no espera')
  assert.deepEqual([1, 2, 3, 4].map(esperaTrasIntentos), [ESPERA_BASE_MS, 2 * ESPERA_BASE_MS, 4 * ESPERA_BASE_MS, 8 * ESPERA_BASE_MS])
  assert.equal(esperaTrasIntentos(30), ESPERA_MAX_MS)
  assert.equal(esperaTrasIntentos(Number.NaN), 0)
})

test('un cobro reciente sin reintentos se reintenta; uno que acaba de reintentarse espera su turno', () => {
  assert.equal(decidirReintento({ intentos: 0, actualizadoAt: hace(10 * 60_000), activadoAt: hace(2 * H) }, ahora), 'REINTENTAR')
  assert.equal(decidirReintento({ intentos: 2, actualizadoAt: hace(10 * 60_000), activadoAt: hace(2 * H) }, ahora), 'ESPERAR', 'tras 2 intentos toca esperar 30 min')
  assert.equal(decidirReintento({ intentos: 2, actualizadoAt: hace(31 * 60_000), activadoAt: hace(2 * H) }, ahora), 'REINTENTAR')
})

test('nunca se reintenta para siempre: agotados los reintentos se rinde', () => {
  assert.equal(decidirReintento({ intentos: MAX_REINTENTOS_AUTOMATICOS, actualizadoAt: hace(3 * D), activadoAt: hace(4 * D) }, ahora), 'AGOTADO')
  assert.equal(decidirReintento({ intentos: MAX_REINTENTOS_AUTOMATICOS - 1, actualizadoAt: hace(3 * D), activadoAt: hace(4 * D) }, ahora), 'REINTENTAR')
})

test('un cobro viejo o sin fecha lo decide una persona, no el barrido', () => {
  assert.equal(decidirReintento({ intentos: 0, actualizadoAt: hace(10 * D), activadoAt: hace((VENTANA_REINTENTO_DIAS + 1) * D) }, ahora), 'FUERA_DE_VENTANA')
  assert.equal(decidirReintento({ intentos: 0, actualizadoAt: hace(1 * H), activadoAt: null }, ahora), 'FUERA_DE_VENTANA')
  assert.equal(decidirReintento({ intentos: 0, actualizadoAt: hace(1 * H), activadoAt: hace((VENTANA_REINTENTO_DIAS - 1) * D) }, ahora), 'REINTENTAR')
})

test('el aviso dice cuántos clientes y cuánto dinero, y si ya hace falta una persona', () => {
  const uno = avisoDeEntregas({ esperando: 1, monto: 500, sinSalidaAutomatica: 0 })
  assert.equal(uno.titulo, 'Un pago con tarjeta sin entregar')
  assert.match(uno.mensaje, /^Un cliente pagó con tarjeta y todavía no tiene su producto \(RD\$500\.00\)\. El sistema sigue reintentando la entrega\. Revísalo en Conciliación\.$/)

  const varios = avisoDeEntregas({ esperando: 3, monto: 1500, sinSalidaAutomatica: 3 })
  assert.equal(varios.titulo, 'Pagos con tarjeta sin entregar')
  assert.match(varios.mensaje, /^3 clientes pagaron con tarjeta y todavía no tienen su producto \(RD\$1,500\.00\)\. El sistema ya no puede resolverlo solo: hace falta una persona\./)

  assert.match(avisoDeEntregas({ esperando: 4, monto: 10, sinSalidaAutomatica: 1 }).mensaje, /En 1 el sistema ya no puede resolverlo solo/)
})

test('la clave del aviso es una por empresa y día', () => {
  const a = claveDeAvisoDelDia('emp1', new Date('2026-10-16T05:00:00Z'))
  assert.equal(a, 'entregas-sin-cerrar:emp1:2026-10-16')
  assert.equal(claveDeAvisoDelDia('emp1', new Date('2026-10-16T23:59:00Z')), a, 'mismo día, misma clave')
  assert.notEqual(claveDeAvisoDelDia('emp1', new Date('2026-10-17T00:01:00Z')), a)
  assert.notEqual(claveDeAvisoDelDia('emp2', new Date('2026-10-16T05:00:00Z')), a)
})
