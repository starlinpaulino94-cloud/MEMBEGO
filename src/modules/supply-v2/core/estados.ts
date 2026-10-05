import type {
  SupplyV2EntitlementStatus,
  SupplyV2VoucherStatus,
  SupplyV2AgreementStatus,
  SupplyV2CustomerOrderStatus,
  SupplyV2OfferStatus,
  SupplyV2PurchaseOrderStatus,
  SupplyV2ReceiptStatus,
} from '@prisma/client'

/**
 * MEMBEGO SUPPLY 2.0 · máquinas de estado (Slice 1).
 *
 * Una transición que no esté declarada aquí NO OCURRE. PURO: se prueba sin
 * base de datos.
 */

export type Transiciones<E extends string> = Record<E, readonly E[]>

export const TRANSICIONES_ORDEN: Transiciones<SupplyV2PurchaseOrderStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  /** Rechazar devuelve a DRAFT con motivo; el historial queda en los eventos. */
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_PAID', 'PAID', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PAID: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  RECEIVED: ['CLOSED'],
  CANCELLED: [],
  CLOSED: [],
}

/** Estados desde los que se puede registrar una recepción. */
export const ORDEN_RECIBIBLE: readonly SupplyV2PurchaseOrderStatus[] = [
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_RECEIVED',
]

/** Estados en los que la orden sigue viva para el tablero («compras abiertas»). */
export const ORDEN_ABIERTA: readonly SupplyV2PurchaseOrderStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_RECEIVED',
]

/** Aprobadas y todavía con unidades por recibir (el subconjunto de `ORDEN_ABIERTA` que espera recepción). */
export const ORDEN_POR_RECIBIR: readonly SupplyV2PurchaseOrderStatus[] = ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_RECEIVED']

/** Una orden aprobada no cambia cantidades ni costos en silencio (§42). */
export const ORDEN_EDITABLE: readonly SupplyV2PurchaseOrderStatus[] = ['DRAFT']

export const TRANSICIONES_ACUERDO: Transiciones<SupplyV2AgreementStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'ACTIVE', 'TERMINATED'],
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
}

export const TRANSICIONES_RECEPCION: Transiciones<SupplyV2ReceiptStatus> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: [],
}

export function puedeTransicionar<E extends string>(tabla: Transiciones<E>, desde: E, hasta: E): boolean {
  return tabla[desde].includes(hasta)
}

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

/**
 * Estado de la orden después de una recepción, derivado de sus líneas: todas
 * completas → RECEIVED; alguna con algo → PARTIALLY_RECEIVED.
 */
export function estadoTrasRecepcion(
  lineas: readonly { quantity: number; receivedQuantity: number }[]
): 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  const completa = lineas.every((l) => l.receivedQuantity >= l.quantity)
  return completa ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
}

/** Mensaje de error o `null`: cuánto se puede recibir todavía en una línea. */
export function validarCantidadRecibida(
  cantidadAhora: number,
  linea: { quantity: number; receivedQuantity: number }
): string | null {
  if (!Number.isInteger(cantidadAhora) || cantidadAhora <= 0) {
    return 'La cantidad recibida tiene que ser un entero positivo.'
  }
  const pendiente = linea.quantity - linea.receivedQuantity
  if (pendiente <= 0) return 'Esta línea ya se recibió completa.'
  if (cantidadAhora > pendiente) {
    return `Solo quedan ${pendiente.toLocaleString('es-DO')} unidades por recibir y se intentan recibir ${cantidadAhora.toLocaleString('es-DO')}.`
  }
  return null
}

// ── Slice 2 · Oferta ────────────────────────────────────────────────────────

export const TRANSICIONES_OFERTA: Transiciones<SupplyV2OfferStatus> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'SOLD_OUT', 'ENDED', 'CANCELLED'],
  /** Pausada no vende; reanudar vuelve a ACTIVE sin tocar la asignación. */
  PAUSED: ['ACTIVE', 'ENDED', 'CANCELLED'],
  SOLD_OUT: ['ENDED', 'CANCELLED'],
  ENDED: [],
  CANCELLED: [],
}

