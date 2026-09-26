/**
 * CUÁNDO SE PUEDE RENOVAR UNA MEMBRESÍA, Y DESDE CUÁNDO CUENTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * Renovar encadenaba: si la membresía todavía no había vencido, el período
 * nuevo arrancaba donde terminaba el anterior — y además movía `fechaInicio` a
 * esa fecha FUTURA. Una membresía renovada el 26 de septiembre quedaba con
 * «Inicio 26 oct · Vencimiento 26 nov»: un período que no había empezado, en
 * una membresía que el cliente estaba usando ese mismo día.
 *
 * El encadenado se escribió para no quitarle a nadie los días que le quedaban,
 * y ese problema es real. Pero la salida no era regalar un mes: es que una
 * membresía viva NO SE RENUEVA. Si no se puede renovar antes de tiempo, no hay
 * días que encadenar ni que perder, y el período vuelve a significar lo que
 * dice — empieza el día que se pagó.
 *
 * Las otras dos vías ya lo hacían así, y esta era la única que se desviaba:
 * `activacion.ts` pone `fechaInicio: now` sin encadenar nada, y la renovación
 * por tarjeta mueve el vencimiento pero NUNCA toca `fechaInicio`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA (decisión del dueño, 26-09-2026)
 *
 * «Las membresías que aún no han vencido no se pueden renovar, al menos que ya
 * no tengan lavados.»
 *
 * Que es exactamente cuándo tiene sentido pagar otra vez: o se acabó el tiempo,
 * o se acabaron los usos.
 */

import type { MembershipEstado } from '@prisma/client'

/** Estados desde los que renovar significa algo. */
const ESTADOS_RENOVABLES: readonly string[] = ['ACTIVA', 'VENCIDA', 'CANCELADA']

export type MotivoNoRenovable =
  /** Su estado no admite renovación (PENDIENTE, RECHAZADA…). */
  | 'estado'
  /** Sigue vigente y le quedan lavados del plan. */
  | 'vigente_con_usos'
  /** Sigue vigente y es ilimitada: no hay usos que se puedan agotar. */
  | 'vigente_ilimitada'

export interface MembresiaParaRenovar {
  estado: MembershipEstado | string
  fechaVencimiento: Date | null
  /** Los del PLAN. Los de regalo van aparte y no cuentan aquí (ver abajo). */
  lavadosRestantes: number
  esIlimitado: boolean
}

/**
 * ¿Por qué NO se puede renovar? `null` = sí se puede.
 *
 * Se devuelve el motivo y no un booleano porque la pantalla tiene que poder
 * decir cuál de los tres es: «todavía le quedan 3 lavados» y «esta membresía
 * no admite renovación» mandan a hacer cosas distintas, y un botón que solo
 * se apaga no enseña ninguna.
 *
 * LOS LAVADOS DE REGALO NO BLOQUEAN, a propósito. Sobreviven a la renovación
 * —`lavadosBonoRestantes` no se toca— así que renovar no le quita al cliente
 * ninguno: no hay nada que proteger posponiéndolo. Lo que se acabó es lo que
 * pagó, que es lo que se está volviendo a pagar.
 */
export function motivoNoRenovable(
  m: MembresiaParaRenovar,
  ahora: Date = new Date()
): MotivoNoRenovable | null {
  if (!ESTADOS_RENOVABLES.includes(String(m.estado))) return 'estado'

  // Cancelada o ya vencida: no hay período vivo que proteger.
  if (m.estado !== 'ACTIVA') return null
  const sigueVigente = m.fechaVencimiento === null || m.fechaVencimiento > ahora
  if (!sigueVigente) return null

  // Vigente. Solo se abre la puerta si se agotaron los usos del plan, y una
  // ilimitada no los agota nunca: para ella «vigente» es motivo suficiente.
  if (m.esIlimitado) return 'vigente_ilimitada'
  return m.lavadosRestantes > 0 ? 'vigente_con_usos' : null
}

/** Lo mismo, en booleano, para quien solo necesita decidir. */
export function puedeRenovarse(m: MembresiaParaRenovar, ahora: Date = new Date()): boolean {
  return motivoNoRenovable(m, ahora) === null
}

/** El texto que se le enseña a quien está en el mostrador. */
export function explicarNoRenovable(motivo: MotivoNoRenovable, lavadosRestantes = 0): string {
  switch (motivo) {
    case 'vigente_con_usos':
      return `Todavía le quedan ${lavadosRestantes} ${
        lavadosRestantes === 1 ? 'uso' : 'usos'
      } de su período actual. Se podrá renovar cuando los agote o cuando venza.`
    case 'vigente_ilimitada':
      return 'Su plan es ilimitado y sigue vigente. Se podrá renovar cuando venza.'
    case 'estado':
      return 'Esta membresía no admite renovación en su estado actual.'
  }
}
