import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { activarPerfilCardnet, consultarClienteCardnet } from '@/lib/payments/cardnet-tokens'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import {
  CARDNET_SESSION_STATES,
  cardnetActivationInputSchema,
  cardnetConfirmInputSchema,
  cardnetStatusInputSchema,
  seleccionarPerfilNuevo,
} from '@/modules/pagos/cardnetClientCore'
import {
  CAPTURE_RECONCILE_MS,
  PURCHASE_RETRY_MS,
  anotarCapturaVencida,
  fail,
  hashNonce,
  success,
  type CardnetReply,
} from '@/modules/pagos/cardnetClienteShared'
import {
  expireSession,
  loadSession,
  renewActivationClaim,
  setActivationClaimState,
  claimProfileCheck,
  type LoadedCardnetSession,
} from '@/modules/pagos/cardnetClienteSesionStore'
import {
  finishApproval,
  interpretPurchase,
  searchPurchase,
} from '@/modules/pagos/cardnetClienteCompra'
import {
  advanceWithProfile,
  baselineFromJson,
  chargeWithProfile,
  getProfileForCharge,
  progressCapture,
} from '@/modules/pagos/cardnetClienteCaptura'
import { resolveTarget } from '@/modules/pagos/cardnetClienteObjetivo'
import type { SessionUser } from '@/types'

type ConsumirCaptura =
  | { readonly ok: true }
  | { readonly ok: false; readonly reply: CardnetReply; readonly vencida: boolean }

/**
 * Pasa una sesión de CAPTURE_OPEN a CAPTURE_CONSUMED, con las mismas garantías venga de donde venga la señal.
 *
 * Hay DOS señales de que la tarjeta ya se capturó y las dos terminan aquí:
 *   · la que manda la app (`/confirmar`, con el nonce de un solo uso), y
 *   · la que descubre el servidor por su cuenta al consultar a CardNET (`reconciliarCapturaAbierta`).
 *
 * La segunda existe porque la primera depende de que el puente del navegador de la app funcione, y cuando no lo hacía (la
 * tarjeta quedaba registrada en CardNET y la app no avisaba) la sesión se quedaba abierta hasta vencer, sin cobro y sin
 * rastro. El `token` que trae `/confirmar` nunca se usa para cobrar —el cobro lee el perfil nuevo directamente de CardNET—,
 * así que la señal solo decide CUÁNDO mirar, no QUÉ cobrar. Por eso la segunda es tan segura como la primera.
 *
 * Con `nonceHash` se exige el nonce (señal de la app); sin él (señal del servidor) basta la propiedad de la sesión, que
 * `loadSession` ya comprobó por `authSubject`.
 */
async function consumirCaptura(
  user: SessionUser,
  session: LoadedCardnetSession,
  nonceHash: string | null
): Promise<ConsumirCaptura> {
  const targetInput = session.membershipId && !session.compraId
    ? { membershipId: session.membershipId }
    : session.compraId && !session.membershipId
      ? { compraId: session.compraId }
      : null
  const currentTarget = targetInput ? await resolveTarget(user, targetInput) : null
  const expectedAmount = Number(session.monto)
  if (
    currentTarget?.kind !== 'ready' ||
    currentTarget.target.companyId !== session.companyId ||
    currentTarget.target.clienteId !== session.clienteId ||
    !Number.isFinite(expectedAmount) ||
    // Cambio de plan: el plan que se paga sigue siendo el que se pidió al abrir la sesión.
    (currentTarget.target.planDestinoId ?? null) !== (session.planDestinoId ?? null) ||
    Math.round(currentTarget.target.amount * 100) !== Math.round(expectedAmount * 100) ||
    (session.guardarTarjeta && !currentTarget.target.allowSaveCard)
  ) {
    await expireSession(session.id, session.companyId, user.supabaseId)
    return {
      ok: false,
      vencida: true,
      reply: fail(409, 'El objetivo de pago cambió. Actualiza la pantalla e intenta de nuevo.'),
    }
  }
  const claimed = await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: user.supabaseId,
        estado: CARDNET_SESSION_STATES.CAPTURE_OPEN,
        ...(nonceHash === null ? {} : { captureNonce: nonceHash }),
        venceAt: { gt: new Date() },
      },
      data: {
        estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED,
        captureNonce: null,
        capturadoAt: new Date(),
      },
    })
  ).catch(() => ({ count: 0 }))
  if (claimed.count !== 1) {
    return { ok: false, vencida: false, reply: fail(409, 'La sesión de pago ya fue procesada o venció.') }
  }
  return { ok: true }
}

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
  if (session.captureNonce !== hashNonce(parsed.data.captureNonce)) {
    return fail(409, 'La sesión de pago ya fue procesada o venció.')
  }
  const consumed = await consumirCaptura(user, session, hashNonce(parsed.data.captureNonce))
  if (!consumed.ok) return consumed.reply
  return progressCapture({ ...session, estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED }, request)
}

