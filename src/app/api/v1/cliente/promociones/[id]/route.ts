import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getPromotionDetail } from '@/modules/marketplace/cached'
import { estadoLimiteCliente } from '@/modules/promociones/compra'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'

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

    const miFicha = await fichaEnEmpresa(user.supabaseId, promotion.company.id).catch(() => null)
    const limite =
      promotion.venta && miFicha
        ? await estadoLimiteCliente(miFicha, promotion.id, promotion.venta.limitePorCliente).catch(
            () => ({ limite: null, adquiridas: 0, alcanzado: false })
          )
        : { limite: null, adquiridas: 0, alcanzado: false }

    return NextResponse.json({
      promotion,
      esMiEmpresa: promotion.company.id === user.metadata.companyId,
      limite,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/promociones/[id]] Error cargando promoción:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la promoción' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}