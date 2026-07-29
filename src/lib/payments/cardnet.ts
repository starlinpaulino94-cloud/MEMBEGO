import 'server-only'
import { randomUUID } from 'node:crypto'
import {
  type Ambiente,
  type DatosTds,
  type Vencimiento,
  firmaAutenticacion,
  firmaEstado,
  montoMenor,
  vencimiento3DS,
  vencimientoVenta,
  normalizarPan,
  esAprobada,
  urlsDe,
} from './cardnet-core'

/**
 * CARDNET · capa de servidor (configuración + llamadas HTTP).
 *
 * La lógica pura (firmas, formatos, redacción, códigos) vive en `cardnet-core`.
 * Aquí está lo que toca el entorno y la red: leer los secretos, y hacer las
 * cuatro llamadas del flujo de cobro.
 *
 * PCI (el dueño de CARTOWN aceptó el modelo directo, SAQ D — ver
 * docs/PAGOS-CARDNET.md). Lo que el código garantiza:
 *   · `import 'server-only'` impide que esto llegue al navegador.
 *   · El PAN y el CVV entran solo como argumentos, viajan a CardNET por TLS, y
 *     se descartan al terminar. Nunca se guardan ni se registran. Para poner un
 *     objeto de esta capa en un log, usa `sinTarjeta()` de cardnet-core.
 *
 * El flujo (autenticar → estado → idempotency → venta) está descrito en
 * cardnet-core y en docs/PAGOS-CARDNET.md.
 */

export type { Ambiente, DatosTds, Vencimiento } from './cardnet-core'
export {
  sinTarjeta,
  parseVencimiento,
  normalizarPan,
  mensajeParaCliente,
  esAprobada,
} from './cardnet-core'

// ── Configuración ───────────────────────────────────────────────────────────

export interface CardnetConfig {
  /** API de pagos: número de afiliado del comercio. */
  merchantId: string
  /** API de pagos: número de terminal del comercio. */
  terminalId: string
  /** Servidor 3DS: código de integrador. */
  integratorCode: string
  /**
   * Servidor 3DS: clave para firmar. ES UN SECRETO — solo del entorno, jamás en
   * la base de datos ni en logs. CardNET la usa como secreto compartido:
   * cualquiera que la lea puede firmar cobros.
   */
  apiKey: string
  ambiente: Ambiente
}

/**
 * Lee la configuración del entorno. Devuelve null si falta algo: sin las cuatro
 * credenciales, CardNET no se ofrece (lo comprueba `metodosDisponibles`).
 */
export function getCardnetConfig(): CardnetConfig | null {
  const merchantId = process.env.CARDNET_MERCHANT_ID?.trim()
  const terminalId = process.env.CARDNET_TERMINAL_ID?.trim()
  const integratorCode = process.env.CARDNET_INTEGRATOR_CODE?.trim()
  const apiKey = process.env.CARDNET_API_KEY?.trim()
  if (!merchantId || !terminalId || !integratorCode || !apiKey) return null
  return {
    merchantId,
    terminalId,
    integratorCode,
    apiKey,
    ambiente: process.env.CARDNET_AMBIENTE === 'produccion' ? 'produccion' : 'pruebas',
  }
}

/** ¿Está CardNET configurado en este entorno? */
export function cardnetConfigurado(): boolean {
  return getCardnetConfig() !== null
}

// ── Transporte HTTP ─────────────────────────────────────────────────────────

const TIMEOUT_MS = 25_000

/**
 * POST JSON a CardNET con timeout y TLS (fetch usa HTTPS y valida el
 * certificado por defecto). No registra el cuerpo: si hay que loguear algo, el
 * llamador lo pasa por `sinTarjeta()` primero.
 */
async function postJson(
  url: string,
  cuerpo: unknown,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; texto: string; json: unknown }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
    })
    const texto = await resp.text()
    let json: unknown = null
    try {
      json = texto ? JSON.parse(texto) : null
    } catch {
      /* idempotency responde texto plano; el llamador decide */
    }
    return { ok: resp.ok, status: resp.status, texto, json }
  } finally {
    clearTimeout(t)
  }
}

