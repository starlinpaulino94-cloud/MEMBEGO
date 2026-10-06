/**
 * PLATAFORMA · catálogo unificado — proyección hacia la API v1 (F1.3). Pura.
 *
 * Lista blanca de campos, igual que el resto de DTOs de la API. Una cosa que
 * NO se parece a las demás: el COSTO. Es el margen de la empresa; lo ve su
 * propia clave de API (es su dato) pero **nunca** un satélite, que atiende a
 * muchas empresas y no tiene por qué conocer el costo de ninguna.
 */

import type { CatalogItemStatus, CatalogItemType, CatalogVariantStatus } from '@prisma/client'
import { urlPublicaCatalogo } from '@/modules/catalog/formato'

type Dec = { toFixed(n: number): string }

export interface CatalogVariantDTO {
  id: string
  itemId: string
  name: string
  sku: string
  barcode: string | null
  price: string
  compareAtPrice: string | null
  /** Solo para la clave de la propia empresa. */
  cost?: string | null
  attributes: Record<string, string>
  isDefault: boolean
  status: CatalogVariantStatus
}

export interface CatalogItemDTO {
  id: string
  name: string
  slug: string
  description: string | null
  type: CatalogItemType
  status: CatalogItemStatus
  currency: string
  source: 'MERCHANT' | 'SUPPLY'
  capabilities: Record<string, boolean>
  imageUrls: string[]
  publishedAt: string | null
  createdAt: string
  variants: CatalogVariantDTO[]
}

interface FilaVariante {
  id: string
  catalogItemId: string
  name: string
  sku: string
  barcode: string | null
  price: Dec
  cost: Dec | null
  compareAtPrice: Dec | null
  attributes: unknown
  isDefault: boolean
  status: CatalogVariantStatus
}

function objetoDeTexto(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
}

export function catalogVariantDTO(v: FilaVariante, incluirCosto: boolean): CatalogVariantDTO {
  return {
    id: v.id,
    itemId: v.catalogItemId,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    price: v.price.toFixed(2),
    compareAtPrice: v.compareAtPrice ? v.compareAtPrice.toFixed(2) : null,
    ...(incluirCosto ? { cost: v.cost ? v.cost.toFixed(2) : null } : {}),
    attributes: objetoDeTexto(v.attributes),
    isDefault: v.isDefault,
    status: v.status,
  }
}

export function catalogItemDTO(
  i: {
    id: string
    name: string
    slug: string
    description: string | null
    type: CatalogItemType
    status: CatalogItemStatus
    currency: string
    source: 'MERCHANT' | 'SUPPLY'
    capabilities: unknown
    publishedAt: Date | null
    createdAt: Date
    variants: FilaVariante[]
    images: { path: string }[]
  },
  incluirCosto: boolean
): CatalogItemDTO {
  const caps = i.capabilities && typeof i.capabilities === 'object' && !Array.isArray(i.capabilities) ? (i.capabilities as Record<string, unknown>) : {}
  return {
    id: i.id,
    name: i.name,
    slug: i.slug,
    description: i.description,
    type: i.type,
    status: i.status,
    currency: i.currency,
    source: i.source,
    capabilities: Object.fromEntries(Object.entries(caps).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>,
    imageUrls: i.images.map((x) => urlPublicaCatalogo(x.path)).filter((u): u is string => !!u),
    publishedAt: i.publishedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    variants: i.variants.map((v) => catalogVariantDTO(v, incluirCosto)),
  }
}
