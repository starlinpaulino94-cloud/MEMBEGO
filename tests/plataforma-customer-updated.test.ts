import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIPO_V2 } from '@membego/contracts'
import { EVENTOS_EMITIDOS, EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'
import { catalogoV2, eventosDeProyeccionSinEmisor } from '../src/modules/plataforma/eventos'

/**
 * MÁS EVENTOS · hallazgo B-4 de la auditoría.
 *
 * El bus emitía decenas de hechos —promoción creada, mensaje entrante, cliente
 * actualizado— y solo siete tenían nombre v2 y aparecían en el catálogo. El
 * resto salía a los webhooks de empresa con su nombre interno en español y sin
 * poder elegirse. Esto vigila que la lista siga contando la verdad: que lo que
 * se ofrece es lo que se emite, y que lo recién conectado —`customer.updated`—
 * de verdad tiene un emisor detrás.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

// ─── El evento nuevo existe de punta a punta ─────────────────────────────────

test('`cliente.actualizado` tiene nombre v2 y es `customer.updated`', () => {
  assert.equal(TIPO_V2['cliente.actualizado'], 'customer.updated')
})

test('`cliente.actualizado` se emite Y se reenvía a los satélites', () => {
  // Va a satélites porque alimenta la proyección CORE de `Customer`: sin él, la
  // copia del satélite se quedaba con el teléfono viejo tras cada edición.
  assert.ok((EVENTOS_EMITIDOS as readonly string[]).includes('cliente.actualizado'))
  assert.ok((EVENTOS_REENVIADOS as readonly string[]).includes('cliente.actualizado'))
})

test('el catálogo ya ofrece `customer.updated`, no solo `customer.created`', () => {
  const cat = catalogoV2()
  assert.ok(cat.includes('customer.created'))
  assert.ok(cat.includes('customer.updated'))
})

test('editar un cliente deja de ser un evento de proyección sin emisor', () => {
  // Antes de B-4, `customer.updated` salía en la lista de huérfanos: el contrato
  // lo exigía y nadie lo emitía. Ahora tiene emisor, así que la lista se vació de
  // él sola. Las promociones, igual.
  const huerfanos = eventosDeProyeccionSinEmisor()
  for (const e of ['customer.updated', 'promotion.created', 'promotion.updated', 'promotion.deleted']) {
    assert.ok(!huerfanos.includes(e), `«${e}» sigue apareciendo como sin emisor`)
  }
})

// ─── La superficie ancha no se confunde con la de satélite ───────────────────

test('los eventos de integración se emiten pero NO se reenvían a satélites', () => {
  /**
   * Un satélite (Car Wash) no atiende `promocion.creada` ni `mensaje.recibido`:
   * reenviárselos le llenaría la cola de entregas muertas. Son superficie de
   * INTEGRACIÓN —un Zapier de empresa los recibe por otro canal— y por eso están
   * en EVENTOS_EMITIDOS pero no en EVENTOS_REENVIADOS.
   */
  const soloEmpresa = ['promocion.creada', 'mensaje.recibido', 'prospecto.creado', 'reserva.pagada']
  for (const e of soloEmpresa) {
    assert.ok((EVENTOS_EMITIDOS as readonly string[]).includes(e), `${e} no está en EVENTOS_EMITIDOS`)
    assert.ok(
      !(EVENTOS_REENVIADOS as readonly string[]).includes(e),
      `${e} se estaría reenviando a los satélites`
    )
  }
})

// ─── Los emisores existen de verdad (guardia estructural) ────────────────────

test('la edición por la API (B-5) emite `cliente.actualizado`', () => {
  // El emisor va FUERA de la transacción y solo cuando la edición salió bien:
  // el aviso no puede convertir un fallo del bus en un fallo de la escritura, que
  // ya está hecha.
  const src = leer('src/modules/plataforma/escrituras.ts')
  assert.match(src, /emitirEventoEstrategia\(/)
  assert.match(src, /type: 'cliente\.actualizado'/)
  assert.match(src, /if \(resultado\.ok\)/)
})

test('el auto-servicio del cliente emite el MISMO evento que la API', () => {
  // Si solo emitiera uno de los dos caminos, la proyección quedaría al día tras
  // una edición y desfasada tras la otra —un fallo que se lee como un acierto—.
  const src = leer('src/modules/cliente/actions.ts')
  const inicio = src.indexOf('export async function actualizarPerfil')
  const fin = src.indexOf('\nexport ', inicio + 1)
  const fn = src.slice(inicio, fin < 0 ? undefined : fin)
  assert.match(fn, /type: 'cliente\.actualizado'/)
})
