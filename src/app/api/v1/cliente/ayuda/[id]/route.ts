import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getTicketDetail } from '@/modules/soporte/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * Detalle de un hilo de soporte del cliente.
 *
 * `includeInternal = false`: las notas internas del negocio nunca salen.
 * La propiedad se comprueba contra TODAS las fichas de la persona — igual que
 * la página web — porque un hilo abierto con otro negocio sigue siendo suyo.
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
    const ticket = await getTicketDetail(id, false)
    const misFichas = await misClienteIds(user.supabaseId)
    if (!ticket || !misFichas.includes(ticket.cliente.id)) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404, headers: corsHeaders(request) })
    }

    return NextResponse.json(
      {
        ticket: {
          id: ticket.id,
          asunto: ticket.asunto,
          estado: ticket.estado,
          categoria: ticket.categoria,
          adjuntoUrl: ticket.adjuntoUrl,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          empresa: { id: ticket.company.id, name: ticket.company.name },
          mensajes: ticket.mensajes.map((m) => ({
            id: m.id,
            autorTipo: m.autorTipo,
            autorNombre: m.autorNombre,
            cuerpo: m.cuerpo,
            createdAt: m.createdAt,
          })),
        },
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/ayuda/[id]] Error cargando ticket:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar el ticket' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
