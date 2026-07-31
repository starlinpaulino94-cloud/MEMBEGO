import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  firmarHmac,
  firmaValida,
  crearTokenSSO,
  verificarTokenSSO,
} from '../src/modules/integraciones/nucleo'

/**
 * Pruebas del núcleo de integraciones: la firma de webhooks y el token SSO
 * son EL contrato con los sistemas satélite — si esto cambia, se les rompe la
 * verificación. Estas pruebas lo fijan.
 */

const SECRETO = 'a'.repeat(64)

test('firmarHmac es determinista y sensible al secreto y al cuerpo', () => {
  const f1 = firmarHmac(SECRETO, '{"a":1}')
  assert.equal(f1, firmarHmac(SECRETO, '{"a":1}'))
  assert.notEqual(f1, firmarHmac(SECRETO, '{"a":2}'))
  assert.notEqual(f1, firmarHmac('b'.repeat(64), '{"a":1}'))
  assert.match(f1, /^[0-9a-f]{64}$/)
})

test('firmaValida acepta la firma correcta y rechaza las demás', () => {
  const cuerpo = '{"id":"evt_1","tipo":"cliente.registrado"}'
  const firma = firmarHmac(SECRETO, cuerpo)
  assert.equal(firmaValida(SECRETO, cuerpo, firma), true)
  const corrupta = (firma[0] === '0' ? '1' : '0') + firma.slice(1)
  assert.equal(firmaValida(SECRETO, cuerpo, corrupta), false)
  assert.equal(firmaValida(SECRETO, cuerpo + ' ', firma), false)
  assert.equal(firmaValida(SECRETO, cuerpo, 'corta'), false)
})

test('token SSO: ida y vuelta con el mismo secreto', () => {
  const exp = Math.floor(Date.now() / 1000) + 90
  const token = crearTokenSSO(SECRETO, {
    sub: 'user_123',
    email: 'empleado@x.com',
    rol: 'EMPLEADO',
    companyId: 'comp_9',
    exp,
  })
  const datos = verificarTokenSSO(SECRETO, token)
  assert.ok(datos)
  assert.equal(datos.sub, 'user_123')
  assert.equal(datos.companyId, 'comp_9')
  assert.equal(datos.rol, 'EMPLEADO')
})

test('token SSO: rechaza firma ajena, expiración y campos faltantes', () => {
  const exp = Math.floor(Date.now() / 1000) + 90
  const token = crearTokenSSO(SECRETO, {
    sub: 'u',
    email: 'e@x.com',
    rol: 'GERENTE',
    companyId: 'c',
    exp,
  })
  // Otro secreto: inválido.
  assert.equal(verificarTokenSSO('b'.repeat(64), token), null)
  // Expirado: inválido.
  const vencido = crearTokenSSO(SECRETO, {
    sub: 'u', email: 'e@x.com', rol: 'GERENTE', companyId: 'c',
    exp: Math.floor(Date.now() / 1000) - 1,
  })
  assert.equal(verificarTokenSSO(SECRETO, vencido), null)
  // Manipulado: inválido.
  const [cuerpo, firma] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)]
  const alterado = Buffer.from(
    JSON.stringify({ sub: 'OTRO', email: 'e@x.com', rol: 'GERENTE', companyId: 'c', exp })
  ).toString('base64url')
  assert.equal(verificarTokenSSO(SECRETO, `${alterado}.${firma}`), null)
  assert.equal(verificarTokenSSO(SECRETO, `${cuerpo}.`), null)
  assert.equal(verificarTokenSSO(SECRETO, 'basura'), null)
})
