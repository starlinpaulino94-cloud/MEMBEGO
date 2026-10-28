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

/**
 * `DESCARTADA` = una persona cerró el cobro SIN entregar desde la conciliación (reembolsado, cobro de prueba, producto que
 * ya no existe…), con motivo y nota en la bitácora. Es un estado final como `COMPLETADA`, pero no factura: no hubo venta.
 */
export type EstadoDeEntrega = 'PENDIENTE' | 'PROCESANDO' | 'FALLIDA' | 'COMPLETADA' | 'DESCARTADA'

/** Los estados que ya no esperan nada: ni la conciliación ni el barrido los vuelven a mirar. */
export const ENTREGA_CERRADA: readonly EstadoDeEntrega[] = ['COMPLETADA', 'DESCARTADA']

export interface EvidenciaDeEntrega {
  /** Cuándo la pasarela aprobó el cobro. Sin esta fecha nada se puede demostrar. */
  activadoAt: Date | null
  membership: { pagoConfirmado: boolean; fechaPago: Date | null } | null
  compra: { pagoConfirmado: boolean; fechaActivacion: Date | null } | null
  /**
   * La activación de ESTE producto anotada en la bitácora (`PAGO_APROBADO`), si la hay (`activacionesEnBitacora`).
   *
   * La membresía sola no basta: su estado de HOY puede no decir nada del cobro de hace meses. Una membresía que se
   * activó con el cobro, venció y volvió a quedar pendiente tiene `pagoConfirmado = false`, y sin la bitácora parecía un
   * cliente esperando; «Reintentar entrega» la habría activado otro periodo con aquel pago. Y si la membresía se borró
   * (el cliente eliminó su cuenta), la bitácora es lo único que queda.
   */
  activacionRegistrada?: Date | null
}

/**
 * El producto de ESTE cobro ya está entregado si se activó a partir del cobro (nunca antes: un pago anterior de la
 * misma membresía no prueba nada sobre este).
 */
export function productoYaEntregado(e: EvidenciaDeEntrega): boolean {
  if (!e.activadoAt) return false
  const desde = e.activadoAt.getTime() - MARGEN_DE_ENTREGA_MS
  if (e.activacionRegistrada && e.activacionRegistrada.getTime() >= desde) return true
  if (e.membership) return e.membership.pagoConfirmado && e.membership.fechaPago != null && e.membership.fechaPago.getTime() >= desde
  if (e.compra) return e.compra.pagoConfirmado && e.compra.fechaActivacion != null && e.compra.fechaActivacion.getTime() >= desde
  return false
}

/** El cobro ya no apunta a nada: su membresía o su compra se borró (la relación queda en nulo). No hay a quién entregar. */
export const productoEliminado = (e: Pick<EvidenciaDeEntrega, 'membership' | 'compra'>) => e.membership == null && e.compra == null

/**
 * LA EVIDENCIA CON LA QUE SE DA POR ENTREGADO UN COBRO, dicha tal cual.
 *
 * `productoYaEntregado` solo acota por abajo: cualquier activación POSTERIOR al cobro cuenta, sea la entrega que se
 * perdió, una renovación de meses después o un cobro de otro día. No puede distinguirlas, así que quien cierra el
 * registro debe ver QUÉ se está usando como prueba y CUÁNTO tardó: una activación a los pocos segundos es casi seguro
 * la entrega; una de varios días puede ser otra cosa, y la nota tiene que decirlo. La bitácora guarda lo mismo.
 */
export interface EvidenciaUsada {
  fuente: 'MEMBRESIA' | 'COMPRA' | 'BITACORA'
  fecha: Date
  /** Milisegundos entre el cobro y la activación que lo prueba. Puede ser negativo dentro del margen de reloj. */
  demoraMs: number
}

