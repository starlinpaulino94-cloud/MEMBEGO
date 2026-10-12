import type { DealClaimStatus, DealDiscountType, DealStatus } from '@prisma/client'

/**
 * COMMERCE CORE · ofertas — textos y formato para la interfaz. Puro y sin dependencias de
 * servidor: lo importan también los componentes de cliente (no pueden arrastrar Prisma).
 */

export type VarianteBadge = 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline'

export const BADGE_ESTADO_OFERTA: Record<DealStatus, VarianteBadge> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  PAUSED: 'warning',
  BUDGET_EXHAUSTED: 'warning',
  COMPLETED: 'secondary',
  ARCHIVED: 'outline',
}

export const BADGE_ESTADO_RECLAMO: Record<DealClaimStatus, VarianteBadge> = {
  CLAIMED: 'default',
  REDEEMED: 'success',
  EXPIRED: 'secondary',
  CANCELLED: 'destructive',
  REFUNDED: 'secondary',
}

export const ETIQUETA_TIPO_DESCUENTO: Record<DealDiscountType, string> = {
  PERCENT: 'Porcentaje (%)',
  AMOUNT_OFF: 'Monto que se rebaja',
  FIXED_PRICE: 'Precio fijo de la oferta',
}

export const AYUDA_TIPO_DESCUENTO: Record<DealDiscountType, string> = {
  PERCENT: 'Por ejemplo 20 = 20 % menos que el precio de lista.',
  AMOUNT_OFF: 'Lo que se resta del precio de lista (por ejemplo 100).',
  FIXED_PRICE: 'El precio final de la oferta; 0 = gratis.',
}

/** Qué le pasa a la oferta, dicho para la empresa. */
export const EXPLICACION_ESTADO_OFERTA: Record<DealStatus, string> = {
  DRAFT: 'Todavía no la ven los clientes. Revísala y publícala.',
  ACTIVE: 'Los clientes la pueden obtener ahora.',
  PAUSED: 'Nadie nuevo la obtiene. Los cupones que ya se reclamaron siguen valiendo.',
  BUDGET_EXHAUSTED: 'El presupuesto ya no alcanza para otro canje. Amplíalo para reabrirla.',
  COMPLETED: 'Terminó su vigencia. Los cupones ya reclamados valen hasta su vencimiento.',
  ARCHIVED: 'Archivada: ya no se muestra ni se reclama.',
}
