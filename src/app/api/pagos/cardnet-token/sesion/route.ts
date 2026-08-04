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
    const email = user.email || `${user.metadata.clienteId}@membego.local`

    // ORDEN CRÍTICO. El proveedor invalida el UniqueID vigente con CUALQUIER
    // operación posterior sobre el mismo Customer (un nuevo registro seguro;
    // posiblemente también la consulta). Por eso:
    //  1) un registro inicial solo para conocer el customerId,
    //  2) la línea base de perfiles (GET) con ese id,
    //  3) el registro DEFINITIVO al final — su UniqueID es el que abre la
    //     ventana, y después de este punto NO se vuelve a tocar al proveedor
    //     hasta que la ventana se cierre (la confirmación corre recién ahí).
    const previa = await crearSesionCaptura({ email })
    if (!previa) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo iniciar la ventana de pago. Intenta de nuevo.' },
        { status: 502 }
      )
    }
    const conteoPerfiles = previa.customerId
      ? (await consultarPerfilesPago(previa.customerId).catch(() => [])).length
      : 0
    const sesion = await crearSesionCaptura({ email })
    if (!sesion) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo iniciar la ventana de pago. Intenta de nuevo.' },
        { status: 502 }
      )
    }
    const { scriptDesdeCaptura } = await import('@/lib/payments/cardnet-tokens-core')

    return NextResponse.json({
      ok: true,
      captureUrl: sesion.captureUrl,
      // El script SIEMPRE del mismo origen que la ventana de captura. El
      // `CaptureURL` lo decide CardNET en la respuesta (varía entre `lab` y
      // `labservicios` según el host consultado), así que fijar el script
      // aparte los desalinea tarde o temprano — y desalineados el token no
      // cruza del iframe a la página.
      scriptUrl: scriptDesdeCaptura(sesion.captureUrl),
      uniqueId: sesion.uniqueId,
      publicKey: pub.publicKey,
      conteoPerfiles,
      // Para la confirmación por GET (un POST /customer durante la captura
      // invalidaría la sesión de la ventana). No es un secreto: el servidor
      // verifica la pertenencia por email antes de usarlo.
      customerId: sesion.customerId || null,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:sesion', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json({ ok: false, error: 'No se pudo iniciar el pago.' }, { status: 500 })
  }
}
