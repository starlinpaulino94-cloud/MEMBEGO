/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · QUÉ SE LE CONTESTA AL PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CÓDIGO HTTP NO ES COSMÉTICA: DECIDE SI NOS LLAMAN MIL VECES
 *
 * Una pasarela reintenta ante lo que parece un fallo nuestro. Elegir mal el
 * código tiene dos formas de salir caro, las dos reales:
 *
 *   · Devolver 4xx/5xx a un evento que NUNCA vamos a aceptar —el monto no
 *     cuadra, la orden no existe— hace que el proveedor lo reintente durante
 *     horas. Nosotros ya decidimos; el que no se entera es él.
 *   · Devolver 200 a un fallo TRANSITORIO nuestro —la base no respondía—
 *     tira el evento a la basura: el proveedor lo da por entregado y no vuelve
 *     a mandarlo. Un aviso de pago perdido es un cliente que pagó y no recibe
 *     lo que compró.
 *
 * De ahí la regla, y es una sola:
 *
 *   200  →  nos hacemos cargo. Lo recibimos y decidimos qué hacer con él,
 *           incluso si la decisión fue NO hacer nada. No hay nada que
 *           reintentar.
 *   4xx  →  el que llama está equivocado y reintentar no lo va a arreglar
 *           (firma mala, evento viejo, cuerpo ilegible, proveedor que no
 *           conocemos).
 *   5xx  →  fallamos NOSOTROS y un reintento tiene sentido.
 *
 * Y el corolario incómodo: un evento RECHAZADO por no cuadrar responde 200.
 * No porque esté bien, sino porque el rechazo ya quedó escrito, auditado y a
 * la espera de que una persona lo mire. Reintentarlo no lo haría cuadrar.
 */

/** Lo que el endpoint puede contestar. Cerrado a propósito. */
export type CodigoEntrada =
  /** Recibido, procesado, con efecto. */
  | 'EVENT_ACCEPTED'
  /** Ya lo teníamos resuelto: esta entrega no hace nada más. */
  | 'EVENT_REPEATED'
  /** Recibido y NO aceptado: no cuadra con nuestra operación, o no lo manejamos. */
  | 'EVENT_REJECTED'
  /** La firma no cuadra. Puede no ser quien dice ser. */
  | 'INVALID_SIGNATURE'
  /** Firma correcta, pero el evento es viejo (o del futuro): no se procesa. */
  | 'REPLAY_REJECTED'
  /** El cuerpo no se puede leer, o le falta lo imprescindible. */
  | 'INVALID_PAYLOAD'
  /** No tenemos ni verificador ni adaptador para ese proveedor. */
  | 'UNKNOWN_PROVIDER'
  /** El cuerpo pasa del tamaño que aceptamos. */
  | 'PAYLOAD_TOO_LARGE'
  /** Nos falló algo a nosotros. Es el único que invita a reintentar. */
  | 'INTERNAL_ERROR'

export const HTTP_DE_CODIGO: Record<CodigoEntrada, number> = {
  // Nos hacemos cargo.
  EVENT_ACCEPTED: 200,
  EVENT_REPEATED: 200,
  EVENT_REJECTED: 200,

  // El que llama está equivocado; reintentar no arregla nada.
  INVALID_SIGNATURE: 401,
  REPLAY_REJECTED: 400,
  INVALID_PAYLOAD: 400,
  UNKNOWN_PROVIDER: 404,
  PAYLOAD_TOO_LARGE: 413,

  // Fallamos nosotros: aquí el reintento SÍ sirve.
  INTERNAL_ERROR: 500,
}

/**
 * Lo que se le dice al proveedor, en una palabra.
 *
 * Nunca lleva el motivo técnico: ni por qué la firma no cuadró, ni qué campo
 * faltaba, ni si la orden existe. Un endpoint público que explica POR QUÉ
 * rechazó una firma le está enseñando a afinarla a quien la está probando, y
 * decir «esa orden no existe» convierte el webhook en un oráculo para
 * averiguar qué números de orden son reales. El detalle va al log y a la
 * bitácora, que tienen dueño y control de acceso.
 */
export const MENSAJE_DE_CODIGO: Record<CodigoEntrada, string> = {
  EVENT_ACCEPTED: 'aceptado',
  EVENT_REPEATED: 'repetido',
  EVENT_REJECTED: 'no aceptado',
  INVALID_SIGNATURE: 'firma inválida',
  REPLAY_REJECTED: 'evento fuera de ventana',
  INVALID_PAYLOAD: 'cuerpo inválido',
  UNKNOWN_PROVIDER: 'proveedor desconocido',
  PAYLOAD_TOO_LARGE: 'cuerpo demasiado grande',
  INTERNAL_ERROR: 'error interno',
}

export function httpDe(codigo: CodigoEntrada): number {
  return HTTP_DE_CODIGO[codigo]
}

/** ¿Debería el proveedor volver a mandarlo? Solo cuando el fallo es nuestro. */
export function invitaAReintentar(codigo: CodigoEntrada): boolean {
  return HTTP_DE_CODIGO[codigo] >= 500
}

/** ¿Nos hicimos cargo del evento? (Lo recibimos y decidimos, sea cual sea.) */
export function quedaResuelto(codigo: CodigoEntrada): boolean {
  return HTTP_DE_CODIGO[codigo] < 300
}
