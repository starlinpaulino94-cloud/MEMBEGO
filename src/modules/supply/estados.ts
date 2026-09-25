import type {
  SupplyAcuerdoEstado,
  SupplyDerechoEstado,
  SupplyIncidenciaEstado,
  SupplyLoteEstado,
  SupplyOrdenEstado,
  SupplyVoucherEstado,
} from '@prisma/client'

/**
 * MEMBEGO SUPPLY · máquinas de estado.
 *
 * Una transición que no esté declarada aquí NO OCURRE. Es la diferencia entre
 * un `estado` que es un campo de texto con buenas intenciones y un ciclo de
 * vida que se puede razonar: sin esta tabla, «cancelar» una orden ya fondeada y
 * «cancelar» un borrador son la misma línea de código y nadie se entera hasta
 * que hay que devolverle dinero a alguien.
 *
 * PURO. Se prueba sin base de datos.
 */

export type Transiciones<E extends string> = Record<E, readonly E[]>

// ── Acuerdo ─────────────────────────────────────────────────────────────────

export const TRANSICIONES_ACUERDO: Transiciones<SupplyAcuerdoEstado> = {
  BORRADOR: ['PENDIENTE_APROBACION', 'CANCELADO'],
  PENDIENTE_APROBACION: ['APROBADO', 'BORRADOR', 'CANCELADO'],
  APROBADO: ['ACTIVO', 'CANCELADO'],
  ACTIVO: ['COMPLETADO', 'VENCIDO', 'CANCELADO'],
  COMPLETADO: [],
  VENCIDO: [],
  CANCELADO: [],
}

// ── Orden de compra ─────────────────────────────────────────────────────────

/**
 * PARCIALMENTE_FONDEADA existe porque la modalidad normal de Membego es
 * anticipo + saldo: entre pagar el 30% y pagar el resto pasan semanas, y sin
 * este estado la orden o miente diciendo FONDEADA o miente diciendo APROBADA.
 *
 * ACTIVA es el único estado desde el que un lote puede entregar unidades.
 */
export const TRANSICIONES_ORDEN: Transiciones<SupplyOrdenEstado> = {
  BORRADOR: ['PENDIENTE_APROBACION', 'CANCELADA'],
  PENDIENTE_APROBACION: ['APROBADA', 'BORRADOR', 'CANCELADA'],
  APROBADA: ['CONFIRMADA', 'CANCELADA'],
  CONFIRMADA: ['PARCIALMENTE_FONDEADA', 'FONDEADA', 'ACTIVA', 'CANCELADA'],
  PARCIALMENTE_FONDEADA: ['FONDEADA', 'ACTIVA', 'CANCELADA'],
  FONDEADA: ['ACTIVA', 'CANCELADA'],
  ACTIVA: ['COMPLETADA', 'CANCELADA'],
  COMPLETADA: [],
  CANCELADA: [],
}

/**
 * Estados de orden desde los que YA se puede crear un lote y entregar.
 *
 * CONFIRMADA entra aunque no se haya pagado nada: en PAGO_POR_REDENCION el
 * dinero se mueve DESPUÉS del consumo, así que exigir fondeo para activar haría
 * imposible esa modalidad entera.
 */
export const ORDEN_PUEDE_GENERAR_LOTE: readonly SupplyOrdenEstado[] = [
  'CONFIRMADA',
  'PARCIALMENTE_FONDEADA',
  'FONDEADA',
  'ACTIVA',
]

// ── Lote ────────────────────────────────────────────────────────────────────

export const TRANSICIONES_LOTE: Transiciones<SupplyLoteEstado> = {
  PROGRAMADO: ['ACTIVO', 'CANCELADO'],
  ACTIVO: ['AGOTADO', 'VENCIDO', 'CANCELADO', 'CERRADO'],
  /**
   * AGOTADO vuelve a ACTIVO a propósito: una reversa de redención o una
   * devolución de emisión devuelven unidades a DISPONIBLE, y un lote que se
   * quedara atrapado en AGOTADO no podría volver a entregarlas.
   */
  AGOTADO: ['ACTIVO', 'VENCIDO', 'CERRADO', 'CANCELADO'],
  VENCIDO: ['CERRADO'],
  CANCELADO: [],
  CERRADO: [],
}

/** Estados en los que el lote puede emitir derechos nuevos. */
export const LOTE_PUEDE_EMITIR: readonly SupplyLoteEstado[] = ['ACTIVO']

// ── Derecho del cliente ─────────────────────────────────────────────────────

