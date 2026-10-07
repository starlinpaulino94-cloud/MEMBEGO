import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { prepararSubidaComprobante } from '@/modules/storage/subidas'
import { registrarComprobanteMembresiaCliente } from '@/modules/membresia/cliente-service'

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
    return NextResponse.json({ error: 'Inicia sesión para adjuntar el comprobante.' }, { status: 401, headers: corsHeaders(request) })
  }

  const { membershipId } = await params
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400, headers: corsHeaders(request) })
  }

  try {
    const extension = 'extension' in body && typeof body.extension === 'string' ? body.extension.trim() : ''
    if (extension) {
      const result = await prepararSubidaComprobante('membresia', membershipId, extension, user.supabaseId)
      return NextResponse.json(result, { status: 'error' in result ? 400 : 201, headers: corsHeaders(request) })
    }

    const path = 'path' in body && typeof body.path === 'string' ? body.path.trim() : ''
    const metodoPagoId = 'metodoPagoId' in body && typeof body.metodoPagoId === 'string'
      ? body.metodoPagoId.trim() || null
      : null
    const nota = 'nota' in body && typeof body.nota === 'string' ? body.nota.trim() || null : null
    const result = await registrarComprobanteMembresiaCliente(user, { membershipId, path, metodoPagoId, nota })
    if ('error' in result) {
      return NextResponse.json(result, { status: 400, headers: corsHeaders(request) })
    }
    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/pagos')
    revalidatePath(`/membresia/${membershipId}`)
    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/membresias/:id/comprobante] Error:', error)
    return NextResponse.json({ error: 'No pudimos procesar el comprobante. Intenta de nuevo.' }, { status: 500, headers: corsHeaders(request) })
  }
}
