import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import {
  RETORNO_APP_CARDNET,
  construirVentanaCardnet,
  construirVentanaNoDisponible,
  type DatosVentanaCardnet,
} from '../src/modules/pagos/cardnetVentanaHtml'
import {
  CARDNET_WINDOW_RETURN_URL,
  extractCardnetToken,
  isCardnetWindowReturn,
  parseCardnetWindowReturn,
} from '../apps/client/src/components/pagos/cardnet/security'
import { redirectSystemPath } from '../apps/client/app/+native-intent'

/**
 * EL FORMULARIO DE CARDNET DE LA APP SE ABRE EN EL NAVEGADOR DEL TELÉFONO (14-10-2026).
 *
 * En Android, dentro de la WebView, CardNET respondía «la autenticación falló» a las tarjetas cuyo banco pide 3D Secure;
 * la misma tarjeta se registraba bien en membego.com desde Chrome en el mismo teléfono. La app ahora abre una ventana que
 * sirve el servidor en una pestaña de Chrome / Safari. Estas pruebas EJECUTAN el script real de esa ventana contra un SDK
 * de CardNET y un DOM simulados, y fijan que la vuelta a la app y el router se entienden.
 */

const RAIZ = new URL('..', import.meta.url)
const leer = (ruta: string) => readFileSync(new URL(ruta, RAIZ), 'utf8')

const datos = (patch: Partial<DatosVentanaCardnet> = {}): DatosVentanaCardnet => ({
  sessionId: 'session-id-fixture-1234567890',
  captureUrl: 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/',
  scriptUrl: 'https://tr-tsp.gtp-seglan.com/tr-tsp-mw-cardnet/v1/Scripts/PWCheckout.js',
  publicKey: 'public-key-fixture-123456',
  uniqueId: 'customer-unique-id-fixture',
  montoTexto: 'RD$1,250.00',
  moneda: 'DOP',
  comercio: 'CARTOWN Wash & Detailing',
  ...patch,
})

const emitido = 'OT_01_issued_by_the_widget_123'

interface Ventana {
  readonly reemplazos: string[]
  readonly estado: { textContent: string }
  readonly boton: { disabled: boolean; textContent: string; click: () => void }
  readonly campo: { value: string }
  readonly volver: { href: string; setAttribute: (nombre: string, valor: string) => void }
  readonly sdk: {
    callbacks: Array<(payload: unknown) => void>
    nombres: string[]
    propiedades: Record<string, unknown>[]
    abiertas: Array<{ url: string; uniqueId: string; thisEsElSdk: boolean }>
    cierres: number
  }
  readonly tick: () => void
}

/** Ejecuta la ventana REAL (los dos <script> en línea, en orden) con un SDK y un DOM de mentira. */
function cargarVentana(opciones: { sinSdk?: boolean; abrirFalla?: boolean; cierreRevienta?: boolean; d?: DatosVentanaCardnet } = {}): Ventana {
  const html = construirVentanaCardnet(opciones.d ?? datos())
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
  assert.equal(scripts.length, 2, 'configuración + lógica; el SDK va aparte con src')
  const reemplazos: string[] = []
  const estado = { textContent: '' }
  const campo = { value: '' }
  const volver = { href: '', setAttribute(nombre: string, valor: string) { if (nombre === 'href') this.href = valor } }
  let alTocar: () => void = () => undefined
  const boton = {
    disabled: true,
    textContent: '',
    addEventListener: (evento: string, fn: () => void) => { if (evento === 'click') alTocar = fn },
    click: () => alTocar(),
  }
  const sdk: Ventana['sdk'] = { callbacks: [], nombres: [], propiedades: [], abiertas: [], cierres: 0 }
  const pwCheckout = {
    Bind: (nombre: string, fn: (payload: unknown) => void) => { sdk.nombres.push(nombre); sdk.callbacks.push(fn) },
    SetProperties: (p: Record<string, unknown>) => { sdk.propiedades.push(p) },
    OpenIframeCustom: function (this: unknown, url: string, uniqueId: string) {
      if (opciones.abrirFalla) throw new Error('no abre')
      sdk.abiertas.push({ url, uniqueId, thisEsElSdk: this === pwCheckout })
    },
    Iframe: { Close: () => { sdk.cierres += 1; if (opciones.cierreRevienta) throw new Error("Cannot read properties of null (reading 'parentNode')") } },
  }
  const timers: Array<() => void> = []
  const window: Record<string, unknown> = {
    PWCheckout: opciones.sinSdk ? undefined : pwCheckout,
    location: { replace: (url: string) => { reemplazos.push(url) } },
  }
  const document = {
    getElementById: (id: string) =>
      id === 'abrir' ? boton : id === 'estado' ? estado : id === 'PWToken' ? campo : id === 'volver' ? volver : null,
  }
  const contexto = vm.createContext({
    window, document, JSON, encodeURIComponent,
    setInterval: (fn: () => void) => { timers.push(fn); return timers.length },
    clearInterval: () => undefined,
  })
  for (const s of scripts) vm.runInContext(s, contexto)
  return { reemplazos, estado, boton, campo, volver, sdk, tick: () => timers.forEach((t) => t()), get pwCheckout() { return pwCheckout } } as Ventana
}

