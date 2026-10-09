import type { CatalogItemStatus, CatalogItemType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { fallo } from './errores'
import { normalizarCapacidades } from './domain'

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
  /** Ruta de la portada en el bucket (la URL se deriva en la pantalla), o null. */
  imagenPath: string | null
  /** Visible en el marketplace según «Cómo se comporta» (y publicado). */
  enMarketplace: boolean
  /** «Controla inventario» según «Cómo se comporta». */
  controlaInventario: boolean
  /**
   * Niveles crudos de inventario en sucursales activas (todas las variantes).
   * El catálogo NO interpreta estos números: el resumen (disponible, estado)
   * lo arma `modules/comercio/stock.ts`.
   */
  niveles: { onHand: number; reserved: number; lowStockThreshold: number }[]
}

export interface PaginaItems {
  items: ResumenItem[]
  total: number
  pagina: number
  paginas: number
}

const MAX_PAGINA = 100
export const ITEMS_POR_PAGINA = 30

/** La lista paginada del panel: la misma lectura, con el total para pintar la paginación. */
export async function paginarItemsEnTx(tx: Tx, companyId: string, f: Omit<FiltrosCatalogo, 'take' | 'skip'> & { pagina?: number } = {}): Promise<PaginaItems> {
  const pagina = Math.max(1, Math.trunc(f.pagina ?? 1) || 1)
  const q = f.q?.trim()
  const total = await tx.catalogItem.count({ where: whereDeFiltros(companyId, { ...f, q }) })
  const paginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA))
  const actual = Math.min(pagina, paginas)
  const items = await listarItemsEnTx(tx, companyId, { ...f, q, take: ITEMS_POR_PAGINA, skip: (actual - 1) * ITEMS_POR_PAGINA })
  return { items, total, pagina: actual, paginas }
}

function whereDeFiltros(companyId: string, f: FiltrosCatalogo) {
  const q = f.q?.trim()
  return {
    companyId,
    ...(f.estado ? { status: f.estado } : {}),
    ...(f.tipo ? { type: f.tipo } : {}),
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  }
}

export async function listarItemsEnTx(tx: Tx, companyId: string, f: FiltrosCatalogo = {}): Promise<ResumenItem[]> {
  const items = await tx.catalogItem.findMany({
    where: whereDeFiltros(companyId, f),
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(f.take ?? 50, 1), MAX_PAGINA),
    skip: Math.max(f.skip ?? 0, 0),
    select: {
      id: true, name: true, slug: true, type: true, status: true, currency: true, capabilities: true,
      images: { orderBy: { position: 'asc' as const }, take: 1, select: { path: true } },
      variants: {
        select: {
          price: true,
          status: true,
          inventoryLevels: { where: { location: { activa: true } }, select: { onHand: true, reserved: true, lowStockThreshold: true } },
        },
      },
    },
  })
  return items.map((i) => {
    const activas = i.variants.filter((v) => v.status === 'ACTIVE')
    const fuente = activas.length > 0 ? activas : i.variants
    const minimo = fuente.reduce<number | null>((m, v) => (m == null || v.price.toNumber() < m ? v.price.toNumber() : m), null)
    const caps = normalizarCapacidades(i.type, i.capabilities)
    return {
      id: i.id, name: i.name, slug: i.slug, type: i.type, status: i.status, currency: i.currency,
      variantes: i.variants.length,
      desde: minimo == null ? null : minimo.toFixed(2),
      tieneVariantes: i.variants.length > 1,
      imagenPath: i.images[0]?.path ?? null,
      enMarketplace: caps.availableMarketplace,
      controlaInventario: caps.trackInventory,
      niveles: caps.trackInventory ? i.variants.flatMap((v) => v.inventoryLevels) : [],
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
