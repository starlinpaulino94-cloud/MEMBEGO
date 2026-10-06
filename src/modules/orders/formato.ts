import type {
  MembegoAttributionChannel,
  MembegoOrderOrigin,
  MembegoOrderStatus,
  MembegoPaymentMethod,
  MembegoVerificationLevel,
} from '@prisma/client'

/**
 * COMMERCE CORE · pedidos — textos y formato para la interfaz.
 *
 * Puro y sin dependencias de servidor: lo importan también los componentes de
 * cliente (que NO pueden importar el servicio ni las lecturas, arrastrarían
 * Prisma al navegador).
 */

export const ETIQUETA_ESTADO: Record<MembegoOrderStatus, string> = {
  CREATED: 'Creado',
  AWAITING_MERCHANT: 'Esperando a la empresa',
  IN_PROGRESS: 'En preparación',
  READY: 'Listo para recoger',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
}

export type VarianteBadge = 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline'

export const BADGE_ESTADO: Record<MembegoOrderStatus, VarianteBadge> = {
  CREATED: 'secondary',
  AWAITING_MERCHANT: 'warning',
  IN_PROGRESS: 'default',
  READY: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'secondary',
}

export const ETIQUETA_ORIGEN: Record<MembegoOrderOrigin, string> = {
  MARKETPLACE: 'Marketplace',
  POS: 'Caja',
  SUPPLY: 'Oferta MembeGo',
  EXCURSION: 'Excursión',
  API: 'API',
}

export const ETIQUETA_CANAL: Record<MembegoAttributionChannel, string> = {
  MARKETPLACE_BROWSE: 'Navegando el marketplace',
  MARKETPLACE_SEARCH: 'Buscando en el marketplace',
  PROMOTION_CLAIM: 'Reclamó una promoción',
  CAMPAIGN: 'Campaña',
  REFERRAL: 'Referido',
  QR_SCAN: 'Escaneó un QR',
  SUPPLY_OFFER: 'Oferta MembeGo',
  DIRECT: 'Directo',
}

export const ETIQUETA_METODO: Record<MembegoPaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  MEMBEGO_CHECKOUT: 'Checkout MembeGo',
  OTHER: 'Otro',
}

export const ETIQUETA_NIVEL: Record<MembegoVerificationLevel, string> = {
  ATTRIBUTED: 'Atribuido',
  REDEEMED: 'Canjeado con QR',
  CUSTOMER_VERIFIED: 'Confirmado por el cliente',
  PAYMENT_VERIFIED: 'Pago verificado',
  FISCALLY_RECONCILED: 'Conciliado fiscalmente',
}

/** Qué evidencia falta para el siguiente nivel, en palabras (para la ficha del pedido). */
export const AYUDA_NIVEL: Record<MembegoVerificationLevel, string> = {
  ATTRIBUTED: 'Se sabe de dónde vino. Falta que el cliente lo recoja con su QR.',
  REDEEMED: 'El QR cerró el pedido. Falta que el cliente confirme el monto.',
  CUSTOMER_VERIFIED: 'El cliente confirmó el monto. Falta registrar un pago con tarjeta o transferencia y su referencia.',
  PAYMENT_VERIFIED: 'Hay un pago registrado por el monto del pedido, con referencia.',
  FISCALLY_RECONCILED: 'Conciliado con el comprobante fiscal.',
}

/** Monto con la moneda del pedido (`DOP` → `RD$`), siempre a dos decimales. */
export function formatearMonto(monto: number | string, moneda = 'DOP'): string {
  const n = typeof monto === 'string' ? Number(monto) : monto
  const valor = Number.isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor)
  } catch {
    return `${moneda} ${valor.toFixed(2)}`
  }
}

/** Fecha y hora cortas en español de RD (zona del servidor; solo para mostrar). */
export function formatearFechaHora(d: Date | string): string {
  const fecha = typeof d === 'string' ? new Date(d) : d
  return fecha.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Los pasos del camino feliz, para el indicador de progreso (un pedido cancelado o reembolsado se pinta aparte). */
export const PASOS: ReadonlyArray<{ estado: MembegoOrderStatus; etiqueta: string }> = [
  { estado: 'AWAITING_MERCHANT', etiqueta: 'Enviado' },
  { estado: 'IN_PROGRESS', etiqueta: 'Aceptado' },
  { estado: 'READY', etiqueta: 'Listo' },
  { estado: 'COMPLETED', etiqueta: 'Completado' },
]

/** Cuántos pasos del camino feliz lleva un pedido (0 si no entra en él). */
export function pasoActual(estado: MembegoOrderStatus): number {
  const i = PASOS.findIndex((p) => p.estado === estado)
  if (i >= 0) return i + 1
  if (estado === 'CREATED') return 0
  if (estado === 'REFUNDED') return PASOS.length
  return 0
}

/** Cómo se llama cada paso de la historia del pedido (la bitácora guarda la acción en crudo). */
export const ETIQUETA_EVENTO: Record<string, string> = {
  ORDER_CREATED: 'Pedido creado',
  ORDER_ACCEPTED: 'Aceptado por la empresa',
  ORDER_ADJUSTED: 'Monto ajustado',
  ORDER_READY: 'Marcado listo (QR emitido)',
  ORDER_CONFIRMED: 'El cliente confirmó el monto',
  ORDER_COMPLETED: 'Completado (QR escaneado)',
  ORDER_CANCELLED: 'Cancelado',
  ORDER_REFUNDED: 'Reembolsado',
  ORDER_PAYMENT_RECORDED: 'Pago registrado',
}
