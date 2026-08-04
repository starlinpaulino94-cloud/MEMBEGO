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

test('el vector de prueba de la documentación sigue siendo cierto', () => {
  // docs/INTEGRACIONES.md §1 publica este token para que el satélite pruebe su
  // verificador sin depender de MembeGo. Si el formato cambiara y la doc no,
  // el satélite estaría persiguiendo un fantasma: aquí se rompe primero.
  const SECRETO_DOC = 'secreto-de-prueba'
  const datos = {
    sub: '623d642c-ae5f-445a-99eb-220b55eb0e1c',
    email: 'dueno@ejemplo.com',
    rol: 'ADMIN_EMPRESA',
    companyId: 'cmre1hz570000jp04ad5i0roi',
    exp: 1_900_000_000,
  }
  const TOKEN_DOC =
    'eyJzdWIiOiI2MjNkNjQyYy1hZTVmLTQ0NWEtOTllYi0yMjBiNTVlYjBlMWMiLCJlbWFpbCI6ImR1ZW5vQGVqZW1wbG8uY29tIiwicm9sIjoiQURNSU5fRU1QUkVTQSIsImNvbXBhbnlJZCI6ImNtcmUxaHo1NzAwMDBqcDA0YWQ1aTByb2kiLCJleHAiOjE5MDAwMDAwMDB9.' +
    '02d8a44d97acc2b4eee1804fbb0a78b351adee9ad8018c335888fe08ac8bc326'

  assert.equal(crearTokenSSO(SECRETO_DOC, datos), TOKEN_DOC)
  // Se verifica con un reloj anterior a `exp` para que la prueba no caduque
  // sola en 2030 y deje a alguien depurando un fallo que no existe.
  const leido = verificarTokenSSO(SECRETO_DOC, TOKEN_DOC, 1_800_000_000)
  assert.ok(leido)
  assert.equal(leido.companyId, 'cmre1hz570000jp04ad5i0roi')
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
