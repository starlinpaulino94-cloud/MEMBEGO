import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { solicitarCambioPlanCliente } from '@/modules/membresia/cliente-service'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ error: 'Inicia sesión como cliente para cambiar tu plan.' }, { status: 401, headers: corsHeaders(request) })
  }

  const { membershipId } = await params
  const body: unknown = await request.json().catch(() => null)
  const planId = body && typeof body === 'object' && !Array.isArray(body) && 'planId' in body && typeof body.planId === 'string'
    ? body.planId.trim()
    : ''
  if (!planId) {
    return NextResponse.json({ error: 'Selecciona el plan al que quieres cambiar.' }, { status: 400, headers: corsHeaders(request) })
  }

  try {
    const result = await solicitarCambioPlanCliente(user, { membershipId, planId })
    if ('error' in result) {
      return NextResponse.json(result, { status: 400, headers: corsHeaders(request) })
    }
    revalidatePath('/mis-membresias')
    revalidatePath(`/membresia/${membershipId}`)
    revalidatePath('/cliente/planes')
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    return NextResponse.json(result, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/membresias/:id/cambios-plan] Error:', error)
    return NextResponse.json({ error: 'No pudimos solicitar el cambio. Intenta de nuevo.' }, { status: 500, headers: corsHeaders(request) })
  }
}
