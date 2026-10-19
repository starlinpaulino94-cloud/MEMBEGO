import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { CardnetCaptureSession } from '../apps/client/src/lib/api'
import { cardnetPaymentStatusSchema } from '../apps/client/src/lib/cardnet-api-contracts'
import {
  createCardnetTokenGate,
  decideCaptureStatus,
  extractCardnetToken,
  isAllowedCardnetFrameUrl,
  isCaptureStillOpen,
  isCardnetSessionExpired,
  matchesActiveCaptureFrame,
  shouldRenderPaymentSuccess,
  validateCardnetCaptureSession,
} from '../apps/client/src/components/pagos/cardnet/security'

const session = (patch: Partial<CardnetCaptureSession> = {}): CardnetCaptureSession => ({
  sessionId: 'session-id-fixture-1234567890',
  captureNonce: 'nonce-fixture-1234567890',
  expiresAt: '2026-10-06T18:00:00.000Z',
  amount: 1250,
  currency: 'DOP',
  captureUrl: 'https://lab.cardnet.com.do/servicios/tokens/v1/Capture/',
  scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js',
  publicKey: 'public-key-fixture-123456',
  uniqueId: 'customer-unique-id-fixture',
  ...patch,
})

test('validates the exact test and production capture/script pair', () => {
  const testConfig = validateCardnetCaptureSession(session())
  assert.equal(testConfig?.mode, 'pruebas')
  assert.equal(new URL(testConfig!.iframeUrl).origin, 'https://lab.cardnet.com.do')
  assert.equal(new URL(testConfig!.scriptUrl).origin, 'https://tr-tsp-test.gtp-seglan.com')

  const productionConfig = validateCardnetCaptureSession(session({
    captureUrl: 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/',
    scriptUrl: 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js',
  }))
  assert.equal(productionConfig?.mode, 'produccion')
  assert.equal(new URL(productionConfig!.scriptUrl).origin, 'https://tr-tsp.gtp-seglan.com')
})

