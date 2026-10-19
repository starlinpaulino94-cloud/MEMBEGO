import { NextResponse } from 'next/server'
import { z } from 'zod'
import { corsHeaders, getApiClientUser, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { notificarAdmins } from '@/modules/notificaciones/service'

export const dynamic = 'force-dynamic'

export const reportarResenaSchema = z.object({
  resenaId: z.string().min(1, 'El ID de la reseña es obligatorio.'),
  companySlug: z.string().min(1, 'El comercio es obligatorio.'),
  motivo: z.enum(['OFENSIVO', 'SPAM', 'ENGANOSO', 'ACOSO', 'OTRO']),
  detalle: z.string().max(500).optional().default(''),
})

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = reportarResenaSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const { resenaId, companySlug, motivo, detalle } = parsed.data
    const company = await getCompanyPublic(companySlug)
    if (!company) {
      return NextResponse.json({ error: 'Comercio no encontrado' }, { status: 404, headers: corsHeaders(request) })
    }

    const resultado = await conEmpresa(company.id, async (tx) => {
      const review = await tx.companyRating.findUnique({
        where: { id: resenaId },
        select: { id: true, comment: true, rating: true, clienteId: true },
      })
      if (!review) return null

      const cliente = await tx.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId: user.supabaseId, companyId: company.id } },
        select: { id: true, nombre: true },
      })

      const reporterName = user.email || 'Usuario de la app'
      const ticketClienteId = cliente?.id ?? review.clienteId

      const ticket = await tx.supportTicket.create({
        data: {
          companyId: company.id,
          clienteId: ticketClienteId,
          asunto: `[UGC Moderación] Reporte de reseña (${motivo})`,
          categoria: 'OTRO',
          mensajes: {
            create: {
              autorTipo: 'SISTEMA',
              autorNombre: 'Sistema de Moderación',
              cuerpo: `Alerta de contenido reportado por usuario.\nReseña ID: ${resenaId}\nMotivo: ${motivo}\nDetalle adicional: ${detalle || '(Sin detalle)'}\nReportado por: ${user.supabaseId} (${reporterName})\nCalificación: ${review.rating} estrellas\nTexto reportado: "${review.comment ?? '(Sin texto escrito)'}"`,
            },
          },
        },
        select: { id: true },
      })

      return { ticketId: ticket.id }
    })

    if (!resultado) {
      return NextResponse.json(
        { error: 'La reseña que intentas reportar ya no está disponible.' },
        { status: 404, headers: corsHeaders(request) }
      )
    }

    await notificarAdmins(company.id, {
      tipo: 'TICKET_NUEVO',
      titulo: 'Alerta de Moderación UGC',
      mensaje: `Reseña reportada por ${motivo}. Requiere revisión en menos de 24h.`,
      href: `/admin/tickets/${resultado.ticketId}`,
    }).catch(() => undefined)

    return NextResponse.json(
      {
        success: true,
        ticketId: resultado.ticketId,
        message: 'Tu reporte ha sido recibido. Nuestro equipo revisará este contenido para mantener un espacio seguro.',
      },
      { status: 201, headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/resenas/reportar] Error al reportar reseña:', error)
    return NextResponse.json(
      { error: 'Ocurrió un error al procesar tu reporte. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
