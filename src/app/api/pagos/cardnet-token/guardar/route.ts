import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { consultarClienteCardnet, cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'
import { guardarTarjeta, eliminarTarjeta } from '@/modules/pagos/cardnetTokenGuardado'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'
import { conEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * Guardar o quitar una tarjeta CardNET por solicitud del cliente.
 *
 * POST: selecciona un PaymentProfileId de la cuenta CardNET ya vinculada al
 *   cliente. Todas las demás referencias y metadatos salen del servidor.
 * DELETE: el cliente quita su tarjeta.
 *
 * El guardado requiere consentimiento separado y nunca activa autoRenovar.
 */
export async function POST(req: NextRequest) {
  const id = getClientIdentifier(req)
  if (!(await paymentLimiter(id))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  const companyId = user.metadata.companyId
  const clienteId = user.metadata.clienteId
  if (!companyId || !clienteId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  if (!cardnetTokensConfigurado() || !(await puedeCobrarToken(companyId))) {
    return NextResponse.json({ ok: false, error: 'La tarjeta no está disponible.' }, { status: 400 })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud ilegible.' }, { status: 400 })
  }

  const paymentProfileId = typeof cuerpo.paymentProfileId === 'string' ? cuerpo.paymentProfileId.trim() : ''
  if (cuerpo.consentimiento !== true || !/^\d{1,18}$/.test(paymentProfileId)) {
    return NextResponse.json({ ok: false, error: 'Confirma que deseas guardar esta tarjeta.' }, { status: 400 })
  }

  try {
    const cliente = await conEmpresa(companyId, (tx) => tx.cliente.findFirst({
      where: { id: clienteId, companyId, supabaseId: user.supabaseId, esLocal: false },
      select: { email: true, cardnetCustomerId: true },
    }))
    if (!cliente?.cardnetCustomerId) {
      return NextResponse.json({ ok: false, error: 'No hay una tarjeta nueva vinculada a tu cuenta.' }, { status: 404 })
    }
    const customer = await consultarClienteCardnet(cliente.cardnetCustomerId)
    if (!cliente.email || !customer.email || customer.email.trim().toLowerCase() !== cliente.email.trim().toLowerCase()) {
      return NextResponse.json({ ok: false, error: 'No se pudo verificar la cuenta de la tarjeta.' }, { status: 409 })
    }
    const profile = customer.perfiles.find((candidate) => candidate.paymentProfileId === paymentProfileId)
    if (!profile || !profile.token || !profile.habilitado) {
      return NextResponse.json({ ok: false, error: 'La tarjeta no está lista para guardarse.' }, { status: 409 })
    }
    const expirado = profile.vencMes && profile.vencAnio
      ? new Date(profile.vencAnio, profile.vencMes, 1).getTime() <= Date.now()
      : false
    if (expirado) {
      return NextResponse.json({ ok: false, error: 'La tarjeta está vencida.' }, { status: 409 })
    }

    const tarjeta = await guardarTarjeta({
      companyId,
      clienteId,
      customerId: cliente.cardnetCustomerId,
      paymentProfileId: profile.paymentProfileId,
      token: profile.token,
      marca: profile.marca,
      ultimos4: profile.ultimos4,
      vencMes: profile.vencMes,
      vencAnio: profile.vencAnio,
    })
    return NextResponse.json({ ok: true, tarjetaId: tarjeta.id })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:guardar', e, { clienteId: user.metadata.clienteId })
    return NextResponse.json({ ok: false, error: 'No se pudo guardar la tarjeta.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud ilegible.' }, { status: 400 })
  }
  const tarjetaId = typeof cuerpo.tarjetaId === 'string' ? cuerpo.tarjetaId : ''
  if (!tarjetaId) {
    return NextResponse.json({ ok: false, error: 'Falta la tarjeta.' }, { status: 400 })
  }
  if (!user.metadata.companyId) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }
  const result = await eliminarTarjeta(tarjetaId, user.metadata.clienteId, user.metadata.companyId).catch(() => 'no_encontrada' as const)
  return NextResponse.json({ estado: result }, { status: result === 'no_encontrada' ? 404 : result === 'pendiente' ? 202 : 200 })
}
