import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { paymentLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { crearClienteCardnet, cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'
import { guardarTarjeta, eliminarTarjeta } from '@/modules/pagos/cardnetTokenGuardado'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * FASE 2 — Guardar / quitar una tarjeta tokenizada para renovación automática.
 *
 * POST: registra una tarjeta (crea el Customer en CardNET si hace falta) y, si
 *   se indica membershipId, enciende la renovación automática de esa membresía.
 *   El navegador solo manda las REFERENCIAS que devolvió el iframe de CardNET,
 *   nunca datos de tarjeta.
 * DELETE: el cliente quita su tarjeta.
 *
 * VERIFICAR-QA: qué referencias reutilizables entrega el iframe (paymentProfile
 * / token) se confirma contra el QA de CardNET. El plumbing queda listo.
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
  if (!cardnetTokensConfigurado() || !(await puedeCobrarToken(user.metadata.companyId))) {
    return NextResponse.json({ ok: false, error: 'La tarjeta no está disponible.' }, { status: 400 })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud ilegible.' }, { status: 400 })
  }

  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  let customerId = s(cuerpo.customerId)
  const paymentProfileId = s(cuerpo.paymentProfileId)
  const token = s(cuerpo.token)
  const membershipId = s(cuerpo.membershipId)

  // Sin ninguna referencia reutilizable no hay nada que guardar.
  if (!customerId && !paymentProfileId && !token) {
    return NextResponse.json({ ok: false, error: 'Faltan datos de la tarjeta guardada.' }, { status: 400 })
  }

  try {
    if (!customerId) {
      const cliente = await crearClienteCardnet({ email: user.email || `${user.metadata.clienteId}@membego.local` })
      if (!cliente) {
        return NextResponse.json({ ok: false, error: 'No se pudo registrar la tarjeta.' }, { status: 502 })
      }
      customerId = cliente.customerId
    }

    const tarjeta = await guardarTarjeta({
      companyId: user.metadata.companyId,
      clienteId: user.metadata.clienteId,
      customerId,
      paymentProfileId,
      token,
      marca: s(cuerpo.marca),
      ultimos4: s(cuerpo.ultimos4),
      vencMes: n(cuerpo.vencMes),
      vencAnio: n(cuerpo.vencAnio),
      membershipId,
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
  const ok = await eliminarTarjeta(tarjetaId, user.metadata.clienteId).catch(() => false)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}
