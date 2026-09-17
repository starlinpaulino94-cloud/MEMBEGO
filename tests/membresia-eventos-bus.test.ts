import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIPO_V2 } from '@membego/contracts'
import { EVENTOS_EMITIDOS, EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'
import { catalogoV2, eventosDeProyeccionSinEmisor } from '../src/modules/plataforma/eventos'

/**
 * CICLO DE VIDA DE LA MEMBRESÍA EN EL BUS · hallazgo B-4 de la auditoría.
 *
 * `membresia.activada` salía al bus; la BAJA —cancelada o vencida— se anotaba en
 * la historia de la membresía y nunca llegaba a un satélite ni a un webhook, así
 * que una proyección se quedaba diciendo «activa» algo que ya no lo estaba. Esto
 * vigila que los dos eventos existan de punta a punta y que se emitan en TODOS
 * los flujos que producen la baja.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

// ─── De punta a punta ────────────────────────────────────────────────────────

test('cancelada y vencida tienen nombre v2 en forma `recurso.accion`', () => {
  assert.equal(TIPO_V2['membresia.cancelada'], 'membership.cancelled')
  assert.equal(TIPO_V2['membresia.vencida'], 'membership.expired')
})

test('salen al bus Y se reenvían a los satélites (proyección CORE)', () => {
  // Como `cliente.actualizado`: alimentan la proyección `MembershipSummary` que
  // un satélite mantiene, así que van también a satélites, no solo a webhooks.
  for (const interno of ['membresia.cancelada', 'membresia.vencida']) {
    assert.ok((EVENTOS_EMITIDOS as readonly string[]).includes(interno), `${interno} no está en EMITIDOS`)
    assert.ok((EVENTOS_REENVIADOS as readonly string[]).includes(interno), `${interno} no se reenvía`)
  }
})

test('el catálogo ya ofrece la baja, no solo el alta', () => {
  const cat = catalogoV2()
  assert.ok(cat.includes('membership.activated'))
  assert.ok(cat.includes('membership.cancelled'))
  assert.ok(cat.includes('membership.expired'))
})

test('cancelar y vencer dejan de ser eventos de proyección sin emisor', () => {
  const huerfanos = eventosDeProyeccionSinEmisor()
  assert.ok(!huerfanos.includes('membership.cancelled'), 'membership.cancelled sigue sin emisor')
  assert.ok(!huerfanos.includes('membership.expired'), 'membership.expired sigue sin emisor')
})

// ─── El aviso es único: un mapa, no una emisión suelta por sitio ─────────────

test('el mapeo de tipo de membresía a evento de bus vive en un solo sitio', () => {
  // Un `switch` copiado en cada flujo acabaría diciendo cosas distintas del mismo
  // hecho. `ACTIVADA` NO está en el mapa: ya la emite el punto de activación con
  // su payload rico, y meterla aquí la emitiría dos veces.
  const src = leer('src/modules/membresia/eventos.ts')
  assert.match(src, /CANCELADA: 'membresia\.cancelada'/)
  assert.match(src, /VENCIDA: 'membresia\.vencida'/)
  assert.ok(!/ACTIVADA: 'membresia\.activada'/.test(src), 'ACTIVADA no debe re-emitirse aquí')
})

test('el aviso al bus va FUERA de la transacción y nunca la tumba', () => {
  // `emitirEventoEstrategia` abre su propia transacción y es best-effort: dentro
  // de la del cambio, un fallo del bus se llevaría por delante la cancelación.
  const src = leer('src/modules/membresia/eventos.ts')
  const fn = src.slice(src.indexOf('export async function emitirCambioMembresiaAlBus'))
  assert.match(fn.slice(0, 900), /emitirEventoEstrategia\(/)
  assert.match(fn.slice(0, 900), /subjectId: input\.clienteId/)
})

// ─── Se emite en TODOS los flujos de baja, no solo en uno ────────────────────

test('el vencimiento automático (cron) emite por cada membresía, tras el commit', () => {
  // Es el camino más común: la mayoría de las bajas son por fecha, no a mano.
  const src = leer('src/modules/membresia/vencimiento.ts')
  assert.match(src, /emitirCambioMembresiaAlBus\(/)
  assert.match(src, /tipo: 'VENCIDA'/)
  // Fuera de la transacción: se captura la lista y se emite después del await.
  assert.match(src, /caducadasParaBus/)
})

test('las tres bajas manuales también emiten', () => {
  // Cancelar desde el panel de empresa, cancelar desde superadmin, y desactivar
  // (que termina en VENCIDA). Si una sola se olvidara, la proyección quedaría al
  // día tras unas bajas y desfasada tras otras.
  const admin = leer('src/modules/admin/actions.ts')
  assert.match(admin, /emitirCambioMembresiaAlBus\(\{[\s\S]{0,120}tipo: 'CANCELADA'/)

  const plan = leer('src/modules/admin/planActions.ts')
  const cancelaciones = [...plan.matchAll(/emitirCambioMembresiaAlBus\(\{[\s\S]{0,120}?tipo: '(CANCELADA|VENCIDA)'/g)].map(
    (m) => m[1]
  )
  assert.ok(cancelaciones.includes('CANCELADA'), 'planActions no emite la cancelación de superadmin')
  assert.ok(cancelaciones.includes('VENCIDA'), 'planActions no emite la desactivación')
})
