/**
 * COMMERCE CORE · catálogo — LO QUE VE EL PÚBLICO (F1.3). Puro: sin Prisma.
 *
 * Una sola frontera entre lo interno y lo público. Lo público es una
 * PROYECCIÓN con lista blanca de campos: el costo, el SKU, el código de barras,
 * las capacidades internas y las rutas de Storage NO salen nunca por aquí. Si
 * mañana alguien añade un campo a la tabla, no aparece en la vitrina ni en la
 * API hasta que se escriba aquí a propósito.
 */

import type { CatalogItemType, CatalogVariantStatus } from '@prisma/client'
import { urlPublicaCatalogo } from './formato'

/** Variantes que se enseñan: las vendibles y las agotadas. La descontinuada no existe para el público. */
export const ESTADOS_VARIANTE_VISIBLES: readonly CatalogVariantStatus[] = ['ACTIVE', 'OUT_OF_STOCK']

export interface VariantePublica {
  id: string
  name: string
  /** Decimal en texto, dos decimales. */
  price: string
  /** Precio «antes», solo si de verdad es mayor que el actual. */
  compareAtPrice: string | null
  attributes: Record<string, string>
  available: boolean
}

export interface ItemPublicoResumen {
  id: string
  slug: string
  name: string
  type: CatalogItemType
  currency: string
  imageUrl: string | null
  /** Precio más bajo entre las variantes disponibles (o entre las visibles si ninguna lo está). */
  priceFrom: string | null
  /** true = hay más de una variante visible: «desde». */
  hasVariants: boolean
  company: { slug: string; name: string }
}

export interface ItemPublicoDetalle extends ItemPublicoResumen {
  description: string | null
  images: string[]
  variants: VariantePublica[]
  categories: { name: string; slug: string }[]
}

interface FilaVariante {
  id: string
  name: string
  price: { toFixed(n: number): string; toNumber(): number }
  compareAtPrice: { toFixed(n: number): string; toNumber(): number } | null
  attributes: unknown
  status: CatalogVariantStatus
}

interface FilaItem {
  id: string
  slug: string
  name: string
  description: string | null
  type: CatalogItemType
  currency: string
  company: { slug: string; name: string }
  variants: FilaVariante[]
  images: { path: string }[]
  categories?: { category: { name: string; slug: string } }[]
}

function atributosTexto(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

export function variantesPublicas(filas: readonly FilaVariante[]): VariantePublica[] {
  return filas
    .filter((v) => ESTADOS_VARIANTE_VISIBLES.includes(v.status))
    .map((v) => {
      const price = v.price.toFixed(2)
      const antes = v.compareAtPrice && v.compareAtPrice.toNumber() > v.price.toNumber() ? v.compareAtPrice.toFixed(2) : null
      return { id: v.id, name: v.name, price, compareAtPrice: antes, attributes: atributosTexto(v.attributes), available: v.status === 'ACTIVE' }
    })
}

/** Precio «desde»: el menor entre las disponibles; si ninguna lo está, el menor de las visibles. */
export function precioDesde(vs: readonly VariantePublica[]): string | null {
  const fuente = vs.some((v) => v.available) ? vs.filter((v) => v.available) : vs
  if (fuente.length === 0) return null
  return fuente.reduce((m, v) => (Number(v.price) < Number(m) ? v.price : m), fuente[0].price)
}

export function aResumenPublico(f: FilaItem): ItemPublicoResumen | null {
  const vs = variantesPublicas(f.variants)
  if (vs.length === 0) return null // sin nada que mostrar, el ítem no existe para el público
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    type: f.type,
    currency: f.currency,
    imageUrl: f.images[0] ? urlPublicaCatalogo(f.images[0].path) : null,
    priceFrom: precioDesde(vs),
    hasVariants: vs.length > 1,
    company: { slug: f.company.slug, name: f.company.name },
  }
}

export function aDetallePublico(f: FilaItem): ItemPublicoDetalle | null {
  const resumen = aResumenPublico(f)
  if (!resumen) return null
  return {
    ...resumen,
    description: f.description,
    images: f.images.map((i) => urlPublicaCatalogo(i.path)).filter((u): u is string => !!u),
    variants: variantesPublicas(f.variants),
    categories: (f.categories ?? []).map((c) => ({ name: c.category.name, slug: c.category.slug })),
  }
}

/** Texto de búsqueda de la URL: recortado y sin nada que no sea texto. */
export function normalizarBusqueda(q: unknown): string | undefined {
  if (typeof q !== 'string') return undefined
  const t = q.trim().slice(0, 80)
  return t || undefined
}

/** Página (0-based) de la URL: entero acotado. */
export function normalizarPagina(p: unknown, max = 200): number {
  const n = typeof p === 'string' ? Number.parseInt(p, 10) : Number.NaN
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
}
