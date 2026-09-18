import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCOPES_POR_CAPABILITY, scopesDe, tipoV2, INVENTARIO_API } from '@membego/contracts'
import { EVENTOS_EMITIDOS, EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'

/**
 * BORRAR UN CLIENTE desde la API pública (B-5, derecho al olvido).
 *
 * La operación más peligrosa de la API: purga la ficha y todo lo suyo. Aquí se
 * fija que exige un scope PROPIO (no el de editar), que borra solo la relación
 * de la empresa (no la cuenta de la persona), y que avisa al bus para que un
 * satélite suelte su copia.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── el scope propio de borrado ──────────────────────────────────────────────

test('CUSTOMER_DELETION exige customers:delete, y borrar NO llega por editar', () => {
  assert.deepEqual(SCOPES_POR_CAPABILITY.CUSTOMER_DELETION, ['customers:read', 'customers:delete'])
  // Borrar es su propio permiso: el scope de EDITAR no incluye borrar…
  assert.ok(!scopesDe(['CUSTOMER_UPDATE']).includes('customers:delete'), 'editar no debe conceder borrar')
  // …ni el de leer.
  assert.ok(!scopesDe(['CUSTOMER_LOOKUP']).includes('customers:delete'), 'leer no debe conceder borrar')
})

// ─── el evento completa el ciclo de la proyección de Customer ─────────────────

test('customer.deleted se emite Y se reenvía a satélites (cierra created/updated/deleted)', () => {
  assert.equal(tipoV2('cliente.eliminado'), 'customer.deleted')
  assert.ok(
    (EVENTOS_EMITIDOS as readonly string[]).includes('cliente.eliminado'),
    'cliente.eliminado debería estar en EVENTOS_EMITIDOS'
  )
  // A DIFERENCIA de cita.cancelada: aquí SÍ va a satélites, porque Customer es
  // una proyección con contrato (created/updated ya van), y un borrado que no
  // llega deja un cliente fantasma en el satélite.
  assert.ok(
    (EVENTOS_REENVIADOS as readonly string[]).includes('cliente.eliminado'),
    'cliente.eliminado debería reenviarse a satélites'
  )
})

// ─── la ruta ─────────────────────────────────────────────────────────────────

test('la ruta es DELETE /customers/{id}, de empresa, con scope propio', () => {
  const src = codigo('src/app/api/platform/v1/customers/[id]/route.ts')
  assert.match(src, /export async function DELETE/, 'no existe el handler DELETE')
  assert.match(src, /'customers:delete'/, 'no exige el scope de borrado')
  assert.match(src, /exigeEmpresa\(/, 'no restringe a claves de empresa')
  assert.match(src, /eliminarClienteDeEmpresa\(/, 'no usa el borrador de plataforma')
  assert.ok(!/IDEMPOTENCY_KEY_REQUIRED/.test(src), 'borrar es idempotente: no pide clave')
})

test('el inventario documenta el DELETE con su scope', () => {
  const entrada = INVENTARIO_API.find((r) => r.metodo === 'DELETE' && r.ruta === '/customers/{id}')
  assert.ok(entrada, 'el DELETE de cliente no está en el inventario/OpenAPI')
  assert.equal(entrada!.scope, 'customers:delete')
  assert.equal(entrada!.principal, 'empresa')
})

// ─── la frontera: la empresa borra su relación, NO la identidad de la persona ─

test('borrar un cliente NO toca la cuenta de acceso de la persona', () => {
  const src = codigo('src/modules/plataforma/eliminarCliente.ts')
  // Purga la ficha y su cascada con el mismo helper que el superadmin…
  assert.match(src, /purgarClienteRow\(/, 'no purga en cascada')
  // …pero NUNCA borra la cuenta global: eso es del superadmin. Una clave de
  // empresa no puede alcanzar la identidad de alguien que quizá es cliente de
  // otro negocio.
  assert.ok(!/eliminarCuentaAcceso|auth\.admin\.deleteUser|user\.delete\(/.test(src), 'una clave de empresa borra la cuenta global de la persona')
  // Acotado a la empresa: un id ajeno es no_existe, no «no autorizado».
  assert.match(src, /where:\s*\{\s*id:\s*clienteId,\s*companyId\s*\}/)
  // Avisa al bus para que el satélite suelte su copia.
  assert.match(src, /type:\s*'cliente\.eliminado'/)
})
