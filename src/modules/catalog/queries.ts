import type { CatalogItemStatus, CatalogItemType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { fallo } from './errores'

/**
 * COMMERCE CORE · catálogo — lecturas. Siempre dentro de `conEmpresa` y siempre
 * filtradas por `companyId`, igual que el servicio.
 */

export interface FiltrosCatalogo {
  estado?: CatalogItemStatus
  tipo?: CatalogItemType
  /** Texto libre sobre nombre y descripción. */
  q?: string
  take?: number
  skip?: number
}

export interface ResumenItem {
  id: string
  name: string
  slug: string
  type: CatalogItemType
  status: CatalogItemStatus
  currency: string
  variantes: number
  /** Precio más bajo entre las variantes ACTIVAS (o entre todas si ninguna lo está). */
  desde: string | null
  /** La interfaz muestra el selector de variantes solo si esto es true. */
  tieneVariantes: boolean
}

const MAX_PAGINA = 100

export async function listarItemsEnTx(tx: Tx, companyId: string, f: FiltrosCatalogo = {}): Promise<ResumenItem[]> {
  const q = f.q?.trim()
  const items = await tx.catalogItem.findMany({
    where: {
      companyId,
      ...(f.estado ? { status: f.estado } : {}),
      ...(f.tipo ? { type: f.tipo } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }
        : {}),
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(f.take ?? 50, 1), MAX_PAGINA),
    skip: Math.max(f.skip ?? 0, 0),
    select: {
      id: true, name: true, slug: true, type: true, status: true, currency: true,
      variants: { select: { price: true, status: true } },
    },
  })
  return items.map((i) => {
    const activas = i.variants.filter((v) => v.status === 'ACTIVE')
    const fuente = activas.length > 0 ? activas : i.variants
    const minimo = fuente.reduce<number | null>((m, v) => (m == null || v.price.toNumber() < m ? v.price.toNumber() : m), null)
    return {
      id: i.id, name: i.name, slug: i.slug, type: i.type, status: i.status, currency: i.currency,
      variantes: i.variants.length,
      desde: minimo == null ? null : minimo.toFixed(2),
      tieneVariantes: i.variants.length > 1,
    }
  })
}

export async function obtenerItemEnTx(tx: Tx, companyId: string, itemId: string) {
  const item = await tx.catalogItem.findFirst({
    where: { id: itemId, companyId },
    include: {
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      images: { orderBy: { position: 'asc' } },
      categories: { select: { categoryId: true } },
    },
  })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  return {
    ...item,
    tieneVariantes: item.variants.length > 1,
    variants: item.variants.map((v) => ({
      ...v,
      price: v.price.toFixed(2),
      cost: v.cost?.toFixed(2) ?? null,
      compareAtPrice: v.compareAtPrice?.toFixed(2) ?? null,
    })),
  }
}
