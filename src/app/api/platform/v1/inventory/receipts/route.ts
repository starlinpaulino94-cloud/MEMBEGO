import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { catalogoHabilitado } from '@/modules/plataforma/catalogo'
import { inventarioNoHabilitado, registrarEntradaPorApi, respuestaDeErrorDeInventario, soloClaveDeEmpresaParaInventario } from '@/modules/plataforma/inventario'
import { claveDeCabecera, entradaDeCuerpo } from '@/modules/plataforma/inventario-dto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/inventory/receipts — llega mercancía de UN producto a UNA sucursal y entra a lo vendible.
 * Cuerpo: `{ variantId, branchId, quantity, note?, lots?: [{ code, expiresOn?, quantity }] }`. Sin costo: esta API no lo lee.
 *
 * Solo la clave de empresa, y con `Idempotency-Key` obligatoria: repetir la petición con la misma clave no suma dos veces (contesta
 * `repeated: true`); la misma clave con OTRA operación es `INVALID_REQUEST`.
 */
export async function POST(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'inventory:manage', null, { claveDeEmpresa: true })
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  if (ctx.principal.tipo !== 'empresa') return soloClaveDeEmpresaParaInventario(ctx.requestId)
  if (!(await catalogoHabilitado(companyId))) return inventarioNoHabilitado(ctx.requestId)

  const clave = claveDeCabecera(req.headers.get('idempotency-key'))
  if (!clave.ok) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)
  const entrada = entradaDeCuerpo(await req.json().catch(() => null))
  if (!entrada) return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'A JSON body with variantId, branchId and quantity is required (costs are not accepted).' })

  try {
    const r = await registrarEntradaPorApi(companyId, { id: ctx.principal.claveId, prefijo: ctx.principal.prefijo }, clave.clave, entrada)
    return respuestaApi(r, ctx.requestId, { status: r.repeated ? 200 : 201 })
  } catch (e) {
    const r = respuestaDeErrorDeInventario(e, ctx.requestId)
    if (r) return r
    console.error('[platform] inventory-receipts:', e)
    return errorApi('INTERNAL_ERROR', ctx.requestId)
  }
}
