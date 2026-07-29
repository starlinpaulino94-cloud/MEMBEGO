import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { parseVencimiento } from '@/lib/payments/cardnet-core'
import { completarPagoTarjeta } from '@/modules/pagos/cardnet3ds'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * COMPLETA UN COBRO CON TARJETA DESPUÉS DEL RETO DEL BANCO.
 *
 * El navegador llama aquí cuando el cliente vuelve de la pantalla del banco.
 * Trae los handles del reto (integratorTxId, threeDSServerTransID) y los datos
 * de tarjeta que guardó EN MEMORIA durante el reto (nunca este servidor). Con
 * eso se consulta el estado 3DS y se cobra.
 *
 * El monto vuelve a salir de la base (por el intentoId): el navegador no decide
 * cuánto se cobra, solo aporta la tarjeta y confirma de qué intento se trata.
 */
export async function POST(req: NextRequest) {
  const id = getClientIdentifier(req)
  if (!(await paymentLimiter(id))) {
    return NextResponse.json({ estado: 'error', motivo: 'Demasiados intentos. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return NextResponse.json({ estado: 'error', motivo: 'No autorizado.' }, { status: 401 })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ estado: 'error', motivo: 'Solicitud ilegible.' }, { status: 400 })
  }

  const intentoId = typeof cuerpo.intentoId === 'string' ? cuerpo.intentoId : ''
  const integratorTxId = typeof cuerpo.integratorTxId === 'string' ? cuerpo.integratorTxId : ''
  const threeDSServerTransID = typeof cuerpo.threeDSServerTransID === 'string' ? cuerpo.threeDSServerTransID : ''
  const pan = typeof cuerpo.pan === 'string' ? cuerpo.pan : ''
  const cvv = typeof cuerpo.cvv === 'string' ? cuerpo.cvv : ''
  const vencimiento = parseVencimiento(typeof cuerpo.vencimiento === 'string' ? cuerpo.vencimiento : '')

  if (!intentoId || !integratorTxId || !threeDSServerTransID) {
    return NextResponse.json({ estado: 'error', motivo: 'Faltan datos del pago en curso.' }, { status: 400 })
  }
  if (pan.replace(/\D/g, '').length < 13 || cvv.length < 3 || !vencimiento) {
    return NextResponse.json({ estado: 'error', motivo: 'Revisa los datos de la tarjeta.' }, { status: 400 })
  }

  try {
    const res = await completarPagoTarjeta({
      intentoId,
      clienteId: user.metadata.clienteId,
      integratorTxId,
      threeDSServerTransID,
      tarjeta: { pan, cvv, vencimiento },
      clientIp: id,
    })
    return NextResponse.json(res)
  } catch (e) {
    logErrorBd('pagos:cardnet:completar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json(
      { estado: 'error', motivo: 'No se pudo completar el pago. Revisa tu historial antes de reintentar.' },
      { status: 500 }
    )
  }
}
