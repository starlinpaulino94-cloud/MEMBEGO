import { NextResponse, type NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { paymentSessionLimiter, getClientIdentifier } from '@/lib/rate-limit'
import {
  getTokensPublicConfig,
  cardnetTokensConfigurado,
  consultarClienteCardnet,
  obtenerCustomerId,
} from '@/lib/payments/cardnet-tokens'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * TIEMPO DE FUNCIÓN. Sin esto, Vercel corta la función a los ~15s por defecto.
 *
 * Este camino encadena VARIAS llamadas a CardNET, cada una con su propio
 * límite de 20s: consultar el cliente, leer sus perfiles, activar, y —si
 * activó— cobrar. Con el corte por defecto la función muere a media secuencia
 * y el navegador se queda girando sin respuesta ni error: la peor forma de
 * fallar, porque el cliente no sabe si se le cobró.
 */
export const maxDuration = 60

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
  // Presupuesto PROPIO: abrir la ventana no mueve dinero y no debe gastarse el
  // de las rutas que sí (ver `paymentSessionLimiter`).
  if (!(await paymentSessionLimiter(id))) {
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
  const companyId = user.metadata.companyId

  try {
    // El acceso a la ficha del cliente va con contexto de empresa (RLS Capa 2).
    // Cada op es su propia transacción corta: las llamadas a CardNET quedan
    // FUERA, para no sostener una transacción abierta durante la red.
    const cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findUnique({ where: { id: clienteId }, select: { cardnetCustomerId: true } })
    ).catch(() => null)

    const email = user.email || `${clienteId}@membego.local`

    const guardar = async (valor: string | null) => {
      await conEmpresa(companyId, (tx) =>
        tx.cliente.update({ where: { id: clienteId }, data: { cardnetCustomerId: valor } })
      ).catch(anotarSinRomper(clienteId))
    }

    /**
     * Resuelve el Customer y consulta su ventana. Devuelve `null` si el
     * Customer que se usó NO sirve, para poder reintentar con uno nuevo.
     */
    const intentar = async (guardado: string | null) => {
      const customerId = await obtenerCustomerId({
        email,
        guardado,
        guardar: (valor) => guardar(valor),
      })
      if (!customerId) return { customerId: null, consulta: null }
      // §4.1.2.2 punto 3-4: el GET trae los perfiles Y los datos de la ventana.
      return { customerId, consulta: await consultarClienteCardnet(customerId) }
    }

    let { customerId, consulta } = await intentar(cliente?.cardnetCustomerId ?? null)

    /**
     * ¿El Customer que teníamos guardado ya no sirve?
     *
     * CardNET responde `TK011 El Cliente especificado no es válido` cuando el
     * id no existe en la cuenta — y lo hace con HTTP 200, así que sin mirar el
     * cuerpo parece que todo fue bien y solo faltaron los datos de la ventana.
     *
     * Pasa cada vez que el id guardado queda huérfano: se cambió de juego de
     * llaves, se restauró la base desde otro entorno, o CardNET depuró su lado.
     * En vez de dejar al cliente atascado con un 502 que no explica nada, se
     * descarta el id y se registra uno nuevo. UNA sola vez: si el segundo
     * intento también falla, el problema no es el id guardado.
     */
    const inservible = !consulta?.captureUrl || !consulta?.uniqueId
    const teniamosGuardado = Boolean(cliente?.cardnetCustomerId)
    if (inservible && teniamosGuardado) {
      await guardar(null)
      ;({ customerId, consulta } = await intentar(null))
    }

    if (!customerId || !consulta) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo iniciar la ventana de pago. Intenta de nuevo.' },
        { status: 502 }
      )
    }

    // El Customer debe seguir siendo de este cliente. Si el correo no coincide
    // (id heredado de otro entorno, cliente que cambió de correo), se descarta
    // y se registra uno nuevo en el próximo intento.
    const emailCoincide =
      !consulta.email || consulta.email.trim().toLowerCase() === email.trim().toLowerCase()
    if (!emailCoincide) {
      await guardar(null)
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
      // El script NO sale de aquí: lo sirve el middleware autorizado y el
      // propio widget rechaza cualquier otro origen (ver `scriptWidget`).
      scriptUrl: pub.scriptUrl,
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
