import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getRegalosCliente } from '@/modules/regalos/queries'
import { getGiftCardsCliente } from '@/modules/regalos/giftcards'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Centro de regalos (paridad con /cliente/regalos). El listado es de la
 * PERSONA (todas sus fichas), no de la empresa activa: recibidos + enviados +
 * gift cards (recibidas y compradas).
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const [{ recibidos, enviados, pendientesRecibidos }, { recibidas, compradas }] =
      await Promise.all([
        getRegalosCliente(user.supabaseId).catch(() => ({
          recibidos: [],
          enviados: [],
          pendientesRecibidos: 0,
        })),
        getGiftCardsCliente(user.supabaseId).catch(() => ({ recibidas: [], compradas: [] })),
      ])

    return NextResponse.json(
      {
        recibidos,
        enviados,
        pendientesRecibidos,
        giftCards: [...recibidas, ...compradas],
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/regalos] Error cargando regalos:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar regalos' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}