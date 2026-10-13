import type { CardnetCaptureSession, CardnetPaymentStatus } from '../../../lib/api'

export type CardnetCaptureMode = 'pruebas' | 'produccion'

export interface CardnetCaptureConfig {
  readonly mode: CardnetCaptureMode
  readonly origin: string
  readonly captureUrl: string
  readonly iframeUrl: string
  readonly scriptUrl: string
}

export interface CardnetTokenMessage {
  readonly type: 'CARDNET_TOKEN_CREATED'
  readonly sessionId: string
  readonly captureNonce: string
  readonly token: string
}

const CARDNET_MERCHANT_ORIGIN_FALLBACK = 'https://membego.com'
export const CARDNET_CAPTURE_DOCUMENT_PATH = '/__rn_cardnet_capture__/' as const

const CARDNET_DIAGNOSTIC_STAGES = [
  'document_ready',
  'sdk_script_loaded',
  'sdk_script_failed',
  'sdk_ready',
  'sdk_unavailable',
  'sdk_setup_failed',
  'capture_open_requested',
  'capture_opened',
  'capture_open_failed',
  'navigation_allowed',
  'navigation_rejected',
  'webview_load_start',
  'webview_load_end',
  'webview_error',
  'webview_http_error',
] as const

export type CardnetDiagnosticStage = (typeof CARDNET_DIAGNOSTIC_STAGES)[number]

export interface CardnetDiagnosticMessage {
  readonly type: 'CARDNET_DIAGNOSTIC'
  readonly stage: CardnetDiagnosticStage
}

export interface CardnetDiagnosticLocation {
  readonly host: string
  readonly path: string
}

function isCardnetDiagnosticStage(value: unknown): value is CardnetDiagnosticStage {
  return typeof value === 'string' && CARDNET_DIAGNOSTIC_STAGES.some((stage) => stage === value)
}

const MODE_CONFIG: Readonly<Record<CardnetCaptureMode, {
  origin: string
  capturePath: string
  scriptUrl: string
}>> = {
  pruebas: {
    origin: 'https://lab.cardnet.com.do',
    capturePath: '/servicios/tokens/v1/Capture/',
    scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js',
  },
  produccion: {
    origin: 'https://servicios.cardnet.com.do',
    capturePath: '/servicios/tokens/v1/Capture/',
    scriptUrl: 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js',
  },
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function resolveCardnetMerchantOrigin(value: string | undefined): string | null {
  if (value === undefined) return CARDNET_MERCHANT_ORIGIN_FALLBACK
  const url = safeUrl(value)
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null
  }
  return url.origin
}

export function parseCardnetDiagnosticMessage(raw: string): CardnetDiagnosticMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainRecord(parsed)) return null
  const keys = Object.keys(parsed).sort()
  if (
    keys.join(',') !== 'stage,type' ||
    parsed.type !== 'CARDNET_DIAGNOSTIC' ||
    !isCardnetDiagnosticStage(parsed.stage)
  ) {
    return null
  }
  return {
    type: 'CARDNET_DIAGNOSTIC',
    stage: parsed.stage,
  }
}

export function sanitizeCardnetDiagnosticLocation(rawUrl: string): CardnetDiagnosticLocation | null {
  const url = safeUrl(rawUrl)
  if (!url || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  const path = url.pathname
    .split('/')
    .map((segment) => (/^[A-Za-z0-9_-]{24,}$/.test(segment) || /^\d{8,}$/.test(segment) ? '[redacted]' : segment))
    .join('/')
  return { host: url.host, path }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isValidOneTimeToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u0020\u007f]/.test(value)
  )
}

/**
 * Nombres con los que el widget de CardNET puede entregar el token, en orden de preferencia. `TokenId` es el documentado
 * (manual §7.1); el resto son las grafías que ya tuvo que aceptar la pantalla web de pago. Aquí SOLO se aceptaba
 * `TokenId` en un objeto plano, y cualquier otra forma (el token como texto, un JSON en texto, un objeto envuelto) se
 * descartaba EN SILENCIO: la tarjeta quedaba registrada en CardNET y la app no avisaba al servidor.
 */
const TOKEN_KEYS = ['TokenId', 'tokenId', 'Token', 'token', 'TrxToken', 'trxToken', 'PWToken'] as const
const TOKEN_WRAPPERS = ['data', 'Data', 'detail', 'payload', 'Response', 'response'] as const

