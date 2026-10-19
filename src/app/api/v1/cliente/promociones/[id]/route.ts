import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getPromotionDetail } from '@/modules/marketplace/cached'
import { estadoLimiteCliente } from '@/modules/promociones/compra'
import { sinEmpresa } from '@/lib/tenant'
import { fichaEnEmpresa, misClienteIds } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Detalle de promoción para la app RN.
 *
 * Espejo de `/cliente/promociones/[id]` (web): promoción completa + límite por
 * cliente (para saber si el botón de adquirir debe decir "ya adquirida").
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { id } = await params
    const promotion = await getPromotionDetail(id)
    if (!promotion) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }

    const [miFicha, clienteIds] = await Promise.all([
      fichaEnEmpresa(user.supabaseId, promotion.company.id).catch(() => null),
      misClienteIds(user.supabaseId).catch(() => []),
    ])
    const limite =
      promotion.venta && miFicha
        ? await estadoLimiteCliente(miFicha, promotion.id, promotion.venta.limitePorCliente).catch(
            () => ({ limite: null, adquiridas: 0, alcanzado: false })
          )
        : { limite: null, adquiridas: 0, alcanzado: false }
    const [compra, regalo] = await Promise.all([
      sinEmpresa('detalle de promoción: verificar compra de la persona', (tx) =>
        tx.productoCompra.findFirst({
          where: { promocionId: promotion.id, clienteId: { in: clienteIds } },
          select: { id: true },
        })
      ),
      sinEmpresa('detalle de promoción: verificar regalo recibido por la persona', (tx) =>
        tx.regalo.findFirst({
          where: { promocionId: promotion.id, destinatarioId: { in: clienteIds } },
          select: { id: true },
        })
      ),
    ])

    return NextResponse.json({
      promotion,
      esMiEmpresa: promotion.company.id === user.metadata.companyId,
      limite,
      enMisBeneficios: compra !== null,
      enMisRegalos: regalo !== null,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/promociones/[id]] Error cargando promoción:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la promoción' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
