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
import { normalizarCapacidades } from './domain'

/**
 * Ruta pública de las ofertas de Membego (el checkout de Supply). El catálogo NO importa de
 * Supply (Commerce Core nunca importa de `supply-v2`): la ruta se repite aquí y una prueba
 * (`tests/catalogo-publico.test.ts`) comprueba que es la misma que la de Supply.
 */
export const RUTA_OFERTAS_MEMBEGO = '/promociones/membego'

/** Variantes que se enseñan: las vendibles y las agotadas. La descontinuada no existe para el público. */
export const ESTADOS_VARIANTE_VISIBLES: readonly CatalogVariantStatus[] = ['ACTIVE', 'OUT_OF_STOCK']

/**
 * Lo ÚNICO que el consumidor sabe del stock. Nunca una cantidad: «Disponible»,
 * «Pocas unidades» (solo si la empresa fijó un umbral de aviso y se cruzó) o
 * «Agotado». Un ítem que no controla inventario está siempre «Disponible».
 */
export type DisponibilidadPublica = 'DISPONIBLE' | 'POCAS_UNIDADES' | 'AGOTADO'

export const ETIQUETA_DISPONIBILIDAD: Record<DisponibilidadPublica, string> = {
  DISPONIBLE: 'Disponible',
  POCAS_UNIDADES: 'Pocas unidades',
  AGOTADO: 'Agotado',
}

export interface VariantePublica {
  id: string
  name: string
  /** Decimal en texto, dos decimales. */
  price: string
  /** Precio «antes», solo si de verdad es mayor que el actual. */
  compareAtPrice: string | null
  attributes: Record<string, string>
  available: boolean
  disponibilidad: DisponibilidadPublica
  /**
   * Sucursales (ids) donde la variante tiene existencias para recoger. `null` =
   * no controla inventario (se puede pedir en cualquier sucursal activa). Son
   * ids, no cantidades: el consumidor elige dónde, no cuántas quedan.
   */
  sucursalesConStock: string[] | null
}

/** De dónde viene el ítem: lo creó la empresa, o lo refleja el puente desde una oferta de Membego (Supply). */
export type OrigenPublico = 'EMPRESA' | 'SUPPLY'

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
  origen: OrigenPublico
  /**
   * Solo `SUPPLY`: el slug de la oferta en Supply V2, que es la ruta de compra
   * (la página arma el enlace; Commerce Core no conoce las rutas de Supply).
   */
  ofertaSlug: string | null
  /** La mejor disponibilidad entre sus variantes visibles (para la tarjeta). */
  disponibilidad: DisponibilidadPublica
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
  /**
   * Existencias por sucursal (Fase 3). Solo importan si el ítem CONTROLA inventario;
   * una sucursal cerrada no cuenta (de ahí no se despacha).
   */
  inventoryLevels?: { onHand: number; reserved: number; lowStockThreshold?: number; locationId?: string; location: { activa: boolean } }[]
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
  source: 'MERCHANT' | 'SUPPLY'
  /** Las capacidades del ítem (solo para saber si controla inventario; no salen al público). */
  capabilities?: unknown
  /** Solo `SUPPLY`: la oferta de origen, EN VIVO (no la copia sincronizada). */
  supplyOffer?: { slug: string; status: string } | null
}

