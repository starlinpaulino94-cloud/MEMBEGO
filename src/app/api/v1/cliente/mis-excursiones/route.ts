import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { reservasCliente } from '@/modules/excursiones/reservas/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * GET /api/v1/cliente/mis-excursiones
 * Reservas del cliente en TODAS sus empresas (cross-tenant, filtrado por
 * supabaseId), ordenadas por fecha desc. Mismo shape que `reservasCliente`.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const clienteIds = await sinEmpresa('cliente: mis fichas en todas las empresas (BFF)', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId: user.supabaseId },
        select: { id: true, companyId: true },
      })
    )

    const allReservas = await Promise.all(
      clienteIds.map((c) => reservasCliente(c.companyId, c.id))
    )
    const reservas = allReservas
      .flat()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ reservas }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-excursiones] Error cargando reservas:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar reservas' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}