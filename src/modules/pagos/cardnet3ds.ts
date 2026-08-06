import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { logErrorBd } from '@/lib/prisma-errors'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { esEmpresaDemo } from '@/modules/demo'
import {
  getCardnetConfig,
  autenticar3DS,
  consultarEstado3DS,
  crearIdempotencyKey,
  procesarVenta,
  type CardnetConfig,
  type DatosBrowser,
  type Vencimiento,
} from '@/lib/payments/cardnet'
import { sinTarjeta, mensajeParaCliente } from '@/lib/payments/cardnet-core'
import { crearIntento, marcarRedirigido, confirmarIntento } from '@/modules/pagos/intentos'

/**
 * ORQUESTACIÓN DEL COBRO CON TARJETA (CardNET 3DS).
 *
 * Une las cuatro llamadas de `@/lib/payments/cardnet` con el registro de
 * intentos (`PagoIntento`) y la activación del producto. Es el único lugar
 * donde el dato de tarjeta y la maquinaria de pago se tocan.
 *
 * ── LO QUE ESTE MÓDULO GARANTIZA ────────────────────────────────────────────
 *
 *  1. EL MONTO SALE DE LA BASE DE DATOS, NUNCA DEL NAVEGADOR. El cliente manda
 *     QUÉ paga (una membresía o una compra por id); cuánto se cobra lo decide
 *     `montoDeObjetivo` leyendo el precio en la base. Un navegador manipulado
 *     no puede cobrarse RD$1 por un plan de RD$500.
 *
 *  2. SOLO CARTOWN. Se exige la capacidad `PAGO_CARDNET` encendida para la
 *     empresa Y que no sea una empresa de demostración. Aunque una ruta olvide
 *     comprobarlo, aquí se vuelve a comprobar: es la última puerta antes de
 *     mover dinero de verdad.
 *
 *  3. LA TARJETA NO SE GUARDA NI SE REGISTRA. El PAN/CVV entran como argumentos,
 *     van a CardNET y se descartan. Todo lo que se loguea pasa por
 *     `sinTarjeta()`.
 *
 *  4. IDEMPOTENCIA. La activación la hace `confirmarIntento`, que activa una
 *     sola vez aunque el flujo se repita (recarga, doble clic, reintento).
 *
 * ── EL FLUJO CON RETO ───────────────────────────────────────────────────────
 *
 * `iniciarPagoTarjeta` autentica. Si el banco no pide reto, cobra en el acto y
 * devuelve el resultado. Si pide reto, devuelve los datos para que el navegador
 * abra la pantalla del banco; cuando el cliente vuelve, el navegador llama a
 * `completarPagoTarjeta` con los MISMOS datos de tarjeta (que guardó en memoria,
 * nunca este servidor) y ahí se consulta el estado y se cobra.
 */

export interface Tarjeta {
  pan: string
  cvv: string
  vencimiento: Vencimiento
  cardholderName?: string
}

export interface ObjetivoPago {
  companyId: string
  clienteId: string
  /** Uno de los dos. */
  membershipId?: string | null
  compraId?: string | null
}

export type InicioResultado =
  | { estado: 'aprobado'; compraId: string | null; membershipId: string | null }
  | { estado: 'rechazado'; motivo: string }
  | {
      estado: 'reto'
      intentoId: string
      integratorTxId: string
      threeDSServerTransID: string
      challengeUrl: string
      challengeToken: string
    }
  | { estado: 'error'; motivo: string }

const MONEDA_DOP = '214'

/**
 * Cuánto se cobra por este objetivo, leído de la base. Devuelve null si el
 * objetivo no existe, no es de la empresa, o no está en un estado cobrable.
 */