function atributosTexto(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

/**
 * `agotadaEnOrigen`: la oferta de Supply de la que viene el ítem se agotó. El
 * estado de la variante es una COPIA sincronizada y puede ir por detrás; la
 * oferta en vivo manda.
 */
export function variantesPublicas(filas: readonly FilaVariante[], agotadaEnOrigen = false, controlaInventario = false): VariantePublica[] {
  return filas
    .filter((v) => ESTADOS_VARIANTE_VISIBLES.includes(v.status))
    .map((v) => {
      const price = v.price.toFixed(2)
      const antes = v.compareAtPrice && v.compareAtPrice.toNumber() > v.price.toNumber() ? v.compareAtPrice.toFixed(2) : null
      const available = v.status === 'ACTIVE' && !agotadaEnOrigen && !sinExistencias(v, controlaInventario)
      return {
        id: v.id,
        name: v.name,
        price,
        compareAtPrice: antes,
        attributes: atributosTexto(v.attributes),
        available,
        disponibilidad: !available ? 'AGOTADO' : pocasUnidades(v, controlaInventario) ? 'POCAS_UNIDADES' : 'DISPONIBLE',
        sucursalesConStock: controlaInventario ? sucursalesConStock(v) : null,
      }
    })
}

const nivelesActivos = (v: FilaVariante) => (v.inventoryLevels ?? []).filter((n) => n.location.activa)

/**
 * «Pocas unidades» SOLO si la empresa configuró un umbral de aviso en alguna
 * sucursal y lo disponible total cayó a ese umbral o menos. Sin umbral, el
 * consumidor ve «Disponible» hasta que se acaba: la empresa decide si quiere
 * ese mensaje (configurando el umbral), no el sistema.
 */
function pocasUnidades(v: FilaVariante, controlaInventario: boolean): boolean {
  if (!controlaInventario) return false
  const niveles = nivelesActivos(v)
  const umbral = Math.max(0, ...niveles.map((n) => n.lowStockThreshold ?? 0))
  if (umbral <= 0) return false
  const disponible = niveles.reduce((t, n) => t + Math.max(0, n.onHand - n.reserved), 0)
  return disponible <= umbral
}

function sucursalesConStock(v: FilaVariante): string[] {
  return nivelesActivos(v)
    .filter((n) => n.onHand - n.reserved > 0 && typeof n.locationId === 'string')
    .map((n) => n.locationId as string)
}

/** La mejor disponibilidad del conjunto: con una «Disponible» basta; si todas agotadas, «Agotado». */
export function disponibilidadDelItem(vs: readonly VariantePublica[]): DisponibilidadPublica {
  if (vs.some((v) => v.disponibilidad === 'DISPONIBLE')) return 'DISPONIBLE'
  if (vs.some((v) => v.disponibilidad === 'POCAS_UNIDADES')) return 'POCAS_UNIDADES'
  return 'AGOTADO'
}

/**
 * Lo que se puede vender de una variante en las sucursales abiertas: existencia
 * menos lo apartado. Un producto que controla inventario y no tiene nada
 * disponible se enseña como agotado (el público no ve cantidades, solo eso).
 */
function sinExistencias(v: FilaVariante, controlaInventario: boolean): boolean {
  if (!controlaInventario) return false
  const disponible = (v.inventoryLevels ?? []).filter((n) => n.location.activa).reduce((t, n) => t + Math.max(0, n.onHand - n.reserved), 0)
  return disponible <= 0
}

const controlaInventario = (f: FilaItem): boolean => f.source === 'MERCHANT' && f.capabilities !== undefined && normalizarCapacidades(f.type, f.capabilities).trackInventory

const agotadaEnOrigen = (f: FilaItem): boolean => f.source === 'SUPPLY' && f.supplyOffer?.status === 'SOLD_OUT'

/** Precio «desde»: el menor entre las disponibles; si ninguna lo está, el menor de las visibles. */
export function precioDesde(vs: readonly VariantePublica[]): string | null {
  const fuente = vs.some((v) => v.available) ? vs.filter((v) => v.available) : vs
  if (fuente.length === 0) return null
  return fuente.reduce((m, v) => (Number(v.price) < Number(m) ? v.price : m), fuente[0].price)
}

export function aResumenPublico(f: FilaItem): ItemPublicoResumen | null {
  const vs = variantesPublicas(f.variants, agotadaEnOrigen(f), controlaInventario(f))
  if (vs.length === 0) return null // sin nada que mostrar, el ítem no existe para el público
  // Un ítem puente sin su oferta no existe para el público (no hay a dónde mandar la compra).
  if (f.source === 'SUPPLY' && !f.supplyOffer) return null
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
    origen: f.source === 'SUPPLY' ? 'SUPPLY' : 'EMPRESA',
    ofertaSlug: f.source === 'SUPPLY' ? (f.supplyOffer?.slug ?? null) : null,
    disponibilidad: disponibilidadDelItem(vs),
  }
}

export function aDetallePublico(f: FilaItem): ItemPublicoDetalle | null {
  const resumen = aResumenPublico(f)
  if (!resumen) return null
  return {
    ...resumen,
    description: f.description,
    images: f.images.map((i) => urlPublicaCatalogo(i.path)).filter((u): u is string => !!u),
    variants: variantesPublicas(f.variants, agotadaEnOrigen(f), controlaInventario(f)),
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