export const TRANSICIONES_DERECHO: Transiciones<SupplyDerechoEstado> = {
  /** El hold del checkout: o se confirma o se suelta. Nunca se redime desde aquí. */
  RETENIDO: ['ACTIVO', 'CANCELADO', 'VENCIDO'],
  ACTIVO: ['REDIMIDO', 'VENCIDO', 'CANCELADO', 'REVOCADO'],
  /** Una reversa de redención devuelve el derecho a ACTIVO; nada más lo saca. */
  REDIMIDO: ['ACTIVO'],
  VENCIDO: [],
  CANCELADO: [],
  REVOCADO: [],
}

export const TRANSICIONES_VOUCHER: Transiciones<SupplyVoucherEstado> = {
  ACTIVO: ['REDIMIDO', 'VENCIDO', 'CANCELADO', 'REVOCADO'],
  REDIMIDO: ['ACTIVO'],
  VENCIDO: [],
  CANCELADO: [],
  REVOCADO: [],
}

// ── Incidencias ─────────────────────────────────────────────────────────────

export const TRANSICIONES_INCIDENCIA: Transiciones<SupplyIncidenciaEstado> = {
  ABIERTA: ['EN_REVISION', 'RESUELTA_CLIENTE', 'RESUELTA_COMERCIO', 'RESUELTA_MEMBEGO', 'CERRADA'],
  EN_REVISION: ['RESUELTA_CLIENTE', 'RESUELTA_COMERCIO', 'RESUELTA_MEMBEGO', 'CERRADA'],
  RESUELTA_CLIENTE: ['CERRADA'],
  RESUELTA_COMERCIO: ['CERRADA'],
  RESUELTA_MEMBEGO: ['CERRADA'],
  CERRADA: [],
}

// ── Comprobación genérica ───────────────────────────────────────────────────

// ── Reserva de recogida ─────────────────────────────────────────────────────

export type SupplyReservaEstado = 'CONFIRMADA' | 'LISTA' | 'CUMPLIDA' | 'CANCELADA' | 'NO_ASISTIO'

/**
 * LISTA está EN MEDIO, no al final: el comercio avisa de que lo preparó y
 * después entrega. Se puede saltar —quien hace un café no va a pulsar un botón
 * antes de dárselo— así que CONFIRMADA llega a CUMPLIDA directamente.
 *
 * De LISTA todavía se puede cancelar y se puede marcar NO_ASISTIO: que la
 * comida esté hecha no obliga al cliente a aparecer, y el comercio necesita
 * poder cerrar esa reserva para que deje de ocuparle el cupo del día.
 */
export const TRANSICIONES_RESERVA: Transiciones<SupplyReservaEstado> = {
  CONFIRMADA: ['LISTA', 'CUMPLIDA', 'CANCELADA', 'NO_ASISTIO'],
  LISTA: ['CUMPLIDA', 'CANCELADA', 'NO_ASISTIO'],
  CUMPLIDA: [],
  CANCELADA: [],
  NO_ASISTIO: [],
}

/**
 * Reservas que siguen ocupando el cupo del día.
 *
 * Existe para que nadie tenga que acordarse: el cupo se cuenta en cinco sitios
 * distintos y, cuando LISTA entró, un solo `estado: 'CONFIRMADA'` olvidado
 * habría liberado cupo por una pizza que estaba hecha y encima del mostrador.
 * El comercio habría aceptado una reserva de más por cada pedido preparado.
 */
export const RESERVA_OCUPA_CUPO: readonly SupplyReservaEstado[] = ['CONFIRMADA', 'LISTA']

export function puedeTransicionar<E extends string>(
  tabla: Transiciones<E>,
  desde: E,
  hasta: E
): boolean {
  return (tabla[desde] ?? []).includes(hasta)
}

/**
 * Lanza si la transición no existe. Se usa en las server actions ANTES de
 * escribir: el mensaje nombra los dos estados porque «operación no válida» es
 * inútil cuando llega a soporte tres semanas después.
 */
export function exigirTransicion<E extends string>(
  tabla: Transiciones<E>,
  desde: E,
  hasta: E,
  entidad: string
): void {
  if (!puedeTransicionar(tabla, desde, hasta)) {
    throw new Error(`${entidad}: no se puede pasar de ${desde} a ${hasta}.`)
  }
}

/** Estados sin salida: el registro ya terminó su vida. */
export function esTerminal<E extends string>(tabla: Transiciones<E>, estado: E): boolean {
  return (tabla[estado] ?? []).length === 0
}