// ── Paso 1: autenticación 3DS ───────────────────────────────────────────────

export interface DatosBrowser {
  screenWidth?: number
  screenHeight?: number
  ip: string
  tz?: number
  userAgent: string
  language?: string
  acceptHeader?: string
}

export interface AutenticacionInput {
  pan: string
  vencimiento: Vencimiento
  pesos: number
  monedaNum: string
  /** Nuestra URL de retorno donde CardNET deja al cliente tras el reto. */
  urlRedirect: string
  /** Datos que viajan de vuelta en el callback (nuestro id de intento). */
  rd?: string
  browser: DatosBrowser
  cardholderName?: string
  email?: string
}

export type ResultadoAutenticacion =
  | {
      tipo: 'sin_reto'
      /** integratorTxId que hay que arrastrar a la consulta de estado. */
      integratorTxId: string
      threeDSServerTransID: string
      transStatus: string
      crudo: unknown
    }
  | {
      tipo: 'reto'
      integratorTxId: string
      threeDSServerTransID: string
      browserChallengeUrl: string
      browserChallengeToken: string
      crudo: unknown
    }
  | { tipo: 'error'; motivo: string; crudo: unknown }

/**
 * Paso 1. Pide a CardNET autenticar la tarjeta. Genera el integratorTxId (hay
 * que devolverlo para el paso 2). El PAN entra aquí y no se guarda en ninguna
 * parte.
 */
export async function autenticar3DS(
  config: CardnetConfig,
  input: AutenticacionInput
): Promise<ResultadoAutenticacion> {
  const integratorTxId = randomUUID()
  const purchaseAmount = montoMenor(input.pesos)
  const cardExpiryDate = vencimiento3DS(input.vencimiento.mes, input.vencimiento.anio2)
  const firma = firmaAutenticacion(
    config.integratorCode,
    cardExpiryDate,
    integratorTxId,
    purchaseAmount,
    config.apiKey
  )

  const cuerpo: Record<string, unknown> = {
    integratorCode: config.integratorCode,
    integratorTxId,
    signature: firma,
    urlRedirect: input.urlRedirect,
    urlStatusCallback: null,
    purchaseAmount,
    purchaseCurrency: input.monedaNum,
    purchaseExponent: '2',
    acctNumber: normalizarPan(input.pan),
    cardExpiryDate,
    messageCategory: '01',
    deviceChannel: '02',
    browserJavascriptEnabled: true,
    browserIP: input.browser.ip,
    browserUserAgent: input.browser.userAgent,
    browserScreenWidth: String(input.browser.screenWidth ?? 1024),
    browserScreenHeight: String(input.browser.screenHeight ?? 768),
    browserTZ: String(input.browser.tz ?? 0),
    browserLanguage: input.browser.language ?? 'es',
    browserAcceptHeader: input.browser.acceptHeader ?? 'text/html',
    ...(input.rd ? { rd: input.rd } : {}),
    ...(input.cardholderName ? { cardholderName: input.cardholderName } : {}),
    ...(input.email ? { email: input.email } : {}),
  }

  const { tds } = urlsDe(config.ambiente)
  const r = await postJson(`${tds}/authentication`, cuerpo)
  const j = (r.json ?? {}) as Record<string, unknown>

  if (!r.ok) {
    return { tipo: 'error', motivo: `Autenticación 3DS respondió ${r.status}.`, crudo: j }
  }

  const transStatus = String(j.transStatus ?? '')
  const threeDSServerTransID = String(j.threeDSServerTransID ?? '')

  // 'C' = hay reto (challenge). El cliente debe ir a la pantalla del banco.
  if (transStatus === 'C') {
    const url = String(j.browserChallengeUrl ?? '')
    const token = String(j.browserChallengeToken ?? '')
    if (!url || !token || !threeDSServerTransID) {
      return { tipo: 'error', motivo: 'Reto 3DS incompleto en la respuesta.', crudo: j }
    }
    return {
      tipo: 'reto',
      integratorTxId,
      threeDSServerTransID,
      browserChallengeUrl: url,
      browserChallengeToken: token,
      crudo: j,
    }
  }

  // 'Y' = autenticado sin fricción. Sin threeDSServerTransID no hay forma de
  // continuar al estado, así que eso es un error.
  if (!threeDSServerTransID) {
    return {
      tipo: 'error',
      motivo: `Autenticación sin threeDSServerTransID (estado ${transStatus}).`,
      crudo: j,
    }
  }
  return { tipo: 'sin_reto', integratorTxId, threeDSServerTransID, transStatus, crudo: j }
}

