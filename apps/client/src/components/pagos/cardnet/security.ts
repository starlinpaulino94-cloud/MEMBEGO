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

/**
 * Adónde vuelve la ventana de CardNET abierta en el navegador del teléfono (`/api/v1/cliente/pagos/cardnet/ventana`).
 * Es el `scheme` de `app.json`; el servidor redirige exactamente aquí (`RETORNO_APP_CARDNET`) y una prueba fija que
 * los dos coinciden.
 */
export const CARDNET_WINDOW_RETURN_URL = 'membego://pago-cardnet' as const

/** ¿Este enlace es la vuelta de la ventana de CardNET? (`+native-intent` no debe navegar con él.) */
export function isCardnetWindowReturn(url: string): boolean {
  return url === CARDNET_WINDOW_RETURN_URL || url.startsWith(`${CARDNET_WINDOW_RETURN_URL}?`) || url.startsWith(`${CARDNET_WINDOW_RETURN_URL}/`)
}

/**
 * El token que trae la vuelta de la ventana, SOLO si es de esta sesión y tiene forma de token. Sin `URL`/`URLSearchParams`
 * a propósito: el esquema es propio y se lee a mano. Cualquier otra cosa da `null` y la app sigue con su sondeo (el
 * servidor ve la tarjeta nueva en CardNET aunque la vuelta se pierda).
 */
export function parseCardnetWindowReturn(url: string, sessionId: string): string | null {
  if (!isCardnetWindowReturn(url)) return null
  const query = url.split('?')[1]?.split('#')[0] ?? ''
  const params = new Map<string, string>()
  for (const pair of query.split('&')) {
    if (!pair) continue
    const [rawKey, rawValue = ''] = pair.split('=')
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      if (params.has(key)) return null
      params.set(key, decodeURIComponent(rawValue.replace(/\+/g, ' ')))
    } catch {
      return null
    }
  }
  const token = params.get('t')
  return params.get('s') === sessionId && isValidOneTimeToken(token) ? token : null
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
 * La ventana que la app abre en el navegador (`cardnetVentanaHtml.ts` del servidor) lleva esta misma lógica escrita a
 * mano; una prueba ejecuta ese código y comprueba que coincide con esta función en cada caso.
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
