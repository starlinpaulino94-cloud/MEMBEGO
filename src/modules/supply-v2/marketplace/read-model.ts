import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { motivoNoComprable } from '../core/estados'
import { calcularPrecioOferta } from '../core/precios'
import { unidadesLibres } from '../offers/domain'
import { RUTA_OFERTAS_PUBLICAS } from '../core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · READ MODEL PÚBLICO del marketplace (§17–§19, §53).
 *
 * Es el ÚNICO camino por el que una oferta de Supply 2.0 llega al marketplace
 * y al cliente. Devuelve un DTO cerrado: precio público, precio Membego,
 * ahorro, proveedor, vigencia y si hay unidades. NUNCA costos, lotes,
 * asignaciones ni ledger. El marketplace no importa nada más de Supply 2.0.
 */

export interface MarketplaceSupplyOffer {
  id: string
  slug: string
  code: string
  title: string
  description: string | null
  image: string | null
  supplier: string
  product: string
  publicPrice: string
  salePrice: string
  savings: string
  discountPercentage: number
  currency: string
  startsAt: string
  endsAt: string | null
  /** true si hoy se puede comprar. */
  available: boolean
  /** Cuántas quedan; se muestra solo cuando son pocas. */
  remaining: number
  perCustomerLimit: number
  href: string
}

const SELECT = {
  id: true,
  slug: true,
  code: true,
  title: true,
  description: true,
  imagePath: true,
  status: true,
  publicPrice: true,
  salePrice: true,
  currency: true,
  startsAt: true,
  endsAt: true,
  perCustomerLimit: true,
  supplier: { select: { commercialName: true } },
  catalogItem: { select: { name: true } },
  allocation: { select: { allocatedQuantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true } },
} as const

type Fila = {
  id: string
  slug: string
  code: string
  title: string
  description: string | null
  imagePath: string | null
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'SOLD_OUT' | 'ENDED' | 'CANCELLED'
  publicPrice: { toString(): string }
  salePrice: { toString(): string }
  currency: string
  startsAt: Date
  endsAt: Date | null
  perCustomerLimit: number
  supplier: { commercialName: string }
  catalogItem: { name: string }
  allocation: { allocatedQuantity: number; reservedQuantity: number; issuedQuantity: number; releasedQuantity: number } | null
}

function aDto(o: Fila, ahora: Date): MarketplaceSupplyOffer {
  const libres = o.allocation ? unidadesLibres(o.allocation) : 0
  const precio = calcularPrecioOferta(o.publicPrice.toString(), o.salePrice.toString())
  return {
    id: o.id,
    slug: o.slug,
    code: o.code,
    title: o.title,
    description: o.description,
    image: o.imagePath,
    supplier: o.supplier.commercialName,
    product: o.catalogItem.name,
    publicPrice: precio.publicPrice.toFixed(2),
    salePrice: precio.salePrice.toFixed(2),
    savings: precio.discount.toFixed(2),
    discountPercentage: precio.discountPercentage,
    currency: o.currency,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt?.toISOString() ?? null,
    available: motivoNoComprable(o, libres, ahora) === null,
    remaining: libres,
    perCustomerLimit: o.perCustomerLimit,
    href: `${RUTA_OFERTAS_PUBLICAS}/${o.slug}`,
  }
}

/** Ofertas comprables HOY (§18): activas, vigentes y con unidades. */
export async function ofertasPublicas(limite = 24): Promise<MarketplaceSupplyOffer[]> {
  const ahora = new Date()
  const filas = await sinEmpresa('Supply 2.0: ofertas activas para el marketplace', (tx) =>
    tx.supplyV2Offer.findMany({
      where: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
      orderBy: { publishedAt: 'desc' },
      take: limite * 2,
      select: SELECT,
    })
  )
  return filas.map((f) => aDto(f, ahora)).filter((o) => o.available).slice(0, limite)
}

/** Una oferta por su slug, se pueda comprar o no (la ficha explica por qué). */
export async function ofertaPublicaPorSlug(slug: string): Promise<MarketplaceSupplyOffer | null> {
  const ahora = new Date()
  const f = await sinEmpresa('Supply 2.0: ficha pública de una oferta', (tx) =>
    tx.supplyV2Offer.findUnique({ where: { slug }, select: SELECT })
  )
  if (!f || f.status === 'DRAFT' || f.status === 'CANCELLED') return null
  return aDto(f, ahora)
}
