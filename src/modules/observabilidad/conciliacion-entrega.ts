/**
 * ¿EL CLIENTE YA RECIBIÓ LO QUE PAGÓ? — la regla de la conciliación de entregas, en funciones PURAS.
 *
 * Un cobro aprobado con tarjeta debe terminar con su producto activo y el cobro marcado como entregado. Cuando el
 * cobro sigue sin marcar hay DOS situaciones muy distintas, y la conciliación las separaba mal:
 *
 *   · el producto NO está activo → hay un cliente esperando. Se reintenta la entrega.
 *   · el producto SÍ está activo (se activó después del cobro, por la vía que fuera) → el cliente no espera a nadie;
 *     solo el registro del cobro quedó sin cerrar (cobros anteriores a la columna de cumplimiento, activaciones a mano).
 *     Se cierra el registro con una nota, no se reintenta nada: reintentar fallaría con «ya está activa».
 *
 * Mezclarlas hacía que el panel gritara «9 clientes esperando» por cobros que se habían entregado hacía meses, y
 * que un cobro FALLIDO o atascado sin producto no se viera (solo se miraba `PENDIENTE`).
 *
 * Sin base de datos ni Next: se prueba con datos sueltos.
 */

/** Holgura para el reloj: la activación se escribe a la vez que el cobro, a veces unos milisegundos antes. */
export const MARGEN_DE_ENTREGA_MS = 60_000

/** Una entrega recién empezada (PENDIENTE o PROCESANDO) no es un fallo: es el cobro en curso. */
export const ENTREGA_EN_CURSO_MS = 2 * 60_000

export type EstadoDeEntrega = 'PENDIENTE' | 'PROCESANDO' | 'FALLIDA' | 'COMPLETADA'

export interface EvidenciaDeEntrega {
  /** Cuándo la pasarela aprobó el cobro. Sin esta fecha nada se puede demostrar. */
  activadoAt: Date | null
  membership: { pagoConfirmado: boolean; fechaPago: Date | null } | null
  compra: { pagoConfirmado: boolean; fechaActivacion: Date | null } | null
}

/**
 * El producto de ESTE cobro ya está entregado si se activó a partir del cobro (nunca antes: un pago anterior de la
 * misma membresía no prueba nada sobre este).
 */
export function productoYaEntregado(e: EvidenciaDeEntrega): boolean {
  if (!e.activadoAt) return false
  const desde = e.activadoAt.getTime() - MARGEN_DE_ENTREGA_MS
  if (e.membership) return e.membership.pagoConfirmado && e.membership.fechaPago != null && e.membership.fechaPago.getTime() >= desde
  if (e.compra) return e.compra.pagoConfirmado && e.compra.fechaActivacion != null && e.compra.fechaActivacion.getTime() >= desde
  return false
}

/** `true` si la entrega sigue dentro de su ventana normal de proceso (no hay nada que revisar todavía). */
export function entregaEnCurso(estado: EstadoDeEntrega, actualizadoAt: Date, ahora: Date): boolean {
  if (estado !== 'PENDIENTE' && estado !== 'PROCESANDO') return false
  return ahora.getTime() - actualizadoAt.getTime() < ENTREGA_EN_CURSO_MS
}

export type SituacionDeEntrega = 'EN_CURSO' | 'CLIENTE_ESPERANDO' | 'REGISTRO_SIN_CERRAR' | 'ENTREGADA'

/** Resume qué hay que hacer con un cobro aprobado. Es lo único que decide qué acción se ofrece. */
export function situacionDeEntrega(
  e: EvidenciaDeEntrega & { estado: EstadoDeEntrega; actualizadoAt: Date },
  ahora: Date
): SituacionDeEntrega {
  if (e.estado === 'COMPLETADA') return 'ENTREGADA'
  if (entregaEnCurso(e.estado, e.actualizadoAt, ahora)) return 'EN_CURSO'
  return productoYaEntregado(e) ? 'REGISTRO_SIN_CERRAR' : 'CLIENTE_ESPERANDO'
}
