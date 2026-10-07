import type { NextResponse } from 'next/server'
import type { CatalogItemStatus, CatalogItemType } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { TIPOS_ITEM, type DatosItem, type DatosVariante } from '@/modules/catalog/domain'
import { CatalogoError } from '@/modules/catalog/errores'
import { agregarVarianteEnTx, crearItemEnTx } from '@/modules/catalog/service'
import { errorApi } from '@/modules/plataforma/errores'
import { catalogItemDTO, catalogVariantDTO, type CatalogItemDTO, type CatalogVariantDTO } from './catalogo-dto'

/**
 * PLATAFORMA · catálogo unificado — lógica de las rutas `/catalog-items` y
 * `/catalog-variants` (F1.3). Las rutas solo autentican y responden; lo que
 * decide algo vive aquí.
 *
 * REGLAS:
 *  · Sin la capacidad CATALOGO_UNIFICADO, la empresa contesta `NOT_FOUND`: el
 *    recurso no existe para ella. Mismo cierre que el panel y la vitrina.
 *  · Las escrituras ARMAN borradores. Crear deja el ítem en DRAFT y agregar una
 *    variante solo se admite mientras el ítem siga en DRAFT: publicar, pausar y
 *    tocar lo que ya está a la venta se hace en el panel. Una clave filtrada o
 *    una integración con un error no puede cambiar un precio publicado.
 *  · El costo solo sale hacia la clave de la propia empresa.
 */

export const ESTADOS_ITEM: readonly CatalogItemStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']

export async function catalogoHabilitado(companyId: string): Promise<boolean> {
  return tieneCapacidad(companyId, 'CATALOGO_UNIFICADO')
}

/** Respuesta estándar de «esta empresa no usa el catálogo». */
export function catalogoNoHabilitado(requestId: string): NextResponse {
  return errorApi('NOT_FOUND', requestId, {
    message: 'The unified catalog is not enabled for this company.',
    reason: 'catalog_not_enabled',
  })
}

/** Respuesta estándar cuando una clave de SATÉLITE llega a una ruta solo de empresa. */
export function soloClaveDeEmpresa(requestId: string): NextResponse {
  return errorApi('INSUFFICIENT_SCOPE', requestId, {
    requiredScope: 'catalog:manage',
    reason: 'company_api_key_required',
    message: 'Managing the catalog requires a company API key, not a satellite credential.',
  })
}

/** Un `CatalogoError` de dominio → su respuesta de API. Cualquier otro error: relanzar. */
export function respuestaDeError(e: unknown, requestId: string): NextResponse | null {
  if (!(e instanceof CatalogoError)) return null
  if (e.codigo === 'ITEM_NO_ENCONTRADO' || e.codigo === 'VARIANTE_NO_ENCONTRADA') return errorApi('NOT_FOUND', requestId)
  const duplicado = e.codigo === 'SKU_DUPLICADO' || e.codigo === 'BARCODE_DUPLICADO'
  return errorApi('INVALID_REQUEST', requestId, { message: e.message, reason: duplicado ? 'duplicate' : e.codigo.toLowerCase() })
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export function leerFiltros(params: URLSearchParams): { ok: true; status?: CatalogItemStatus; type?: CatalogItemType } | { ok: false; mensaje: string } {
  const status = params.get('status')
  const type = params.get('type')
  if (status && !ESTADOS_ITEM.includes(status as CatalogItemStatus)) return { ok: false, mensaje: `status must be one of ${ESTADOS_ITEM.join(', ')}.` }
  if (type && !TIPOS_ITEM.includes(type as CatalogItemType)) return { ok: false, mensaje: `type must be one of ${TIPOS_ITEM.join(', ')}.` }
  return { ok: true, ...(status ? { status: status as CatalogItemStatus } : {}), ...(type ? { type: type as CatalogItemType } : {}) }
}

const INCLUIR_ITEM = {
  variants: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }] },
  images: { orderBy: { position: 'asc' as const }, select: { path: true } },
}

