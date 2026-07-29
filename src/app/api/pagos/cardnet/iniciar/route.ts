import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { parseVencimiento } from '@/lib/payments/cardnet-core'
import { iniciarPagoTarjeta } from '@/modules/pagos/cardnet3ds'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * INICIA UN COBRO CON TARJETA (CardNET 3DS).
 *
 * Recibe los datos de tarjeta del navegador (modelo directo, aceptado a
 * conciencia — ver docs/PAGOS-CARDNET.md). Esta ruta NO guarda ni registra la
 * tarjeta: la pasa a la orquestación y responde. El monto y la empresa salen de
 * la SESIÓN y de la base, nunca del cuerpo del request.
 *
 * Responde:
 *   · { estado: 'aprobado' | 'rechazado' | 'error', ... }  → sin reto.
 *   · { estado: 'reto', challengeUrl, challengeToken, intentoId, ... } → el
 *     navegador abre la pantalla del banco y luego llama a /completar.
 */
export async function POST(req: NextRequest) {
  // Límite: 10 intentos por minuto por IP. El cobro con tarjeta es caro de
  // abusar (cada intento es una llamada a CardNET) y un bucle sería una forma
  // de probar tarjetas robadas.
  const id = getClientIdentifier(req)
  if (!(await paymentLimiter(id))) {
    return NextResponse.json({ estado: 'error', motivo: 'Demasiados intentos. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
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
  if (!membershipId && !compraId) {
    return NextResponse.json({ estado: 'error', motivo: 'Falta indicar qué se paga.' }, { status: 400 })
  }

  const pan = typeof cuerpo.pan === 'string' ? cuerpo.pan : ''
  const cvv = typeof cuerpo.cvv === 'string' ? cuerpo.cvv : ''
  const vencimiento = parseVencimiento(typeof cuerpo.vencimiento === 'string' ? cuerpo.vencimiento : '')
  const cardholderName = typeof cuerpo.cardholderName === 'string' ? cuerpo.cardholderName : undefined
  const b = (cuerpo.browser ?? {}) as Record<string, unknown>

  if (pan.replace(/\D/g, '').length < 13 || cvv.length < 3 || !vencimiento) {
    return NextResponse.json(
      { estado: 'error', motivo: 'Revisa los datos de la tarjeta.' },
      { status: 400 }
    )
  }

  const ip = id
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? req.nextUrl.origin

  try {
    const res = await iniciarPagoTarjeta({
      objetivo: {
        companyId: user.metadata.companyId,
        clienteId: user.metadata.clienteId,
        membershipId,
        compraId,
      },
      tarjeta: { pan, cvv, vencimiento, cardholderName },
      browser: {
        ip,
        userAgent: req.headers.get('user-agent') ?? 'desconocido',
        screenWidth: typeof b.screenWidth === 'number' ? b.screenWidth : undefined,
        screenHeight: typeof b.screenHeight === 'number' ? b.screenHeight : undefined,
        tz: typeof b.tz === 'number' ? b.tz : undefined,
        language: typeof b.language === 'string' ? b.language : undefined,
        acceptHeader: req.headers.get('accept') ?? undefined,
      },
      urlRetorno: `${base}/api/pagos/cardnet/retorno`,
      clientIp: ip,
    })
    return NextResponse.json(res)
  } catch (e) {
    // El catch nunca recibe datos de tarjeta (la orquestación no los propaga en
    // errores), pero por si acaso no se registra el cuerpo del request.
    logErrorBd('pagos:cardnet:iniciar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json(
      { estado: 'error', motivo: 'No se pudo procesar el pago. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
