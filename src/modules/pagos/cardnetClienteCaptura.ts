import 'server-only'
import type { PerfilPagoCardnet } from '@/lib/payments/cardnet-tokens-core'
import { cobrarConToken, consultarClienteCardnet } from '@/lib/payments/cardnet-tokens'
import {
  CARDNET_SESSION_STATES,
  purchaseDecision,
  seleccionarPerfilNuevo,
} from '@/modules/pagos/cardnetClientCore'
import {
  ACTIVATION_CLAIM_STALE_MS,
  fail,
  ownRecord,
  requestIp,
  success,
  type CardnetReply,
} from '@/modules/pagos/cardnetClienteShared'
import {
  createOrReadIntent,
  loadSession,
  claimStaleActivation,
  setSessionState,
  setActivationClaimState,
  claimProfileCheck,
  type LoadedCardnetSession,
} from '@/modules/pagos/cardnetClienteSesionStore'
import {
  associateApprovedCard,
  finishApproval,
  interpretPurchase,
  profileForSession,
  searchPurchase,
} from '@/modules/pagos/cardnetClienteCompra'

export async function getProfileForCharge(
  session: LoadedCardnetSession
): Promise<PerfilPagoCardnet | null> {
  if (!session.customerId || !session.paymentProfileId) return null
  const customer = await consultarClienteCardnet(session.customerId).catch(() => null)
  if (
    !customer ||
    customer.email?.trim().toLowerCase() !== session.cliente.email.trim().toLowerCase()
  ) return null
  const profile = profileForSession(customer.perfiles, session.paymentProfileId)
  return profile?.token ? profile : null
}

export async function chargeWithProfile(
  session: LoadedCardnetSession,
  profile: PerfilPagoCardnet,
  request: Request
): Promise<CardnetReply> {
  const intent = await createOrReadIntent(session)
  if (!intent?.cardnetUniqueId || !profile.token) return success(202, { status: 'pending' })
  const purchaseSession = await loadSession(session.id, session.authSubject)
  if (
    !purchaseSession ||
    purchaseSession.estado !== CARDNET_SESSION_STATES.PURCHASE_PENDING ||
    purchaseSession.purchaseIntent?.id !== intent.id ||
    !purchaseSession.purchaseIntent
  ) return success(202, { status: 'pending' })
  const currentIntent = purchaseSession.purchaseIntent
  if (!currentIntent.cardnetUniqueId) return success(202, { status: 'pending' })
  if (currentIntent.estado === 'APROBADO') {
    return finishApproval(purchaseSession, currentIntent.id, currentIntent.autorizacion, null)
  }
  if (currentIntent.estado === 'RECHAZADO') return success(200, { status: 'declined' })
  if (currentIntent.estado === 'EXPIRADO') return success(200, { status: 'expired' })
  if (currentIntent.estado !== 'CREADO' && currentIntent.estado !== 'REDIRIGIDO') {
    return success(202, { status: 'pending' })
  }
  const ip = requestIp(request)
  const charge = await cobrarConToken({
    trxToken: profile.token,
    pesos: Number(purchaseSession.monto),
    orden: currentIntent.id,
    clienteIp: ip,
    customerId: purchaseSession.customerId ?? undefined,
    purchaseUniqueId: currentIntent.cardnetUniqueId,
  }).catch(() => null)
  if (!charge) {
    const latest = await loadSession(purchaseSession.id, purchaseSession.authSubject)
    if (!latest) return success(202, { status: 'pending' })
    const reconciled = await searchPurchase(latest)
    return interpretPurchase(latest, currentIntent.id, reconciled.decision, reconciled.payload)
  }
  const http = ownRecord(charge.crudo)?._http
  const httpStatus = typeof http === 'number' ? http : 0
  const decision = purchaseDecision(httpStatus, charge.crudo)
  if (decision.kind === 'ambiguous' || decision.kind === 'pending') {
    const latest = await loadSession(purchaseSession.id, purchaseSession.authSubject)
    if (!latest) return success(202, { status: 'pending' })
    const reconciled = await searchPurchase(latest)
    return interpretPurchase(latest, currentIntent.id, reconciled.decision, reconciled.payload)
  }
  return interpretPurchase(purchaseSession, currentIntent.id, decision, charge.crudo)
}

