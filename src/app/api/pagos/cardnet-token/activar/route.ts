import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { activarTarjetaPendiente } from '@/modules/pagos/cardnetToken'
import { normalizarCodigoActivacion } from '@/lib/payments/cardnet-tokens-core'
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
 * ACTIVA LA TARJETA CON EL CÓDIGO DEL BANCO y cobra el pendiente (§4.1.2.3).
 *
 * Con las llaves CON autenticación (3DS), la tarjeta recién capturada nace
 * deshabilitada: CardNET cobra RD$1.00 y el banco muestra un código de 6
 * dígitos que el cliente ingresa aquí. Si CardNET la habilita, el servidor
 * cobra en el mismo movimiento por la tubería idempotente de siempre.
 *
 * Mismas guardas que el resto del flujo: solo CLIENTE autenticado, solo su
 * propio Customer (pertenencia por email), monto desde la base, rate-limit de
 * pagos. El código NO es dato de tarjeta (no es PAN/CVV): es un reto de un
 * solo uso que ya viajó por el estado de cuenta del propio cliente.
 */
export async function POST(req: NextRequest) {
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
  const customerId = typeof cuerpo.customerId === 'string' ? cuerpo.customerId : null
  const guardar = cuerpo.guardar === true
  if (!membershipId && !compraId) {
    return NextResponse.json(
      { estado: 'error', motivo: 'Falta indicar qué se paga.' },
      { status: 400 }
    )
  }

  // Se normaliza ANTES de gastar un intento contra el proveedor: el cliente
  // pega «Cardnet:z2r78v» con prefijo y minúsculas, y CardNET solo da 3
  // intentos antes de borrar la tarjeta. Un error de tipeo no debe quemar uno.
  const codigo = normalizarCodigoActivacion(
    typeof cuerpo.codigo === 'string' ? cuerpo.codigo : ''
  )
  if (!codigo) {
    return NextResponse.json({
      estado: 'codigo_rechazado',
      motivo:
        'El código debe tener 6 letras o números (aparece como «Cardnet:XXXXXX» en el cargo de RD$1.00 de tu banco).',
    })
  }

  try {
    const res = await activarTarjetaPendiente({
      objetivo: {
        companyId: user.metadata.companyId,
        clienteId: user.metadata.clienteId,
        membershipId,
        compraId,
      },
      emailCliente: user.email || `${user.metadata.clienteId}@membego.local`,
      codigo,
      clienteIp: id,
      userAgent: req.headers.get('user-agent'),
      customerId,
    })

    if (res.estado === 'aprobado') {
      // «Guardar tarjeta» funciona igual llegando por activación que por el
      // cobro directo — mismo bloque best-effort que /confirmar.
      if (guardar && res.perfil) {
        const { guardarTarjeta } = await import('@/modules/pagos/cardnetTokenGuardado')
        await guardarTarjeta({
          companyId: user.metadata.companyId,
          clienteId: user.metadata.clienteId,
          customerId: res.perfil.customerId,
          paymentProfileId: res.perfil.paymentProfileId,
          token: res.perfil.token,
          marca: res.perfil.marca,
          ultimos4: res.perfil.ultimos4,
          membershipId,
        }).catch((e) => logErrorBd('pagos:activar:guardarTarjeta', e, { membershipId }))
      }
      return NextResponse.json({
        estado: res.estado,
        compraId: res.compraId,
        membershipId: res.membershipId,
      })
    }
    return NextResponse.json({ estado: res.estado, motivo: res.motivo })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:activar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json(
      { estado: 'error', motivo: 'No se pudo activar la tarjeta. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
