import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { catalogoHabilitado } from '@/modules/plataforma/catalogo'
import { inventarioNoHabilitado, registrarAjustePorApi, respuestaDeErrorDeInventario, soloClaveDeEmpresaParaInventario } from '@/modules/plataforma/inventario'
import { ajusteDeCuerpo, claveDeCabecera } from '@/modules/plataforma/inventario-dto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/inventory/adjustments — corrige un descuadre de UN producto en UNA sucursal: `change` positivo es un sobrante y
 * negativo un faltante. Cuerpo: `{ variantId, branchId, change, reasonCode, note?, lots?, lotsOut? }`.
 *
 * `reasonCode` es OBLIGATORIO y sale del catálogo de motivos del inventario (`EXPIRED`, `THEFT`, `LOST`, `FOUND`, `OTHER`…): un ajuste
 * sin explicación es un faltante sin explicar. Solo la clave de empresa, y con `Idempotency-Key` obligatoria, como en las entradas.
 */
export async function POST(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'inventory:manage', null, { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (ctx.principal.tipo !== 'empresa') return soloClaveDeEmpresaParaInventario(ctx.requestId)
  if (!(await catalogoHabilitado(companyId))) return inventarioNoHabilitado(ctx.requestId)

  const clave = claveDeCabecera(req.headers.get('idempotency-key'))
  if (!clave.ok) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)
  const ajuste = ajusteDeCuerpo(await req.json().catch(() => null))
  if (!ajuste) return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'A JSON body with variantId, branchId, change and reasonCode is required.' })

  try {
    const r = await registrarAjustePorApi(companyId, { id: ctx.principal.claveId, prefijo: ctx.principal.prefijo }, clave.clave, ajuste)
    return respuestaApi(r, ctx.requestId, { status: r.repeated ? 200 : 201 })
  } catch (e) {
    const r = respuestaDeErrorDeInventario(e, ctx.requestId)
    if (r) return r
    console.error('[platform] inventory-adjustments:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
