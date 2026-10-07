import { NextResponse } from 'next/server'
import { corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { paymentSessionLimiter } from '@/lib/rate-limit'
import { getCardnetBearerUser, iniciarSesionCardnet } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function POST(request: Request) {
  const user = await getCardnetBearerUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  if (!(await paymentSessionLimiter(user.supabaseId))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'La solicitud de pago no es válida.' }, { status: 400, headers: corsHeaders(request) })
  }
  const reply = await iniciarSesionCardnet(request, user, body)
  return NextResponse.json(reply.body, { status: reply.status, headers: corsHeaders(request) })
}
