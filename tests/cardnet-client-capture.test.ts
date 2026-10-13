import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm, { runInNewContext } from 'node:vm'
import type { CardnetCaptureSession } from '../apps/client/src/lib/api'
import { buildCardnetCaptureDocument } from '../apps/client/src/components/pagos/cardnet/captureDocument.native'
import { cardnetPaymentStatusSchema } from '../apps/client/src/lib/cardnet-api-contracts'
import { CARDNET_PAGE_HELPERS } from '../apps/client/src/components/pagos/cardnet/pageHelpers'
import {
  createCardnetTokenGate,
  decideCaptureStatus,
  extractCardnetToken,
  isAllowedCardnetFrameUrl,
  isAllowedCardnetNavigation,
  isCaptureStillOpen,
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
    setInterval: () => 1,
    clearInterval: () => undefined,
  })

  assert.equal(sdkScript.src, config.scriptUrl)
  assert.equal(sdkScript.async, true)
  assert.equal(button.disabled, true)
  sdkAvailable = true
  scriptListeners.get('load')?.()

  // El widget ha usado varios nombres para el mismo evento: se enlazan los tres.
  assert.deepEqual(calls, ['bind:tokenCreated', 'bind:TokenCreated', 'bind:token_created'])
  assert.equal(button.disabled, false)
  assert.equal(frames.length, 0)

  listeners.get('click')?.()

  assert.deepEqual(calls, ['bind:tokenCreated', 'bind:TokenCreated', 'bind:token_created', 'set-properties', 'open-capture'])
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


// ── El puente de la WebView: lo que fallaba en silencio ──────────────────────────────────────────────────────────────
//
// 18 sesiones seguidas de un mismo cliente quedaron en «captura abierta» con la tarjeta YA registrada en CardNET: la app
// nunca avisó al servidor. Causas probables (no se pudo ver el iframe real desde un teléfono): el widget añade parámetros a
// la dirección de su iframe y la app exigía que solo hubiera `key` y `session_id`; el token puede llegar en otro formato; el
// widget cierra su ventana antes de entregar el token (y su `Close` puede reventar). Estas pruebas EJECUTAN el documento
// real de la WebView contra un SDK simulado para cada una de esas formas.

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

test('the code that runs inside the WebView behaves exactly like the TypeScript versions', () => {
  const active = session()
  const config = validateCardnetCaptureSession(active)!
  const helpers = vm.runInNewContext(`${CARDNET_PAGE_HELPERS}; ({ tokenFrom, frameMatches, guardClose })`, { URL }) as {
    tokenFrom: (value: unknown, raw?: boolean) => string | null
    frameMatches: (src: string, cfg: object) => boolean
    guardClose: (sdk: unknown) => void
  }
  const valid = 'OT_01_valid_token_1234567'
  const payloads: unknown[] = [
    { TokenId: valid }, { tokenId: valid }, { Token: valid }, { token: valid }, { TrxToken: valid }, { PWToken: valid },
    { Response: { TokenId: valid } }, { response: { token: valid } }, { detail: { data: { Token: valid } } },
    { payload: { Data: { TokenId: valid } } }, JSON.stringify({ TokenId: valid }), JSON.stringify([{ TokenId: valid }]),
    JSON.stringify({ data: JSON.stringify({ TokenId: valid }) }), valid, `  ${valid}  `, 'short', 'two words here 1234',
    { TokenId: 'short' }, { TokenId: valid + ' ' }, { TokenId: 'x'.repeat(513) }, {}, [], null, undefined, 42, true, '{not json',
    { data: { data: { data: { TokenId: valid } } } }, { data: { data: { data: { data: { TokenId: valid } } } } },
    Object.create({ TokenId: valid }),
  ]
  for (const payload of payloads) {
    for (const raw of [false, true]) {
      assert.equal(helpers.tokenFrom(payload, raw), extractCardnetToken(payload, raw), JSON.stringify([payload, raw]))
    }
  }
  const pageConfig = { captureOrigin: config.origin, capturePath: '/servicios/tokens/v1/Capture/', publicKey: active.publicKey, uniqueId: active.uniqueId }
  const urls = [
    config.iframeUrl, widgetUrl(config, '&name=x&lang=ESP'), config.iframeUrl.replace('customer-unique-id-fixture', 'other-id'),
    config.iframeUrl.replace('key=public-key-fixture-123456', 'key=forged'), `${config.iframeUrl}&key=public-key-fixture-123456`,
    `${config.iframeUrl}&session_id=customer-unique-id-fixture`, `${config.iframeUrl}#h`, config.iframeUrl.replace('https://', 'http://'),
    config.iframeUrl.replace('lab.cardnet.com.do', 'lab.cardnet.com.do.attacker.example'), config.iframeUrl.replace('/Capture/', '/Capture-evil/'),
    config.iframeUrl.replace('https://', 'https://user:pass@'), 'not a url', '',
  ]
  for (const url of urls) {
    assert.equal(helpers.frameMatches(url, pageConfig), isAllowedCardnetFrameUrl(url, config, active), url)
  }
  const widget = { Iframe: { Close: () => { throw new Error("Cannot read properties of null (reading 'parentNode')") } } }
  helpers.guardClose(widget)
  assert.doesNotThrow(() => widget.Iframe.Close())
  const guarded = widget.Iframe.Close
  helpers.guardClose(widget)
  assert.equal(widget.Iframe.Close, guarded, 'guarding twice must not stack wrappers')
  assert.doesNotThrow(() => helpers.guardClose(undefined))
})

