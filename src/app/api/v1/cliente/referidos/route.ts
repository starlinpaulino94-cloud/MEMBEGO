import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { absoluteUrl } from '@/lib/site'
import { ensureCodigoCorto } from '@/lib/referidos'
import {
  misCampanasDisponibles,
  getInvitadosPorCliente,
  getInvitaYGanaStats,
} from '@/modules/invitaciones/queries'
import { normalizeInvitaContenido, mensajeCompartirConRegalo } from '@/lib/invitaContenido'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Referidos (paridad con /cliente/invita-y-gana, que unificó el módulo
 * Referidos). Devuelve el enlace/código de invitación de la campaña elegida
 * (`?empresa=<slug>`, o la de la empresa activa, o la primera) y el listado de
 * invitados + stats de progreso.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const empresaParam = searchParams.get('empresa') ?? undefined

    // Sin ficha de cliente no hay campañas: misma salida que la web.
    if (!user.metadata.clienteId) {
      return NextResponse.json({ campanas: [], elegida: null }, { headers: corsHeaders(request) })
    }

    const opciones = await misCampanasDisponibles(user.supabaseId)
    const elegida =
      opciones.find((o) => o.company.slug === empresaParam) ??
      opciones.find((o) => o.company.id === user.metadata.companyId) ??
      opciones[0]

    if (!elegida) {
      return NextResponse.json({ campanas: [], elegida: null }, { headers: corsHeaders(request) })
    }

    const { campana, clienteId, company } = elegida
    const companyId = company.id

    const [codigoCorto, invitados, stats] = await Promise.all([
      ensureCodigoCorto(clienteId),
      getInvitadosPorCliente(clienteId),
      getInvitaYGanaStats(clienteId, companyId),
    ])

    // Enlace corto personal: /invitar/CODIGO?c=<slug>&v=<version> (la versión
    // evita que WhatsApp/Facebook cacheen la vista previa vieja).
    const version = campana.updatedAt.getTime().toString(36)
    const inviteUrl = absoluteUrl(
      `/invitar/${codigoCorto}?c=${encodeURIComponent(campana.slug)}&v=${version}`
    )

    const t = normalizeInvitaContenido(campana.contenido)
    const beneficioInvitado = campana.beneficioInvitado as { descripcion?: string } | null
    const regalo = beneficioInvitado?.descripcion || 'un regalo de bienvenida'
    const regaloCorto = regalo.split(/[.!\n]/)[0].trim().slice(0, 80) || 'un regalo de bienvenida'
    const mensajeCompartir = mensajeCompartirConRegalo(t.mensajeCompartir, regaloCorto)

    return NextResponse.json(
      {
        campanas: opciones.map((o) => ({
          company: o.company,
          campana: {
            id: o.campana.id,
            titulo: o.campana.titulo,
            slug: o.campana.slug,
            bannerUrl: o.campana.bannerUrl,
            imagenUrl: o.campana.imagenUrl,
            beneficioInvitado: o.campana.beneficioInvitado,
            fechaFin: o.campana.fechaFin,
          },
        })),
        elegida: {
          company,
          campana: {
            id: campana.id,
            titulo: campana.titulo,
            slug: campana.slug,
            bannerUrl: campana.bannerUrl,
            imagenUrl: campana.imagenUrl,
            beneficioInvitado: campana.beneficioInvitado,
            fechaFin: campana.fechaFin,
          },
          codigo: codigoCorto,
          inviteUrl,
          mensajeCompartir,
          stats,
          invitados: invitados.map((inv) => ({
            id: inv.id,
            estado: inv.estado,
            recompensaAplicada: inv.recompensaAplicada,
            createdAt: inv.createdAt,
            nombre: inv.referidoCliente.nombre,
          })),
        },
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/referidos] Error cargando referidos:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar referidos' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}