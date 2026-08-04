import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import {
  getTokensPublicConfig,
  cardnetTokensConfigurado,
  consultarClienteCardnet,
  obtenerCustomerId,
} from '@/lib/payments/cardnet-tokens'
import { scriptDesdeCaptura } from '@/lib/payments/cardnet-tokens-core'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * SESIÓN DE CAPTURA — implementa el flujo del MANUAL v1.7 §4.1.2.
 *
 * §4.1.2.1 · Registro de usuarios: el Customer se registra UNA vez y su
 *   `CustomerId` se guarda («se deberá procesar y almacenar como mínimo el
 *   CustomerId»). Aquí vive en `Cliente.cardnetCustomerId`.
 *
 * §4.1.2.2 · Registro de medios de pago, punto 3 y 4: para abrir la ventana se
 *   hace un **GET** al Customer, y el objeto devuelto «informa un CaptureURL y
 *   UniqueID que debe ser utilizado luego para mostrarle al usuario la interfaz
 *   de captura». La sesión sale de ESA consulta.
 *
 * ── POR QUÉ SE REESCRIBIÓ ───────────────────────────────────────────────────
 *
 * La versión anterior hacía POST → GET → POST en cada apertura, y usaba el
 * `UniqueID` del segundo POST. Se diseñó sin el manual, tanteando. El problema
 * es que **cada POST /Customer invalida el UniqueID anterior**: bastaba que
 * cualquier otra cosa tocara al mismo Customer —otra pestaña, un reintento, una
 * consulta de diagnóstico— para que la ventana abriera con una sesión ya
 * muerta. El síntoma era `INTERNAL_SERVER_ERROR` en la ventana de CardNET, sin
 * ninguna pista de la causa.
 *
 * Ahora, en el caso normal, esta ruta hace **una sola llamada y es un GET**.
 * Un GET no emite sesiones nuevas, así que no puede invalidar la de nadie.
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

  const clienteId = user.metadata.clienteId

  try {
    const cliente = await prisma.cliente
      .findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
      .catch(() => null)

    const email = user.email || `${clienteId}@membego.local`

    // §4.1.2.1: registrar una vez, guardar el id. El POST solo ocurre en el
    // primer pago de este cliente; a partir de ahí, nunca más.
    const customerId = await obtenerCustomerId({
      email,
      guardado: cliente?.cardnetCustomerId ?? null,
      guardar: async (nuevo) => {
        await prisma.cliente
          .update({ where: { id: clienteId }, data: { cardnetCustomerId: nuevo } })
          .catch(anotarSinRomper(clienteId))
      },
    })
    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo iniciar la ventana de pago. Intenta de nuevo.' },
        { status: 502 }
      )
    }

    // §4.1.2.2 punto 3-4: el GET trae los perfiles Y los datos de la ventana.
    // Una sola llamada para las dos cosas — antes eran dos, y la segunda
    // mataba a la primera.
    const consulta = await consultarClienteCardnet(customerId)

    // El Customer guardado debe seguir siendo de este cliente. Si el correo no
    // coincide (id heredado de otro entorno, cliente que cambió de correo), se
    // descarta y se registra uno nuevo en el próximo intento.
    const emailCoincide =
      !consulta.email || consulta.email.trim().toLowerCase() === email.trim().toLowerCase()
    if (!emailCoincide) {
      await prisma.cliente
        .update({ where: { id: clienteId }, data: { cardnetCustomerId: null } })
        .catch(anotarSinRomper(clienteId))
      return NextResponse.json(
        { ok: false, error: 'La sesión de pago no era válida. Intenta de nuevo.' },
        { status: 409 }
      )
    }

    if (!consulta.captureUrl || !consulta.uniqueId) {
      return NextResponse.json(
        { ok: false, error: 'La pasarela no devolvió una ventana de pago válida.' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      captureUrl: consulta.captureUrl,
      // El script SIEMPRE del mismo origen que la ventana: el token vuelve del
      // iframe por postMessage y con orígenes distintos no cruza.
      scriptUrl: scriptDesdeCaptura(consulta.captureUrl),
      uniqueId: consulta.uniqueId,
      publicKey: pub.publicKey,
      // Línea base para saber si el cliente registró una tarjeta NUEVA.
      conteoPerfiles: consulta.perfiles.length,
      customerId,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:sesion', e, { clienteId })
    return NextResponse.json({ ok: false, error: 'No se pudo iniciar el pago.' }, { status: 500 })
  }
}

/** Guardar el id es una optimización, no un requisito: si falla, se sigue. */
function anotarSinRomper(clienteId: string) {
  return (e: unknown) => {
    logErrorBd('pagos:cardnet-token:guardarCustomerId', e, { clienteId })
    return null
  }
}
