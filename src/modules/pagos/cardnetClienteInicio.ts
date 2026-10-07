import 'server-only'
import { randomBytes } from 'node:crypto'
import { conEmpresa } from '@/lib/tenant'
import {
  getTokensPublicConfig,
  obtenerCustomerId,
  consultarClienteCardnet,
} from '@/lib/payments/cardnet-tokens'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import {
  CARDNET_SESSION_STATES,
  cardnetReservationKey,
  cardnetSessionInputSchema,
  perfilesBase,
  validarCaptureUrl,
} from '@/modules/pagos/cardnetClientCore'
import {
  CAPTURE_TTL_MS,
  CLAIM_STALE_MS,
  fail,
  hashNonce,
  sessionPayload,
  success,
  type CardnetReply,
} from '@/modules/pagos/cardnetClienteShared'
import { resolveTarget, type TargetInfo } from '@/modules/pagos/cardnetClienteObjetivo'
import {
  expireSession,
  failStartingSession,
  loadSession,
} from '@/modules/pagos/cardnetClienteSesionStore'
import type { SessionUser } from '@/types'

const PROCESSING_STATES: ReadonlySet<string> = new Set([
  CARDNET_SESSION_STATES.CAPTURE_CONSUMED,
  CARDNET_SESSION_STATES.PROFILE_PENDING,
  CARDNET_SESSION_STATES.ACTIVATION_REQUIRED,
  CARDNET_SESSION_STATES.ACTIVATION_PROCESSING,
  CARDNET_SESSION_STATES.PURCHASE_PENDING,
  CARDNET_SESSION_STATES.FULFILLMENT_PENDING,
  CARDNET_SESSION_STATES.ASSOCIATION_PENDING,
])

async function existingReservation(
  reservationKey: string,
  user: SessionUser,
  target: TargetInfo,
  guardarRenovacion: boolean
): Promise<CardnetReply | null> {
  const existing = await conEmpresa(target.companyId, (tx) =>
    tx.cardnetCaptureSession.findUnique({ where: { reservaClienteKey: reservationKey } })
  ).catch(() => null)
  if (!existing) return null
  const sameTarget =
    existing.authSubject === user.supabaseId &&
    existing.companyId === target.companyId &&
    existing.clienteId === target.clienteId &&
    existing.membershipId === (target.membershipId ?? null) &&
    existing.compraId === (target.compraId ?? null)
  if (
    sameTarget &&
    existing.estado === CARDNET_SESSION_STATES.CAPTURE_OPEN &&
    existing.venceAt > new Date()
  ) {
    const nonce = randomBytes(32).toString('base64url')
    const resumed = await conEmpresa(target.companyId, (tx) =>
      tx.cardnetCaptureSession.updateMany({
        where: {
          id: existing.id,
          authSubject: user.supabaseId,
          estado: CARDNET_SESSION_STATES.CAPTURE_OPEN,
          venceAt: { gt: new Date() },
          captureNonce: existing.captureNonce,
        },
        data: { captureNonce: hashNonce(nonce), guardarRenovacion },
      })
    ).catch(() => ({ count: 0 }))
    if (resumed.count !== 1) return fail(409, 'El pago ya se está procesando. Intenta de nuevo.')
    const session = await loadSession(existing.id, user.supabaseId)
    return session
      ? sessionPayload(session, nonce) ?? fail(409, 'No se pudo recuperar la sesión de pago.')
      : fail(409, 'No se pudo recuperar la sesión de pago.')
  }

  if (sameTarget && PROCESSING_STATES.has(existing.estado)) {
    return success(200, { status: 'processing', sessionId: existing.id })
  }

  if (existing.estado === CARDNET_SESSION_STATES.CAPTURE_OPEN && existing.venceAt <= new Date()) {
    await expireSession(existing.id, target.companyId, user.supabaseId)
  } else if (
    existing.estado === CARDNET_SESSION_STATES.STARTING &&
    existing.updatedAt.getTime() < Date.now() - CLAIM_STALE_MS
  ) {
    await failStartingSession(existing.id, target.companyId, user.supabaseId)
  } else {
    return fail(409, 'Ya hay un pago en proceso para este cliente.')
  }
  return null
}

