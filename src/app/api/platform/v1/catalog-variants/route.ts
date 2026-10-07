import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { leerPaginacion } from '@/modules/plataforma/paginacion'
import { construirPagina } from '@/modules/plataforma/paginacionNucleo'
import {
  agregarVarianteABorrador,
  catalogoHabilitado,
  catalogoNoHabilitado,
  listarVariantes,
  respuestaDeError,
  soloClaveDeEmpresa,
  varianteDeCuerpo,
} from '@/modules/plataforma/catalogo'
import { conEmpresa } from '@/lib/tenant'
import { catalogVariantDTO } from '@/modules/plataforma/catalogo-dto'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/catalog-variants?companyId=…&itemId=… — variantes del
 * catálogo, paginadas. Es lo que se recorre para sincronizar precios y SKU sin
 * bajar los ítems enteros. El costo solo sale hacia la clave de la empresa.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'catalog:read', params.get('companyId'), { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (!(await catalogoHabilitado(companyId))) return catalogoNoHabilitado(ctx.requestId)

  const pag = leerPaginacion(params, ctx.requestId)
  if (!pag.ok) return pag.fallo
  const itemId = params.get('itemId')?.trim() || undefined

  try {
    const filas = await listarVariantes(companyId, { take: pag.limite + 1, cursor: pag.cursor, itemId }, ctx.principal.tipo === 'empresa')
    const { items, nextCursor } = construirPagina(filas, pag.limite)
    return respuestaApi({ variants: items, page: { limit: pag.limite, nextCursor } }, ctx.requestId)
  } catch (e) {
    console.error('[platform] catalog-variants:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}

/**
 * POST /api/platform/v1/catalog-variants — agrega una variante a un ítem que
 * SIGUE EN BORRADOR. Cuerpo: `{ itemId, name, price, … }`.
 *
 * Solo la clave de empresa, y solo sobre borradores: lo que ya está a la venta
 * se edita en el panel. Mismo criterio que `POST /catalog-items`, incluida la
 * advertencia sobre reintentos (manda `sku`).
 */
export async function POST(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'catalog:manage', null, { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (ctx.principal.tipo !== 'empresa') return soloClaveDeEmpresa(ctx.requestId)
  if (!(await catalogoHabilitado(companyId))) return catalogoNoHabilitado(ctx.requestId)

  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const itemId = typeof cuerpo?.itemId === 'string' ? cuerpo.itemId.trim() : ''
  const entrada = varianteDeCuerpo(cuerpo)
  if (!cuerpo || !entrada || !itemId) {
    return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'A JSON body with itemId, name and price is required.' })
  }

  try {
    const id = await agregarVarianteABorrador(companyId, itemId, entrada)
    const fila = await conEmpresa(companyId, (tx) => tx.catalogVariant.findFirst({ where: { id, companyId } }))
    return respuestaApi(fila ? catalogVariantDTO(fila, true) : { id }, ctx.requestId, { status: 201 })
  } catch (e) {
    const r = respuestaDeError(e, ctx.requestId)
    if (r) return r
    console.error('[platform] crear catalog-variant:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
