import { NextResponse } from 'next/server'
import { corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { paymentLimiter } from '@/lib/rate-limit'
import { estadoSesionCardnet, getCardnetBearerUser } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getCardnetBearerUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  if (!(await paymentLimiter(user.supabaseId))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes.' }, { status: 429, headers: corsHeaders(request) })
  }
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  const reply = await estadoSesionCardnet(user, sessionId, request)
  return NextResponse.json(reply.body, { status: reply.status, headers: corsHeaders(request) })
}
