import { fallo } from '../core/errores'
import { sanear } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · ADAPTADORES POR PROVEEDOR (§4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE ESTA CAPA
 *
 * Cada pasarela nombra las cosas a su manera: una manda `order_reference`, otra
 * `invoice`, otra lo mete dentro de `metadata`. Una dice `status: "APPROVED"`,
 * otra `result: "00"`. Traducir eso es trabajo de UN sitio, aquí, y lo que sale
 * de aquí ya está en nuestro vocabulario.
 *
 * El Bloque 1 demostró —con una prueba— que reinterpretar el cuerpo crudo
 * dentro del procesador era incorrecto: toda pasarela que no nombrara los
 * campos como nosotros acababa con sus eventos marcados SIN_REFERENCIA aunque
 * trajeran la referencia dentro. Ese defecto NO se vuelve a introducir: lo que
 * el adaptador interpreta se guarda interpretado, y el procesador no vuelve a
 * adivinar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ADAPTADOR NO DECIDE NADA DE DINERO
 *
 * Traduce y nada más. No mira si el monto cuadra, no busca la orden, no
 * confirma ni rechaza: eso es del procesador, que lo hace contra NUESTRA orden
 * y dentro de la transacción. Un adaptador que decidiera sería un segundo
 * motor de pagos escrito por proveedor.
 */

/** Lo que llega por la puerta, sin interpretar. */
export interface EventoCrudo {
  provider: string
  cuerpoCrudo: string
  cabeceras: Record<string, string | null>
}

/** El pago en NUESTRO vocabulario. Lo único que el procesador va a leer. */
export interface PagoExternoAdaptado {
  /** Cómo el proveedor nombra nuestra compra (nuestro `number`). */
  orderReference: string | null
  /** Importe tal como lo dice el proveedor, en texto para no perder decimales. */
  amount: string | null
  currency: string | null
  /** El id de la transacción en el sistema del proveedor. Para conciliar. */
  externalTransactionId: string | null
  /** Lo que el proveedor dice del pago, ya traducido a mayúsculas. */
  status: string | null
}

/** El evento ya traducido. Es lo que el inbox recibe. */
export interface EventoExternoAdaptado {
  provider: string
  externalEventId: string
  /** `PAYMENT_CONFIRMED`, `PAYMENT_REJECTED`… nuestro vocabulario, no el suyo. */
  eventType: string
  payment: PagoExternoAdaptado
  /** Lo que se conserva del cuerpo, YA SANEADO: sin firmas ni secretos. */
  rawSanitizedPayload: Record<string, unknown>
}

export interface AdaptadorDeProveedor {
  readonly provider: string
  /** Traduce, o lanza `PAYLOAD_INVALIDO` si no hay nada que traducir. */
  adaptar(e: EventoCrudo): EventoExternoAdaptado
}

/**
 * EL ADAPTADOR DE PRUEBA.
 *
 * Su cuerpo usa el vocabulario de un proveedor cualquiera —no el nuestro— a
 * propósito: si la prueba mandara ya `orderNumber` y `PAYMENT_CONFIRMED`, no
 * demostraría que el adaptador hace falta.
 *
 *   {
 *     "event":       { "id": "evt_123", "kind": "payment.updated" },
 *     "transaction": { "id": "TX-9", "status": "APPROVED",
 *                      "amount": "1000.00", "currency": "DOP",
 *                      "order_reference": "MBG-SO-000123" }
 *   }
 */
export const ADAPTADOR_TEST_GATEWAY: AdaptadorDeProveedor = {
  provider: 'TEST_GATEWAY',

  adaptar(e: EventoCrudo): EventoExternoAdaptado {
    const cuerpo = leerJson(e.cuerpoCrudo)

    const evento = objeto(cuerpo.event)
    const tx = objeto(cuerpo.transaction)

    const externalEventId = texto(evento.id)
    if (!externalEventId) {
      // Sin identidad no hay idempotencia posible: no se puede saber si esto ya
      // llegó. Se rechaza en la puerta en vez de inventarle un id, que es lo
      // que haría que dos entregas del mismo evento fueran dos cobros.
      fallo('PAYLOAD_INVALIDO', 'El evento no trae identificador propio.')
    }

    const kind = texto(evento.kind)?.toUpperCase() ?? null
    const estado = texto(tx.status)?.toUpperCase() ?? null

    return {
      provider: 'TEST_GATEWAY',
      externalEventId,
      eventType: tipoDesde(kind, estado),
      payment: {
        orderReference: texto(tx.order_reference) ?? texto(tx.orderReference),
        amount: numeroEnTexto(tx.amount),
        currency: texto(tx.currency)?.toUpperCase() ?? null,
        externalTransactionId: texto(tx.id),
        status: estado,
      },
      // El cuerpo se conserva SANEADO para poder investigar: un volcado de la
      // tabla no puede llevar la firma ni nada que se le parezca.
      rawSanitizedPayload: (sanear(cuerpo) ?? {}) as Record<string, unknown>,
    }
  },
}

/**
 * Del vocabulario del proveedor al nuestro.
 *
 * Lo que no sepamos traducir se queda como `PAYMENT_UNKNOWN`, que el procesador
 * ignora con `TIPO_NO_MANEJADO`. **No se adivina**: un `status` raro no se
 * interpreta como aprobado «porque no dice lo contrario».
 */
export function tipoDesde(kind: string | null, estado: string | null): string {
  if (kind && !kind.startsWith('PAYMENT')) return 'PAYMENT_UNKNOWN'
  switch (estado) {
    case 'APPROVED':
    case 'CAPTURED':
    case 'PAID':
      return 'PAYMENT_CONFIRMED'
    case 'DECLINED':
    case 'REJECTED':
    case 'FAILED':
      return 'PAYMENT_REJECTED'
    default:
      return 'PAYMENT_UNKNOWN'
  }
}

const ADAPTADORES: readonly AdaptadorDeProveedor[] = [ADAPTADOR_TEST_GATEWAY]

export function adaptadorDe(provider: string): AdaptadorDeProveedor | null {
  const buscado = provider.trim().toUpperCase()
  return ADAPTADORES.find((a) => a.provider === buscado) ?? null
}

// ── Lectura defensiva ───────────────────────────────────────────────────────
//
// Todo lo que entra por aquí lo escribió alguien de fuera. Nada se da por
// supuesto: ni que es un objeto, ni que los campos son del tipo esperado.

function leerJson(crudo: string): Record<string, unknown> {
  let valor: unknown
  try {
    valor = JSON.parse(crudo)
  } catch {
    fallo('PAYLOAD_INVALIDO', 'El cuerpo no es JSON.')
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    fallo('PAYLOAD_INVALIDO', 'El cuerpo no es un objeto.')
  }
  return valor as Record<string, unknown>
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Importes en texto: `1000.00` no es lo mismo que `1000.0000001` en coma flotante. */
function numeroEnTexto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}
