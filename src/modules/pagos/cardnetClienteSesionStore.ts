import 'server-only'
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { CARDNET_SESSION_STATES } from '@/modules/pagos/cardnetClientCore'
import { CLAIM_STALE_MS } from '@/modules/pagos/cardnetClienteShared'

export type CardnetReceiptGateTransaction = Pick<Prisma.TransactionClient, 'cardnetCaptureSession'>

export async function arbitrarComprobanteContraCapturaCardnet(
  tx: CardnetReceiptGateTransaction,
  target: { readonly companyId: string; readonly clienteId: string; readonly membershipId: string; readonly authSubject: string }
): Promise<boolean> {
  await tx.cardnetCaptureSession.updateMany({
    where: {
      ...target,
      estado: { in: [CARDNET_SESSION_STATES.STARTING, CARDNET_SESSION_STATES.CAPTURE_OPEN] },
    },
    data: {
      estado: CARDNET_SESSION_STATES.EXPIRED,
      reservaClienteKey: null,
      captureNonce: null,
    },
  })

  const inFlight = await tx.cardnetCaptureSession.findFirst({
    where: {
      ...target,
      estado: {
        in: [
          CARDNET_SESSION_STATES.CAPTURE_CONSUMED,
          CARDNET_SESSION_STATES.PROFILE_PENDING,
          CARDNET_SESSION_STATES.ACTIVATION_REQUIRED,
          CARDNET_SESSION_STATES.ACTIVATION_PROCESSING,
          CARDNET_SESSION_STATES.PURCHASE_PENDING,
          CARDNET_SESSION_STATES.FULFILLMENT_PENDING,
          CARDNET_SESSION_STATES.ASSOCIATION_PENDING,
        ],
      },
    },
    select: { id: true },
  })
  return inFlight === null
}

export async function loadSession(sessionId: string, authSubject: string) {
  return sinEmpresa(
    'CardNET cliente: leer sesión por id con la identidad autenticada',
    (tx) =>
      tx.cardnetCaptureSession.findFirst({
        where: { id: sessionId, authSubject },
        include: {
          cliente: { select: { email: true, cardnetCustomerId: true } },
          purchaseIntent: true,
        },
      })
  ).catch(() => null)
}

export async function expireSession(sessionId: string, companyId: string, authSubject: string): Promise<void> {
  await conEmpresa(companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: { id: sessionId, authSubject, estado: CARDNET_SESSION_STATES.CAPTURE_OPEN },
      data: { estado: CARDNET_SESSION_STATES.EXPIRED, reservaClienteKey: null, captureNonce: null },
    })
  ).catch(() => undefined)
}

export async function failStartingSession(sessionId: string, companyId: string, authSubject: string): Promise<void> {
  await conEmpresa(companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: { id: sessionId, authSubject, estado: CARDNET_SESSION_STATES.STARTING },
      data: { estado: CARDNET_SESSION_STATES.FAILED, reservaClienteKey: null, captureNonce: null },
    })
  ).catch(() => undefined)
}

export async function setSessionState(
  session: { readonly id: string; readonly companyId: string; readonly authSubject: string },
  state: string,
  additional: Prisma.CardnetCaptureSessionUpdateManyMutationInput = {}
): Promise<void> {
  await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: { id: session.id, authSubject: session.authSubject },
      data: { estado: state, ...additional },
    })
  ).catch(() => undefined)
}

function stablePurchaseId(): string {
  return String(randomInt(100_000_000_000, 999_999_999_999))
}

export async function createOrReadIntent(
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>
) {
  if (session.purchaseIntent) return session.purchaseIntent
  const uniqueId = stablePurchaseId()
  return conEmpresa(session.companyId, async (tx) => {
    const claimed = await tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: session.authSubject,
        purchaseIntentId: null,
        estado: {
          in: [
            CARDNET_SESSION_STATES.PROFILE_PENDING,
            CARDNET_SESSION_STATES.ACTIVATION_PROCESSING,
            CARDNET_SESSION_STATES.ACTIVATION_REQUIRED,
          ],
        },
      },
      data: { estado: CARDNET_SESSION_STATES.PURCHASE_PENDING, paymentProfileId: session.paymentProfileId },
    })
    if (claimed.count !== 1) return null
    const intent = await tx.pagoIntento.create({
      data: {
        companyId: session.companyId,
        clienteId: session.clienteId,
        proveedor: 'CARDNET',
        membershipId: session.membershipId,
        compraId: session.compraId,
        monto: session.monto,
        moneda: session.moneda,
        estado: 'CREADO',
        ipAddress: null,
        userAgent: null,
        cardnetUniqueId: uniqueId,
      },
    })
    await tx.cardnetCaptureSession.update({
      where: { id: session.id },
      data: { purchaseIntentId: intent.id },
    })
    return intent
  }).catch(() => null)
}

export async function claimProfileCheck(
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>
): Promise<boolean> {
  const old = new Date(Date.now() - CLAIM_STALE_MS)
  const fresh = await conEmpresa(session.companyId, async (tx) => {
    const direct = await tx.cardnetCaptureSession.updateMany({
      where: { id: session.id, authSubject: session.authSubject, estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED },
      data: { estado: CARDNET_SESSION_STATES.PROFILE_PENDING },
    })
    if (direct.count === 1) return true
    const stale = await tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: session.authSubject,
        estado: CARDNET_SESSION_STATES.PROFILE_PENDING,
        updatedAt: { lt: old },
      },
      data: { updatedAt: new Date() },
    })
    return stale.count === 1
  }).catch(() => false)
  return fresh
}

export type LoadedCardnetSession = NonNullable<Awaited<ReturnType<typeof loadSession>>>