export async function montoDeObjetivo(
  obj: ObjetivoPago
): Promise<{ pesos: number; descripcion: string } | null> {
  if (obj.membershipId) {
    const membershipId = obj.membershipId
    const m = await sinEmpresa(
      'pagos: leer membresía por id para validar objetivo de cobro (empresa se valida después)',
      (tx) =>
        tx.membership.findUnique({
          where: { id: membershipId },
          include: { plan: true, planSolicitado: true, cliente: true },
        })
    ).catch(() => null)
    if (!m || m.cliente.companyId !== obj.companyId || m.clienteId !== obj.clienteId) return null

    // Cambio de plan pendiente: se cobra el plan SOLICITADO. Si no, el actual.
    const esCambio = m.estado === 'ACTIVA' && m.planIdSolicitado != null
    const plan = esCambio ? m.planSolicitado : m.plan
    if (!plan) return null
    // El descuento de bienvenida solo en la primera activación (fechaInicio null).
    const descuento = m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
    const pesos = Math.max(0, Number(plan.precio) - descuento)
    return { pesos, descripcion: `${esCambio ? 'Cambio a ' : 'Plan '}${plan.nombre}` }
  }

  if (obj.compraId) {
    const compraId = obj.compraId
    const c = await sinEmpresa(
      'pagos: leer compra por id para validar objetivo de cobro (empresa se valida después)',
      (tx) =>
        tx.productoCompra.findUnique({
          where: { id: compraId },
          include: { promocion: true },
        })
    ).catch(() => null)
    if (!c || c.companyId !== obj.companyId || c.clienteId !== obj.clienteId) return null
    const pesos = Number(c.precioCongelado ?? c.promocion?.precio ?? 0)
    return { pesos, descripcion: c.promocion?.titulo ?? 'Compra' }
  }

  return null
}

/** ¿Puede esta empresa cobrar con CardNET ahora mismo? Última puerta. */
async function puedeCobrar(companyId: string, config: CardnetConfig | null): Promise<boolean> {
  if (!config) return false
  const [capacidad, demo] = await Promise.all([
    tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false),
    esEmpresaDemo(companyId),
  ])
  return capacidad && !demo
}

/**
 * Paso servidor tras tener autenticación 3DS: consulta el estado, cobra y
 * activa. Se usa tanto en el camino sin reto (dentro de `iniciar`) como al
 * volver del reto (`completar`). Recibe la tarjeta solo para el cobro.
 */
async function cobrarConEstado(
  config: CardnetConfig,
  intentoId: string,
  params: {
    threeDSServerTransID: string
    integratorTxId: string
    pesos: number
    tarjeta: Tarjeta
    clientIp: string
  }
): Promise<InicioResultado> {
  const estado = await consultarEstado3DS(config, {
    threeDSServerTransID: params.threeDSServerTransID,
    integratorTxId: params.integratorTxId,
    pesos: params.pesos,
  })
  if (!estado.ok || !estado.autenticado) {
    const motivo = estado.ok ? 'La autenticación del banco no se completó.' : estado.motivo
    await confirmarIntento(intentoId, { aprobada: false, autorizacion: null, motivo, crudo: estado.crudo })
    return { estado: 'rechazado', motivo }
  }

  const idem = await crearIdempotencyKey(config)
  if (!idem) {
    await confirmarIntento(intentoId, {
      aprobada: false,
      autorizacion: null,
      motivo: 'No se pudo iniciar el cobro (idempotency).',
      crudo: null,
    })
    return { estado: 'error', motivo: 'No se pudo iniciar el cobro. Intenta de nuevo.' }
  }

  const venta = await procesarVenta(config, {
    idempotencyKey: idem,
    pan: params.tarjeta.pan,
    cvv: params.tarjeta.cvv,
    vencimiento: params.tarjeta.vencimiento,
    pesos: params.pesos,
    monedaNum: MONEDA_DOP,
    referencia: intentoId,
    clientIp: params.clientIp,
    tds: estado.tds,
  })

  // El `crudo` que se guarda como evidencia NO lleva tarjeta: la respuesta de
  // venta de CardNET no la incluye, pero se pasa por sinTarjeta por si acaso.
  const evidencia = sinTarjeta((venta.crudo ?? {}) as Record<string, unknown>)

  const res = await confirmarIntento(intentoId, {
    aprobada: venta.aprobada,
    autorizacion: venta.autorizacion,
    motivo: venta.aprobada ? null : mensajeParaCliente(venta.responseCode),
    crudo: evidencia,
  })

  if (res.ok) {
    return { estado: 'aprobado', compraId: res.compraId, membershipId: res.membershipId }
  }
  return { estado: 'rechazado', motivo: mensajeParaCliente(venta.responseCode) }
}

/**
 * Inicia el cobro con tarjeta. Devuelve 'aprobado'/'rechazado' si no hubo reto,
 * o 'reto' con los datos para que el navegador abra la pantalla del banco.
 */
