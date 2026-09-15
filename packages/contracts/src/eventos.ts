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
  'reserva.creada': 'reservation.created',
  'reserva.pagada': 'reservation.paid',
  'venta.generada': 'sale.created',
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

// ── Webhooks de EMPRESA ─────────────────────────────────────────────────────
//
// Otro canal y otras cabeceras. Los satélites los registra el superadmin y
// reciben Ed25519; estos los crea la propia empresa apuntando a donde quiera y
// se firman con el secreto `whs_…` que se le enseña al crearlos. Comparten el
// MATERIAL firmado (`materialFirmado`) a propósito: es la única parte donde una
// diferencia entre los dos canales se pagaría en firmas rechazadas que nadie
// sabe explicar.

/** Id de la entrega. Va dentro del material firmado, así que no se puede mover. */
export const CABECERA_ENTREGA = 'X-Membego-Delivery'
/** Nombre del evento. Comodidad para enrutar; la verdad está en el cuerpo. */
export const CABECERA_EVENTO_NOMBRE = 'X-Membego-Event'

/**
 * FIRMA v2 de los webhooks de empresa: HMAC-SHA256 hex de
 * `materialFirmado(timestamp, entregaId, cuerpo)`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA RESPECTO A LA v1 (hallazgo A-2 de la auditoría)
 *
 * La v1 firmaba SOLO el cuerpo. El timestamp viajaba al lado, en su cabecera,
 * sin que nada lo protegiera — así que quien capturara una entrega podía
 * reenviarla mañana con el timestamp que quisiera y la firma seguiría siendo
 * válida. La cabecera existía y no servía para nada: comprobar la ventana con
 * un valor que el atacante elige es comprobar su palabra.
 *
 * Con el timestamp DENTRO del material, cambiarlo rompe la firma. Eso es lo que
 * convierte la ventana anti-replay en una defensa de verdad.
 *
 * El id de la entrega va dentro por el mismo motivo, y añade uno: dos entregas
 * con el mismo cuerpo en el mismo segundo —el mismo evento a dos suscripciones
 * de la misma empresa— dejan de tener firmas intercambiables.
 */
export const CABECERA_FIRMA_EMPRESA_V2 = 'X-Membego-Signature-V2'

/**
 * FIRMA v1, HMAC-SHA256 hex del cuerpo a secas. LEGADO.
 *
 * Sigue saliendo porque quien ya verifica así dejaría de aceptar sus avisos el
 * minuto del despliegue, y un webhook que empieza a rechazar todo no se nota
 * hasta que alguien echa de menos un dato.
 *
 * CÓMO SE RETIRA, porque no es «cuando la telemetría lo diga»: no hay
 * telemetría posible. Qué cabecera comprueba un receptor ocurre dentro de SU
 * servidor y no vuelve a nosotros de ninguna forma — desde aquí, uno que
 * verifica la v2 y otro que no verifica nada son indistinguibles. Así que se
 * retira anunciando una fecha y pidiendo confirmación, no observando. Prometer
 * lo contrario sería planear sobre un dato que nadie va a poder mirar.
 */
export const CABECERA_FIRMA_EMPRESA = 'X-Membego-Signature'

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
