import 'server-only'
import { prisma } from '@/lib/prisma'
import { logErrorBd } from '@/lib/prisma-errors'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { esEmpresaDemo } from '@/modules/demo'
import {
  getTokensConfig,
  cardnetTokensConfigurado,
  cobrarConToken,
  consultarClienteCardnet,
} from '@/lib/payments/cardnet-tokens'
import { MENSAJE_ACTIVACION_PENDIENTE } from '@/lib/payments/cardnet-tokens-core'
import { crearIntento, confirmarIntento } from '@/modules/pagos/intentos'
import { montoDeObjetivo, type ObjetivoPago } from '@/modules/pagos/cardnet3ds'

/**
 * ORQUESTACIÓN DEL COBRO CON TARJETA HOSPEDADA (CardNET Tokenización).
 *
 * El navegador abre el iframe de CardNET, el cliente digita la tarjeta ALLÁ, y
 * nos devuelve un TOKEN. Este módulo recibe ese token y cobra. La tarjeta nunca
 * llega aquí — por eso este flujo es mucho más simple y seguro que el directo
 * (`cardnet3ds.ts`): no hay 3DS que orquestar (lo hace el iframe), no hay PAN.
 *
 * GARANTÍAS (las mismas del flujo directo):
 *  1. EL MONTO SALE DE LA BASE, NUNCA DEL NAVEGADOR (`montoDeObjetivo`).
 *  2. SOLO CARTOWN: capacidad `PAGO_CARDNET` + no empresa demo.
 *  3. IDEMPOTENCIA: activa una sola vez (`confirmarIntento`).
 *  4. EL TOKEN NO SE GUARDA (en Fase 1). Se usa para el cobro y se descarta.
 */

export type CobroTokenResultado =
  | { estado: 'aprobado'; compraId: string | null; membershipId: string | null }
  | { estado: 'rechazado'; motivo: string }
  | { estado: 'error'; motivo: string }

/** ¿Puede esta empresa cobrar con tarjeta hospedada ahora mismo? */
export async function puedeCobrarToken(companyId: string): Promise<boolean> {
  if (!cardnetTokensConfigurado()) return false
  const [capacidad, demo] = await Promise.all([
    tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false),
    esEmpresaDemo(companyId),
  ])
  return capacidad && !demo
}

/**
 * Cobra un objetivo (membresía o compra) con el token del iframe. Registra el
 * intento, cobra, y activa el producto si aprobó — todo con el monto de la base.
 */
