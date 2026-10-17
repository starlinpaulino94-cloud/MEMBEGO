import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { leerPaginacion } from '@/modules/plataforma/paginacion'
import { construirPagina } from '@/modules/plataforma/paginacionNucleo'
import { catalogoHabilitado } from '@/modules/plataforma/catalogo'
import { inventarioNoHabilitado, listarMovimientos } from '@/modules/plataforma/inventario'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/inventory/movements?companyId=…&branchId=…&variantId=… — el libro de movimientos (ledger), del más reciente al más
 * antiguo y paginado. Es la historia de cada cambio de existencias: tipo, cantidad, saldo antes y después, motivo y de dónde vino. Sin costos.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'inventory:read', params.get('companyId'), { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (!(await catalogoHabilitado(companyId))) return inventarioNoHabilitado(ctx.requestId)

  const pag = leerPaginacion(params, ctx.requestId)
  if (!pag.ok) return pag.fallo
  const branchId = params.get('branchId')?.trim() || undefined
  const variantId = params.get('variantId')?.trim() || undefined

  try {
    const filas = await listarMovimientos(companyId, { take: pag.limite + 1, cursor: pag.cursor, branchId, variantId })
    const { items, nextCursor } = construirPagina(filas, pag.limite)
    return respuestaApi({ movements: items, page: { limit: pag.limite, nextCursor } }, ctx.requestId)
  } catch (e) {
    console.error('[platform] inventory-movements:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
