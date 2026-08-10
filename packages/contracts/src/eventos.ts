/**
 * CONTRATOS · el sobre de los eventos y su firma.
 *
 * Es lo que un satélite recibe por webhook. Los tipos están aquí para que no
 * haya que copiarlos a mano en cada integración — copiarlos es exactamente cómo
 * empiezan a divergir.
 */

export const VERSION_SOBRE = 1

export interface SobreEvento {
  /** Id estable. Es la clave de deduplicación de tu inbox. */
  eventId: string
  eventType: string
  /**
   * Nombre anterior, mientras dure la migración. Si tu integración compara con
   * `cliente.visita`, sigue funcionando; cuando migres, borra esa rama.
   */
  legacyType?: string
  version: number
  /** ISO 8601. Cuándo OCURRIÓ, no cuándo se envió: los reintentos no lo mueven. */
  occurredAt: string
  companyId: string
  customerId?: string
  source: 'membego'
  /** Hilo que une los eventos de una misma operación. */
  traceId: string
  data: Record<string, unknown>
}

/**
 * Claves del formato anterior, que siguen viajando dentro del mismo cuerpo.
 * Son duplicados EXACTOS de los campos de arriba, no datos distintos.
 */
export interface ClavesLegado {
  id: string
  tipo: string
  payload: Record<string, unknown>
  emitidoEn: string
}

/** Lo que llega de verdad por el cable: el sobre más las claves de legado. */
export type CuerpoWebhook = SobreEvento & ClavesLegado

/** Nombre v2 de cada evento interno de MembeGo. */
export const TIPO_V2: Record<string, string> = {
  'cliente.registrado': 'customer.created',
  'cliente.primera_visita': 'visit.first_completed',
  'cliente.visita': 'visit.completed',
  'cliente.compro_servicio': 'purchase.completed',
  'cliente.primera_compra': 'purchase.first_completed',
  'membresia.activada': 'membership.activated',
  'referido.convirtio': 'referral.converted',
}

export const TIPO_INTERNO: Record<string, string> = Object.fromEntries(
  Object.entries(TIPO_V2).map(([interno, v2]) => [v2, interno])
)

export function tipoV2(interno: string): string {
  return TIPO_V2[interno] ?? interno
}

// ── Firma ───────────────────────────────────────────────────────────────────

export const CABECERA_FIRMA = 'X-Membego-Signature'
export const CABECERA_TIMESTAMP = 'X-Membego-Timestamp'
export const CABECERA_EVENTO = 'X-Membego-Event-Id'
/** La firma simétrica anterior. Se retira cuando ningún satélite la use. */
export const CABECERA_FIRMA_HMAC = 'X-Membego-Firma'

/**
 * Ventana anti-replay: cinco minutos. Suficiente para un reloj mal puesto y un
 * reintento lento; poco para que un webhook capturado siga sirviendo.
 *
 * Por sí sola NO impide repetir dentro de esos cinco minutos: eso lo impide el
 * inbox, que descarta un `eventId` ya visto. Son dos defensas y hacen falta las
 * dos — la ventana acota el tiempo, el inbox acota las veces.
 */
export const VENTANA_REPLAY_SEGUNDOS = 300

/**
 * Lo que se firma. Estructurado para que ningún campo se pueda mover a otro, y
 * definido aquí para que emisor y receptor no puedan describirlo distinto.
 */
export function materialFirmado(timestamp: number, eventId: string, cuerpo: string): string {
  return `${timestamp}.${eventId}.${cuerpo}`
}
