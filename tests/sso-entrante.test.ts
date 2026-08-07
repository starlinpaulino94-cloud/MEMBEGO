/**
 * SSO DE ENTRADA (satélite → MembeGo) · pruebas del verificador.
 * Ejecutar: npm test
 *
 * Dos propiedades críticas:
 *   1. El token entrante acepta `sub` O `email` como identidad (el satélite
 *      puede no conocer el sub de un usuario que nunca entró por nuestro SSO),
 *      pero JAMÁS acepta un token sin identidad, sin empresa, vencido o con
 *      firma ajena.
 *   2. La verificación de NUESTROS tokens salientes (la que copian los
 *      satélites) no se aflojó: sigue exigiendo `sub`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  firmarHmac,
  verificarTokenSSO,
  verificarTokenSSOEntrante,
} from '../src/modules/integraciones/nucleo'

const SECRETO = 'secreto-de-prueba'
const AHORA = 1_800_000_000

function token(payload: Record<string, unknown>, secreto = SECRETO): string {
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${cuerpo}.${firmarHmac(secreto, cuerpo)}`
}

test('entrante: acepta identidad por email (sin sub) — el caso del satélite', () => {
  const t = token({ email: 'maria@correo.com', companyId: 'c1', exp: AHORA + 60 })
  const datos = verificarTokenSSOEntrante(SECRETO, t, AHORA)
  assert.ok(datos)
  assert.equal(datos!.email, 'maria@correo.com')
  assert.equal(datos!.companyId, 'c1')
})

test('entrante: acepta identidad por sub (preferida)', () => {
  const t = token({ sub: 'uuid-supabase', companyId: 'c1', exp: AHORA + 60 })
  assert.ok(verificarTokenSSOEntrante(SECRETO, t, AHORA))
})

test('entrante: rechaza sin identidad, sin empresa, vencido y firma ajena', () => {
  assert.equal(
    verificarTokenSSOEntrante(SECRETO, token({ companyId: 'c1', exp: AHORA + 60 }), AHORA),
    null,
    'sin sub ni email'
  )
  assert.equal(
    verificarTokenSSOEntrante(SECRETO, token({ email: 'a@b.c', exp: AHORA + 60 }), AHORA),
    null,
    'sin companyId'
  )
  assert.equal(
    verificarTokenSSOEntrante(SECRETO, token({ email: 'a@b.c', companyId: 'c1', exp: AHORA - 1 }), AHORA),
    null,
    'vencido'
  )
  assert.equal(
    verificarTokenSSOEntrante(SECRETO, token({ email: 'a@b.c', companyId: 'c1', exp: AHORA + 60 }, 'otro-secreto'), AHORA),
    null,
    'firmado con otro secreto'
  )
  assert.equal(verificarTokenSSOEntrante(SECRETO, 'basura-sin-punto', AHORA), null, 'malformado')
})

test('saliente NO se aflojó: sigue exigiendo sub', () => {
  const sinSub = token({ email: 'a@b.c', rol: 'EMPLEADO', companyId: 'c1', exp: AHORA + 60 })
  assert.equal(verificarTokenSSO(SECRETO, sinSub, AHORA), null)

  const conSub = token({ sub: 'u1', email: 'a@b.c', rol: 'EMPLEADO', companyId: 'c1', exp: AHORA + 60 })
  assert.ok(verificarTokenSSO(SECRETO, conSub, AHORA))
})