interface PageHarness {
  readonly posted: string[]
  readonly diagnostics: string[]
  readonly sdkScript: { src: string; listeners: Map<string, () => void> }
  readonly status: { textContent: string }
  readonly field: { value: string }
  readonly button: { disabled: boolean; textContent: string; click: () => void }
  readonly frames: Array<{ src: string }>
  readonly sdk: { callbacks: Array<(payload: unknown) => void>; closeCalls: number; opened: string[]; finish: (payload: unknown) => void }
  readonly tick: () => void
  readonly config: ReturnType<typeof validateCardnetCaptureSession>
  readonly active: CardnetCaptureSession
}

/** Ejecuta el documento REAL de la WebView con un SDK y un DOM de mentira. */
function loadCaptureDocument(options: { widgetAddsParams?: boolean; closeThrows?: boolean; sdkAvailable?: boolean; otherSession?: boolean } = {}): PageHarness {
  const active = session()
  const config = validateCardnetCaptureSession(active)!
  const html = buildCardnetCaptureDocument(active, config)
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)![1]
  // `posted` es lo que la app recibe como TOKEN; los avisos de diagnóstico del documento viajan por el mismo puente pero aparte.
  const posted: string[] = []
  const diagnostics: string[] = []
  const sdkScript = { src: '', async: false, listeners: new Map<string, () => void>(), addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener) } }
  const frames: Array<{ src: string }> = []
  const status = { textContent: '' }
  const field = { value: '' }
  let clickHandler: () => void = () => undefined
  const button = {
    disabled: true,
    textContent: '',
    addEventListener: (event: string, handler: () => void) => { if (event === 'click') clickHandler = handler },
    click: () => clickHandler(),
  }
  const sdk = {
    callbacks: [] as Array<(payload: unknown) => void>,
    closeCalls: 0,
    opened: [] as string[],
    // Lo que hace el SDK real al terminar: primero cierra su ventana (`Iframe.Close`) y DESPUÉS entrega el token. Si el
    // Close revienta y nadie lo ha blindado, la excepción se lleva por delante la entrega.
    finish: (payload: unknown) => {
      pwCheckoutRef.Iframe.Close()
      sdk.callbacks.forEach((callback) => callback(payload))
    },
  }
  const pwCheckoutRef = { Iframe: { Close: () => undefined as unknown } }
  const timers: Array<() => void> = []
  let observed: () => void = () => undefined
  const pwCheckout = {
    Bind: (_event: string, callback: (payload: unknown) => void) => { sdk.callbacks.push(callback) },
    SetProperties: () => undefined,
    OpenIframeCustom: (url: string) => {
      sdk.opened.push(url)
      if (options.otherSession) url = url.replace('customer-unique-id-fixture', 'someone-elses-session')
      frames.push({ src: options.widgetAddsParams ? `${url}&name=MembeGo&currency=DOP&lang=ESP&autoSubmit=false` : url })
      observed() // un navegador real avisa al MutationObserver de que apareció el iframe
    },
    Iframe: { Close: () => { sdk.closeCalls += 1; if (options.closeThrows) throw new Error('boom') } },
  }
  pwCheckoutRef.Iframe = pwCheckout.Iframe
  const window = {
    PWCheckout: options.sdkAvailable === false ? undefined : pwCheckout,
    ReactNativeWebView: { postMessage: (data: string) => { (JSON.parse(data).type === 'CARDNET_DIAGNOSTIC' ? diagnostics : posted).push(data) } },
  }
  const document = {
    documentElement: {},
    getElementById: (id: string) => (id === 'open-capture' ? button : id === 'status' ? status : id === 'PWToken' ? field : null),
    querySelectorAll: () => frames,
    // El documento carga el SDK por su cuenta (en la WebView de Android el <script> estático no llegaba a ejecutarse).
    createElement: () => sdkScript,
    head: { appendChild: () => undefined },
  }
  class FakeObserver {
    constructor(callback: () => void) { observed = callback }
    observe() { return undefined }
  }
  vm.runInNewContext(script, {
    window, document, URL, JSON, MutationObserver: FakeObserver,
    setInterval: (callback: () => void) => { timers.push(callback); return timers.length },
    clearInterval: () => undefined,
  })
  return { posted, diagnostics, sdkScript, status, field, button, frames, sdk, tick: () => timers.forEach((timer) => timer()), config, active }
}