export async function cobrarObjetivoConToken(input: {
  objetivo: ObjetivoPago
  trxToken: string
  clienteIp: string
  userAgent?: string | null
}): Promise<CobroTokenResultado> {
  if (!getTokensConfig() || !(await puedeCobrarToken(input.objetivo.companyId))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }
  if (!input.trxToken || input.trxToken.length < 8) {
    return { estado: 'error', motivo: 'No se recibió una tarjeta válida. Intenta de nuevo.' }
  }

  const monto = await montoDeObjetivo(input.objetivo)
  if (!monto) return { estado: 'error', motivo: 'No se encontró qué pagar, o ya no está pendiente.' }
  if (monto.pesos <= 0) return { estado: 'error', motivo: 'El monto a pagar no es válido.' }

  const intento = await crearIntento({
    companyId: input.objetivo.companyId,
    clienteId: input.objetivo.clienteId,
    proveedor: 'CARDNET',
    membershipId: input.objetivo.membershipId ?? null,
    compraId: input.objetivo.compraId ?? null,
    monto: monto.pesos,
    moneda: 'DOP',
    ipAddress: input.clienteIp,
    userAgent: input.userAgent ?? null,
  })

  let cobro
  try {
    cobro = await cobrarConToken({
      trxToken: input.trxToken,
      pesos: monto.pesos,
      orden: intento.id,
      clienteIp: input.clienteIp,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet-token:cobrar', e, { intentoId: intento.id })
    await confirmarIntento(intento.id, {
      aprobada: false,
      autorizacion: null,
      motivo: 'No se pudo contactar la pasarela.',
      crudo: null,
    })
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.' }
  }

  const res = await confirmarIntento(intento.id, {
    aprobada: cobro.aprobada,
    autorizacion: cobro.autorizacion,
    motivo: cobro.motivo,
    crudo: cobro.crudo,
  })

  if (res.ok) {
    return { estado: 'aprobado', compraId: res.compraId, membershipId: res.membershipId }
  }
  if (res.estado === 'RECHAZADO') {
    return { estado: 'rechazado', motivo: cobro.motivo ?? 'La tarjeta fue rechazada.' }
  }
  return { estado: 'error', motivo: res.motivo }
}

// ── Confirmación por perfil (camino oficial confirmado por CardNET) ─────────

/** Referencias del perfil cobrado, por si el cliente pidió guardar la tarjeta. */
export interface PerfilCobrado {
  customerId: string
  paymentProfileId: string | null
  token: string | null
  marca: string | null
  ultimos4: string | null
}

export type ConfirmacionPerfilResultado =
  | { estado: 'aprobado'; compraId: string | null; membershipId: string | null; perfil: PerfilCobrado }
  | { estado: 'sin_tarjeta' }
  | { estado: 'en_proceso' }
  | { estado: 'sin_pendiente' }
  /**
   * La tarjeta se registró pero CardNET la dejó deshabilitada a la espera del
   * código de activación de 6 dígitos (§4.1.2.3). Es un estado TERMINAL del
   * sondeo: seguir esperando no la va a habilitar sola.
   */
  | { estado: 'pendiente_activacion'; motivo: string; ultimos4: string | null }
  | { estado: 'rechazado'; motivo: string }
  | { estado: 'error'; motivo: string }

// Ventana en la que un intento CREADO se considera "en vuelo" y bloquea un
// segundo cobro del mismo objetivo (los dos canales — navegador y sondeo —
// pueden llegar casi a la vez).
const VENTANA_EN_VUELO_MS = 2 * 60 * 1000

/**
 * COBRA EL PENDIENTE CONSULTANDO AL PROVEEDOR (sin token del navegador).
 *
 * Camino confirmado por CardNET: tras la captura hospedada, el token queda en
 * `PaymentProfiles` al consultar el Customer. El servidor registra/consulta el
 * Customer por el email del cliente, toma el perfil MÁS RECIENTE y cobra con
 * su token por la misma tubería idempotente de siempre.
 *
 * `conteoAntes` (opcional) es cuántos perfiles tenía el Customer al abrir la
 * ventana de pago: solo se cobra si hay MÁS perfiles ahora — así, si el
 * cliente cierra la ventana sin registrar la tarjeta, un perfil viejo no se
 * cobra por accidente.
 */
export async function cobrarPendienteConPerfil(input: {
  objetivo: ObjetivoPago
  emailCliente: string
  clienteIp: string
  userAgent?: string | null
  conteoAntes?: number | null
  /**
   * CustomerId de la sesión de captura, si el navegador lo trae. Con él la
   * consulta es un GET puro — CRÍTICO mientras la ventana está abierta: un
   * POST /customer con el mismo email genera un UniqueID nuevo e INVALIDA la
   * sesión de la ventana (la mata con INTERNAL_SERVER_ERROR). El valor no se
   * confía a ciegas: el Email del Customer debe coincidir con el del usuario.
   */
  customerId?: string | null
}): Promise<ConfirmacionPerfilResultado> {
  if (!(await puedeCobrarToken(input.objetivo.companyId))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }

  // ¿Hay un cobro de este mismo objetivo en vuelo? (doble canal / doble pestaña)
  const enVuelo = await prisma.pagoIntento
    .findFirst({
      where: {
        proveedor: 'CARDNET',
        estado: 'CREADO',
        createdAt: { gte: new Date(Date.now() - VENTANA_EN_VUELO_MS) },
        ...(input.objetivo.membershipId ? { membershipId: input.objetivo.membershipId } : {}),
        ...(input.objetivo.compraId ? { compraId: input.objetivo.compraId } : {}),
      },
      select: { id: true },
    })
    .catch(() => null)
  if (enVuelo) return { estado: 'en_proceso' }

  // Si ya no hay nada pendiente (p. ej. el otro canal ya cobró y activó),
  // el sondeo termina sin error y sin doble cobro.
  const monto = await montoDeObjetivo(input.objetivo)
  if (!monto || monto.pesos <= 0) return { estado: 'sin_pendiente' }

  // Resolver el Customer SIN tocar la sesión de la ventana abierta: con el
  // customerId de la sesión se consulta por GET y se verifica la pertenencia
  // por email. Solo si no llegó (caso raro) se cae al POST /customer — que es
  // seguro únicamente cuando la ventana ya se cerró.
  let customerId = input.customerId?.trim() || null
  let perfiles: Awaited<ReturnType<typeof consultarClienteCardnet>>['perfiles']
  if (customerId) {
    const consulta = await consultarClienteCardnet(customerId)
    const emailCoincide =
      !!consulta.email &&
      consulta.email.trim().toLowerCase() === input.emailCliente.trim().toLowerCase()
    if (!emailCoincide) {
      // Customer ajeno o consulta fallida: no se cobra nada con él.
      return { estado: 'sin_tarjeta' }
    }
    perfiles = consulta.perfiles
  } else {
    // Sin customerId del navegador: se usa el guardado del cliente (§4.1.2.1).
    // NUNCA se hace POST aquí — la ventana de captura puede seguir abierta y
    // un POST emitiría un UniqueID nuevo, matándola con INTERNAL_SERVER_ERROR.
    const guardado = await prisma.cliente
      .findUnique({
        where: { id: input.objetivo.clienteId },
        select: { cardnetCustomerId: true },
      })
      .catch(() => null)
    customerId = guardado?.cardnetCustomerId?.trim() || null
    if (!customerId) return { estado: 'sin_tarjeta' }
    perfiles = (await consultarClienteCardnet(customerId)).perfiles
  }
  const conteoAntes = Math.max(0, input.conteoAntes ?? 0)
  // Sin perfil NUEVO todavía: el cliente sigue digitando (o cerró sin terminar).
  if (perfiles.length === 0 || perfiles.length <= conteoAntes) {
    return { estado: 'sin_tarjeta' }
  }
  // El perfil recién agregado es el último de la lista (VERIFICAR-QA el orden).
  const perfil = perfiles[perfiles.length - 1]
  if (!perfil.token) return { estado: 'sin_tarjeta' }

  // MANUAL §4.1.2.2 punto 12: el PaymentProfile puede venir `Enabled: false`.
  // Con las llaves CON autenticación, la tarjeta recién capturada nace así:
  // CardNET cobra RD$1.00 y el banco le muestra al cliente un código de 6
  // dígitos que hay que ingresar para activarla (§4.1.2.3). Cobrar con un
  // perfil deshabilitado falla, y el fallo no explica por qué — por eso se
  // detecta aquí y se le dice al cliente qué tiene que hacer.
  if (!perfil.habilitado) {
    return {
      estado: 'pendiente_activacion',
      ultimos4: perfil.ultimos4,
      motivo: MENSAJE_ACTIVACION_PENDIENTE,
    }
  }

  const res = await cobrarObjetivoConToken({
    objetivo: input.objetivo,
    trxToken: perfil.token,
    clienteIp: input.clienteIp,
    userAgent: input.userAgent,
  })
  if (res.estado === 'aprobado') {
    return {
      ...res,
      perfil: {
        customerId,
        paymentProfileId: perfil.paymentProfileId,
        token: perfil.token,
        marca: perfil.marca,
        ultimos4: perfil.ultimos4,
      },
    }
  }
  return res
}
