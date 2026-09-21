import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCOPES_POR_CAPABILITY, scopesDe, tipoV2 } from '@membego/contracts'
import { EVENTOS_EMITIDOS, EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'

/**
 * CANCELAR UNA CITA desde la API pública (B-5).
 *
 * La API deja de ser solo lectura sobre la agenda: un integrador puede cancelar
 * una cita. Es una transición de la máquina de estados, no un borrado, y sale al
 * bus con el MISMO evento la cancele quien la cancele (panel, cliente o API).
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── el scope nuevo ──────────────────────────────────────────────────────────

test('APPOINTMENT_MANAGE concede manage + read, y read no arrastra manage', () => {
  assert.deepEqual(SCOPES_POR_CAPABILITY.APPOINTMENT_MANAGE, ['appointments:read', 'appointments:manage'])
  // Concesión mínima: pedir solo lectura de agenda NO da cancelar.
  assert.deepEqual(scopesDe(['APPOINTMENT_LOOKUP']), ['appointments:read'])
})

// ─── el evento nuevo ─────────────────────────────────────────────────────────

test('cita.cancelada tiene nombre v2 y emisor real, pero no se reenvía a satélites', () => {
  assert.equal(tipoV2('cita.cancelada'), 'appointment.cancelled')
  assert.ok(
    (EVENTOS_EMITIDOS as readonly string[]).includes('cita.cancelada'),
    'cita.cancelada debería estar en EVENTOS_EMITIDOS (tiene emisor real)'
  )
  // NO va a satélites: no hay contrato de proyección de agenda como el de
  // Customer/Membership, y esa lista se mantiene estrecha a propósito (B-4).
  assert.ok(
    !(EVENTOS_REENVIADOS as readonly string[]).includes('cita.cancelada'),
    'cita.cancelada no debería reenviarse a satélites'
  )
})

// ─── un SOLO emisor del evento, lo cancele quien lo cancele ───────────────────

test('los TRES caminos de cancelación avisan al bus con el mismo helper', () => {
  // Es la regla que este trabajo defiende (como el ciclo de membresía en B-4):
  // que la cancelación salga del panel, del cliente o de la API no puede darle
  // un nombre distinto al mismo hecho.
  const acciones = codigo('src/modules/citas/actions.ts')
  const cancelacion = codigo('src/modules/citas/cancelacion.ts')

  // El panel (admin) y el cliente llaman al helper directamente…
  const admin = acciones.slice(acciones.indexOf("accion === 'cancelar'"))
  assert.match(admin, /emitirCitaCanceladaAlBus\(/, 'el panel no avisa al bus')
  const cliente = acciones.slice(acciones.indexOf('cancelarCitaCliente'))
  assert.match(cliente.slice(0, 2500), /emitirCitaCanceladaAlBus\(/, 'el cliente no avisa al bus')
  // …y la API lo hace a través de `cancelarCitaDeNegocio`, que también llama al
  // helper. El helper compone el evento en un solo sitio.
  assert.match(cancelacion, /emitirCitaCanceladaAlBus\(/, 'la cancelación de negocio no avisa al bus')
  assert.match(cancelacion, /type:\s*'cita\.cancelada'/, 'el helper no emite cita.cancelada')
})

// ─── la ruta ─────────────────────────────────────────────────────────────────

test('la ruta de cancelación es POST /cancel, de empresa, e idempotente', () => {
  const src = codigo('src/app/api/platform/v1/appointments/[id]/cancel/route.ts')
  assert.match(src, /export async function POST/, 'cancelar es una acción POST, no un DELETE')
  assert.match(src, /'appointments:manage'/, 'no exige el scope de gestión de agenda')
  assert.match(src, /exigeEmpresa\(/, 'no restringe a claves de empresa')
  assert.match(src, /cancelarCitaDeNegocio\(/, 'no usa el cancelador compartido')
  // Idempotente: una repetición no vuelve a notificar, y responde `applied`.
  assert.match(src, /res\.cambiada/, 'no distingue si la llamada cambió algo')
  assert.match(src, /applied:/, 'no expone si la cancelación se aplicó o ya estaba')
  // No pide Idempotency-Key: cancelar dos veces deja la cita igual.
  assert.ok(!/IDEMPOTENCY_KEY_REQUIRED/.test(src), 'una cancelación idempotente no necesita clave')
})

// ─── la máquina de estados: qué se puede cancelar y qué no ────────────────────

test('cancelarCitaDeNegocio es idempotente y respeta los estados terminales', () => {
  const src = codigo('src/modules/citas/cancelacion.ts')
  // Ya cancelada → no toca nada (cambiada:false), no re-emite.
  assert.match(src, /cita\.estado === 'CANCELADA'\)\s*return \{ ok: true, cambiada: false/)
  // Solo PENDIENTE/CONFIRMADA (ESTADOS_ACTIVOS) se cancelan; el resto (COMPLETADA,
  // NO_ASISTIO) es no_cancelable: eso ya ocurrió.
  assert.match(src, /ESTADOS_ACTIVOS[\s\S]*?return \{ ok: false, motivo: 'no_cancelable' \}/)
  // Se busca acotada a la empresa: un id ajeno es no_encontrada, no «no autorizado».
  assert.match(src, /where:\s*\{\s*id:\s*citaId,\s*companyId\s*\}/)
})