test('rejects invalid initial URLs, hostile suffixes, mixed modes, and query overrides', () => {
  const invalidSessions = [
    session({ captureUrl: 'http://lab.cardnet.com.do/servicios/tokens/v1/Capture/' }),
    session({ captureUrl: 'https://lab.cardnet.com.do.attacker.example/servicios/tokens/v1/Capture/' }),
    session({ captureUrl: 'https://lab.cardnet.com.do.evil/servicios/tokens/v1/Capture/' }),
    session({ captureUrl: 'https://lab.cardnet.com.do/servicios/tokens/v1/Capture-evil/' }),
    session({ captureUrl: 'https://lab.cardnet.com.do/servicios/tokens/v1/Capture/?redirect=https://evil.example' }),
    session({ captureUrl: 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/' }),
    session({ scriptUrl: 'https://tr-tsp-test.gtp-seglan.com.attacker.example/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js' }),
    session({ scriptUrl: 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js' }),
    session({ scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js?key=forged' }),
    session({ uniqueId: 'id with spaces' }),
  ]
  for (const value of invalidSessions) assert.equal(validateCardnetCaptureSession(value), null)
})

test('accepts only the active capture iframe from the exact selected origin', () => {
  const frame = {} as Window
  const message = (origin: string, source: MessageEventSource | null) => ({
    origin,
    source,
    data: { TokenId: 'one-time-token-fixture-123' },
  })

  assert.equal(matchesActiveCaptureFrame(message('https://lab.cardnet.com.do', frame), 'https://lab.cardnet.com.do', frame), true)
  assert.equal(matchesActiveCaptureFrame(message('https://lab.cardnet.com.do.attacker.example', frame), 'https://lab.cardnet.com.do', frame), false)
  assert.equal(matchesActiveCaptureFrame(message('https://lab.cardnet.com.do', {} as Window), 'https://lab.cardnet.com.do', frame), false)
  assert.equal(matchesActiveCaptureFrame({ ...message('https://lab.cardnet.com.do', frame), data: { TokenId: 'short' } }, 'https://lab.cardnet.com.do', frame), false)
})


test('constrains native iframe navigation to this session capture URL', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)!
  assert.equal(isAllowedCardnetFrameUrl(config.iframeUrl, config, active), true)
  assert.equal(isAllowedCardnetFrameUrl('https://lab.cardnet.com.do.attacker.example/servicios/tokens/v1/Capture/?key=public-key-fixture-123456&session_id=customer-unique-id-fixture', config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(config.iframeUrl.replace('customer-unique-id-fixture', 'other-id'), config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(config.iframeUrl.replace('/Capture/', '/Capture-evil/'), config, active), false)
})

test('expires a capture session without treating it as a payment result', () => {
  assert.equal(isCardnetSessionExpired(session({ expiresAt: '2026-10-06T18:00:00.000Z' }), Date.parse('2026-10-06T17:59:59.000Z')), false)
  assert.equal(isCardnetSessionExpired(session({ expiresAt: '2026-10-06T18:00:00.000Z' }), Date.parse('2026-10-06T18:00:00.000Z')), true)
  assert.equal(shouldRenderPaymentSuccess(null), false)
})

test('a capture notification never renders payment success without server approval', () => {
  const acceptOnce = createCardnetTokenGate(session())
  assert.ok(acceptOnce('one-time-token-fixture-123'))
  assert.equal(shouldRenderPaymentSuccess(null), false)
  assert.equal(shouldRenderPaymentSuccess({ status: 'pending' }), false)
  assert.equal(shouldRenderPaymentSuccess({ status: 'activation_required' }), false)
  assert.equal(shouldRenderPaymentSuccess({ status: 'approved' }), true)
})


// ── Reconocer la ventana y leer el token: lo que fallaba en silencio ─────────────────────────────────────────────────
//
// 18 sesiones seguidas de un mismo cliente quedaron en «captura abierta» con la tarjeta YA registrada en CardNET: la app
// nunca avisó al servidor. El widget añade parámetros a la dirección de su iframe y el token puede llegar en otro formato.
// La ventana que la app abre en el navegador se prueba ejecutándola en tests/cardnet-ventana-navegador.test.ts.

const widgetUrl = (config: { iframeUrl: string }, extra = '') => `${config.iframeUrl}${extra}`

test('the native capture frame is recognised even when the widget appends its own parameters', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)!
  assert.equal(isAllowedCardnetFrameUrl(widgetUrl(config, '&name=MembeGo&currency=DOP&lang=ESP&amount=1250&autoSubmit=false'), config, active), true)
  // Lo que identifica la sesión sigue fijo: origen, ruta, llave pública y session_id, cada uno UNA vez.
  assert.equal(isAllowedCardnetFrameUrl(widgetUrl(config, '&key=public-key-fixture-123456'), config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(widgetUrl(config, '&session_id=customer-unique-id-fixture'), config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(widgetUrl(config, '#fragment'), config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(config.iframeUrl.replace('key=public-key-fixture-123456', 'key=forged'), config, active), false)
  assert.equal(isAllowedCardnetFrameUrl(config.iframeUrl.replace('https://', 'http://'), config, active), false)
})

test('the token is read from every shape the widget has been seen to use, and only valid ones', () => {
  const valid = 'OT_01_valid_token_1234567'
  const cases: Array<[unknown, boolean, string | null]> = [
    [{ TokenId: valid }, false, valid],
    [{ tokenId: valid }, false, valid],
    [{ Token: valid, other: 'x' }, false, valid],
    [{ Response: { TokenId: valid } }, false, valid],
    [{ detail: { data: { token: valid } } }, false, valid],
    [JSON.stringify({ TokenId: valid }), false, valid],
    [JSON.stringify({ data: { TokenId: valid } }), false, valid],
    [valid, true, valid],
    [valid, false, null],
    [{ TokenId: 'short' }, false, null],
    [{ TokenId: 'has a space in it 12345' }, false, null],
    [{ TokenId: 12345678901234 }, false, null],
    [{}, true, null],
    [null, true, null],
    [42, true, null],
    [[valid], true, null],
    [{ data: { data: { data: { data: { TokenId: valid } } } } }, false, null],
    [Object.create({ TokenId: valid }), false, null],
  ]
  for (const [payload, raw, expected] of cases) {
    assert.equal(extractCardnetToken(payload, raw), expected, JSON.stringify([payload, raw]))
  }
})

test('the status contract tells the app whether the capture is still open, closed, or unknown', () => {
  assert.deepEqual(cardnetPaymentStatusSchema.parse({ ok: true, status: 'pending', capture: 'open' }), { status: 'pending', capture: 'open' })
  assert.deepEqual(cardnetPaymentStatusSchema.parse({ ok: true, status: 'pending', capture: 'closed' }), { status: 'pending', capture: 'closed' })
  assert.deepEqual(cardnetPaymentStatusSchema.parse({ ok: true, status: 'pending' }), { status: 'pending' })
  assert.deepEqual(cardnetPaymentStatusSchema.parse({ status: 'approved', capture: 'open', other: 1 }), { status: 'approved' })
  assert.throws(() => cardnetPaymentStatusSchema.parse({ status: 'pending', capture: 'maybe' }))
})

const status = (value: unknown) => cardnetPaymentStatusSchema.parse(value)
const open = status({ status: 'pending', capture: 'open' })
const closed = status({ status: 'pending', capture: 'closed' })
const unmarked = status({ status: 'pending' })
const approved = status({ status: 'approved' })
const sent = { submitted: true, submitting: false }
const idle = { submitted: false, submitting: false }

test('only an explicit "closed" says the payment moved on; no marker (an older server) means keep waiting', () => {
  assert.equal(isCaptureStillOpen(open), true)
  assert.equal(isCaptureStillOpen(unmarked), true, 'an old server sends no marker: closing the form here would break every payment')
  assert.equal(isCaptureStillOpen(closed), false)
  for (const final of ['approved', 'declined', 'activation_required', 'expired']) {
    assert.equal(isCaptureStillOpen(status({ status: final })), false, final)
  }
})

test('what the capture screen does with each server answer (the race that left the screen dead)', () => {
  // El servidor avanzó o hay un resultado: se muestra y el formulario se cierra.
  assert.equal(decideCaptureStatus({ next: closed, current: null, ...idle }), 'accept')
  assert.equal(decideCaptureStatus({ next: approved, current: null, ...idle }), 'accept')
  assert.equal(decideCaptureStatus({ next: closed, current: closed, ...idle }), 'accept')
  // Sigue esperando la tarjeta: no se toca nada mientras el cliente la teclea.
  assert.equal(decideCaptureStatus({ next: open, current: null, ...idle }), 'ignore')
  assert.equal(decideCaptureStatus({ next: unmarked, current: null, ...idle }), 'ignore')
  assert.equal(decideCaptureStatus({ next: open, current: null, submitted: true, submitting: true }), 'ignore', '/confirmar sigue en vuelo')
  // EL CASO: el token ya se entregó, /confirmar no avanzó (409/red) y el servidor sigue sin ver la tarjeta → no dejar el
  // formulario muerto: se vuelve a armar.
  assert.equal(decideCaptureStatus({ next: open, current: null, ...sent }), 'rearm')
  assert.equal(decideCaptureStatus({ next: unmarked, current: null, ...sent }), 'rearm')
  // Una respuesta ATRASADA nunca pisa lo que el servidor ya dijo.
  assert.equal(decideCaptureStatus({ next: closed, current: approved, ...sent }), 'ignore')
  assert.equal(decideCaptureStatus({ next: open, current: closed, ...sent }), 'ignore')
  assert.equal(decideCaptureStatus({ next: open, current: approved, ...sent }), 'ignore')
  // Pero un resultado real sí cambia a otro resultado (p. ej. de «activación» a «aprobado»).
  assert.equal(decideCaptureStatus({ next: approved, current: status({ status: 'activation_required' }), ...sent }), 'accept')
})

test('the capture screen wires the policy: watches while the server has said nothing, never deduped away after a failed confirm', () => {
  const capture = readFileSync(new URL('../apps/client/src/components/pagos/cardnet/Capture.tsx', import.meta.url), 'utf8')
  // Vigila MIENTRAS el servidor no haya dicho nada, también con un error de captura a la vista o enviando el token.
  assert.match(capture, /const watching = config !== null && effectiveStatus === null/)
  assert.match(capture, /if \(!watching\) return\n\s+const interval = setInterval\(\(\) => \{\n\s+void refreshStatusRef\.current\(\{ silent: true \}\)/)
  assert.match(capture, /\}, \[watching\]\)/)
  assert.match(capture, /const CAPTURE_WATCH_MS = 3500/)
  // Un fallo de /confirmar consulta SIEMPRE (la consulta de respaldo en vuelo no puede descartarla) y con submittingRef ya libre.
  assert.match(capture, /submittingRef\.current = false\n\s+await refreshStatus\(\{ force: true \}\)/)
  assert.match(capture, /if \(pollInFlightRef\.current && !options\.force\) return null/)
  // Una red caída mientras se teclea la tarjeta no cambia el formulario por «estamos confirmando».
  assert.match(capture, /if \(!options\.silent\) setConfirmationUncertain\(true\)/)
  // La decisión sale de la política pura y rearmar remonta la superficie con un token nuevo.
  assert.match(capture, /decideCaptureStatus\(\{/)
  assert.match(capture, /submittedRef\.current = false\n\s+setSurfaceKey\(\(key\) => key \+ 1\)/)
  assert.match(capture, /<CardnetCaptureSurface\n\s+key=\{surfaceKey\}/)
  // Una respuesta de otra sesión no se aplica a esta.
  assert.match(capture, /if \(sessionIdRef\.current !== requestedFor\) return null/)
  // Lo que dice el servidor manda sobre un error de captura mostrado antes.
  assert.match(capture, /setCaptureFailure\(null\)\n\s+setConfirmationUncertain\(false\)\n\s+onStatusChange/)
})
