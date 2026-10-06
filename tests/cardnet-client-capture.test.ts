import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { CardnetCaptureSession } from '../apps/client/src/lib/api'
import { buildCardnetCaptureDocument } from '../apps/client/src/components/pagos/cardnet/captureDocument.native'
import {
  createCardnetTokenGate,
  isAllowedCardnetFrameUrl,
  isCardnetSessionExpired,
  matchesActiveCaptureFrame,
  parseNativeCardnetMessage,
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

test('rejects malformed, forged, wrong-session, and replayed native bridge messages', () => {
  const active = session()
  const payload = {
    type: 'CARDNET_TOKEN_CREATED',
    sessionId: active.sessionId,
    captureNonce: active.captureNonce,
    token: 'one-time-token-fixture-123',
  }
  assert.deepEqual(parseNativeCardnetMessage(JSON.stringify(payload), active), payload)
  assert.equal(parseNativeCardnetMessage('{not-json', active), null)
  assert.equal(parseNativeCardnetMessage(JSON.stringify({ ...payload, token: 'short' }), active), null)
  assert.equal(parseNativeCardnetMessage(JSON.stringify({ ...payload, sessionId: 'other-session' }), active), null)
  assert.equal(parseNativeCardnetMessage(JSON.stringify({ ...payload, captureNonce: 'other-nonce' }), active), null)
  assert.equal(parseNativeCardnetMessage(JSON.stringify({ ...payload, approved: true }), active), null)

  const acceptOnce = createCardnetTokenGate(active)
  assert.equal(acceptOnce('one-time-token-fixture-123')?.type, 'CARDNET_TOKEN_CREATED')
  assert.equal(acceptOnce('one-time-token-fixture-456'), null)
  assert.equal(createCardnetTokenGate(active)('not a token'), null)
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

test('escapes server session strings before embedding them in the native WebView script', () => {
  const attack = '</script><script>alert(1)</script>&' + String.fromCharCode(0x2028, 0x2029)
  const active = session({ sessionId: attack, captureNonce: attack })
  const config = validateCardnetCaptureSession(active)
  assert.ok(config)

  const html = buildCardnetCaptureDocument(active, config)
  const slash = String.fromCharCode(92)
  assert.equal(html.includes(attack), false)
  for (const escaped of ['u003c', 'u003e', 'u0026', 'u2028', 'u2029']) {
    assert.ok(html.includes(slash + escaped))
  }
})

test('native capture surface colors stay tied to semantic client tokens', () => {
  const nativeSurface = readFileSync(
    new URL('../apps/client/src/components/pagos/cardnet/CaptureSurface.native.tsx', import.meta.url),
    'utf8',
  )
  const nativeDocument = readFileSync(
    new URL('../apps/client/src/components/pagos/cardnet/captureDocument.native.ts', import.meta.url),
    'utf8',
  )

  assert.match(nativeSurface, /border border-border bg-card/)
  assert.doesNotMatch(nativeSurface, /\bbg-white\b/)
  assert.match(nativeDocument, /cssRgba\(colors\.surface\.foreground, 0\.06\)/)
  assert.doesNotMatch(nativeDocument, /rgba\(\s*\d+/)
  assert.doesNotMatch(nativeDocument, /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i)
})
