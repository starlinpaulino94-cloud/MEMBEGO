/**
 * Acceso multi-empresa — pruebas de `filasDeAcceso`. Ejecutar: npm test
 *
 * POR QUÉ SE PRUEBA ESTA FUNCIÓN Y NO OTRA COSA DEL MÓDULO:
 *
 * Es la que evita que un administrador se quede ENCERRADO. El selector de
 * empresas se arma con las filas de `UserCompanyAccess` más la empresa activa.
 * Si la empresa de siempre de una persona no tiene fila, en cuanto cambia a
 * otra deja de ser la activa, nunca tuvo fila, y el selector ya no la puede
 * ofrecer: no hay camino de vuelta a su negocio.
 *
 * El fallo no da error ni deja rastro en ningún log. Se ve cuando alguien
 * llama diciendo que su car wash desapareció. Por eso se prueba: es lógica
 * pura, se verifica sin base de datos, y es exactamente lo que uno rompería
 * sin darse cuenta al "simplificar" la función.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filasDeAcceso } from '../src/modules/empresas/accesos'

test('escribe la empresa nueva Y la de siempre: siempre hay camino de vuelta', () => {
  const filas = filasDeAcceso('u1', 'demo', 'cartown')
  assert.equal(filas.length, 2)
  assert.deepEqual(
    filas.map((f) => f.companyId).sort(),
    ['cartown', 'demo']
  )
  assert.ok(filas.every((f) => f.userId === 'u1'))
})

test('no duplica cuando la empresa nueva es la de siempre', () => {
  // Pasa al re-vincular a alguien a su propia empresa. Sin la deduplicación,
  // `createMany` recibiría dos filas idénticas contra un @@unique.
  const filas = filasDeAcceso('u1', 'cartown', 'cartown')
  assert.deepEqual(filas, [{ userId: 'u1', companyId: 'cartown' }])
})

test('sin empresa de siempre escribe solo la nueva', () => {
  // Un usuario recién creado puede no tener companyId todavía.
  const filas = filasDeAcceso('u1', 'demo', null)
  assert.deepEqual(filas, [{ userId: 'u1', companyId: 'demo' }])
})

test('la empresa nueva va primero, la de siempre después', () => {
  // No cambia el resultado en la base, pero fija el orden para que una
  // reescritura futura no lo altere sin querer.
  const filas = filasDeAcceso('u1', 'demo', 'cartown')
  assert.equal(filas[0].companyId, 'demo')
  assert.equal(filas[1].companyId, 'cartown')
})

test('vincular a una tercera empresa conserva la de siempre, no la anterior', () => {
  // `filasDeAcceso` solo AÑADE: nunca borra. Las empresas que ya tenía siguen
  // en la tabla porque `createMany` con skipDuplicates no toca lo existente.
  const filas = filasDeAcceso('u1', 'otra', 'cartown')
  assert.deepEqual(
    filas.map((f) => f.companyId).sort(),
    ['cartown', 'otra']
  )
})
