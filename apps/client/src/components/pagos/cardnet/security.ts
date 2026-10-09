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

export function extractCardnetToken(payload: unknown): string | null {
  if (!isPlainRecord(payload) || !Object.hasOwn(payload, 'TokenId')) return null
  return isValidOneTimeToken(payload.TokenId) ? payload.TokenId : null
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

export function isAllowedCardnetFrameUrl(
  rawUrl: string,
  config: CardnetCaptureConfig,
  session: Pick<CardnetCaptureSession, 'publicKey' | 'uniqueId'>
): boolean {
  const url = safeUrl(rawUrl)
  if (!url || url.protocol !== 'https:' || url.origin !== config.origin || url.pathname !== '/servicios/tokens/v1/Capture/') {
    return false
  }
  const keys = [...url.searchParams.keys()].sort()
  return (
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    keys.join(',') === 'key,session_id' &&
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

export function shouldRenderPaymentSuccess(status: CardnetPaymentStatus | null): boolean {
  return status?.status === 'approved'
}
