import { periodEnd } from '@/lib/periodos'

/**
 * QUÉ CAMBIA EN LA MEMBRESÍA AL APLICAR UN CAMBIO DE PLAN — una sola definición.
 *
 * El cambio que el cliente pidió se aplica por tres caminos: la aprobación del administrador, la confirmación de un pago
 * por transferencia y el cobro con tarjeta en la pasarela. Los tres deben dejar la membresía IGUAL: mismo plan, mismo
 * periodo nuevo, mismos lavados, el pedido borrado. Escrito tres veces, la primera vez que uno cambie (otra vigencia, otro
 * campo) los otros dos se quedan atrás y el cliente recibe algo distinto según cómo pagó.
 *
 * Es PURA (sin base de datos ni Next) para poder probarla sola. Lo que cada camino pone aparte es el importe y la fecha
 * del pago: el administrador cobra la diferencia prorrateada de hoy; la pasarela entrega lo que YA cobró, fechado al cobro.
 */
export interface PlanDestinoParaAplicar {
  id: string
  vigenciaDias: number
  esIlimitado: boolean
  lavadosIncluidos: number
}

export function datosDeCambioDePlan(input: {
  nuevoPlan: PlanDestinoParaAplicar
  /** Lo pagado por el cambio (la diferencia prorrateada). */
  monto: number
  /** El momento en que el cambio se aplica: empieza el periodo nuevo. */
  ahora: Date
  /** Cuándo entró el dinero. Por defecto, `ahora`; en la pasarela, la aprobación del cobro. */
  fechaPago?: Date
}) {
  const { nuevoPlan, monto, ahora } = input
  return {
    planId: nuevoPlan.id,
    planIdSolicitado: null,
    estado: 'ACTIVA' as const,
    pagoConfirmado: true,
    montoPagado: monto,
    fechaPago: input.fechaPago ?? ahora,
    fechaInicio: ahora,
    fechaVencimiento: periodEnd(ahora, nuevoPlan.vigenciaDias),
    lavadosRestantes: nuevoPlan.esIlimitado ? 0 : nuevoPlan.lavadosIncluidos,
    rechazadoReason: null,
  }
}
