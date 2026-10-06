import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { activarPerfilCardnet } from '@/lib/payments/cardnet-tokens'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import {
  CARDNET_SESSION_STATES,
  cardnetActivationInputSchema,
  cardnetConfirmInputSchema,
  cardnetStatusInputSchema,
} from '@/modules/pagos/cardnetClientCore'
import {
  PURCHASE_RETRY_MS,
  fail,
  hashNonce,
  success,
  type CardnetReply,
} from '@/modules/pagos/cardnetClienteShared'
import {
  expireSession,
  loadSession,
  setSessionState,
  type LoadedCardnetSession,
} from '@/modules/pagos/cardnetClienteSesionStore'
import {
  interpretPurchase,
  searchPurchase,
} from '@/modules/pagos/cardnetClienteCompra'
import {
  chargeWithProfile,
  getProfileForCharge,
  progressCapture,
} from '@/modules/pagos/cardnetClienteCaptura'
import type { SessionUser } from '@/types'

export async function confirmarSesionCardnet(
  request: Request,
  user: SessionUser,
  body: unknown
): Promise<CardnetReply> {
  const parsed = cardnetConfirmInputSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'La solicitud de confirmación no es válida.')
  const session = await loadSession(parsed.data.sessionId, user.supabaseId)
  if (!session) return fail(404, 'No se encontró la sesión de pago.')
  if (session.estado !== CARDNET_SESSION_STATES.CAPTURE_OPEN) return fail(409, 'La sesión de pago ya fue procesada.')
  if (session.venceAt <= new Date()) {
    await expireSession(session.id, session.companyId, user.supabaseId)
    return fail(409, 'La sesión de pago venció.')
  }
  const claimed = await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: user.supabaseId,
        estado: CARDNET_SESSION_STATES.CAPTURE_OPEN,
        captureNonce: hashNonce(parsed.data.captureNonce),
        venceAt: { gt: new Date() },
      },
      data: {
        estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED,
        captureNonce: null,
        capturadoAt: new Date(),
      },
    })
  ).catch(() => ({ count: 0 }))
  if (claimed.count !== 1) return fail(409, 'La sesión de pago ya fue procesada o venció.')
  return progressCapture({ ...session, estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED }, request)
}

export async function activarPerfilSesionCardnet(
  request: Request,
  user: SessionUser,
  body: unknown
): Promise<CardnetReply> {
  const parsed = cardnetActivationInputSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'La solicitud de activación no es válida.')
  const session = await loadSession(parsed.data.sessionId, user.supabaseId)
  if (!session) return fail(404, 'No se encontró la sesión de pago.')
  if (session.estado !== CARDNET_SESSION_STATES.ACTIVATION_REQUIRED) {
    if (session.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
    return fail(409, 'La sesión no requiere activación.')
  }
  if (!(await puedeCobrarToken(session.companyId).catch(() => false))) {
    return fail(502, 'El pago con tarjeta no está disponible.')
  }
  const claimed = await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: { id: session.id, authSubject: user.supabaseId, estado: CARDNET_SESSION_STATES.ACTIVATION_REQUIRED },
      data: { estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING },
    })
  ).catch(() => ({ count: 0 }))
  if (claimed.count !== 1) return success(202, { status: 'pending' })
  const profile = await getProfileForCharge({ ...session, estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING })
  if (!profile?.token) return success(202, { status: 'pending' })
  if (!profile.habilitado) {
    const activated = await activarPerfilCardnet({
      customerId: session.customerId ?? '',
      token: profile.token,
      codigo: parsed.data.activationCode,
    }).catch(() => null)
    if (!activated || activated.status === 0 || activated.status === 401 || activated.status === 403 || activated.status >= 500) {
      return success(202, { status: 'pending' })
    }
    if (!activated.ok) {
      await setSessionState(session, CARDNET_SESSION_STATES.ACTIVATION_REQUIRED)
      return success(200, { status: 'activation_required' })
    }
    const refreshed = await getProfileForCharge({ ...session, estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING })
    if (!refreshed?.token || !refreshed.habilitado) return success(202, { status: 'pending' })
    return chargeWithProfile({ ...session, estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING }, refreshed, request)
  }
  return chargeWithProfile({ ...session, estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING }, profile, request)
}

export async function estadoSesionCardnet(
  user: SessionUser,
  sessionIdValue: unknown,
  request: Request
): Promise<CardnetReply> {
  const parsed = cardnetStatusInputSchema.safeParse(sessionIdValue)
  if (!parsed.success) return fail(400, 'La sesión de pago no es válida.')
  const session = await loadSession(parsed.data, user.supabaseId)
  if (!session) return fail(404, 'No se encontró la sesión de pago.')
  if (session.estado === CARDNET_SESSION_STATES.CAPTURE_OPEN) {
    if (session.venceAt <= new Date()) {
      await expireSession(session.id, session.companyId, user.supabaseId)
      return success(200, { status: 'expired' })
    }
    return success(200, { status: 'pending' })
  }
  if (session.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
  if (session.estado === CARDNET_SESSION_STATES.DECLINED) return success(200, { status: 'declined' })
  if (session.estado === CARDNET_SESSION_STATES.EXPIRED) return success(200, { status: 'expired' })
  if (session.estado === CARDNET_SESSION_STATES.FAILED) return fail(409, 'La sesión no pudo iniciarse.')
  if (session.estado === CARDNET_SESSION_STATES.PURCHASE_PENDING && session.purchaseIntent) {
    const searched = await searchPurchase(session)
    if (searched.decision.kind !== 'pending') {
      return interpretPurchase(session, session.purchaseIntent.id, searched.decision, searched.payload)
    }
    if (Date.now() - session.updatedAt.getTime() >= PURCHASE_RETRY_MS) {
      const claimed = await conEmpresa(session.companyId, (tx) =>
        tx.cardnetCaptureSession.updateMany({
          where: {
            id: session.id,
            authSubject: user.supabaseId,
            estado: CARDNET_SESSION_STATES.PURCHASE_PENDING,
            updatedAt: { lt: new Date(Date.now() - PURCHASE_RETRY_MS) },
          },
          data: { updatedAt: new Date() },
        })
      ).catch(() => ({ count: 0 }))
      if (claimed.count === 1) {
        const profile = await getProfileForCharge(session)
        if (profile?.token) return chargeWithProfile(session, profile, request)
      }
    }
    return success(202, { status: 'pending' })
  }
  return progressCapture(session, request)
}