/** Estado con el que nace una oferta al publicarla, según su vigencia (§14). */
export function estadoInicialOferta(startsAt: Date, ahora = new Date()): 'SCHEDULED' | 'ACTIVE' {
  return startsAt > ahora ? 'SCHEDULED' : 'ACTIVE'
}

export interface OfertaParaComprar {
  status: SupplyV2OfferStatus
  startsAt: Date
  endsAt: Date | null
}

/** Mensaje de error o `null`: ¿se puede comprar esta oferta ahora? (§18, §45) */
export function motivoNoComprable(o: OfertaParaComprar, unidadesLibres: number, ahora = new Date()): string | null {
  if (o.status === 'SCHEDULED' || o.startsAt > ahora) return 'Esta oferta todavía no ha empezado.'
  if (o.status === 'PAUSED') return 'Esta oferta está pausada.'
  if (o.status === 'SOLD_OUT') return 'Esta oferta se agotó.'
  if (o.status === 'ENDED' || (o.endsAt && o.endsAt <= ahora)) return 'Esta oferta ya terminó.'
  if (o.status !== 'ACTIVE') return 'Esta oferta no está disponible.'
  if (unidadesLibres <= 0) return 'Esta oferta se agotó.'
  return null
}

// ── Slice 2 · Orden del cliente ─────────────────────────────────────────────

export const TRANSICIONES_ORDEN_CLIENTE: Transiciones<SupplyV2CustomerOrderStatus> = {
  PENDING: ['AWAITING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED'],
  /** Con pago avisado, la reserva aguanta hasta que Membego lo revise. */
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
}

/** Estados en los que la orden retiene unidades. */
export const ORDEN_CLIENTE_CON_RESERVA: readonly SupplyV2CustomerOrderStatus[] = ['PENDING', 'AWAITING_PAYMENT']

/** Cuántas unidades de esta oferta cuentan contra el límite por cliente (§35): pagadas y reservas vivas. */
export function unidadesQueCuentanParaLimite(
  ordenes: readonly { status: SupplyV2CustomerOrderStatus; quantity: number }[]
): number {
  return ordenes
    .filter((o) => o.status === 'PAID' || ORDEN_CLIENTE_CON_RESERVA.includes(o.status))
    .reduce((t, o) => t + o.quantity, 0)
}

export function validarLimitePorCliente(perCustomerLimit: number, yaCuenta: number, quiere: number): string | null {
  if (!Number.isInteger(quiere) || quiere <= 0) return 'La cantidad tiene que ser un entero positivo.'
  if (yaCuenta + quiere > perCustomerLimit) {
    const restan = Math.max(0, perCustomerLimit - yaCuenta)
    return restan === 0
      ? `Ya alcanzaste el máximo de ${perCustomerLimit} por persona en esta oferta.`
      : `Solo puedes comprar ${restan} más en esta oferta (máximo ${perCustomerLimit} por persona).`
  }
  return null
}

// ── Slice 3 · voucher y derecho (§42–§43) ────────────────────────────────────

/** Un voucher vuelve a ACTIVE solo por una reversa; lo demás es terminal. */
export const TRANSICIONES_VOUCHER: Transiciones<SupplyV2VoucherStatus> = {
  ACTIVE: ['REDEEMED', 'EXPIRED', 'CANCELLED', 'REVOKED'],
  REDEEMED: ['ACTIVE'],
  EXPIRED: [],
  CANCELLED: [],
  REVOKED: [],
}

/** Un derecho REDEEMED vuelve a ACTIVE solo por una reversa. */
export const TRANSICIONES_DERECHO: Transiciones<SupplyV2EntitlementStatus> = {
  ACTIVE: ['REDEEMED', 'EXPIRED', 'CANCELLED'],
  REDEEMED: ['ACTIVE'],
  EXPIRED: [],
  CANCELLED: [],
}
