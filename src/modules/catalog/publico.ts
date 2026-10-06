import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import {
  aDetallePublico,
  aResumenPublico,
  normalizarBusqueda,
  type ItemPublicoDetalle,
  type ItemPublicoResumen,
  ESTADOS_VARIANTE_VISIBLES,
} from './publico-nucleo'

/**
 * COMMERCE CORE · catálogo — LECTURAS PÚBLICAS (F1.3): vitrina de la empresa,
 * detalle de un ítem y descubrimiento entre empresas.
 *
 * TRES CONDICIONES, TODAS A LA VEZ, para que algo se vea:
 *
 *  1. La empresa está publicada, activa y no es demo, Y tiene la capacidad
 *     CATALOGO_UNIFICADO. Apagar la capacidad saca el catálogo de la vitrina
 *     sin borrar nada.
 *  2. El ítem está ACTIVO y declara `availableMarketplace`. Un borrador, uno
 *     pausado o archivado, o uno solo para caja, no se publica.
 *  3. Tiene al menos una variante que se pueda enseñar.
 *
 * El proyecto de salida es `publico-nucleo.ts`: lista blanca de campos.
 */

const EMPRESA_VISIBLE = { isPublished: true, isActive: true, esDemo: false } as const

/** Condición de ítem visible. La capacidad de la empresa se comprueba aparte (no es SQL). */
const ITEM_VISIBLE = {
  status: 'ACTIVE',
  capabilities: { path: ['availableMarketplace'], equals: true },
  variants: { some: { status: { in: [...ESTADOS_VARIANTE_VISIBLES] } } },
} satisfies Prisma.CatalogItemWhereInput

const INCLUIR = {
  company: { select: { slug: true, name: true } },
  variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  images: { orderBy: { position: 'asc' }, select: { path: true } },
} satisfies Prisma.CatalogItemInclude

export const MAX_ITEMS_PUBLICOS = 48

/** ¿Esta empresa publica catálogo? (capacidad, fail-closed). */
export async function empresaPublicaCatalogo(companyId: string): Promise<boolean> {
  return tieneCapacidad(companyId, 'CATALOGO_UNIFICADO')
}

/** Vitrina de UNA empresa. Vacía si no tiene la capacidad. */
export async function catalogoPublicoDeEmpresa(companyId: string, limite = 24): Promise<ItemPublicoResumen[]> {
  try {
    if (!(await empresaPublicaCatalogo(companyId))) return []
    const filas = await sinEmpresa('marketplace: catálogo público de una empresa', (tx) =>
      tx.catalogItem.findMany({
        where: { companyId, company: EMPRESA_VISIBLE, ...ITEM_VISIBLE },
        include: INCLUIR,
        orderBy: [{ position: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }],
        take: Math.min(Math.max(limite, 1), MAX_ITEMS_PUBLICOS),
      })
    )
    return filas.map(aResumenPublico).filter((x): x is ItemPublicoResumen => !!x)
  } catch (e) {
    console.error('[catalogoPublicoDeEmpresa]', e)
    return []
  }
}

/** Detalle por (slug de empresa, slug de ítem). null = no existe o no es público (es lo mismo para quien mira). */
export async function itemCatalogoPublico(companySlug: string, itemSlug: string): Promise<ItemPublicoDetalle | null> {
  if (!companySlug || !itemSlug) return null
  try {
    const fila = await sinEmpresa('marketplace: detalle público de un ítem', (tx) =>
      tx.catalogItem.findFirst({
        where: { slug: itemSlug, company: { slug: companySlug, ...EMPRESA_VISIBLE }, ...ITEM_VISIBLE },
        include: { ...INCLUIR, categories: { select: { category: { select: { name: true, slug: true } } } } },
      })
    )
    if (!fila) return null
    if (!(await empresaPublicaCatalogo(fila.companyId))) return null
    return aDetallePublico(fila)
  } catch (e) {
    console.error('[itemCatalogoPublico]', e)
    return null
  }
}

export interface FiltrosDescubrimiento {
  q?: string
  /** slug de una categoría de la empresa (se compara por slug, entre empresas). */
  categoria?: string
  limite?: number
  pagina?: number
}

/**
 * Descubrimiento entre empresas. Primero se averigua QUÉ empresas publican (la
 * capacidad no es una columna: sale de código), y solo entonces se pide la
 * página, para que paginar no deje huecos ni cuente ítems de empresas que no
 * deben verse.
 */
export async function catalogoPublicoGlobal(f: FiltrosDescubrimiento = {}): Promise<{ items: ItemPublicoResumen[]; hayMas: boolean }> {
  const limite = Math.min(Math.max(f.limite ?? 24, 1), MAX_ITEMS_PUBLICOS)
  const pagina = Math.max(f.pagina ?? 0, 0)
  const q = normalizarBusqueda(f.q)
  const categoria = normalizarBusqueda(f.categoria)
  try {
    const candidatas = await sinEmpresa('marketplace: empresas con catálogo público', (tx) =>
      tx.catalogItem.findMany({
        where: { company: EMPRESA_VISIBLE, ...ITEM_VISIBLE },
        distinct: ['companyId'],
        select: { companyId: true },
      })
    )
    const permitidas: string[] = []
    for (const { companyId } of candidatas) if (await empresaPublicaCatalogo(companyId)) permitidas.push(companyId)
    if (permitidas.length === 0) return { items: [], hayMas: false }

    const filas = await sinEmpresa('marketplace: descubrimiento de catálogo', (tx) =>
      tx.catalogItem.findMany({
        where: {
          companyId: { in: permitidas },
          company: EMPRESA_VISIBLE,
          ...ITEM_VISIBLE,
          ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] } : {}),
          ...(categoria ? { categories: { some: { category: { slug: categoria } } } } : {}),
        },
        include: INCLUIR,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: limite + 1,
        skip: pagina * limite,
      })
    )
    const items = filas.slice(0, limite).map(aResumenPublico).filter((x): x is ItemPublicoResumen => !!x)
    return { items, hayMas: filas.length > limite }
  } catch (e) {
    console.error('[catalogoPublicoGlobal]', e)
    return { items: [], hayMas: false }
  }
}
