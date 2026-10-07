import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { leerPaginacion } from '@/modules/plataforma/paginacion'
import { construirPagina } from '@/modules/plataforma/paginacionNucleo'
import {
  catalogoHabilitado,
  catalogoNoHabilitado,
  crearItemEnBorrador,
  itemDeCuerpo,
  leerFiltros,
  listarItems,
  obtenerItem,
  respuestaDeError,
  soloClaveDeEmpresa,
} from '@/modules/plataforma/catalogo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/catalog-items?companyId=… — productos y servicios del
 * catálogo unificado, con sus variantes. Paginado por cursor; filtros
 * `status` y `type`.
 *
 * Es una PROYECCIÓN para pintar y sincronizar, no una fuente de verdad de
 * disponibilidad. El costo solo lo ve la clave de la propia empresa.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const auth = await autenticarSobreEmpresa(req, 'catalog:read', params.get('companyId'), { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (!(await catalogoHabilitado(companyId))) return catalogoNoHabilitado(ctx.requestId)

  const pag = leerPaginacion(params, ctx.requestId)
  if (!pag.ok) return pag.fallo
  const filtros = leerFiltros(params)
  if (!filtros.ok) return errorApi('INVALID_REQUEST', ctx.requestId, { message: filtros.mensaje })

  try {
    const filas = await listarItems(companyId, { take: pag.limite + 1, cursor: pag.cursor, status: filtros.status, type: filtros.type }, ctx.principal.tipo === 'empresa')
    const { items, nextCursor } = construirPagina(filas, pag.limite)
    return respuestaApi({ items, page: { limit: pag.limite, nextCursor } }, ctx.requestId)
  } catch (e) {
    // Un fallo de la base NO puede salir como una página vacía «final»: una
    // sincronización la daría por completa y perdería lo que falta.
    console.error('[platform] catalog-items:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}

/**
 * POST /api/platform/v1/catalog-items — crea un producto o servicio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO ARMA BORRADORES, Y SOLO LA CLAVE DE EMPRESA
 *
 * El ítem nace en `DRAFT` con su variante (la única automática si no se manda
 * `variants`). Publicarlo es una decisión humana, desde el panel: una clave
 * filtrada o una integración con un error puede llenar de borradores, pero no
 * puede poner nada a la venta.
 *
 * Sin `Idempotency-Key` —esa tabla es de satélites— y por eso un reintento tras
 * un timeout crearía un segundo ítem. Mandar `sku` lo evita: el SKU es único por
 * empresa y el reintento contesta `INVALID_REQUEST` con `reason: "duplicate"`
 * en vez de duplicar.
 */
export async function POST(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'catalog:manage', null, { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (ctx.principal.tipo !== 'empresa') return soloClaveDeEmpresa(ctx.requestId)
  if (!(await catalogoHabilitado(companyId))) return catalogoNoHabilitado(ctx.requestId)

  const cuerpo = await req.json().catch(() => null)
  const entrada = itemDeCuerpo(cuerpo)
  if (!entrada) return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'Invalid JSON body.' })

  try {
    const id = await crearItemEnBorrador(companyId, entrada)
    const creado = await obtenerItem(companyId, id, true)
    return respuestaApi(creado, ctx.requestId, { status: 201 })
  } catch (e) {
    const r = respuestaDeError(e, ctx.requestId)
    if (r) return r
    console.error('[platform] crear catalog-item:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