// ── Paso 2: consulta de estado 3DS ──────────────────────────────────────────

export type ResultadoEstado =
  | { ok: true; autenticado: boolean; tds: DatosTds; crudo: unknown }
  | { ok: false; motivo: string; crudo: unknown }

/**
 * Paso 2. Tras el reto (o directo, si no hubo), pregunta a CardNET el resultado
 * de la autenticación y arma los campos `tds_*` que necesita la venta.
 *
 * `integratorTxId` y `pesos` son los ORIGINALES del paso 1: la firma de estado
 * se calcula con ellos, no con el threeDSServerTransID.
 */
export async function consultarEstado3DS(
  config: CardnetConfig,
  params: { threeDSServerTransID: string; integratorTxId: string; pesos: number }
): Promise<ResultadoEstado> {
  const purchaseAmount = montoMenor(params.pesos)
  const firma = firmaEstado(config.integratorCode, params.integratorTxId, purchaseAmount, config.apiKey)

  const { tds } = urlsDe(config.ambiente)
  const r = await postJson(`${tds}/status`, {
    integratorCode: config.integratorCode,
    threeDSServerTransID: params.threeDSServerTransID,
    signature: firma,
  })
  const j = (r.json ?? {}) as Record<string, unknown>

  if (!r.ok) return { ok: false, motivo: `Consulta de estado respondió ${r.status}.`, crudo: j }

  const transStatus = String(j.transStatus ?? '')
  // 'Y' = autenticado. Cualquier otro valor NO autentica y la venta no debe
  // intentarse: sin autenticación 3DS, el banco puede trasladar la
  // responsabilidad del fraude al comercio.
  const autenticado = transStatus === 'Y'

  return {
    ok: true,
    autenticado,
    tds: {
      servertransactionid: params.threeDSServerTransID,
      eci: String(j.eci ?? ''),
      avv: String(j.authenticationValue ?? ''),
      programprotocol: String(j.messageVersion ?? ''),
      dstransactionid: String(j.dsTransID ?? ''),
      status: transStatus,
    },
    crudo: j,
  }
}

// ── Paso 3: idempotency key ─────────────────────────────────────────────────

/**
 * Paso 3. Pide a CardNET un identificador que hace el cobro repetible sin
 * duplicar. La respuesta llega como texto `ikey:<valor>`.
 *
 * VERIFICAR-QA: el endpoint aparece escrito de dos formas en la documentación
 * (`idempotency-keys` en la guía, `idenpotency-keys` en el Postman). Se usa la
 * del Postman porque es el artefacto probado; si QA responde 404, es esto.
 */
