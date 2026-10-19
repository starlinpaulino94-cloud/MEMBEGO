import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { getClientIdentifier, paymentLimiter, paymentSessionLimiter } from '@/lib/rate-limit'
import { iniciarSesionCardnet } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  const identifier = getClientIdentifier(request)
  if (!(await paymentSessionLimiter(identifier)) || !(await paymentLimiter(identifier))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos de pago.' }, { status: 429 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'La solicitud de pago no es válida.' }, { status: 400 })
  }
  const reply = await iniciarSesionCardnet(request, user, body)
  return NextResponse.json(reply.body, { status: reply.status })
}
