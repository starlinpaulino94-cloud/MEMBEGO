import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClienteVisitas } from '@/modules/cliente/queries'

export const dynamic = 'force-dynamic'

/** Mismo tamaño de página que la vista web de historial. */
const PAGE_SIZE = 20

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1)

    // Sin ficha de cliente no hay visitas: misma salida que la web.
    if (!user.metadata.clienteId) {
      return NextResponse.json(
        { total: 0, esteMes: 0, pages: 0, visitas: [] },
        { headers: corsHeaders(request) }
      )
    }

    // getClienteVisitas no acepta filtro por membresía → no se soporta ?membershipId=.
    const result = await getClienteVisitas(user.supabaseId, page, PAGE_SIZE)
    return NextResponse.json(result, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/historial] Error cargando historial:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar historial' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
