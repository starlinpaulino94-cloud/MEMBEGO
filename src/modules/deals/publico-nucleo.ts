import type { CatalogItemType, DealDiscountType, Prisma } from '@prisma/client'
import { urlPublicaCatalogo } from '@/modules/catalog/formato'
import { precioDeLaOferta, reclamosPosibles, etiquetaDeDescuento } from './domain'

/**
 * COMMERCE CORE · ofertas — LO QUE VE EL PÚBLICO. Puro: sin Prisma ni Next.
 *
 * Una sola frontera entre lo interno y lo público, con LISTA BLANCA de campos: el presupuesto,
 * la cuota que Membego cobra, lo reservado o gastado, los reclamos de otras personas y quién
 * creó la oferta NO salen nunca por aquí. Si mañana alguien añade un campo a la tabla, no
 * aparece en la vitrina hasta que se escriba aquí a propósito.
 */

export interface FilaDeOfertaPublica {
  id: string
  title: string
  description: string | null
  discountType: DealDiscountType
  discountValue: Prisma.Decimal
  currency: string
  endsAt: Date | null
  voucherDays: number
  newCustomersOnly: boolean
  maxClaims: number
  claimsActive: number
  feePerRedemption: Prisma.Decimal
  budgetTotal: Prisma.Decimal
  budgetReserved: Prisma.Decimal
  budgetSpent: Prisma.Decimal
  variant: {
    id: string
    name: string
    /** La variante automática de un ítem simple: su nombre es de sistema y no se enseña. */
    isDefault?: boolean
    price: Prisma.Decimal
    item: {
      name: string
      slug: string
      type: CatalogItemType
      images: { path: string }[]
      company: { slug: string; name: string; sucursales: { id: string; nombre: string }[] }
    }
  }
}

export interface OfertaPublica {
  id: string
  title: string
  description: string | null
  /** «20 % de descuento», «RD$ 100 menos», «A RD$ 250», «Gratis». */
  etiqueta: string
  currency: string
  precioAntes: string
  precioAhora: string
  ahorro: string
  itemName: string
  itemSlug: string
  variantName: string
  imageUrl: string | null
  empresa: { slug: string; name: string }
  /** Dónde se puede canjear (las sucursales activas de la empresa). */
  sucursales: { id: string; nombre: string }[]
  /** ISO. `null` = sin fecha de fin. */
  endsAt: string | null
  voucherDays: number
  soloClientesNuevos: boolean
  /** Solo cuando quedan pocos (≤ 10): crea urgencia sin enseñar el tamaño de la oferta. */
  quedan: number | null
}

/** Cuántos «quedan» se enseñan como máximo. */
export const UMBRAL_QUEDAN = 10

/**
 * Proyección pública de una oferta, o `null` si no merece enseñarse: sin descuento real o sin
 * nada que reclamar (cupos o presupuesto agotados). La vigencia y el estado los filtra la
 * consulta; esto es la última red.
 */
export function aOfertaPublica(f: FilaDeOfertaPublica): OfertaPublica | null {
  const { precio, ahorro } = precioDeLaOferta(f.variant.price, f.discountType, f.discountValue)
  if (!ahorro.greaterThan(0)) return null
  const posibles = reclamosPosibles(f)
  if (posibles < 1) return null
  // Sin una sucursal activa donde canjearla no hay nada que reclamar.
  if (f.variant.item.company.sucursales.length === 0) return null
  return {
    id: f.id,
    title: f.title,
    description: f.description,
    etiqueta: etiquetaDeDescuento(f.discountType, f.discountValue, f.currency),
    currency: f.currency,
    precioAntes: f.variant.price.toFixed(2),
    precioAhora: precio.toFixed(2),
    ahorro: ahorro.toFixed(2),
    itemName: f.variant.item.name,
    itemSlug: f.variant.item.slug,
    // Un ítem simple no tiene «variante» para el cliente: se nombra como el ítem.
    variantName: f.variant.isDefault ? f.variant.item.name : f.variant.name,
    imageUrl: f.variant.item.images[0] ? urlPublicaCatalogo(f.variant.item.images[0].path) : null,
    empresa: { slug: f.variant.item.company.slug, name: f.variant.item.company.name },
    sucursales: f.variant.item.company.sucursales.map((x) => ({ id: x.id, nombre: x.nombre })),
    endsAt: f.endsAt ? f.endsAt.toISOString() : null,
    voucherDays: f.voucherDays,
    soloClientesNuevos: f.newCustomersOnly,
    quedan: posibles <= UMBRAL_QUEDAN ? posibles : null,
  }
}
