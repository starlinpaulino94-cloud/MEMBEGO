import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getRegalosConfig } from '@/modules/regalos/config'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Gift card (paridad con /cliente/regalos/giftcard). Devuelve la
 * configuración del negocio: si están activas y el rango de montos. La compra
 * de gift cards se hace por caja citando el código (la action `comprarGiftCard`
 * crea la PENDIENTE_PAGO); el BFF expone la config para el formulario RN.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { clienteId, companyId } = user.metadata
    if (!clienteId || !companyId) {
      return NextResponse.json(
        { error: 'Tu cuenta no está vinculada a una empresa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const config = await getRegalosConfig(companyId)
    return NextResponse.json(
      {
        permitirGiftCards: config.permitirGiftCards,
        giftCardMontoMin: config.giftCardMontoMin,
        giftCardMontoMax: config.giftCardMontoMax,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/regalos/giftcard] Error cargando config:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la configuración de gift cards' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}