export async function listarItems(
  companyId: string,
  o: { take: number; cursor: { cursor: { id: string }; skip: number } | Record<string, never>; status?: CatalogItemStatus; type?: CatalogItemType },
  incluirCosto: boolean
): Promise<CatalogItemDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.catalogItem.findMany({
      where: { companyId, ...(o.status ? { status: o.status } : {}), ...(o.type ? { type: o.type } : {}) },
      include: INCLUIR_ITEM,
      // `id` al final: desempate estable para el cursor.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: o.take,
      ...o.cursor,
    })
  )
  return filas.map((f) => catalogItemDTO(f, incluirCosto))
}

export async function obtenerItem(companyId: string, id: string, incluirCosto: boolean): Promise<CatalogItemDTO | null> {
  const fila = await conEmpresa(companyId, (tx) => tx.catalogItem.findFirst({ where: { id, companyId }, include: INCLUIR_ITEM }))
  return fila ? catalogItemDTO(fila, incluirCosto) : null
}

export async function listarVariantes(
  companyId: string,
  o: { take: number; cursor: { cursor: { id: string }; skip: number } | Record<string, never>; itemId?: string },
  incluirCosto: boolean
): Promise<CatalogVariantDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.catalogVariant.findMany({
      where: { companyId, ...(o.itemId ? { catalogItemId: o.itemId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: o.take,
      ...o.cursor,
    })
  )
  return filas.map((f) => catalogVariantDTO(f, incluirCosto))
}

// ── Escrituras (borradores) ──────────────────────────────────────────────────

const ctxAuditoria = { actorId: null, ipAddress: null, userAgent: 'platform-api' } as const

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** El cuerpo de la API → la entrada del dominio. Solo pasan los campos conocidos. */
export function itemDeCuerpo(c: unknown): DatosItem | null {
  if (!esObjeto(c)) return null
  return {
    name: c.name as string,
    description: c.description as string | null | undefined,
    type: c.type as CatalogItemType,
    currency: c.currency as string | null | undefined,
    capabilities: c.capabilities,
    price: c.price as number | string | undefined,
    cost: c.cost as number | string | null | undefined,
    compareAtPrice: c.compareAtPrice as number | string | null | undefined,
    sku: c.sku as string | null | undefined,
    barcode: c.barcode as string | null | undefined,
    variants: Array.isArray(c.variants) ? (c.variants.map(varianteDeCuerpo).filter(Boolean) as DatosVariante[]) : (c.variants as undefined),
  }
}

export function varianteDeCuerpo(c: unknown): DatosVariante | null {
  if (!esObjeto(c)) return null
  return {
    name: c.name as string | null | undefined,
    sku: c.sku as string | null | undefined,
    barcode: c.barcode as string | null | undefined,
    price: c.price as number | string,
    cost: c.cost as number | string | null | undefined,
    compareAtPrice: c.compareAtPrice as number | string | null | undefined,
    attributes: esObjeto(c.attributes) ? c.attributes : undefined,
    status: c.status as DatosVariante['status'],
  }
}

export async function crearItemEnBorrador(companyId: string, entrada: DatosItem): Promise<string> {
  const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, entrada, ctxAuditoria))
  return r.id
}

export async function agregarVarianteABorrador(companyId: string, itemId: string, entrada: DatosVariante): Promise<string> {
  return conEmpresa(companyId, async (tx) => {
    const item = await tx.catalogItem.findFirst({ where: { id: itemId, companyId }, select: { status: true } })
    if (!item) throw new CatalogoError('ITEM_NO_ENCONTRADO', 'The item does not exist.')
    if (item.status !== 'DRAFT') {
      throw new CatalogoError('ITEM_NO_ES_BORRADOR', 'Variants can only be added through the API while the item is a DRAFT. Edit published items in the panel.')
    }
    const v = await agregarVarianteEnTx(tx, companyId, itemId, entrada, ctxAuditoria)
    return v.id
  })
}
