import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getGamificacion } from '@/modules/engagement/gamificacion'

export const dynamic = 'force-dynamic'

/** Misma ventana que usa la wallet de la web para "por vencer". */
const DIAS_POR_VENCER = 7

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const memberships = await getClienteAllMemberships(
      user.supabaseId,
      user.metadata.clienteId
    ).catch(() => [])

    const now = new Date()
    const serializada = memberships.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      companyName: m.company.name,
      companySlug: m.company.slug,
      companyLogoUrl: m.company.logoUrl,
      companyColorPrimario: m.company.colorPrimario,
      planId: m.plan.id,
      planNombre: m.plan.nombre,
      planEsIlimitado: m.plan.esIlimitado,
      planLavadosIncluidos: m.plan.lavadosIncluidos,
      estado: m.estado,
      fechaInicio: m.fechaInicio,
      fechaVencimiento: m.fechaVencimiento,
      lavadosRestantes: m.lavadosRestantes,
      qrToken: m.qrToken?.token ?? null,
    }))

    // TRES GRUPOS EXCLUYENTES, como las secciones de la wallet web:
    // porVencer ⊆ activas totales; `activas` es lo que queda vigente.
    const activasTodas = serializada.filter((m) => {
      const v = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
      return m.estado === 'ACTIVA' && (!v || v > now)
    })
    const porVencer = activasTodas.filter((m) => {
      if (!m.fechaVencimiento) return false
      const dias = Math.ceil((new Date(m.fechaVencimiento).getTime() - now.getTime()) / 86_400_000)
      return dias <= DIAS_POR_VENCER
    })
    const porVencerIds = new Set(porVencer.map((m) => m.id))
    const activas = activasTodas.filter((m) => !porVencerIds.has(m.id))
    const vencidas = serializada.filter((m) => !activasTodas.some((a) => a.id === m.id))

    const { clienteId, companyId } = user.metadata
    const puntos =
      clienteId && companyId
        ? ((await getGamificacion(clienteId, companyId).catch(() => null))?.puntos ?? null)
        : null

    return NextResponse.json(
      { membresias: serializada, activas, porVencer, vencidas, puntos },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/membresias] Error cargando membresías:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar membresías' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