test('la ventana abre el formulario oficial de CardNET con los MISMOS parámetros que la pantalla web', () => {
  const v = cargarVentana()
  assert.equal(v.sdk.abiertas.length, 1, 'se abre sola al cargar')
  const abierta = v.sdk.abiertas[0]!
  assert.equal(abierta.thisEsElSdk, true, 'se llama como método del SDK')
  assert.equal(abierta.uniqueId, 'customer-unique-id-fixture')
  const url = new URL(abierta.url)
  assert.equal(url.origin + url.pathname, 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture/')
  assert.equal(url.searchParams.get('key'), 'public-key-fixture-123456')
  assert.equal(url.searchParams.get('session_id'), 'customer-unique-id-fixture')
  assert.deepEqual(v.sdk.nombres, ['tokenCreated', 'TokenCreated', 'token_created'])
  // Mismas claves que `PagoTokenCardnet` (web). El `&` del nombre partiría la URL del widget y CardNET daría 500.
  // Viene de otro contexto de vm (otro Object.prototype): se compara por valor.
  assert.deepEqual(JSON.parse(JSON.stringify(v.sdk.propiedades[0])), {
    name: 'CARTOWN Wash Detailing',
    email: '',
    button_label: 'Pagar RD$1,250.00',
    description: 'Pago CARTOWN Wash Detailing',
    currency: 'DOP',
    lang: 'ESP',
    form_id: 'cardnet_capture_form',
    checkout_card: 1,
    autoSubmit: 'false',
    empty: 'false',
  })
  const web = leer('src/components/membresia/PagoTokenCardnet.tsx')
  for (const clave of ['email', 'form_id', 'checkout_card', 'autoSubmit', 'empty', 'lang']) {
    assert.match(web, new RegExp(`\\b${clave}:`), `la web también fija ${clave}`)
  }
  assert.doesNotMatch(web.slice(web.indexOf('sdk.SetProperties({')), /^\s*amount:/m, 'ni la web ni la ventana mandan amount')
})

test('el SDK se carga del host oficial con la llave pública, y la página no se indexa', () => {
  const html = construirVentanaCardnet(datos())
  assert.match(html, /<script src="https:\/\/tr-tsp\.gtp-seglan\.com\/tr-tsp-mw-cardnet\/v1\/Scripts\/PWCheckout\.js\?key=public-key-fixture-123456"><\/script>/)
  assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/)
  assert.match(html, /<form id="cardnet_capture_form" hidden><input id="PWToken" name="PWToken" type="hidden" \/><\/form>/)
})

test('al entregar CardNET el token, la ventana vuelve a la app con él, una sola vez, y la app lo entiende', () => {
  const v = cargarVentana()
  v.sdk.callbacks[0]!({ TokenId: emitido })
  v.sdk.callbacks[1]!({ TokenId: `${emitido}_otro` })
  assert.deepEqual(v.reemplazos, [`${RETORNO_APP_CARDNET}?s=session-id-fixture-1234567890&t=${emitido}`])
  assert.equal(v.boton.disabled, true)
  assert.equal(parseCardnetWindowReturn(v.reemplazos[0]!, 'session-id-fixture-1234567890'), emitido)
  // Si Chrome no deja saltar solo a la app, el botón de volver ya lleva el token: un toque lo entrega.
  assert.equal(v.volver.href, v.reemplazos[0])
  assert.match(v.estado.textContent, /toca «Volver a MembeGo»/)
})

