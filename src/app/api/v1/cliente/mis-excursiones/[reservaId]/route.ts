import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { reservaCliente } from '@/modules/excursiones/reservas/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * GET /api/v1/cliente/mis-excursiones/[reservaId]
 * Detalle de una reserva propia (busca en todas las empresas del cliente).
 * Shape: `{ reserva, excursion, variante, saldo, checkinToken, checkinAt, checkinPorId }`
 * (igual que `reservaCliente`). `reservaCliente` genera el checkinToken si falta.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reservaId: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { reservaId } = await params

    const clienteIds = await sinEmpresa('cliente: mis fichas en todas las empresas (BFF)', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId: user.supabaseId },
        select: { id: true, companyId: true },
      })
    )

    for (const c of clienteIds) {
      const found = await reservaCliente(c.companyId, c.id, reservaId)
      if (found) {
        return NextResponse.json(found, { headers: corsHeaders(request) })
      }
    }

    return NextResponse.json(
      { error: 'Reserva no encontrada' },
      { status: 404, headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/mis-excursiones/[reservaId]] Error cargando reserva:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la reserva' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}