const issuedToken = 'OT_01_issued_by_the_widget_123'

test('WebView page: the token reaches the app when the widget adds its own parameters to the iframe URL', () => {
  const page = loadCaptureDocument({ widgetAddsParams: true })
  page.button.click()
  assert.equal(page.frames.length, 1)
  page.sdk.callbacks[0]!({ TokenId: issuedToken })
  assert.equal(page.posted.length, 1)
  assert.deepEqual(JSON.parse(page.posted[0]!), {
    type: 'CARDNET_TOKEN_CREATED', sessionId: page.active.sessionId, captureNonce: page.active.captureNonce, token: issuedToken,
  })
  assert.ok(parseNativeCardnetMessage(page.posted[0]!, page.active), 'and the React Native side accepts exactly what the page sends')
})

test('WebView page: the token still arrives when the widget closes its iframe BEFORE delivering it', () => {
  const page = loadCaptureDocument()
  page.button.click()
  page.frames.length = 0
  page.sdk.callbacks[0]!({ TokenId: issuedToken })
  assert.equal(page.posted.length, 1)
})

test('WebView page: every payload shape the widget has used is accepted', () => {
  for (const payload of [issuedToken, JSON.stringify({ TokenId: issuedToken }), { Response: { TokenId: issuedToken } }, { detail: { Token: issuedToken } }]) {
    const page = loadCaptureDocument()
    page.button.click()
    page.sdk.callbacks[0]!(payload)
    assert.equal(page.posted.length, 1, JSON.stringify(payload))
  }
})

test('WebView page: plan B reads the hidden PWToken field when the callback never fires', () => {
  const page = loadCaptureDocument()
  page.tick()
  assert.equal(page.posted.length, 0, 'nothing happens before the capture form was opened')
  page.button.click()
  page.tick()
  assert.equal(page.posted.length, 0, 'an empty field is not a token')
  page.field.value = issuedToken
  page.tick()
  assert.equal(page.posted.length, 1)
})

test('WebView page: nothing is delivered before the right form was opened, for junk, for another session, or twice', () => {
  const early = loadCaptureDocument()
  early.sdk.callbacks[0]!({ TokenId: issuedToken })
  assert.equal(early.posted.length, 0, 'a token with no capture form ever opened is ignored')

  const junk = loadCaptureDocument()
  junk.button.click()
  for (const payload of [{ TokenId: 'short' }, {}, null, 'ready', { type: 'loaded' }]) junk.sdk.callbacks[0]!(payload)
  assert.equal(junk.posted.length, 0)

  const other = loadCaptureDocument({ otherSession: true })
  other.button.click()
  other.sdk.callbacks[0]!({ TokenId: issuedToken })
  assert.equal(other.posted.length, 0, 'a frame for a different session never counts')

  const twice = loadCaptureDocument()
  twice.button.click()
  twice.sdk.callbacks[0]!({ TokenId: issuedToken })
  twice.sdk.callbacks[0]!({ TokenId: `${issuedToken}_second` })
  twice.field.value = `${issuedToken}_third`
  twice.tick()
  assert.equal(twice.posted.length, 1, 'the capture is delivered once')
})

test('WebView page: a widget Close that throws before delivering the token does not lose the token', () => {
  const page = loadCaptureDocument({ closeThrows: true })
  page.button.click()
  assert.equal(page.sdk.opened.length, 1)
  assert.doesNotThrow(() => page.sdk.finish({ TokenId: issuedToken }))
  assert.equal(page.sdk.closeCalls, 1, 'the widget did try to close its window')
  assert.equal(page.posted.length, 1, 'and the token still reached the app')
})

test('WebView page: no SDK means a visible message, not a silent dead end', () => {
  const page = loadCaptureDocument({ sdkAvailable: false })
  assert.equal(page.sdkScript.src, page.config!.scriptUrl, 'the page asks for the SDK itself')
  assert.equal(page.sdk.callbacks.length, 0)
  assert.equal(page.button.disabled, true)
  page.sdkScript.listeners.get('error')?.()
  assert.equal(page.status.textContent, 'No se pudo cargar el formulario seguro.')
  assert.equal(page.button.disabled, true)
  assert.ok(page.diagnostics.some((message) => message.includes('sdk_script_failed')), 'and the app is told why')
  assert.equal(page.posted.length, 0)
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
