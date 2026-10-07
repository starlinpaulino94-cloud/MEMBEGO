import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { catalogoHabilitado, catalogoNoHabilitado, obtenerItem } from '@/modules/plataforma/catalogo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/catalog-items/{id}?companyId=… — un producto con sus
 * variantes.
 *
 * `NOT_FOUND` es el MISMO error para un id inventado y para uno de otra
 * empresa: distinguirlos confirmaría, ítem a ítem, de quién es cada cosa.
 */
export async function GET(req: NextRequest, ctxRuta: { params: Promise<{ id: string }> }) {
  const { id } = await ctxRuta.params
  const auth = await autenticarSobreEmpresa(req, 'catalog:read', req.nextUrl.searchParams.get('companyId'), { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (!(await catalogoHabilitado(companyId))) return catalogoNoHabilitado(ctx.requestId)

  try {
    const item = await obtenerItem(companyId, id, ctx.principal.tipo === 'empresa')
    if (!item) return errorApi('NOT_FOUND', ctx.requestId)
    return respuestaApi(item, ctx.requestId)
  } catch (e) {
    console.error('[platform] catalog-item:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