export function evidenciaDeEntrega(e: EvidenciaDeEntrega): EvidenciaUsada | null {
  if (!productoYaEntregado(e) || !e.activadoAt) return null
  // La bitácora va primero: anota la activación en el momento en que ocurrió, y el producto puede haber cambiado después.
  const desde = e.activadoAt.getTime() - MARGEN_DE_ENTREGA_MS
  const delProducto = e.membership ? e.membership.fechaPago : e.compra ? e.compra.fechaActivacion : null
  const fuente: EvidenciaUsada['fuente'] =
    e.activacionRegistrada && e.activacionRegistrada.getTime() >= desde ? 'BITACORA' : e.membership ? 'MEMBRESIA' : 'COMPRA'
  const fecha = fuente === 'BITACORA' ? e.activacionRegistrada! : delProducto
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

/**
 * · `SIN_PRODUCTO`: la membresía o la compra del cobro ya no existe y nada prueba que se entregara. Reintentar no puede
 *   funcionar nunca (no hay qué activar) y nadie espera en la app: lo cierra una persona («Cerrar sin entregar»).
 * · `DESCARTADA`: ya la cerró una persona sin entregar.
 */
export type SituacionDeEntrega = 'EN_CURSO' | 'CLIENTE_ESPERANDO' | 'REGISTRO_SIN_CERRAR' | 'SIN_PRODUCTO' | 'ENTREGADA' | 'DESCARTADA'

/** Resume qué hay que hacer con un cobro aprobado. Es lo único que decide qué acción se ofrece. */
export function situacionDeEntrega(
  e: EvidenciaDeEntrega & { estado: EstadoDeEntrega; actualizadoAt: Date },
  ahora: Date
): SituacionDeEntrega {
  if (e.estado === 'COMPLETADA') return 'ENTREGADA'
  if (e.estado === 'DESCARTADA') return 'DESCARTADA'
  if (entregaEnCurso(e.estado, e.actualizadoAt, ahora)) return 'EN_CURSO'
  if (productoYaEntregado(e)) return 'REGISTRO_SIN_CERRAR'
  return productoEliminado(e) ? 'SIN_PRODUCTO' : 'CLIENTE_ESPERANDO'
}

/**
 * Un cobro que NUNCA pasó por el control de entregas: sigue `PENDIENTE`, sin un solo intento y sin error. Es lo que dejó la
 * columna de cumplimiento al nacer (12-sep-2026, `20260912_p1b_cumplimiento_dedupe`): todos los cobros aprobados de antes
 * recibieron `PENDIENTE` por defecto, aunque el sistema de entonces sí activó su producto. Hoy cualquier cobro aprobado
 * entra en `PROCESANDO` con un intento, así que esta combinación solo la tienen esos.
 */
export function anteriorAlControlDeEntregas(e: { estado: EstadoDeEntrega; intentos: number; error: string | null }): boolean {
  return e.estado === 'PENDIENTE' && e.intentos === 0 && !e.error
}

/**
 * POR QUÉ ESTE COBRO ESTÁ EN LA CONCILIACIÓN, en una frase que una persona entiende sin abrir la base de datos.
 *
 * Antes la pantalla solo decía «Entrega pendiente» —sin motivo, porque un cobro antiguo no tiene ningún error anotado— y
 * el único botón era reintentar, que en estos casos o fallaba siempre o activaba otro periodo gratis.
 */
export function diagnosticoDeEntrega(e: {
  situacion: SituacionDeEntrega
  estado: EstadoDeEntrega
  error: string | null
  intentos: number
  evidencia: EvidenciaUsada | null
  productoEliminado: boolean
}): string {
  const antiguo = anteriorAlControlDeEntregas(e)
  const partes: string[] = []
  if (antiguo) {
    partes.push(
      'Este cobro es anterior al control de entregas (12-sep-2026): el sistema de entonces activaba el producto pero no anotaba el resultado, por eso figura «pendiente» sin ningún error.'
    )
  } else if (e.estado === 'FALLIDA') {
    partes.push(`La entrega falló${e.intentos > 0 ? ` (${e.intentos} ${e.intentos === 1 ? 'intento' : 'intentos'})` : ''}: ${e.error ?? 'sin mensaje de error'}.`)
  } else if (e.estado === 'PROCESANDO') {
    partes.push('La entrega empezó y no terminó: el proceso se interrumpió a mitad (por ejemplo, la función del servidor se cortó).')
  } else if (e.estado === 'PENDIENTE') {
    partes.push('La entrega nunca se completó y no dejó ningún error anotado.')
  }

  if (e.evidencia) {
    const donde =
      e.evidencia.fuente === 'BITACORA'
        ? 'La bitácora registra la activación del producto'
        : e.evidencia.fuente === 'MEMBRESIA'
          ? 'La membresía muestra su pago confirmado'
          : 'La compra muestra su activación'
    partes.push(`${donde} ${describirDemora(e.evidencia.demoraMs)} después del cobro: el cliente sí lo recibió y solo falta cerrar el registro.`)
    if (e.productoEliminado) partes.push('El producto se eliminó después (normalmente porque el cliente borró su cuenta).')
  } else if (e.situacion === 'SIN_PRODUCTO') {
    partes.push(
      'La membresía o compra de este cobro ya no existe (se elimina, por ejemplo, cuando el cliente borra su cuenta) y no hay registro de que se activara. No hay nada que entregar: reintentar no puede funcionar. Comprueba en CardNET si el cobro se devolvió y ciérralo con «Cerrar sin entregar».'
    )
  } else if (e.situacion === 'CLIENTE_ESPERANDO') {
    partes.push('No hay ninguna activación de este producto después del cobro: el cliente pagó y no lo tiene.')
  }
  return partes.join(' ')
}

/**
 * Por qué una persona cierra un cobro SIN entregar. La lista es cerrada para que la bitácora se pueda contar; «Otro» exige
 * que la nota lo explique.
 */
export const MOTIVOS_DE_CIERRE = [
  { codigo: 'REEMBOLSADO', etiqueta: 'Se devolvió el dinero al cliente (reembolso en CardNET)' },
  { codigo: 'PRODUCTO_ELIMINADO', etiqueta: 'El producto o la cuenta del cliente ya no existe' },
  { codigo: 'COBRO_DE_PRUEBA', etiqueta: 'Fue un cobro de prueba' },
  { codigo: 'RESUELTO_FUERA', etiqueta: 'Se resolvió con el cliente por otra vía' },
  { codigo: 'OTRO', etiqueta: 'Otro motivo (explícalo en la nota)' },
] as const

export type MotivoDeCierre = (typeof MOTIVOS_DE_CIERRE)[number]['codigo']

/**
 * Los únicos motivos con los que se cierra sin entregar un cobro cuya MEMBRESÍA SIGUE ACTIVA: el dinero no se quedó, porque
 * se devolvió o porque era una prueba. Cerrarlo así cancela esa membresía en la misma transacción: un cliente no puede
 * conservar lo que no pagó. Con cualquier otro motivo, un producto activo se cierra con «Marcar entregada» (y factura).
 */
export const MOTIVOS_CON_PRODUCTO_ACTIVO = ['REEMBOLSADO', 'COBRO_DE_PRUEBA'] as const satisfies readonly MotivoDeCierre[]

export const motivoValeConProductoActivo = (m: MotivoDeCierre): boolean =>
  (MOTIVOS_CON_PRODUCTO_ACTIVO as readonly string[]).includes(m)

export const esMotivoDeCierre = (v: unknown): v is MotivoDeCierre =>
  typeof v === 'string' && MOTIVOS_DE_CIERRE.some((m) => m.codigo === v)

/** Una nota corta no explica nada: es lo único que dirá, dentro de meses, por qué este cobro no se entregó. */
export const NOTA_DE_CIERRE_MIN = 10