/**
 * Extrae el token de lo que entrega el widget. Con `raw` (la llamada directa del SDK, `tokenCreated`), un texto suelto ES
 * el token; en un mensaje del iframe solo cuentan objetos y JSON en texto (un texto cualquiera no es un token).
 *
 * La misma lógica vive escrita a mano dentro del documento de la WebView (`CARDNET_PAGE_HELPERS`); una prueba ejecuta
 * ese código y comprueba que coincide con esta función en cada caso.
 */
export function extractCardnetToken(payload: unknown, raw = false, depth = 0): string | null {
  if (typeof payload === 'string') {
    const text = payload.trim()
    if ((text.startsWith('{') || text.startsWith('[')) && depth < 3) {
      try {
        return extractCardnetToken(JSON.parse(text) as unknown, raw, depth + 1)
      } catch {
        return null
      }
    }
    return raw && depth === 0 && isValidOneTimeToken(text) ? text : null
  }
  if (!isPlainRecord(payload) || depth >= 4) return null
  for (const key of TOKEN_KEYS) {
    if (Object.hasOwn(payload, key) && isValidOneTimeToken(payload[key])) return payload[key]
  }
  for (const key of TOKEN_WRAPPERS) {
    if (Object.hasOwn(payload, key) && payload[key]) {
      const nested = extractCardnetToken(payload[key], raw, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

export function validateCardnetCaptureSession(
  session: CardnetCaptureSession
): CardnetCaptureConfig | null {
  const capture = safeUrl(session.captureUrl)
  const script = safeUrl(session.scriptUrl)
  if (!capture || !script) return null

  const mode = (Object.keys(MODE_CONFIG) as CardnetCaptureMode[]).find((candidate) => {
    const expected = MODE_CONFIG[candidate]
    return capture.origin === expected.origin
  })
  if (!mode) return null

  const expected = MODE_CONFIG[mode]
  if (
    capture.protocol !== 'https:' ||
    capture.origin !== expected.origin ||
    capture.pathname !== expected.capturePath ||
    capture.username !== '' ||
    capture.password !== '' ||
    capture.search !== '' ||
    capture.hash !== '' ||
    session.scriptUrl !== expected.scriptUrl ||
    script.href !== expected.scriptUrl ||
    script.protocol !== 'https:' ||
    script.username !== '' ||
    script.password !== '' ||
    script.search !== '' ||
    script.hash !== '' ||
    !isValidOneTimeToken(session.publicKey) ||
    !isValidOneTimeToken(session.uniqueId) ||
    !session.sessionId ||
    !session.captureNonce ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    !Number.isFinite(session.amount) ||
    session.amount <= 0 ||
    session.currency.length < 1 ||
    session.currency.length > 8
  ) {
    return null
  }

  const iframe = new URL(session.captureUrl)
  iframe.searchParams.set('key', session.publicKey)
  iframe.searchParams.set('session_id', session.uniqueId)

  const scriptUrl = new URL(expected.scriptUrl)
  scriptUrl.searchParams.set('key', session.publicKey)

  return {
    mode,
    origin: expected.origin,
    captureUrl: session.captureUrl,
    iframeUrl: iframe.toString(),
    scriptUrl: scriptUrl.toString(),
  }
}

export function isCardnetSessionExpired(session: Pick<CardnetCaptureSession, 'expiresAt'>, now = Date.now()): boolean {
  const expiresAt = Date.parse(session.expiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

/**
 * ¿Esta dirección es la ventana de captura DE ESTA SESIÓN?
 *
 * Quedan fijados el origen, la ruta, la llave pública y el `session_id` (el `UniqueID` del Customer). Los DEMÁS parámetros
 * se toleran a propósito: el widget de CardNET arrastra a la dirección del iframe los valores que se le configuran
 * (`Capture/?key=…&name=…&currency=…`; la pantalla web ya lo documenta y lo acepta). Antes aquí se exigía que las únicas
 * claves fueran `key` y `session_id`, así que el iframe REAL no coincidía, la app no reconocía su propia ventana y el token
 * se descartaba sin avisar, con la tarjeta ya registrada en CardNET.
 */
export function isAllowedCardnetFrameUrl(
  rawUrl: string,
  config: CardnetCaptureConfig,
  session: Pick<CardnetCaptureSession, 'publicKey' | 'uniqueId'>
): boolean {
  const url = safeUrl(rawUrl)
  if (!url || url.protocol !== 'https:' || url.origin !== config.origin || url.pathname !== '/servicios/tokens/v1/Capture/') {
    return false
  }
  return (
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    url.searchParams.getAll('key').length === 1 &&
    url.searchParams.getAll('session_id').length === 1 &&
    url.searchParams.get('key') === session.publicKey &&
    url.searchParams.get('session_id') === session.uniqueId
  )
}

export function isAllowedCardnetNavigation(
  request: { readonly url: string; readonly isTopFrame?: boolean },
  merchantOrigin: string,
  config: CardnetCaptureConfig,
  session: Pick<CardnetCaptureSession, 'publicKey' | 'uniqueId'>
): boolean {
  if (resolveCardnetMerchantOrigin(merchantOrigin) !== merchantOrigin) return false
  if (request.url === 'about:blank') return true
  if (isAllowedCardnetFrameUrl(request.url, config, session)) return true
  if (request.isTopFrame === false) return false

  const url = safeUrl(request.url)
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.origin === merchantOrigin &&
    url.username === '' &&
    url.password === '' &&
    (url.pathname === '/' || url.pathname === CARDNET_CAPTURE_DOCUMENT_PATH) &&
    url.search === '' &&
    url.hash === ''
  )
}

export function matchesActiveCaptureFrame(
  event: Pick<MessageEvent<unknown>, 'origin' | 'source' | 'data'>,
  expectedOrigin: string,
  activeFrame: Window | null
): boolean {
  return (
    activeFrame !== null &&
    event.origin === expectedOrigin &&
    event.source === activeFrame &&
    extractCardnetToken(event.data) !== null
  )
}

export function parseNativeCardnetMessage(
  raw: string,
  session: Pick<CardnetCaptureSession, 'sessionId' | 'captureNonce'>
): CardnetTokenMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainRecord(parsed)) return null
  const keys = Object.keys(parsed).sort()
  if (keys.join(',') !== 'captureNonce,sessionId,token,type') return null
  if (
    parsed.type !== 'CARDNET_TOKEN_CREATED' ||
    parsed.sessionId !== session.sessionId ||
    parsed.captureNonce !== session.captureNonce ||
    !isValidOneTimeToken(parsed.token)
  ) {
    return null
  }
  return {
    type: 'CARDNET_TOKEN_CREATED',
    sessionId: session.sessionId,
    captureNonce: session.captureNonce,
    token: parsed.token,
  }
}

export function createCardnetTokenGate(session: Pick<CardnetCaptureSession, 'sessionId' | 'captureNonce'>) {
  let consumed = false
  return (token: unknown): CardnetTokenMessage | null => {
    if (consumed || !isValidOneTimeToken(token)) return null
    consumed = true
    return {
      type: 'CARDNET_TOKEN_CREATED',
      sessionId: session.sessionId,
      captureNonce: session.captureNonce,
      token,
    }
  }
}

/**
 * ¿Esta respuesta de `/estado` dice que el servidor SIGUE esperando la tarjeta? Solo `pending` con `capture: 'closed'` dice que
 * ya avanzó; sin marca (un servidor que no la manda) no se sabe y se sigue esperando.
 */
export function isCaptureStillOpen(status: CardnetPaymentStatus): boolean {
  return status.status === 'pending' && status.capture !== 'closed'
}

export type CaptureStatusDecision =
  /** Es un resultado del servidor: se muestra (y el formulario se cierra). */
  | 'accept'
  /** No cambia nada: la captura sigue abierta, o es una respuesta atrasada que no debe pisar lo que ya se sabe. */
  | 'ignore'
  /** El token ya se entregó, `/confirmar` no avanzó y la tarjeta sigue sin verse: el formulario no puede quedar muerto. */
  | 'rearm'

/**
 * Qué hacer con una respuesta de `/estado` recibida mientras se captura. Es una función pura porque ahí vivía una carrera:
 * el token de la app y un sondeo coincidían, `/confirmar` respondía 409 («el servidor ya avanzó»), la consulta de respaldo se
 * descartaba por haber otra en vuelo y la pantalla se quedaba con el formulario reabierto pero sin entrega ni sondeo.
 *
 * `current` es lo último que el servidor dijo (`null` si nada). Una respuesta `pending` atrasada nunca pisa un resultado
 * (aprobado, rechazado, activación…) ya conocido.
 */
export function decideCaptureStatus(input: {
  readonly next: CardnetPaymentStatus
  readonly current: CardnetPaymentStatus | null
  readonly submitted: boolean
  readonly submitting: boolean
}): CaptureStatusDecision {
  const { next, current, submitted, submitting } = input
  if (!isCaptureStillOpen(next)) {
    if (next.status === 'pending' && current !== null && current.status !== 'pending') return 'ignore'
    return 'accept'
  }
  if (current !== null) return 'ignore'
  return submitted && !submitting ? 'rearm' : 'ignore'
}

export function shouldRenderPaymentSuccess(status: CardnetPaymentStatus | null): boolean {
  return status?.status === 'approved'
}
