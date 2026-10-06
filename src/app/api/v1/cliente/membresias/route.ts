import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getGamificacion } from '@/modules/engagement/gamificacion'
import { solicitarMembresiaCliente } from '@/modules/membresia/cliente-service'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'

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

export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ error: 'Inicia sesión como cliente para solicitar un plan.' }, { status: 401, headers: corsHeaders(request) })
  }

  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400, headers: corsHeaders(request) })
  }
  const planId = 'planId' in body && typeof body.planId === 'string' ? body.planId.trim() : ''
  const vehicleId = 'vehicleId' in body && typeof body.vehicleId === 'string' ? body.vehicleId.trim() : undefined
  if (!planId) {
    return NextResponse.json({ error: 'Selecciona un plan.' }, { status: 400, headers: corsHeaders(request) })
  }

  try {
    const result = await solicitarMembresiaCliente(user, { planId, vehicleId: vehicleId || undefined })
    if ('error' in result) {
      return NextResponse.json(result, { status: 400, headers: corsHeaders(request) })
    }
    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/planes')
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    return NextResponse.json(result, { status: 201, headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/membresias] Error solicitando membresía:', error)
    return NextResponse.json({ error: 'No pudimos iniciar la solicitud. Intenta de nuevo.' }, { status: 500, headers: corsHeaders(request) })
  }
}
