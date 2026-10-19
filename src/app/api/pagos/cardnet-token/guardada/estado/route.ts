import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { getClientIdentifier, paymentSessionLimiter } from '@/lib/rate-limit'
import { estadoSesionCardnet } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  if (!(await paymentSessionLimiter(getClientIdentifier(request)))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas consultas.' }, { status: 429 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'La sesión no es válida.' }, { status: 400 })
  }
  const sessionId = body && typeof body === 'object' && 'sessionId' in body
    ? (body as { sessionId?: unknown }).sessionId
    : null
  const reply = await estadoSesionCardnet(user, sessionId, request)
  return NextResponse.json(reply.body, { status: reply.status })
}
