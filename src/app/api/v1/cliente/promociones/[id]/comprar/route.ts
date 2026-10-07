import { NextResponse } from 'next/server'
import { corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { paymentSessionLimiter } from '@/lib/rate-limit'
import { comprarPromocionCardnet, getCardnetBearerUser } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
) {
  const user = await getCardnetBearerUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  if (!(await paymentSessionLimiter(user.supabaseId))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  const { id } = await context.params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'La solicitud de compra no es válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    return NextResponse.json({ ok: false, error: 'La solicitud de compra no es válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  const reply = await comprarPromocionCardnet(user, id)
  return NextResponse.json(reply.body, { status: reply.status, headers: corsHeaders(request) })
}
