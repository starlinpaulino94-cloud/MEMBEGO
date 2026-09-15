import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getNovedadesInicio } from '@/modules/social/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    // Mismo límite que la página web /cliente/novedades (paridad BFF).
    const novedades = user.metadata.dbUserId
      ? await getNovedadesInicio(user.metadata.dbUserId, 12).catch(() => [])
      : []

    return NextResponse.json({ novedades }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/novedades] Error cargando novedades:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar novedades' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}