test('la ventana acepta el token en cada forma en que el widget lo ha entregado, igual que la app', () => {
  const payloads: unknown[] = [
    { TokenId: emitido }, { tokenId: emitido }, { Token: emitido }, { token: emitido }, { TrxToken: emitido }, { PWToken: emitido },
    { Response: { TokenId: emitido } }, { response: { token: emitido } }, { detail: { data: { Token: emitido } } },
    { payload: { Data: { TokenId: emitido } } }, JSON.stringify({ TokenId: emitido }), JSON.stringify({ data: JSON.stringify({ TokenId: emitido }) }),
    emitido, `  ${emitido}  `, 'short', 'two words here 1234', { TokenId: 'short' }, { TokenId: `${emitido} ` }, { TokenId: 'x'.repeat(513) },
    {}, [], null, undefined, 42, true, '{not json', { data: { data: { data: { data: { TokenId: emitido } } } } }, Object.create({ TokenId: emitido }),
  ]
  for (const payload of payloads) {
    const v = cargarVentana()
    v.sdk.callbacks[0]!(payload)
    const esperado = extractCardnetToken(payload, true)
    assert.deepEqual(
      v.reemplazos,
      esperado ? [`${RETORNO_APP_CARDNET}?s=session-id-fixture-1234567890&t=${encodeURIComponent(esperado)}`] : [],
      JSON.stringify(payload)
    )
  }
})

test('plan B: el token del campo oculto PWToken también vuelve a la app', () => {
  const v = cargarVentana()
  v.tick()
  assert.deepEqual(v.reemplazos, [], 'campo vacío no es un token')
  v.campo.value = emitido
  v.tick()
  v.tick()
  assert.equal(v.reemplazos.length, 1)
})

test('si el formulario no llegó a abrirse, nada vuelve a la app', () => {
  const v = cargarVentana({ abrirFalla: true })
  assert.match(v.estado.textContent, /No se pudo abrir el formulario seguro/)
  v.sdk.callbacks[0]!({ TokenId: emitido })
  v.campo.value = emitido
  v.tick()
  assert.deepEqual(v.reemplazos, [])
  assert.equal(v.boton.disabled, false, 'se puede volver a intentar')
})

test('un Close del widget que revienta no se lleva el token', () => {
  const v = cargarVentana({ cierreRevienta: true }) as Ventana & { pwCheckout: { Iframe: { Close: () => void } } }
  assert.doesNotThrow(() => v.pwCheckout.Iframe.Close())
  assert.equal(v.sdk.cierres, 1)
  v.sdk.callbacks[0]!({ TokenId: emitido })
  assert.equal(v.reemplazos.length, 1)
})

test('sin el SDK de CardNET la ventana lo dice y no vuelve a la app con nada', () => {
  const v = cargarVentana({ sinSdk: true })
  assert.match(v.estado.textContent, /No se pudo cargar el formulario seguro/)
  assert.equal(v.boton.disabled, true)
  assert.deepEqual(v.reemplazos, [])
})