export async function iniciarPagoTarjeta(input: {
  objetivo: ObjetivoPago
  tarjeta: Tarjeta
  browser: DatosBrowser
  urlRetorno: string
  clientIp: string
}): Promise<InicioResultado> {
  const config = getCardnetConfig()
  if (!(await puedeCobrar(input.objetivo.companyId, config)) || !config) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
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
    ipAddress: input.clientIp,
    userAgent: input.browser.userAgent,
  })

  let auth
  try {
    auth = await autenticar3DS(config, {
      pan: input.tarjeta.pan,
      vencimiento: input.tarjeta.vencimiento,
      pesos: monto.pesos,
      monedaNum: MONEDA_DOP,
      urlRedirect: input.urlRetorno,
      rd: intento.id,
      browser: input.browser,
      cardholderName: input.tarjeta.cardholderName,
    })
  } catch (e) {
    logErrorBd('pagos:cardnet:autenticar', e, { intentoId: intento.id })
    return { estado: 'error', motivo: 'No se pudo contactar la pasarela. Intenta de nuevo.' }
  }

  if (auth.tipo === 'error') {
    logErrorBd('pagos:cardnet:autenticar:respuesta', new Error(auth.motivo), {
      intentoId: intento.id,
      crudo: sinTarjeta((auth.crudo ?? {}) as Record<string, unknown>),
    })
    await confirmarIntento(intento.id, {
      aprobada: false,
      autorizacion: null,
      motivo: 'No se pudo autenticar la tarjeta.',
      crudo: sinTarjeta((auth.crudo ?? {}) as Record<string, unknown>),
    })
    return { estado: 'error', motivo: 'No se pudo autenticar la tarjeta. Verifica los datos.' }
  }

  if (auth.tipo === 'reto') {
    await marcarRedirigido(intento.id, auth.threeDSServerTransID, input.objetivo.companyId)
    return {
      estado: 'reto',
      intentoId: intento.id,
      integratorTxId: auth.integratorTxId,
      threeDSServerTransID: auth.threeDSServerTransID,
      challengeUrl: auth.browserChallengeUrl,
      challengeToken: auth.browserChallengeToken,
    }
  }

  // Sin reto: cobrar en el acto.
  return cobrarConEstado(config, intento.id, {
    threeDSServerTransID: auth.threeDSServerTransID,
    integratorTxId: auth.integratorTxId,
    pesos: monto.pesos,
    tarjeta: input.tarjeta,
    clientIp: input.clientIp,
  })
}

/**
 * Completa el cobro después del reto del banco. El navegador llama aquí con los
 * handles del reto y la tarjeta que guardó en memoria. Se vuelve a resolver el
 * intento y su monto desde la base: el navegador no decide cuánto se cobra.
 */
export async function completarPagoTarjeta(input: {
  intentoId: string
  clienteId: string
  integratorTxId: string
  threeDSServerTransID: string
  tarjeta: Tarjeta
  clientIp: string
}): Promise<InicioResultado> {
  const config = getCardnetConfig()
  if (!config) return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }

  const intento = await sinEmpresa(
    'pagos: localizar intento por id al volver de la pasarela (puede ser de cualquier empresa)',
    (tx) => tx.pagoIntento.findUnique({ where: { id: input.intentoId } })
  ).catch(() => null)
  // El intento tiene que ser de ESTE cliente: así un navegador no completa el
  // pago de otro.
  if (!intento || intento.clienteId !== input.clienteId) {
    return { estado: 'error', motivo: 'No se encontró el pago en curso.' }
  }
  if (!(await puedeCobrar(intento.companyId, config))) {
    return { estado: 'error', motivo: 'El pago con tarjeta no está disponible.' }
  }
  // El threeDSServerTransID que manda el navegador debe coincidir con el que se
  // guardó al iniciar el reto. No es la barrera de seguridad principal (el monto
  // sale de la base), pero evita cruzar sesiones por error.
  if (intento.referenciaExterna && intento.referenciaExterna !== input.threeDSServerTransID) {
    return { estado: 'error', motivo: 'La sesión de pago no coincide.' }
  }

  return cobrarConEstado(config, intento.id, {
    threeDSServerTransID: input.threeDSServerTransID,
    integratorTxId: input.integratorTxId,
    pesos: Number(intento.monto),
    tarjeta: input.tarjeta,
    clientIp: input.clientIp,
  })
}
