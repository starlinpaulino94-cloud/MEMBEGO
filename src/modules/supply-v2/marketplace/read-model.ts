import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { motivoNoComprable } from '../core/estados'
import { calcularPrecioOferta } from '../core/precios'
import { SIN_TOPE, unidadesLibres, unidadesLibresComision } from '../offers/domain'
import { RUTA_OFERTAS_PUBLICAS } from '../core/catalogo'
import { presentacionComercial, type PresentacionComercial } from '@/modules/comercio/modo-comercial'

/**
 * MEMBEGO SUPPLY · READ MODEL PÚBLICO del marketplace (§17–§19, §53).
 *
 * Es el ÚNICO camino por el que una oferta de Supply llega al marketplace
 * y al cliente. Devuelve un DTO cerrado: precio público, precio Membego,
 * ahorro, proveedor, vigencia y si hay unidades. NUNCA costos, lotes,
 * asignaciones ni ledger. El marketplace no importa nada más de Supply.
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
  /** Slice 5: oferta sin tope (comisión UNLIMITED): `remaining` no aplica. */
  unlimited: boolean
  perCustomerLimit: number
  href: string
  /** Quién vende (Membego), si es regalo/patrocinio y dónde se canjea (§12–§19), ya resuelto. */
  comercial: PresentacionComercial
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
  sourceType: true,
  priceMode: true,
  availabilityMode: true,
  availabilityQuantity: true,
  // El punto de canje: el proveedor y, si su empresa tiene vitrina, su slug y sucursales (§15, §49).
  supplier: { select: { commercialName: true, company: { select: { slug: true, name: true, isPublished: true, isActive: true, esDemo: true, sucursales: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } } } } } },
  // Un beneficio ACTIVO financiado por Membego sobre la oferta = patrocinio (§18). Solo se cuenta.
  benefits: { where: { status: 'ACTIVE', scope: 'SPECIFIC_OFFER', funding: { in: ['MEMBEGO', 'SHARED'] } }, select: { id: true } },
  catalogItem: { select: { name: true } },
  allocation: { select: { allocatedQuantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true } },
  // Solo para contar disponibilidad en comisión; NUNCA sale al DTO (ni comisión, ni neto, ni acuerdo).
  commissionReservations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { quantity: true } },
} satisfies Prisma.SupplyV2OfferSelect

type Fila = Prisma.SupplyV2OfferGetPayload<{ select: typeof SELECT }>

function aDto(o: Fila, ahora: Date): MarketplaceSupplyOffer {
  const libresComision = o.sourceType === 'COMMISSION' ? unidadesLibresComision(o, o.commissionReservations.reduce((t, r) => t + r.quantity, 0)) : 0
  const unlimited = o.sourceType === 'COMMISSION' && libresComision === null
  const libres = o.sourceType === 'COMMISSION' ? (libresComision ?? SIN_TOPE) : o.allocation ? unidadesLibres(o.allocation) : 0
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
    remaining: unlimited ? 0 : libres,
    unlimited,
    perCustomerLimit: o.perCustomerLimit,
    href: `${RUTA_OFERTAS_PUBLICAS}/${o.slug}`,
    comercial: comercialDeOferta(o, precio.salePrice.toFixed(2)),
  }
}

/** La empresa del proveedor tiene vitrina: Merchant publicado y activo (no demo). */
function conVitrina(c: { isPublished: boolean; isActive: boolean; esDemo: boolean } | null): boolean {
  return !!c && c.isPublished && c.isActive && !c.esDemo
}

function comercialDeOferta(o: Fila, salePrice: string): PresentacionComercial {
  const empresa = o.supplier.company
  return presentacionComercial({
    origen: 'SUPPLY',
    // La «empresa» dueña del listado es Membego (la casa); no se enseña como vendedora de nada.
    empresa: { nombre: 'Membego', slug: '' },
    supply: {
      priceMode: o.priceMode,
      sourceType: o.sourceType,
      salePrice,
      subsidioMembego: o.benefits.length > 0,
      proveedor: { nombre: o.supplier.commercialName, slug: conVitrina(empresa) ? empresa!.slug : null, sucursales: empresa?.sucursales ?? [] },
    },
  })
}

/** Ofertas comprables HOY (§18): activas, vigentes y con unidades. */
export async function ofertasPublicas(limite = 24): Promise<MarketplaceSupplyOffer[]> {
  const ahora = new Date()
  const filas = await sinEmpresa('Supply: ofertas activas para el marketplace', (tx) =>
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
  const f = await sinEmpresa('Supply: ficha pública de una oferta', (tx) =>
    tx.supplyV2Offer.findUnique({ where: { slug }, select: SELECT })
  )
  if (!f || f.status === 'DRAFT' || f.status === 'CANCELLED') return null
  return aDto(f, ahora)
}

/**
 * Una oferta en su forma pública MÁS su estado crudo, dentro de la transacción
 * de quien llama. La usa el puente Supply → Catálogo (Fase 2.5): necesita lo
 * mismo que ve el público (precios ya calculados, unidades libres, si se puede
 * comprar) sin duplicar esas reglas, y necesita leerlo bajo SU transacción
 * —una lectura aparte no vería lo que esa transacción acaba de escribir—.
 * Devuelve el mismo DTO cerrado: nunca costos, lotes ni ledger.
 */
export async function ofertaParaPuenteEnTx(tx: Tx, offerId: string): Promise<{ oferta: MarketplaceSupplyOffer; status: string } | null> {
  const f = await tx.supplyV2Offer.findUnique({ where: { id: offerId }, select: SELECT })
  if (!f) return null
  return { oferta: aDto(f, new Date()), status: f.status }
}
