import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { cobrarObjetivoConToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * COBRA UN OBJETIVO CON EL TOKEN DE LA PÁGINA HOSPEDADA (CardNET Tokenización).
 *
 * El navegador manda SOLO el token que devolvió el iframe de CardNET (nunca la
 * tarjeta) y QUÉ se paga (membershipId/compraId). El monto y la empresa salen
 * de la sesión y de la base — el navegador no decide cuánto se cobra.
 */
export async function POST(req: NextRequest) {
  // Un intento de cobro es caro de abusar (llama a CardNET) y un bucle sería
  // una forma de probar tokens. Mismo límite que el flujo directo.
  const id = getClientIdentifier(req)
  if (!(await paymentLimiter(id))) {
    return NextResponse.json(
      { estado: 'error', motivo: 'Demasiados intentos. Espera un momento.' },
      { status: 429 }
    )
  }

  const user = await getUser()
  if (
    !user ||
    user.metadata.role !== 'CLIENTE' ||
    !user.metadata.clienteId ||
    !user.metadata.companyId
  ) {
    return NextResponse.json({ estado: 'error', motivo: 'No autorizado.' }, { status: 401 })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ estado: 'error', motivo: 'Solicitud ilegible.' }, { status: 400 })
  }

  const membershipId = typeof cuerpo.membershipId === 'string' ? cuerpo.membershipId : null
  const compraId = typeof cuerpo.compraId === 'string' ? cuerpo.compraId : null
  const trxToken = typeof cuerpo.trxToken === 'string' ? cuerpo.trxToken : ''
  if (!membershipId && !compraId) {
    return NextResponse.json({ estado: 'error', motivo: 'Falta indicar qué se paga.' }, { status: 400 })
  }
  if (!trxToken) {
    return NextResponse.json({ estado: 'error', motivo: 'No se recibió la tarjeta.' }, { status: 400 })
  }

  try {
    const res = await cobrarObjetivoConToken({
      objetivo: {
        companyId: user.metadata.companyId,
        clienteId: user.metadata.clienteId,
        membershipId,
        compraId,
      },
      trxToken,
      clienteIp: id,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(res)
  } catch (e) {
    logErrorBd('pagos:cardnet-token:cobrar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json(
      { estado: 'error', motivo: 'No se pudo procesar el pago. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
