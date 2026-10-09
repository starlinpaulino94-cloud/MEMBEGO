import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import type { CardnetCaptureSession } from '../apps/client/src/lib/api'
import { buildCardnetCaptureDocument } from '../apps/client/src/components/pagos/cardnet/captureDocument.native'
import {
  createCardnetTokenGate,
  isAllowedCardnetFrameUrl,
  isAllowedCardnetNavigation,
  isCardnetSessionExpired,
  matchesActiveCaptureFrame,
  parseCardnetDiagnosticMessage,
  parseNativeCardnetMessage,
  resolveCardnetMerchantOrigin,
  sanitizeCardnetDiagnosticLocation,
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

test('resolves only an HTTPS merchant origin for the native capture document', () => {
  assert.equal(resolveCardnetMerchantOrigin(undefined), 'https://membego.com')
  assert.equal(resolveCardnetMerchantOrigin('https://checkout.example/'), 'https://checkout.example')
  for (const invalid of [
    '',
    'http://checkout.example',
    'https://checkout.example/pay',
    'https://checkout.example/?redirect=https://attacker.example',
    'https://user:password@checkout.example',
  ]) {
    assert.equal(resolveCardnetMerchantOrigin(invalid), null)
  }
})

test('allows exact CardNET session navigation on Android when isTopFrame is absent', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)
  assert.ok(config)
  const merchantOrigin = 'https://membego.com'
  const request = (url: string, isTopFrame?: boolean) =>
    isTopFrame === undefined ? { url } : { url, isTopFrame }

  assert.equal(isAllowedCardnetNavigation(request(config.iframeUrl), merchantOrigin, config, active), true)
  assert.equal(isAllowedCardnetNavigation(request('about:blank'), merchantOrigin, config, active), true)
  assert.equal(isAllowedCardnetNavigation(request('https://membego.com/', true), merchantOrigin, config, active), true)
  assert.equal(isAllowedCardnetNavigation(request('https://membego.com/__rn_cardnet_capture__/'), merchantOrigin, config, active), true)
  assert.equal(isAllowedCardnetNavigation(request(config.iframeUrl, false), merchantOrigin, config, active), true)
  assert.equal(isAllowedCardnetNavigation(request('https://membego.com/pay', true), merchantOrigin, config, active), false)
  assert.equal(isAllowedCardnetNavigation(request('http://membego.com/', true), merchantOrigin, config, active), false)
  assert.equal(isAllowedCardnetNavigation(request('https://attacker.example/', undefined), merchantOrigin, config, active), false)
  assert.equal(isAllowedCardnetNavigation(request(config.iframeUrl.replace('customer-unique-id-fixture', 'other-id')), merchantOrigin, config, active), false)
  assert.equal(isAllowedCardnetNavigation(request(config.iframeUrl), 'http://membego.com', config, active), false)
})

test('CardNET diagnostics accept fixed stages and omit query or identifier values', () => {
  assert.deepEqual(parseCardnetDiagnosticMessage(JSON.stringify({
    type: 'CARDNET_DIAGNOSTIC',
    stage: 'sdk_ready',
  })), { type: 'CARDNET_DIAGNOSTIC', stage: 'sdk_ready' })
  assert.equal(parseCardnetDiagnosticMessage(JSON.stringify({
    type: 'CARDNET_DIAGNOSTIC',
    stage: 'sdk_ready',
    sessionId: 'private-session-fixture',
  })), null)
  assert.deepEqual(
    sanitizeCardnetDiagnosticLocation('https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/?key=secret-public-key&session_id=secret-session'),
    { host: 'servicios.cardnet.com.do', path: '/servicios/tokens/v1/Capture/' },
  )
  const location = sanitizeCardnetDiagnosticLocation('https://servicios.cardnet.com.do/private-session-identifier-1234567890')
  assert.ok(location)
  assert.equal(location.path.includes('private-session-identifier-1234567890'), false)
  assert.equal(sanitizeCardnetDiagnosticLocation('http://servicios.cardnet.com.do/path'), null)
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

test('keeps the generated native WebView document free of literal NUL bytes', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)
  assert.ok(config)

  const html = buildCardnetCaptureDocument(active, config)
  assert.equal(html.includes(String.fromCharCode(0)), false)
})

