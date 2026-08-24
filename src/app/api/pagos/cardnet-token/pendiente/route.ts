import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentSessionLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { conEmpresa } from '@/lib/tenant'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * Encadena una consulta a CardNET (20s de límite propio). El corte por defecto
 * de la plataforma la mataría a media llamada y el cliente vería la pantalla
 * de pago normal, sin saber que su tarjeta sigue esperando el código.
 */
export const maxDuration = 30

/**
 * ¿ESTE CLIENTE TIENE UNA TARJETA ESPERANDO SU CÓDIGO DE ACTIVACIÓN?
 *
 * POR QUÉ EXISTE ESTA RUTA
 *
 * El código de activación NO es un SMS: es la descripción de un cargo de
 * RD$1.00 en el estado de cuenta, y aparece cuando el cargo se asienta — que
 * puede ser minutos u horas después, no en los treinta segundos que dura una
 * pantalla de pago abierta.
 *
 * Hasta ahora la pantalla de activación solo se alcanzaba COMO REACCIÓN a un
 * intento de cobro. El cliente que cerraba la pestaña porque el código todavía
 * no estaba en su banco no tenía forma de volver: al reabrir la pantalla de
 * pago no había nada que dijera que su tarjeta seguía pendiente, así que el
 * flujo arrancaba de cero —ventana de captura nueva, tarjeta nueva, OTRO cargo
 * de RD$1.00— y el perfil anterior quedaba huérfano y deshabilitado.
 *
 * El servidor SIEMPRE supo cuál era ese perfil. Lo que faltaba era la puerta
 * para preguntárselo sin tener que intentar un cobro primero.
 *
 * ES UN GET PURO, Y ESO ES DELIBERADO
 *
 * `consultarClienteCardnet` es un GET contra el proveedor: no crea Customer y
 * —a diferencia del POST /customer— NO invalida el `UniqueID` de una ventana
 * de captura abierta. Se puede llamar con la pantalla de pago montada sin
 * matarla con INTERNAL_SERVER_ERROR. No mueve dinero y no gasta ninguno de los
 * 3 intentos de activación: solo lee.
 *
 * GUARDAS. El `customerId` NO se acepta del navegador en ningún caso: sale de
 * la fila del cliente de la sesión, leída con contexto de empresa. El límite
 * es el de `paymentSessionLimiter` y no el de los cobros, por el mismo motivo
 * escrito allí: el navegador la pide sola al montar, y agotar con una lectura
 * el presupuesto de las rutas que mueven dinero es cómo el cliente se queda
 * sin poder pagar.
 */
export async function GET(req: NextRequest) {
  const id = getClientIdentifier(req)
  if (!(await paymentSessionLimiter(id))) {
    // Sin drama: esta consulta es un extra. Si se limita, la pantalla de pago
    // sigue funcionando como siempre — simplemente no ofrece el atajo.
    return NextResponse.json({ pendiente: false, limitado: true })
  }

  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ pendiente: false }, { status: 401 })
  }

  try {
    const fila = await conEmpresa(user.metadata.companyId, (tx) =>
      tx.cliente
        .findUnique({
          where: { id: user.metadata.clienteId as string },
          select: { cardnetCustomerId: true },
        })
        .catch(() => null)
    )
    const customerId = fila?.cardnetCustomerId?.trim() || null
    if (!customerId) return NextResponse.json({ pendiente: false })

    const { consultarClienteCardnet } = await import('@/lib/payments/cardnet-tokens')
    const { perfilPendienteDeActivar } = await import('@/lib/payments/cardnet-tokens-core')
    const { perfiles } = await consultarClienteCardnet(customerId)
    // MISMA función que usa la activación para elegir cuál activar: si aquí se
    // eligiera por otro criterio, el aviso enseñaría los últimos 4 dígitos de
    // una tarjeta y se activaría otra.
    const perfil = perfilPendienteDeActivar(perfiles)
    if (!perfil) return NextResponse.json({ pendiente: false })

    // Solo lo justo para que el cliente RECONOZCA su tarjeta. Nunca el token
    // ni el PaymentProfileId: no le sirven de nada en pantalla y son las dos
    // referencias con las que se cobra.
    return NextResponse.json({
      pendiente: true,
      marca: perfil.marca ?? null,
      ultimos4: perfil.ultimos4 ?? null,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:pendiente', e, { clienteId: user.metadata.clienteId })
    // Fallar aquí NO puede romper la pantalla de pago: sin respuesta, el
    // cliente ve el flujo normal de siempre.
    return NextResponse.json({ pendiente: false })
  }
}