test('los datos de la sesión no pueden romper el HTML ni el script de la ventana', () => {
  const ataque = '</script><script>alert(1)</script>&"\'' + String.fromCharCode(0x2028, 0x2029)
  const html = construirVentanaCardnet(datos({ comercio: ataque, sessionId: ataque, uniqueId: ataque }))
  assert.equal(html.includes('<script>alert(1)'), false)
  assert.equal(html.split('</script>').length - 1, 3, 'solo cierran los tres <script> propios')
  assert.equal(html.includes(String.fromCharCode(0)), false)
  const v = cargarVentana({ d: datos({ comercio: ataque }) })
  assert.doesNotMatch(String(v.sdk.propiedades[0]!.name), /[&?#=+%]/, 'nada que parta la URL del widget')
})

test('la ventana vencida o ajena enseña el camino de vuelta, sin datos de nadie', () => {
  const html = construirVentanaNoDisponible()
  assert.match(html, /Esta ventana de pago ya no está disponible/)
  assert.match(html, new RegExp(`href="${RETORNO_APP_CARDNET}"`))
  assert.doesNotMatch(html, /<script/)
})

test('la vuelta a la app: mismo esquema en los dos lados, y solo cuenta el token de ESTA sesión', () => {
  assert.equal(RETORNO_APP_CARDNET, CARDNET_WINDOW_RETURN_URL)
  assert.equal(JSON.parse(leer('apps/client/app.json')).expo.scheme, 'membego')
  const id = 'session-id-fixture-1234567890'
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=${id}&t=${emitido}`, id), emitido)
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?t=${emitido}&s=${id}`, id), emitido)
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=otra-sesion&t=${emitido}`, id), null)
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=${id}`, id), null, 'volver sin token: sigue el sondeo')
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=${id}&t=corto`, id), null)
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=${id}&t=${emitido}&t=otro_token_1234567`, id), null, 'parámetros repetidos')
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}?s=${id}&t=%E0%A4%A`, id), null, 'codificación rota')
  assert.equal(parseCardnetWindowReturn(`otraapp://pago-cardnet?s=${id}&t=${emitido}`, id), null)
  assert.equal(parseCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}-falso?s=${id}&t=${emitido}`, id), null)
  assert.equal(isCardnetWindowReturn(CARDNET_WINDOW_RETURN_URL), true)
  assert.equal(isCardnetWindowReturn(`${CARDNET_WINDOW_RETURN_URL}x`), false)
})

test('el router de la app no navega con la vuelta de CardNET (sacaría al cliente de su pago)', () => {
  assert.equal(redirectSystemPath({ path: `${CARDNET_WINDOW_RETURN_URL}?s=a&t=${emitido}`, initial: false }), null)
  assert.equal(redirectSystemPath({ path: '/pago-cardnet?s=a', initial: false }), null)
  assert.equal(redirectSystemPath({ path: 'pago-cardnet', initial: false }), null)
  assert.equal(redirectSystemPath({ path: `${CARDNET_WINDOW_RETURN_URL}?s=a`, initial: true }), '/', 'en frío, al inicio')
  assert.equal(redirectSystemPath({ path: 'membego://mis-membresias', initial: false }), 'membego://mis-membresias')
  assert.equal(redirectSystemPath({ path: '/pago-cardnetx', initial: false }), '/pago-cardnetx')
})

test('en el teléfono el formulario se abre en el navegador del sistema, no en una WebView', () => {
  const superficie = leer('apps/client/src/components/pagos/cardnet/CaptureSurface.native.tsx')
  assert.doesNotMatch(superficie, /react-native-webview|<WebView/)
  assert.match(superficie, /WebBrowser\.openAuthSessionAsync\(\s*api\.cardnetCaptureWindowUrl\(\{ sessionId: session\.sessionId, captureNonce: session\.captureNonce \}\),\s*CARDNET_WINDOW_RETURN_URL,/)
  assert.match(superficie, /preferEphemeralSession: true/)
  assert.match(superficie, /parseCardnetWindowReturn\(result\.url, session\.sessionId\)/)
  const api = leer('apps/client/src/lib/api.ts')
  assert.match(api, /\/api\/v1\/cliente\/pagos\/cardnet\/ventana\?s=\$\{encodeURIComponent\(input\.sessionId\)\}&n=\$\{encodeURIComponent\(input\.captureNonce\)\}/)
  const paquete = JSON.parse(leer('apps/client/package.json'))
  assert.ok(paquete.dependencies['expo-web-browser'], 'expo-web-browser es dependencia de la app')
  // La pantalla de pago ya no tiene un modo de WebView a pantalla completa: siempre el resumen con el botón.
  const captura = leer('apps/client/src/components/pagos/cardnet/Capture.tsx')
  assert.doesNotMatch(captura, /nativeCaptureActive|merchantOrigin/)
})

test('la ruta de la ventana: sin sesión de la app, pero solo con id + nonce de una captura abierta y vigente', () => {
  const ruta = leer('src/app/api/v1/cliente/pagos/cardnet/ventana/route.ts')
  assert.match(ruta, /paymentSessionLimiter\(`ventana-cardnet:\$\{requestIp\(request\)\}`\)/)
  assert.match(ruta, /'Cache-Control': 'no-store'/)
  assert.match(ruta, /'X-Robots-Tag': 'noindex, nofollow'/)
  assert.match(ruta, /status: 404/)
  const cargador = leer('src/modules/pagos/cardnetVentana.ts')
  assert.match(cargador, /sesion\.estado !== CARDNET_SESSION_STATES\.CAPTURE_OPEN/)
  assert.match(cargador, /sesion\.venceAt\.getTime\(\) <= ahora\.getTime\(\)/)
  assert.match(cargador, /mismoHash\(sesion\.captureNonce, hashNonce\(nonce\)\)/)
  assert.match(cargador, /validarCaptureUrl\(sesion\.captureUrl, config\.captureUrl\)/)
  assert.match(cargador, /sesion\.scriptUrl !== config\.scriptUrl/)
  assert.match(cargador, /sesion\.publicKey !== config\.publicKey/)
  assert.match(cargador, /timingSafeEqual/)
})