/**
 * LA RED DE SEGURIDAD DEL SERVIDOR: mientras la captura está abierta, mira en CardNET si la tarjeta ya existe.
 *
 * Antes, una sesión en CAPTURE_OPEN solo avanzaba si la app mandaba `/confirmar`, y `/estado` contestaba «pendiente» sin
 * mirar nada. Si la señal del navegador de la app se perdía por cualquier motivo (el formulario de CardNET añade parámetros a
 * su dirección, el widget entrega el token en otro formato, su `Close` revienta antes de entregarlo…), la tarjeta quedaba
 * registrada en CardNET y la sesión vencía a los 10 minutos sin cobrar. Pasó: 18 sesiones seguidas, ninguna pasó de abierta.
 *
 * Cada sondeo de `/estado` puede ahora comprobarlo, como mucho una vez cada `CAPTURE_RECONCILE_MS` por sesión. Se avanza
 * SOLO si CardNET muestra, para el Customer de esta sesión (con el correo del usuario verificado), UN perfil que no estaba al
 * abrirla. El resto de comprobaciones (objetivo, importe, consentimiento) son las de `/confirmar`.
 *
 * @returns la respuesta del avance, o `null` si no hay nada que avanzar todavía (el sondeo contesta «sigue abierta»).
 */
async function reconciliarCapturaAbierta(
  user: SessionUser,
  session: LoadedCardnetSession,
  request: Request
): Promise<CardnetReply | null> {
  if (!session.customerId) return null
  if (Date.now() - session.updatedAt.getTime() < CAPTURE_RECONCILE_MS) return null
  const claimedAt = new Date()
  const claimed = await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: {
        id: session.id,
        authSubject: user.supabaseId,
        estado: CARDNET_SESSION_STATES.CAPTURE_OPEN,
        updatedAt: session.updatedAt,
        venceAt: { gt: new Date() },
      },
      data: { updatedAt: claimedAt },
    })
  ).catch(() => ({ count: 0 }))
  if (claimed.count !== 1) return null

  const customer = await consultarClienteCardnet(session.customerId).catch(() => null)
  if (
    !customer ||
    customer.email?.trim().toLowerCase() !== session.cliente.email.trim().toLowerCase()
  ) return null
  const nuevo = seleccionarPerfilNuevo(customer.perfiles, baselineFromJson(session.perfilBase))
  if (nuevo.kind !== 'selected') return null

  const consumed = await consumirCaptura(user, { ...session, updatedAt: claimedAt }, null)
  if (!consumed.ok) {
    return consumed.vencida ? success(200, { status: 'expired' }) : success(202, { status: 'pending' })
  }
  console.warn('[pagos:cardnet-cliente] captura recuperada por el servidor: la app no avisó, CardNET sí tenía la tarjeta', {
    sessionId: session.id,
    clienteId: session.clienteId,
    transcurridoMs: Date.now() - session.createdAt.getTime(),
  })
  // El perfil nuevo YA está leído y verificado: no se le vuelve a pedir a CardNET (una segunda lectura que fallara dejaba la
  // sesión esperando). Se sigue por el mismo tramo que `progressCapture`: reclamar la comprobación y avanzar con ese perfil.
  const consumedSession = { ...session, estado: CARDNET_SESSION_STATES.CAPTURE_CONSUMED }
  if (!(await claimProfileCheck(consumedSession))) return success(202, { status: 'pending' })
  const claimedSession = await loadSession(session.id, user.supabaseId)
  if (!claimedSession) return success(202, { status: 'pending' })
  return advanceWithProfile(claimedSession, nuevo.perfil, request)
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
  const claimAt = new Date()
  const claimed = await conEmpresa(session.companyId, (tx) =>
    tx.cardnetCaptureSession.updateMany({
      where: { id: session.id, authSubject: user.supabaseId, estado: CARDNET_SESSION_STATES.ACTIVATION_REQUIRED },
      data: { estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING, updatedAt: claimAt },
    })
  ).catch(() => ({ count: 0 }))
  if (claimed.count !== 1) return success(202, { status: 'pending' })
  const activationSession = {
    ...session,
    estado: CARDNET_SESSION_STATES.ACTIVATION_PROCESSING,
    updatedAt: claimAt,
  }
  const profile = await getProfileForCharge(activationSession)
  if (!profile?.token) return success(202, { status: 'pending' })
  const currentClaim = await renewActivationClaim(activationSession)
  if (!currentClaim) return success(202, { status: 'pending' })
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
      const required = await setActivationClaimState(currentClaim, CARDNET_SESSION_STATES.ACTIVATION_REQUIRED)
      return required ? success(200, { status: 'activation_required' }) : success(202, { status: 'pending' })
    }
    const postActivationClaim = await renewActivationClaim(currentClaim)
    if (!postActivationClaim) return success(202, { status: 'pending' })
    const refreshed = await getProfileForCharge(postActivationClaim)
    if (!refreshed?.token || !refreshed.habilitado) return success(202, { status: 'pending' })
    const ready = await setActivationClaimState(postActivationClaim, CARDNET_SESSION_STATES.PROFILE_PENDING)
    if (!ready) return success(202, { status: 'pending' })
    const fresh = await loadSession(session.id, user.supabaseId)
    return fresh ? chargeWithProfile(fresh, refreshed, request) : success(202, { status: 'pending' })
  }
  const ready = await setActivationClaimState(currentClaim, CARDNET_SESSION_STATES.PROFILE_PENDING)
  if (!ready) return success(202, { status: 'pending' })
  const fresh = await loadSession(session.id, user.supabaseId)
  return fresh ? chargeWithProfile(fresh, profile, request) : success(202, { status: 'pending' })
}

