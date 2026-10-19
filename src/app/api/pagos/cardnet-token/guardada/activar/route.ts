import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { getClientIdentifier, paymentLimiter } from '@/lib/rate-limit'
import { activarPerfilSesionCardnet } from '@/modules/pagos/cardnetCliente'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  if (!(await paymentLimiter(getClientIdentifier(request)))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos de activación.' }, { status: 429 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'La solicitud de activación no es válida.' }, { status: 400 })
  }
  const reply = await activarPerfilSesionCardnet(request, user, body)
  return NextResponse.json(reply.body, { status: reply.status })
}