export async function progressCapture(
  session: LoadedCardnetSession,
  request: Request
): Promise<CardnetReply> {
  if (session.estado === CARDNET_SESSION_STATES.ACTIVATION_REQUIRED) {
    return success(200, { status: 'activation_required' })
  }
  if (session.estado === CARDNET_SESSION_STATES.PURCHASE_PENDING && session.purchaseIntent) {
    if (session.purchaseIntent.estado === 'APROBADO') {
      return finishApproval(session, session.purchaseIntent.id, session.purchaseIntent.autorizacion, null)
    }
    const searched = await searchPurchase(session)
    if (searched.decision.kind !== 'pending') {
      return interpretPurchase(session, session.purchaseIntent.id, searched.decision, searched.payload)
    }
    return success(202, { status: 'pending' })
  }
  if (session.estado === CARDNET_SESSION_STATES.FULFILLMENT_PENDING) {
    if (session.purchaseIntent?.estado === 'APROBADO') {
      return finishApproval(
        session,
        session.purchaseIntent.id,
        session.purchaseIntent.autorizacion,
        null
      )
    }
    return success(202, { status: 'pending' })
  }
  if (session.estado === CARDNET_SESSION_STATES.ASSOCIATION_PENDING && session.purchaseIntent) {
    const associated = await associateApprovedCard(session)
    return associated ? success(200, { status: 'approved' }) : success(202, { status: 'pending' })
  }
  if (session.estado === CARDNET_SESSION_STATES.ACTIVATION_PROCESSING) {
    if (Date.now() - session.updatedAt.getTime() < ACTIVATION_CLAIM_STALE_MS) {
      return success(202, { status: 'pending' })
    }
    if (!(await claimStaleActivation(session))) return success(202, { status: 'pending' })
    const claimed = await loadSession(session.id, session.authSubject)
    if (!claimed) return success(202, { status: 'pending' })
    const profile = await getProfileForCharge(claimed)
    if (!profile) return success(202, { status: 'pending' })
    if (!profile.habilitado) {
      const required = await setActivationClaimState(claimed, CARDNET_SESSION_STATES.ACTIVATION_REQUIRED)
      return required ? success(200, { status: 'activation_required' }) : success(202, { status: 'pending' })
    }
    const ready = await setActivationClaimState(claimed, CARDNET_SESSION_STATES.PROFILE_PENDING)
    if (!ready) return success(202, { status: 'pending' })
    const fresh = await loadSession(claimed.id, claimed.authSubject)
    return fresh ? chargeWithProfile(fresh, profile, request) : success(202, { status: 'pending' })
  }
  if (
    session.estado !== CARDNET_SESSION_STATES.CAPTURE_CONSUMED &&
    session.estado !== CARDNET_SESSION_STATES.PROFILE_PENDING
  ) return fail(409, 'La sesión de pago ya fue procesada.')

  if (!(await claimProfileCheck(session))) return success(202, { status: 'pending' })
  const claimed = await loadSession(session.id, session.authSubject)
  if (!claimed?.customerId) return success(202, { status: 'pending' })
  const customer = await consultarClienteCardnet(claimed.customerId).catch(() => null)
  if (
    !customer ||
    customer.email?.trim().toLowerCase() !== claimed.cliente.email.trim().toLowerCase()
  ) return success(202, { status: 'pending' })
  const profile = seleccionarPerfilNuevo(customer.perfiles, baselineFromJson(claimed.perfilBase))
  if (profile.kind !== 'selected') return success(202, { status: 'pending' })
  if (!profile.perfil.habilitado) {
    const required = await setSessionState(claimed, CARDNET_SESSION_STATES.ACTIVATION_REQUIRED, {
      paymentProfileId: profile.perfil.paymentProfileId,
      perfilLeidoAt: new Date(),
    })
    return required ? success(200, { status: 'activation_required' }) : success(202, { status: 'pending' })
  }
  const ready = await setSessionState(claimed, CARDNET_SESSION_STATES.PROFILE_PENDING, {
    paymentProfileId: profile.perfil.paymentProfileId,
    perfilLeidoAt: new Date(),
  })
  if (!ready) return success(202, { status: 'pending' })
  const fresh = await loadSession(claimed.id, claimed.authSubject)
  return fresh ? chargeWithProfile(fresh, profile.perfil, request) : success(202, { status: 'pending' })
}

function baselineFromJson(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