export async function crearIdempotencyKey(config: CardnetConfig): Promise<string | null> {
  const { pagos } = urlsDe(config.ambiente)
  try {
    const resp = await fetch(`${pagos}/idenpotency-keys`, {
      method: 'POST',
      headers: { Accept: 'text/plain' },
    })
    if (!resp.ok) return null
    const texto = (await resp.text()).trim()
    const m = /(?:ikey:)?([\w-]{8,})/.exec(texto)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// ── Paso 4: venta ───────────────────────────────────────────────────────────

export interface VentaInput {
  idempotencyKey: string
  pan: string
  cvv: string
  vencimiento: Vencimiento
  pesos: number
  monedaNum: string
  /** Número de referencia propio (nuestro id de intento), para conciliar. */
  referencia: string
  clientIp: string
  tds: DatosTds
}

export interface ResultadoVenta {
  aprobada: boolean
  /** Código del banco emisor (2 dígitos); se puede mostrar al cliente. */
  responseCode: string
  /** Código interno de la plataforma (4 dígitos); NO mostrar al cliente. */
  internalCode: string
  descripcion: string
  autorizacion: string | null
  /** Referencia de la plataforma; se necesita para anular. */
  pnRef: string | null
  crudo: unknown
}

/**
 * Paso 4. El cobro. Aquí entran el PAN y el CVV por última vez; se descartan al
 * volver. `tds_mode` es 1 en producción (autenticando con el servidor de
 * CardNET) y 2 en QA, según la guía.
 *
 * VERIFICAR-QA: el nombre del campo del valor de autenticación aparece como
 * `tds_aav` en la tabla de parámetros pero como `tds_avv` en los ejemplos de
 * venta y en el Postman. Se envía `tds_avv` (el de los ejemplos probados).
 */
export async function procesarVenta(
  config: CardnetConfig,
  input: VentaInput
): Promise<ResultadoVenta> {
  const tdsMode = config.ambiente === 'produccion' ? '1' : '2'
  const cuerpo: Record<string, unknown> = {
    'idempotency-key': input.idempotencyKey,
    'merchant-id': config.merchantId,
    'terminal-id': config.terminalId,
    'card-number': normalizarPan(input.pan),
    environment: 'ECommerce',
    'expiration-date': vencimientoVenta(input.vencimiento.mes, input.vencimiento.anio2),
    cvv: input.cvv,
    amount: Number(input.pesos.toFixed(2)),
    currency: input.monedaNum,
    'invoice-number': input.referencia,
    'client-ip': input.clientIp,
    'reference-number': input.referencia,
    tax: 0,
    tip: 0,
    tds_mode: tdsMode,
    tds_servertransactionid: input.tds.servertransactionid,
    tds_eci: input.tds.eci,
    tds_avv: input.tds.avv,
    tds_programprotocol: input.tds.programprotocol,
    tds_dstransactionid: input.tds.dstransactionid,
    tds_status: input.tds.status,
  }

  const { pagos } = urlsDe(config.ambiente)
  const r = await postJson(`${pagos}/transactions/sales`, cuerpo)
  const j = (r.json ?? {}) as Record<string, unknown>

  const responseCode = String(j['response-code'] ?? '')
  const internalCode = String(j['internal-response-code'] ?? '')
  return {
    aprobada: esAprobada(responseCode, internalCode),
    responseCode,
    internalCode,
    descripcion: String(j['response-code-desc'] ?? (r.ok ? '' : `HTTP ${r.status}`)),
    autorizacion: (j['approval-code'] as string) ?? null,
    pnRef: (j.pnRef as string) ?? null,
    crudo: j,
  }
}

// ── Anulación (para reversar antes del cierre de las 7:00 PM) ────────────────

/**
 * Anula un cobro autorizado el mismo día (antes del cierre automático de las
 * 7:00 PM). Lo usa la conciliación cuando el monto no cuadra o un administrador
 * necesita reversar. No lleva datos de tarjeta.
 */
export async function anularVenta(
  config: CardnetConfig,
  params: {
    idempotencyKey: string
    pnRef: string
    pesos: number
    monedaNum: string
    referencia: string
    clientIp: string
  }
): Promise<{ ok: boolean; crudo: unknown }> {
  const { pagos } = urlsDe(config.ambiente)
  const r = await postJson(`${pagos}/transactions/voids`, {
    'idempotency-key': params.idempotencyKey,
    'merchant-id': config.merchantId,
    'terminal-id': config.terminalId,
    environment: 'ECommerce',
    amount: Number(params.pesos.toFixed(2)),
    currency: params.monedaNum,
    pnRef: params.pnRef,
    'invoice-number': params.referencia,
    'reference-number': params.referencia,
    'client-ip': params.clientIp,
  })
  const j = (r.json ?? {}) as Record<string, unknown>
  return {
    ok: esAprobada(String(j['response-code'] ?? ''), String(j['internal-response-code'] ?? '')),
    crudo: j,
  }
}
