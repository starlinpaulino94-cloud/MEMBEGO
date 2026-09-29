import type {
  SupplyV2AgreementStatus,
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

/**
 * Política de segregación (§23): quien creó la orden no la aprueba. Se aplica
 * siempre que se conozca al creador; `permitirAutoaprobacion` existe para que
 * la política sea configurable, no para saltársela por defecto.
 */
export function puedeAprobar(
  orden: { createdById: string | null },
  actorId: string,
  permitirAutoaprobacion = false
): string | null {
  if (!permitirAutoaprobacion && orden.createdById && orden.createdById === actorId) {
    return 'Una orden de compra no la puede aprobar quien la creó.'
  }
  return null
}
