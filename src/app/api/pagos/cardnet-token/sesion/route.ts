import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import {
  getTokensPublicConfig,
  crearSesionCaptura,
  consultarPerfilesPago,
  cardnetTokensConfigurado,
} from '@/lib/payments/cardnet-tokens'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * Crea la SESIÓN de captura de CardNET (paso previo a abrir el iframe).
 *
 * El servidor crea un Customer (con la llave privada) y CardNET devuelve el
 * CaptureURL y el UniqueID válidos. El navegador usa esos para abrir el iframe.
 * Nunca se expone la llave privada; solo la pública (que ya es pública).
 */
export async function POST(req: NextRequest) {
  const id = getClientIdentifier(req)
  if (!(await paymentLimiter(id))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (
    !user ||
    user.metadata.role !== 'CLIENTE' ||
    !user.metadata.clienteId ||
    !user.metadata.companyId
  ) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  if (!cardnetTokensConfigurado() || !(await puedeCobrarToken(user.metadata.companyId))) {
    return NextResponse.json({ ok: false, error: 'El pago con tarjeta no está disponible.' }, { status: 400 })
  }

  const pub = getTokensPublicConfig()
  if (!pub) {
    return NextResponse.json({ ok: false, error: 'Pasarela no configurada.' }, { status: 400 })
  }

  try {
    const sesion = await crearSesionCaptura({
      email: user.email || `${user.metadata.clienteId}@membego.local`,
    })
    if (!sesion) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo iniciar la ventana de pago. Intenta de nuevo.' },
        { status: 502 }
      )
    }
    // Línea base para la confirmación por perfil: cuántas tarjetas tenía el
    // Customer ANTES de abrir la ventana. Solo se cobrará un perfil agregado
    // después de este punto — cerrar la ventana sin terminar no cobra nada.
    const conteoPerfiles = sesion.customerId
      ? (await consultarPerfilesPago(sesion.customerId).catch(() => [])).length
      : 0
    return NextResponse.json({
      ok: true,
      captureUrl: sesion.captureUrl,
      uniqueId: sesion.uniqueId,
      publicKey: pub.publicKey,
      conteoPerfiles,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:sesion', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json({ ok: false, error: 'No se pudo iniciar el pago.' }, { status: 500 })
  }
}
