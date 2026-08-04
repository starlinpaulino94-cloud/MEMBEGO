import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES_APP, ADMIN_ROLES } from '../src/types'

/**
 * Quién puede abrir el sistema satélite. La lista escrita a mano en la ruta
 * olvidaba ADMINISTRADOR (el nombre moderno de ADMIN_EMPRESA), y con eso el
 * DUEÑO de la empresa recibía un 401 al intentar entrar a su propio car wash.
 * Esta prueba fija la regla: entra todo el equipo, no entra el cliente.
 */

/** Misma derivación que usa la ruta /api/integraciones/abrir/[slug]. */
const rolesEquipo = new Set<string>(ROLES_APP.filter((r) => r !== 'CLIENTE'))

test('todos los roles administrativos pueden abrir el satélite', () => {
  for (const rol of ADMIN_ROLES) {
    assert.ok(rolesEquipo.has(rol), `${rol} debería poder entrar al satélite`)
  }
})

test('los roles de piso también entran: el satélite es su herramienta', () => {
  for (const rol of ['RECEPCION', 'EMPLEADO'] as const) {
    assert.ok(rolesEquipo.has(rol), `${rol} debería poder entrar al satélite`)
  }
})

test('el CLIENTE nunca entra al satélite', () => {
  assert.equal(rolesEquipo.has('CLIENTE'), false)
})

test('un rol nuevo entra solo, sin tener que acordarse de la lista', () => {
  // La regla es por exclusión: si mañana se agrega un rol de equipo, queda
  // cubierto. Solo CLIENTE está fuera, y eso es deliberado.
  assert.equal(rolesEquipo.size, ROLES_APP.length - 1)
})