export async function iniciarSesionCardnet(request: Request, user: SessionUser, body: unknown): Promise<CardnetReply> {
  const parsed = cardnetSessionInputSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'La solicitud de pago no es válida.')
  const resolution = await resolveTarget(user, parsed.data)
  if (resolution.kind === 'missing') return fail(404, 'No se encontró el objetivo de pago.')
  if (resolution.kind === 'ineligible') return fail(409, 'El objetivo de pago ya no admite este cobro.')
  const target = resolution.target
  if (parsed.data.guardarParaRenovacion && !target.allowRenewalConsent) {
    return fail(409, 'El objetivo no admite guardar la tarjeta para renovaciones.')
  }
  const reservationKey = cardnetReservationKey(target.companyId, target.clienteId)
  const guardarRenovacion = parsed.data.guardarParaRenovacion ?? false
  const cached = await existingReservation(reservationKey, user, target, guardarRenovacion)
  if (cached) return cached

  const config = getTokensPublicConfig()
  if (!config || !(await puedeCobrarToken(target.companyId).catch(() => false))) {
    return fail(502, 'El pago con tarjeta no está disponible.')
  }

  const sessionId = randomBytes(24).toString('hex')
  const nonce = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + CAPTURE_TTL_MS)
  try {
    await conEmpresa(target.companyId, (tx) =>
      tx.cardnetCaptureSession.create({
        data: {
          id: sessionId,
          authSubject: user.supabaseId,
          companyId: target.companyId,
          clienteId: target.clienteId,
          membershipId: target.membershipId ?? null,
          compraId: target.compraId ?? null,
          monto: target.amount,
          reservaClienteKey: reservationKey,
          captureNonce: hashNonce(nonce),
          guardarRenovacion,
          venceAt: expiresAt,
        },
      })
    )
  } catch {
    const conflict = await existingReservation(reservationKey, user, target, guardarRenovacion)
    return conflict ?? fail(409, 'Ya hay un pago en proceso para este cliente.')
  }

  const currentTarget = await resolveTarget(user, parsed.data)
  if (
    currentTarget.kind !== 'ready' ||
    currentTarget.target.companyId !== target.companyId ||
    currentTarget.target.clienteId !== target.clienteId ||
    currentTarget.target.membershipId !== target.membershipId ||
    currentTarget.target.compraId !== target.compraId ||
    currentTarget.target.amount !== target.amount ||
    (parsed.data.guardarParaRenovacion && !currentTarget.target.allowRenewalConsent)
  ) {
    await failStartingSession(sessionId, target.companyId, user.supabaseId)
    return fail(409, 'El objetivo de pago cambió. Actualiza la pantalla e intenta de nuevo.')
  }

  try {
    const customer = await obtenerCustomerId({
      email: target.email,
      guardado: target.cardnetCustomerId,
      guardar: async (value) => {
        await conEmpresa(target.companyId, (tx) =>
          tx.cliente.updateMany({
            where: { id: target.clienteId, supabaseId: user.supabaseId },
            data: { cardnetCustomerId: value },
          })
        )
      },
    })
    if (!customer.ok) {
      await failStartingSession(sessionId, target.companyId, user.supabaseId)
      return fail(502, 'No se pudo iniciar el pago con la pasarela.')
    }
    const consulta = await consultarClienteCardnet(customer.customerId)
    if (
      consulta.denegado ||
      !consulta.email ||
      consulta.email.trim().toLowerCase() !== target.email.trim().toLowerCase() ||
      !consulta.captureUrl ||
      !consulta.uniqueId ||
      !validarCaptureUrl(consulta.captureUrl, config.captureUrl)
    ) {
      await failStartingSession(sessionId, target.companyId, user.supabaseId)
      return fail(502, 'No se pudo iniciar el pago con la pasarela.')
    }
    const updated = await conEmpresa(target.companyId, (tx) =>
      tx.cardnetCaptureSession.updateMany({
        where: { id: sessionId, authSubject: user.supabaseId, estado: CARDNET_SESSION_STATES.STARTING },
        data: {
          customerId: customer.customerId,
          captureUrl: consulta.captureUrl,
          scriptUrl: config.scriptUrl,
          publicKey: config.publicKey,
          customerUniqueId: consulta.uniqueId,
          perfilBase: perfilesBase(consulta.perfiles),
          estado: CARDNET_SESSION_STATES.CAPTURE_OPEN,
        },
      })
    )
    if (updated.count !== 1) {
      await failStartingSession(sessionId, target.companyId, user.supabaseId)
      return fail(502, 'No se pudo iniciar el pago con la pasarela.')
    }
    const session = await loadSession(sessionId, user.supabaseId)
    return session ? sessionPayload(session, nonce) ?? fail(502, 'No se pudo iniciar el pago con la pasarela.') : fail(502, 'No se pudo iniciar el pago con la pasarela.')
  } catch {
    await failStartingSession(sessionId, target.companyId, user.supabaseId)
    return fail(502, 'No se pudo iniciar el pago con la pasarela.')
  }
}
