import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { consultarClienteCardnet, consultarComprasCardnet } from '@/lib/payments/cardnet-tokens'
import type { PerfilPagoCardnet } from '@/lib/payments/cardnet-tokens-core'
import { confirmarIntento, reintentarEntrega } from '@/modules/pagos/intentos'
import {
  CARDNET_SESSION_STATES,
  matchingPurchases,
  purchaseDecision,
  purchaseList,
  type CardnetPurchaseDecision,
} from '@/modules/pagos/cardnetClientCore'
import { ownRecord, success, type CardnetReply } from '@/modules/pagos/cardnetClienteShared'
import {
  loadSession,
  setSessionState,
  type LoadedCardnetSession,
} from '@/modules/pagos/cardnetClienteSesionStore'

export function profileForSession(
  perfiles: readonly PerfilPagoCardnet[],
  paymentProfileId: string | null
): PerfilPagoCardnet | null {
  if (!paymentProfileId) return null
  return perfiles.find((profile) => profile.paymentProfileId === paymentProfileId) ?? null
}

function orderDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

function purchaseAmountPesos(payload: unknown): number | null {
  const outer = ownRecord(payload)
  if (!outer) return null
  const response = ownRecord(outer.Response ?? outer.response) ?? outer
  const transaction = ownRecord(response.Transaction ?? response.transaction) ?? {}
  const rawAmount = transaction.Amount ?? transaction.amount ?? response.Amount ?? response.amount
  if (typeof rawAmount !== 'string' && typeof rawAmount !== 'number') return null
  const amount = Number(rawAmount)
  return Number.isFinite(amount) ? amount / 100 : null
}

export async function searchPurchase(session: LoadedCardnetSession): Promise<{
  readonly decision: CardnetPurchaseDecision
  readonly payload: unknown
}> {
  const pending = { decision: { kind: 'pending' } as const, payload: null }
  if (!session.customerId || !session.purchaseIntent?.cardnetUniqueId) return pending
  const now = new Date()
  const result = await consultarComprasCardnet({
    customerId: session.customerId,
    from: orderDate(new Date(session.createdAt.getTime() - 24 * 60 * 60 * 1000)),
    to: orderDate(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    orderNumber: session.purchaseIntent.cardnetUniqueId,
  }).catch(() => null)
  if (!result?.ok) return pending
  const rows = purchaseList(result.json)
  if (!rows) return pending
  const exact = matchingPurchases(rows, {
    customerId: session.customerId,
    orderNumber: session.purchaseIntent.cardnetUniqueId,
    uniqueId: session.purchaseIntent.cardnetUniqueId,
    from: new Date(session.createdAt.getTime() - 24 * 60 * 60 * 1000),
    to: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  })
  if (exact.length !== 1) return pending
  const payload = exact[0]
  return { decision: purchaseDecision(200, payload), payload }
}

export async function markDefiniteDecline(
  session: LoadedCardnetSession,
  intentId: string
): Promise<CardnetReply> {
  const transitioned = await conEmpresa(session.companyId, async (tx) => {
    const attempt = await tx.pagoIntento.updateMany({
      where: {
        id: intentId,
        activadoAt: null,
        estado: { in: ['CREADO', 'REDIRIGIDO'] },
      },
      data: { estado: 'RECHAZADO', motivoRechazo: 'CardNET confirmó el rechazo.' },
    })
    if (attempt.count !== 1) return false

    const capture = await tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: session.authSubject,
        purchaseIntentId: intentId,
        updatedAt: session.updatedAt,
        estado: {
          in: [
            CARDNET_SESSION_STATES.PURCHASE_PENDING,
            CARDNET_SESSION_STATES.ACTIVATION_PROCESSING,
            CARDNET_SESSION_STATES.PROFILE_PENDING,
          ],
        },
      },
      data: { estado: CARDNET_SESSION_STATES.DECLINED, reservaClienteKey: null, conciliadoAt: new Date() },
    })
    if (capture.count !== 1) throw new Error('CardNET decline no longer matches the pending capture')
    return true
  }).catch(() => false)

  if (transitioned) return success(200, { status: 'declined' })
  const current = await loadSession(session.id, session.authSubject)
  if (current?.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
  if (current?.estado === CARDNET_SESSION_STATES.DECLINED) return success(200, { status: 'declined' })
  return success(202, { status: 'pending' })
}

