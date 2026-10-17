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

/**
 * LA EVIDENCIA CON LA QUE SE DA POR ENTREGADO UN COBRO, dicha tal cual.
 *
 * `productoYaEntregado` solo acota por abajo: cualquier activación POSTERIOR al cobro cuenta, sea la entrega que se
 * perdió, una renovación de meses después o un cobro de otro día. No puede distinguirlas, así que quien cierra el
 * registro debe ver QUÉ se está usando como prueba y CUÁNTO tardó: una activación a los pocos segundos es casi seguro
 * la entrega; una de varios días puede ser otra cosa, y la nota tiene que decirlo. La bitácora guarda lo mismo.
 */
export interface EvidenciaUsada {
  fuente: 'MEMBRESIA' | 'COMPRA'
  fecha: Date
  /** Milisegundos entre el cobro y la activación que lo prueba. Puede ser negativo dentro del margen de reloj. */
  demoraMs: number
}

export function evidenciaDeEntrega(e: EvidenciaDeEntrega): EvidenciaUsada | null {
  if (!productoYaEntregado(e) || !e.activadoAt) return null
  const fuente = e.membership ? 'MEMBRESIA' : 'COMPRA'
  const fecha = e.membership ? e.membership.fechaPago : e.compra ? e.compra.fechaActivacion : null
  if (!fecha) return null
  return { fuente, fecha, demoraMs: fecha.getTime() - e.activadoAt.getTime() }
}

/** Demora a partir de la cual la evidencia es DÉBIL: ya no parece la entrega perdida de ese cobro. */
export const DEMORA_SOSPECHOSA_MS = 24 * 3_600_000

/** «unos segundos», «12 minutos», «3 horas», «2 días»: lo que lee una persona antes de firmar una nota. */
export function describirDemora(ms: number): string {
  const abs = Math.max(0, ms)
  if (abs < 60_000) return 'unos segundos'
  const min = Math.round(abs / 60_000)
  if (min < 60) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const horas = Math.round(abs / 3_600_000)
  if (horas < 48) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`
  const dias = Math.round(abs / 86_400_000)
  return `${dias} días`
}

/**
 * Un cobro de CAMBIO DE PLAN pagado con tarjeta que la pasarela NO puede entregar sola.
 *
 * Un cambio de plan se entrega aplicando el plan que se pagó (`aplicarCambioDePlanCobrado`), y eso exige saber CUÁL: el
 * cobro lo guarda (`planDestinoId`) y la membresía debe seguir pidiendo ese mismo plan. Se necesita a una persona cuando
 * la membresía está activa, tiene un cambio pedido y el cobro no lo respalda: es anterior a que se guardara el plan, o el
 * cliente cambió su pedido después de pagar. Reintentar solo toparía con lo mismo, una y otra vez, así que ni el botón ni el
 * barrido lo reintentan: se muestra qué hay que hacer. Una RENOVACIÓN automática no entra aquí aunque la membresía esté
 * activa y tenga un cambio pedido: la renovación tiene su propia entrega.
 */
export const CAMBIO_DE_PLAN_PAGADO =
  'Es un cambio de plan pagado con tarjeta que no se pudo aplicar solo (el cobro es anterior al registro del plan o el cliente cambió su pedido): una persona debe aplicarlo desde Pagos (aprobar el cambio de plan) y luego cerrar el cobro con «Marcar entregada».'

export function entregaRequierePersona(e: {
  canal: string | null
  /** El plan que respalda el cobro (`pago_intentos.planDestinoId`); nulo si no es un cambio de plan o es anterior a la columna. */
  planDestinoId?: string | null
  membership: { estado: string; planIdSolicitado: string | null } | null
}): boolean {
  if (e.canal === 'RENOVACION_AUTOMATICA') return false
  if (e.membership?.estado !== 'ACTIVA' || e.membership.planIdSolicitado == null) return false
  return e.planDestinoId == null || e.planDestinoId !== e.membership.planIdSolicitado
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
