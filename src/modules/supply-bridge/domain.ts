import type { CatalogItemStatus, CatalogVariantStatus } from '@prisma/client'

/**
 * SUPPLY BRIDGE · el mapeo oferta → ítem del catálogo (Fase 2.5). PURO.
 *
 * Supply V2 es el MASTER. La unidad que se vende es la OFERTA (un producto de
 * proveedor tiene muchas a lo largo del tiempo, cada una con su precio y su
 * vigencia), así que cada oferta publicada se refleja en UN ítem del catálogo
 * de la empresa de la casa, con UNA variante. Aquí solo se decide QUÉ debe
 * decir ese ítem; escribirlo es de `service.ts`.
 */

export interface OfertaOrigen {
  slug: string
  code: string
  title: string
  description: string | null
  supplier: string
  currency: string
  /** Decimal en texto (dos decimales), como lo entrega el read model de Supply. */
  publicPrice: string
  salePrice: string
  /** Estado crudo de la oferta en Supply V2. */
  status: string
  /** Si hoy se puede comprar (vigencia y unidades, ya calculado por Supply). */
  available: boolean
  remaining: number
  unlimited: boolean
}

export interface VarianteDeseada {
  name: string
  /** El código de la oferta (`MBG-OF-2026-000001`): único en la plataforma. */
  sku: string
  price: string
  /** Solo si el precio de lista es MAYOR que el de venta (la base lo exige). */
  compareAtPrice: string | null
  status: CatalogVariantStatus
}

export interface ItemDeseado {
  name: string
  slug: string
  description: string | null
  currency: string
  status: CatalogItemStatus
  variant: VarianteDeseada
}

/** Qué hace el ítem puente: se canjea por un voucher, no se prepara ni se reserva ni pasa por caja. */
export const CAPACIDADES_PUENTE = {
  trackInventory: false,
  requiresBooking: false,
  requiresRedemption: true,
  requiresPreparation: false,
  availableMarketplace: true,
  availablePOS: false,
} as const

/**
 * Estado del ítem según el de la oferta.
 *
 *   ACTIVE, SOLD_OUT  → ACTIVE   (la agotada se enseña como agotada, no desaparece)
 *   SCHEDULED, PAUSED → PAUSED   (todavía no, o por ahora no)
 *   ENDED, CANCELLED  → ARCHIVED
 *   DRAFT             → sin ítem (un borrador no existe fuera de Supply)
 *
 * El público NO se fía de este estado para las fechas: lo cruza con la oferta
 * en vivo (ver `catalog/publico.ts`), porque entre un cambio y su sincronización
 * puede pasar un rato.
 */
export function estadoDeItem(estadoOferta: string): CatalogItemStatus | null {
  switch (estadoOferta) {
    case 'ACTIVE':
    case 'SOLD_OUT':
      return 'ACTIVE'
    case 'SCHEDULED':
    case 'PAUSED':
      return 'PAUSED'
    case 'ENDED':
    case 'CANCELLED':
      return 'ARCHIVED'
    default:
      return null
  }
}

export function estadoDeVariante(o: Pick<OfertaOrigen, 'status' | 'remaining' | 'unlimited'>): CatalogVariantStatus {
  if (o.status === 'SOLD_OUT') return 'OUT_OF_STOCK'
  if (o.status === 'ACTIVE' && !o.unlimited && o.remaining <= 0) return 'OUT_OF_STOCK'
  return 'ACTIVE'
}

export function itemDeseado(o: OfertaOrigen): ItemDeseado | null {
  const status = estadoDeItem(o.status)
  if (status === null) return null
  const lista = Number(o.publicPrice)
  const venta = Number(o.salePrice)
  const description = [o.description?.trim(), o.supplier.trim() ? `Ofrecido por ${o.supplier.trim()}.` : null].filter(Boolean).join('\n\n') || null
  return {
    name: o.title.trim(),
    slug: o.slug,
    description,
    currency: o.currency,
    status,
    variant: {
      name: 'Default',
      sku: o.code,
      price: o.salePrice,
      compareAtPrice: Number.isFinite(lista) && Number.isFinite(venta) && lista > venta ? o.publicPrice : null,
      status: estadoDeVariante(o),
    },
  }
}

export interface ItemActual {
  name: string
  description: string | null
  currency: string
  status: CatalogItemStatus
  variant: { price: string; compareAtPrice: string | null; status: CatalogVariantStatus } | null
}

/** Qué campos del ítem puente se apartan de lo que debería decir (vacío = al día). */
export function diferencias(actual: ItemActual, d: ItemDeseado): string[] {
  const out: string[] = []
  if (actual.name !== d.name) out.push('nombre')
  if ((actual.description ?? null) !== d.description) out.push('descripción')
  if (actual.currency !== d.currency) out.push('moneda')
  if (actual.status !== d.status) out.push('estado')
  if (!actual.variant) out.push('variante')
  else {
    if (actual.variant.price !== d.variant.price) out.push('precio')
    if ((actual.variant.compareAtPrice ?? null) !== d.variant.compareAtPrice) out.push('precio anterior')
    if (actual.variant.status !== d.variant.status) out.push('disponibilidad')
  }
  return out
}
