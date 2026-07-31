import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { cobrarPendienteConPerfil } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * CONFIRMA EL PAGO CONSULTANDO AL PROVEEDOR (camino oficial de CardNET).
 *
 * Tras la captura hospedada, el token de la tarjeta queda en los
 * `PaymentProfiles` del Customer — confirmado por CardNET. El navegador solo
 * dice QUÉ se paga; el servidor consulta al proveedor por el email de la
 * sesión, encuentra el perfil recién agregado y cobra con el monto de la base.
 * Nada sensible viaja por el navegador.
 *
 * La página lo sondea mientras la ventana de pago está abierta; responder
 * `sin_tarjeta` significa "aún no hay tarjeta nueva, sigue esperando".
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
  const guardar = cuerpo.guardar === true
  const conteoAntes = typeof cuerpo.conteoAntes === 'number' ? cuerpo.conteoAntes : null
  if (!membershipId && !compraId) {
    return NextResponse.json(
      { estado: 'error', motivo: 'Falta indicar qué se paga.' },
      { status: 400 }
    )
  }

  try {
    const res = await cobrarPendienteConPerfil({
      objetivo: {
        companyId: user.metadata.companyId,
        clienteId: user.metadata.clienteId,
        membershipId,
        compraId,
      },
      emailCliente: user.email || `${user.metadata.clienteId}@membego.local`,
      clienteIp: id,
      userAgent: req.headers.get('user-agent'),
      conteoAntes,
    })

    // Fase 2: si el cliente pidió renovación automática, se guardan las
    // referencias del perfil recién cobrado (nunca datos de tarjeta). Es
    // best-effort: el cobro ya aprobó y eso es lo que manda.
    if (res.estado === 'aprobado' && guardar && res.perfil) {
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
      }).catch((e) => logErrorBd('pagos:confirmar:guardarTarjeta', e, { membershipId }))
    }

    // El perfil (con token) es de uso interno: al navegador solo va el estado.
    const { estado } = res
    const motivo = 'motivo' in res ? res.motivo : undefined
    if (estado === 'aprobado') {
      return NextResponse.json({
        estado,
        compraId: res.compraId,
        membershipId: res.membershipId,
      })
    }
    return NextResponse.json({ estado, ...(motivo ? { motivo } : {}) })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:confirmar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json(
      { estado: 'error', motivo: 'No se pudo confirmar el pago. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
