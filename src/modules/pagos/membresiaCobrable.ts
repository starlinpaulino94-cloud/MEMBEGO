import type { MembershipEstado, Prisma } from '@prisma/client'
import { calcularPagoCambioPlan } from '@/modules/membresia/prorrateo'

/**
 * ¿ADMITE COBRO CON TARJETA ESTA MEMBRESÍA? Y SI SÍ, ¿CUÁNTO?
 *
 * La resolución del importe vivía en `montoDeObjetivo` y NO filtraba por estado:
 * cualquier membresía daba un precio, incluida una en `PENDIENTE_PAGO` —que ya
 * tiene su propio flujo de comprobante—. Mientras `PAGO_CARDNET` esté apagado el
 * agujero no se puede alcanzar, pero encenderlo con esto dentro sería una
 * apuesta: ofrecer tarjeta sobre una membresía que ya está pagando por otro
 * camino es cobrar dos veces el mismo período.
 *
 * Esta función es PURA (sin base de datos, sin `server-only`) por dos razones:
 *   1. Es una decisión de negocio, no una consulta: se puede leer y probar sola.
 *   2. Deja la puerta sujeta a una prueba que falla si alguien la quita. Un
 *      guard dentro de una función que habla con la base solo se puede probar
 *      con la base delante, y esos tests se saltan cuando no la hay.
 *
 * Estados cobrables con tarjeta, y sus caminos legítimos:
 *   · `PENDIENTE`            → activación inicial (paga el plan, menos descuento).
 *   · `RECHAZADA`            → su pago anterior fue rechazado y vuelve a pagar.
 *   · `ACTIVA` + cambio de plan + SIN comprobante → diferencia prorrateada.
 *
 * Todo lo demás se rechaza con un motivo explícito:
 *   · `PENDIENTE_PAGO`       → el comprobante ya está enviado, espera validación.
 *   · `ACTIVA` + cambio + comprobante → ya lo envió; su camino es validarlo, no
 *                                        cobrarlo otra vez con tarjeta.
 *   · `ACTIVA` sin cambio    → ya está pagada.
 *   · `VENCIDA` / `CANCELADA`→ no hay período vivo que cobrar.
 *
 * EL IMPORTE SE REUSA, NO SE REIMPLEMENTA: el cambio de plan llama a
 * `calcularPagoCambioPlan`, la única fuente de la fórmula de prorrateo.
 */

export interface MembresiaParaCobro {
  estado: MembershipEstado
  planIdSolicitado: string | null
  comprobanteUrl: string | null
  /** `null` = nunca se activó: aplica el descuento de bienvenida. */
  fechaInicio: Date | null
  descuentoBienvenida: Prisma.Decimal | number | null
  fechaVencimiento: Date | null
  plan: {
    nombre: string
    precio: Prisma.Decimal | number
    vigenciaDias: number
  }
  planSolicitado: {
    nombre: string
    precio: Prisma.Decimal | number
  } | null
}

export type CobroMembresia =
  | { ok: true; pesos: number; descripcion: string }
  | { ok: false; motivo: string }

/** Motivo del rechazo cuando lo que falla es el ESTADO (no la pertenencia). */
function motivoEstadoNoCobrable(estado: MembershipEstado): string {
  switch (estado) {
    case 'PENDIENTE_PAGO':
      return 'Ya enviaste el comprobante de esta membresía. Espera a que el equipo lo valide.'
    case 'ACTIVA':
      return 'Esta membresía ya está pagada.'
    case 'VENCIDA':
      return 'Esta membresía venció. Renueva desde tus planes.'
    case 'CANCELADA':
      return 'Esta membresía está cancelada.'
    case 'PENDIENTE':
    case 'RECHAZADA':
      // Inalcanzable: ambos son cobrables y salen antes de esta función.
      return 'Esta membresía no admite un cobro con tarjeta.'
  }
}

export function resolverCobroMembresia(m: MembresiaParaCobro): CobroMembresia {
  const esCambio = m.estado === 'ACTIVA' && m.planIdSolicitado != null
  if (esCambio) {
    if (!m.planSolicitado) {
      return { ok: false, motivo: 'No se encontró el plan solicitado.' }
    }
    // Un cambio ya cubierto por su comprobante no se cobra con tarjeta: su
    // camino es la validación del comprobante. Cobrar aquí sería doble cobro.
    if (m.comprobanteUrl != null) {
      return {
        ok: false,
        motivo:
          'Ya enviaste el comprobante de tu cambio de plan. Espera a que el equipo lo valide.',
      }
    }
    const pago = calcularPagoCambioPlan({
      precioNuevo: Number(m.planSolicitado.precio),
      precioVigente: Number(m.plan.precio),
      fechaVencimiento: m.fechaVencimiento,
      vigenciaDias: m.plan.vigenciaDias,
    })
    return { ok: true, pesos: pago.aPagar, descripcion: `Cambio a ${m.planSolicitado.nombre}` }
  }

  if (m.estado !== 'PENDIENTE' && m.estado !== 'RECHAZADA') {
    return { ok: false, motivo: motivoEstadoNoCobrable(m.estado) }
  }

  const descuento = m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
  const pesos = Math.max(0, Number(m.plan.precio) - descuento)
  return { ok: true, pesos, descripcion: `Plan ${m.plan.nombre}` }
}
