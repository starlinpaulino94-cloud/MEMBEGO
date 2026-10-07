import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getFaqs, listTicketsCliente, getComunicacionConfig } from '@/modules/soporte/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { crearTicketSchema } from '@/modules/soporte/schema'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { getOnboardingCliente } from '@/modules/social/queries'
import {
  renderPlantilla,
  buildWaLink,
  horarioLegible,
  SOPORTE_PLATAFORMA,
} from '@/lib/soporte'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * Centro de ayuda: temas (FAQ), hilos de soporte y vías de contacto.
 *
 * Espejo de la carga de /cliente/ayuda. Los "temas" son las preguntas
 * frecuentes activas de la empresa; los tickets son de TODAS las fichas de la
 * persona (`misClienteIds`), como en la web.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const companyId = user.metadata.companyId
    const clienteId = user.metadata.clienteId

    const [config, cliente, temas, tickets, onboarding] = await Promise.all([
      companyId ? getComunicacionConfig(companyId).catch(() => null) : null,
      clienteId && companyId
        ? conEmpresa(companyId, (tx) =>
            tx.cliente.findUnique({
              where: { id: clienteId },
              select: { nombre: true, company: { select: { name: true } } },
            })
          ).catch(() => null)
        : null,
      getFaqs(companyId ?? null, { activeOnly: true }).catch(() => []),
      clienteId
        ? misClienteIds(user.supabaseId)
            .then((ids) => listTicketsCliente(ids))
            .catch(() => [])
        : Promise.resolve([]),
      user.metadata.dbUserId
        ? getOnboardingCliente(user.metadata.dbUserId, user.supabaseId).catch(() => null)
        : Promise.resolve(null),
    ])

    const empresaNombre = cliente?.company.name ?? 'la empresa'
    const mensajeWa = config
      ? renderPlantilla(config.mensajePlantilla, { cliente: cliente?.nombre, empresa: empresaNombre })
      : `Hola, soy ${cliente?.nombre ?? 'cliente de MembeGo'}. Necesito ayuda con mi cuenta de ${empresaNombre}.`
    const whatsappUrl =
      config?.activo && config.numero
        ? buildWaLink(config.codigoPais, config.numero, mensajeWa)
        : buildWaLink(
            SOPORTE_PLATAFORMA.whatsappCodigoPais,
            SOPORTE_PLATAFORMA.whatsappNumero,
            mensajeWa
          )
    const whatsappNumero =
      config?.activo && config.numero
        ? `+${config.codigoPais.replace(/\D/g, '')} ${config.numero}`
        : SOPORTE_PLATAFORMA.whatsappDisplay

    return NextResponse.json(
      {
        temas: temas.map((f) => ({
          id: f.id,
          pregunta: f.pregunta,
          respuesta: f.respuesta,
          orden: f.orden,
        })),
        tickets: tickets.map((t) => ({
          id: t.id,
          asunto: t.asunto,
          estado: t.estado,
          categoria: t.categoria,
          updatedAt: t.updatedAt,
          mensajes: t._count.mensajes,
          empresaNombre: t.company.name,
        })),
        contacto: {
          empresaNombre,
          whatsappUrl,
          whatsappNumero,
          correo: config?.correoSoporte || SOPORTE_PLATAFORMA.email,
          horario: horarioLegible(config?.horaInicio, config?.horaCierre, config?.diasLaborales),
        },
        onboarding,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/ayuda] Error cargando ayuda:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar el centro de ayuda' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  const companyId = user.metadata.companyId
  const clienteId = user.metadata.clienteId
  if (user.metadata.role !== 'CLIENTE' || !companyId || !clienteId) {
    return NextResponse.json({ error: 'No se pudo identificar tu cuenta de cliente.' }, { status: 400, headers: corsHeaders(request) })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = crearTicketSchema.safeParse({
      asunto: String(body.asunto ?? ''),
      descripcion: String(body.descripcion ?? ''),
      categoria: String(body.categoria ?? 'OTRO'),
      adjuntoUrl: String(body.adjuntoUrl ?? ''),
    })
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400, headers: corsHeaders(request) })
    }
    const categoria = parsed.data.categoria === 'PAGO'
      ? 'PAGO'
      : parsed.data.categoria === 'MEMBRESIA'
        ? 'MEMBRESIA'
        : parsed.data.categoria === 'BENEFICIOS'
          ? 'BENEFICIOS'
          : parsed.data.categoria === 'APP'
            ? 'APP'
            : 'OTRO'

    const ticket = await conEmpresa(companyId, async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { id: clienteId },
        select: { nombre: true },
      })
      return tx.supportTicket.create({
        data: {
          companyId,
          clienteId,
          asunto: parsed.data.asunto,
          categoria,
          adjuntoUrl: parsed.data.adjuntoUrl,
          mensajes: {
            create: {
              autorTipo: 'CLIENTE',
              autorNombre: cliente?.nombre ?? 'Cliente',
              cuerpo: parsed.data.descripcion,
            },
          },
        },
        select: { id: true },
      })
    })

    await notificarAdmins(companyId, {
      tipo: 'TICKET_NUEVO',
      titulo: 'Nuevo ticket de soporte',
      mensaje: `Un cliente: ${parsed.data.asunto}`,
      href: `/admin/tickets/${ticket.id}`,
    }).catch(() => undefined)

    return NextResponse.json(
      { success: true, ticketId: ticket.id, message: 'Ticket enviado. Te avisaremos cuando haya respuesta.' },
      { status: 201, headers: corsHeaders(request) },
    )
  } catch (error) {
    console.error('[api/v1/cliente/ayuda] Error creando ticket:', error)
    return NextResponse.json(
      { error: 'Ocurrió un error. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}