export async function associateApprovedCard(
  session: LoadedCardnetSession
): Promise<boolean> {
  const customerId = session.customerId
  const membershipId = session.membershipId
  if (!customerId || !session.paymentProfileId || !membershipId) return false
  const customer = await consultarClienteCardnet(customerId).catch(() => null)
  if (
    !customer ||
    customer.email?.trim().toLowerCase() !== session.cliente.email.trim().toLowerCase()
  ) return false
  const profile = profileForSession(customer.perfiles, session.paymentProfileId)
  if (!profile?.token || !profile.habilitado) return false

  return conEmpresa(session.companyId, async (tx) => {
    const tarjeta = await tx.tarjetaTokenizada.upsert({
      where: { cardnetCaptureSessionId: session.id },
      create: {
        companyId: session.companyId,
        clienteId: session.clienteId,
        customerId,
        paymentProfileId: profile.paymentProfileId,
        token: profile.token,
        marca: profile.marca,
        ultimos4: profile.ultimos4,
        cardnetCaptureSessionId: session.id,
      },
      update: {},
    })
    const attached = await tx.membership.updateMany({
      where: { id: membershipId, clienteId: session.clienteId },
      data: { autoRenovar: true, tarjetaTokenizadaId: tarjeta.id },
    })
    if (attached.count !== 1) throw new Error('membership association failed')
    const captured = await tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: session.authSubject,
        estado: session.estado,
        updatedAt: session.updatedAt,
      },
      data: {
        estado: CARDNET_SESSION_STATES.APPROVED,
        reservaClienteKey: null,
        asociadoAt: new Date(),
        updatedAt: new Date(),
      },
    })
    if (captured.count !== 1) throw new Error('capture session association changed')
    return true
  }).catch(() => false)
}

export async function finishApproval(
  session: LoadedCardnetSession,
  intentId: string,
  authorization: string | null,
  purchasePayload: unknown
): Promise<CardnetReply> {
  const result = await confirmarIntento(intentId, {
    aprobada: true,
    autorizacion: authorization,
    motivo: null,
    crudo: { flujo: 'cardnet-cliente', resultado: 'aprobado' },
    montoCobrado: purchaseAmountPesos(purchasePayload),
  }).catch(() => null)
  let deliveryState = result?.ok ? result.entrega : null
  if (deliveryState && deliveryState !== 'COMPLETADA') {
    const retry = await reintentarEntrega(intentId).catch(() => null)
    deliveryState = retry?.entrega ?? 'PENDIENTE'
  }
  if (deliveryState === 'PENDIENTE') return success(202, { status: 'pending' })
  if (!result?.ok || deliveryState !== 'COMPLETADA') {
    const pending = await setSessionState(session, CARDNET_SESSION_STATES.FULFILLMENT_PENDING, { conciliadoAt: new Date() })
    return pending ? success(202, { status: 'pending' }) : currentSessionReply(session)
  }
  if (session.guardarRenovacion) {
    const associated = await associateApprovedCard(session)
    if (!associated) {
      const pending = await setSessionState(session, CARDNET_SESSION_STATES.ASSOCIATION_PENDING, { conciliadoAt: new Date() })
      return pending ? success(202, { status: 'pending' }) : currentSessionReply(session)
    }
  } else {
    const approved = await setSessionState(session, CARDNET_SESSION_STATES.APPROVED, {
      reservaClienteKey: null,
      conciliadoAt: new Date(),
    })
    if (!approved) return currentSessionReply(session)
  }
  return success(200, { status: 'approved' })
}

export async function interpretPurchase(
  session: LoadedCardnetSession,
  intentId: string,
  decision: ReturnType<typeof purchaseDecision>,
  payload: unknown
): Promise<CardnetReply> {
  if (session.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
  if (session.estado === CARDNET_SESSION_STATES.DECLINED) return success(200, { status: 'declined' })
  if (session.estado === CARDNET_SESSION_STATES.EXPIRED) return success(200, { status: 'expired' })
  if (decision.kind === 'approved') {
    return finishApproval(session, intentId, decision.authorization, payload)
  }
  if (decision.kind === 'declined') return markDefiniteDecline(session, intentId)
  if (decision.kind === 'activation_required') {
    if (session.estado === CARDNET_SESSION_STATES.ACTIVATION_REQUIRED) {
      return success(200, { status: 'activation_required' })
    }
    const required = await setSessionState(session, CARDNET_SESSION_STATES.ACTIVATION_REQUIRED)
    return required ? success(200, { status: 'activation_required' }) : currentSessionReply(session)
  }
  if (session.estado === CARDNET_SESSION_STATES.PURCHASE_PENDING) {
    return success(202, { status: 'pending' })
  }
  const pending = await setSessionState(session, CARDNET_SESSION_STATES.PURCHASE_PENDING, { conciliadoAt: new Date() })
  return pending ? success(202, { status: 'pending' }) : currentSessionReply(session)
}

async function currentSessionReply(session: LoadedCardnetSession): Promise<CardnetReply> {
  const current = await loadSession(session.id, session.authSubject)
  if (current?.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
  if (current?.estado === CARDNET_SESSION_STATES.DECLINED) return success(200, { status: 'declined' })
  if (current?.estado === CARDNET_SESSION_STATES.EXPIRED) return success(200, { status: 'expired' })
  if (current?.estado === CARDNET_SESSION_STATES.ACTIVATION_REQUIRED) return success(200, { status: 'activation_required' })
  return success(202, { status: 'pending' })
}