test('opens the provider capture only after a user tap once PWCheckout is ready', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)
  assert.ok(config)

  const calls: string[] = []
  const frames: Array<{ src: string; contentWindow: object }> = []
  const listeners = new Map<string, () => void>()
  const scriptListeners = new Map<string, () => void>()
  const button = {
    disabled: true,
    textContent: 'Preparando formulario seguro',
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
  }
  const status = { textContent: '' }
  const properties: Record<string, unknown>[] = []
  const sdk = {
    Bind: (event: string) => calls.push(`bind:${event}`),
    SetProperties: (value: Record<string, unknown>) => {
      calls.push('set-properties')
      properties.push(value)
    },
    OpenIframeCustom: (url: string, uniqueId: string) => {
      calls.push('open-capture')
      assert.equal(url, config.iframeUrl)
      assert.equal(uniqueId, active.uniqueId)
      frames.push({ src: url, contentWindow: {} })
    },
  }
  let sdkAvailable = false
  const sdkScript = {
    src: '',
    async: false,
    addEventListener: (name: string, listener: () => void) => scriptListeners.set(name, listener),
  }
  const messages: string[] = []
  const document = {
    documentElement: {},
    getElementById: (id: string) => id === 'open-capture' ? button : status,
    querySelector: () => null,
    querySelectorAll: () => frames,
    createElement: () => sdkScript,
    head: { appendChild: () => undefined },
  }
  const windowObject = {
    get PWCheckout() { return sdkAvailable ? sdk : undefined },
    ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    addEventListener: () => undefined,
  }

  const html = buildCardnetCaptureDocument(active, config)
  const inlineScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source?.includes('CARDNET_TOKEN_CREATED'))
  assert.ok(inlineScript)

  runInNewContext(inlineScript, {
    MutationObserver: class { observe() {} },
    URL,
    document,
    window: windowObject,
  })

  assert.equal(sdkScript.src, config.scriptUrl)
  assert.equal(sdkScript.async, true)
  assert.equal(button.disabled, true)
  sdkAvailable = true
  scriptListeners.get('load')?.()

  assert.deepEqual(calls, ['bind:tokenCreated'])
  assert.equal(button.disabled, false)
  assert.equal(frames.length, 0)

  listeners.get('click')?.()

  assert.deepEqual(calls, ['bind:tokenCreated', 'set-properties', 'open-capture'])
  assert.equal(properties[0]?.form_id, 'cardnet_capture_form')
  assert.equal(properties[0]?.empty, 'false')
  assert.equal(properties[0]?.autoSubmit, 'false')
  assert.equal(Object.hasOwn(properties[0] ?? {}, 'amount'), false)
  assert.equal(frames.length, 1)
  assert.ok(messages.some((message) => message.includes('capture_opened')))
})

test('native capture surface fills its modal and colors stay tied to semantic client tokens', () => {
  const nativeSurface = readFileSync(
    new URL('../apps/client/src/components/pagos/cardnet/CaptureSurface.native.tsx', import.meta.url),
    'utf8',
  )
  const nativeDocument = readFileSync(
    new URL('../apps/client/src/components/pagos/cardnet/captureDocument.native.ts', import.meta.url),
    'utf8',
  )

  assert.match(nativeSurface, /className="flex-1 bg-background"/)
  assert.match(nativeSurface, /style=\{\{ flex: 1, opacity: 1 \}\}/)
  assert.doesNotMatch(nativeSurface, /height: 284/)
  assert.doesNotMatch(nativeSurface, /\bbg-white\b/)
  assert.match(nativeDocument, /cssRgba\(colors\.surface\.foreground, 0\.06\)/)
  assert.doesNotMatch(nativeDocument, /rgba\(\s*\d+/)
  assert.doesNotMatch(nativeDocument, /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i)
})