/**
 * El estado de la sesión de pago, con una marca que la app necesita mientras muestra el formulario de la tarjeta:
 *
 *   · `pending` + `capture: 'open'`   → el servidor SIGUE esperando la tarjeta: el formulario debe seguir abierto.
 *   · `pending` + `capture: 'closed'` → la tarjeta ya se capturó y el pago avanza (se consulta, se cobra, se confirma):
 *     el formulario debe cerrarse.
 *
 * Son DOS valores a propósito. Si solo existiera `open`, una app nueva contra un servidor viejo (que no manda ninguna marca)
 * interpretaría «pendiente sin marca» como «ya avanzó» y cerraría el formulario a los pocos segundos en TODOS los pagos.
 * Así, la ausencia de marca significa «no sé»: se sigue esperando. Los demás estados (aprobado, rechazado, activación,
 * vencido) no necesitan marca.
 */
export async function estadoSesionCardnet(
  user: SessionUser,
  sessionIdValue: unknown,
  request: Request
): Promise<CardnetReply> {
  const reply = await estadoSinMarca(user, sessionIdValue, request)
  if (reply.status < 300 && reply.body.ok === true && reply.body.status === 'pending' && reply.body.capture === undefined) {
    return { ...reply, body: { ...reply.body, capture: 'closed' } }
  }
  return reply
}

async function estadoSinMarca(
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
      anotarCapturaVencida(session, 'estado')
      await expireSession(session.id, session.companyId, user.supabaseId)
      return success(200, { status: 'expired' })
    }
    const recuperada = await reconciliarCapturaAbierta(user, session, request)
    if (recuperada) return recuperada
    // `capture: 'open'` le dice a la app que la captura SIGUE abierta (puede seguir mostrando el formulario); un
    // «pendiente» sin ella significa que el pago ya avanzó y el formulario debe cerrarse.
    return success(200, { status: 'pending', capture: 'open' })
  }
  if (session.estado === CARDNET_SESSION_STATES.APPROVED) return success(200, { status: 'approved' })
  if (session.estado === CARDNET_SESSION_STATES.DECLINED) return success(200, { status: 'declined' })
  if (session.estado === CARDNET_SESSION_STATES.EXPIRED) return success(200, { status: 'expired' })
  if (session.estado === CARDNET_SESSION_STATES.FAILED) return fail(409, 'La sesión no pudo iniciarse.')
  if (session.estado === CARDNET_SESSION_STATES.PURCHASE_PENDING && session.purchaseIntent) {
    if (session.purchaseIntent.estado === 'APROBADO') {
      return finishApproval(session, session.purchaseIntent.id, session.purchaseIntent.autorizacion, null)
    }
    const searched = await searchPurchase(session)
    if (searched.decision.kind !== 'pending') {
      return interpretPurchase(session, session.purchaseIntent.id, searched.decision, searched.payload)
    }
    if (Date.now() - session.updatedAt.getTime() >= PURCHASE_RETRY_MS) {
      const claimedAt = new Date()
      const claimed = await conEmpresa(session.companyId, (tx) =>
        tx.cardnetCaptureSession.updateMany({
          where: {
            id: session.id,
            authSubject: user.supabaseId,
            estado: CARDNET_SESSION_STATES.PURCHASE_PENDING,
            updatedAt: { lt: new Date(Date.now() - PURCHASE_RETRY_MS) },
          },
          data: { updatedAt: claimedAt },
        })
      ).catch(() => ({ count: 0 }))
      if (claimed.count === 1) {
        const claimedSession = { ...session, updatedAt: claimedAt }
        const profile = await getProfileForCharge(claimedSession)
        if (profile?.token) return chargeWithProfile(claimedSession, profile, request)
      }
    }
    return success(202, { status: 'pending' })
  }
  return progressCapture(session, request)
}
