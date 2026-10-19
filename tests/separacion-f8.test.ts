import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { anfitrionDelHost, anfitrionesDe, cabecerasDelAnfitrion, decidirAnfitrion, estadoDeRedireccion } from '../src/lib/anfitriones'
import { cookiesHeredadasALimpiar, MARCADOR_LIMPIEZA } from '../src/lib/cookies-heredadas'
import { comprobarCorte, cookieConDominio, resumir, type Pedir, type Respuesta } from '../scripts/corte/comprobaciones'

/**
 * SEPARACIÓN LANDING · APP — F8: cerrar el corte (cookies heredadas, redirección permanente, verificador).
 */

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const LANDING = 'https://membego.com'
const APP = 'https://app.membego.com'
const ANFITRIONES = anfitrionesDe(LANDING, APP)!

// ── cookies heredadas ──────────────────────────────────────────────────────────────────────────────────────────────

test('borra la sesión host-only (entera y por trozos) una vez y deja un marcador host-only', () => {
  const lineas = cookiesHeredadasALimpiar({
    nombres: ['sb-abc-auth-token', 'sb-abc-auth-token.0', 'sb-abc-auth-token.1', 'otra', 'mg_canal'],
    dominioCompartido: '.membego.com',
    anfitrion: 'landing',
  })
  assert.deepEqual(
    lineas.slice(0, 3).map((l) => l.split('=')[0]),
    ['sb-abc-auth-token', 'sb-abc-auth-token.0', 'sb-abc-auth-token.1']
  )
  for (const l of lineas.slice(0, 3)) {
    assert.match(l, /Max-Age=0/)
    assert.match(l, /Path=\//)
    assert.doesNotMatch(l, /Domain=/i, 'sin Domain: solo toca la cookie host-only, no la compartida')
  }
  assert.match(lineas[3], new RegExp(`^${MARCADOR_LIMPIEZA}=1; Max-Age=\\d+; Path=/`))
  assert.doesNotMatch(lineas[3], /Domain=/i, 'el marcador es host-only: cada host limpia lo suyo')
  assert.equal(lineas.length, 4)
})

test('no toca nada si no hay dominio compartido, ni anfitrión, ni sesión, o ya se limpió, o está apagada', () => {
  const base = { nombres: ['sb-abc-auth-token'], dominioCompartido: '.membego.com', anfitrion: 'landing' as const }
  assert.equal(cookiesHeredadasALimpiar(base).length, 2)
  assert.deepEqual(cookiesHeredadasALimpiar({ ...base, dominioCompartido: undefined }), [])
  assert.deepEqual(cookiesHeredadasALimpiar({ ...base, anfitrion: null }), [])
  assert.deepEqual(cookiesHeredadasALimpiar({ ...base, nombres: ['mg_canal', 'sb-abc-auth-token-code-verifier'] }), [])
  assert.deepEqual(cookiesHeredadasALimpiar({ ...base, nombres: ['sb-abc-auth-token', MARCADOR_LIMPIEZA] }), [])
  assert.deepEqual(cookiesHeredadasALimpiar({ ...base, habilitada: false }), [])
})

test('el proxy aplica la limpieza solo en modo dividido y con un interruptor de emergencia', () => {
  const proxy = sinComentarios('src/proxy.ts')
  assert.match(proxy, /cookiesHeredadasALimpiar\(\{/)
  assert.match(proxy, /dominioCompartido: sessionCookieDomain\(\)/)
  assert.match(proxy, /anfitrion: anfitrionDelHost\(host, anfitriones\)/)
  assert.match(proxy, /ANFITRIONES_LIMPIAR_COOKIES_HEREDADAS !== '0'/)
  assert.match(proxy, /respuesta\.headers\.append\('Set-Cookie', linea\)/, 'líneas crudas: el mapa de cookies de Next va por nombre')
  const dentroDelModoDividido = proxy.slice(proxy.indexOf('export async function proxy'))
  assert.ok(dentroDelModoDividido.indexOf('if (anfitriones)') < dentroDelModoDividido.indexOf('cookiesHeredadasALimpiar'))
})

// ── redirección permanente ─────────────────────────────────────────────────────────────────────────────────────────

test('307 mientras se valida; 308 con el interruptor, y el proxy lo lee del entorno en tiempo de ejecución', () => {
  assert.equal(estadoDeRedireccion(false), 307)
  assert.equal(estadoDeRedireccion(true), 308)
  assert.match(sinComentarios('src/proxy.ts'), /estadoDeRedireccion\(process\.env\.ANFITRIONES_REDIRECCION_PERMANENTE === '1'\)/)
})

// ── el verificador ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Opciones {
  estado?: number
  sinNoindex?: boolean
  sitemapAjeno?: boolean
  canalSinDominio?: boolean
  sinLimpieza?: boolean
  portadaConCookie?: boolean
  postRedirige?: boolean
}

/** Un despliegue simulado con las MISMAS funciones puras que usa el proxy: lo que el verificador debe dar por bueno. */
function despliegue(op: Opciones = {}): Pedir {
  const resp = (status: number, extra: Partial<Respuesta> = {}): Respuesta => ({
    status,
    setCookies: [],
    body: '',
    ...extra,
    // Como Node: los nombres de cabecera llegan en minúsculas.
    headers: Object.fromEntries(Object.entries(extra.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  })
  return async (origen, ruta, opciones = {}) => {
    const url = new URL(ruta, origen)
    const host = new URL(origen).host
    const reenviado = opciones.headers?.['x-forwarded-host']
    void reenviado // el Host reenviado NO cuenta: es justo lo que se comprueba
    const decision = decidirAnfitrion({ host, ruta: url.pathname, busqueda: url.search, metodo: opciones.method ?? 'GET' }, ANFITRIONES)
    if (decision.accion === 'redirigir') return resp(op.estado ?? 307, { headers: { location: decision.destino, ...cabecerasDelAnfitrion(host, ANFITRIONES) } })
    if ((opciones.method ?? 'GET') === 'POST' && op.postRedirige) return resp(307, { headers: { location: `${APP}${url.pathname}` } })
    const aqui = anfitrionDelHost(host, ANFITRIONES)
    const cabeceras: Record<string, string> = op.sinNoindex ? {} : { ...cabecerasDelAnfitrion(host, ANFITRIONES) }
    if (url.pathname === '/robots.txt') {
      return resp(200, { body: aqui === 'app' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${LANDING}/sitemap.xml\n` })
    }
    if (url.pathname === '/sitemap.xml') {
      return resp(200, { body: `<urlset><url><loc>${LANDING}/empresas</loc></url>${op.sitemapAjeno ? `<url><loc>${LANDING}/login</loc></url>` : ''}</urlset>` })
    }
    if (url.pathname.startsWith('/api/')) return resp(200, { headers: { 'cache-control': 'no-store, private' }, body: '{}' })
    const cookies = (opciones.headers?.cookie ?? '').split(/;\s*/).map((c) => c.split('=')[0]).filter(Boolean)
    const setCookies: string[] = []
    if (url.searchParams.get('src')) setCookies.push(`mg_canal=${url.searchParams.get('src')}; Max-Age=2592000; Path=/; SameSite=lax${op.canalSinDominio ? '' : '; Domain=.membego.com'}`)
    if (!op.sinLimpieza) setCookies.push(...cookiesHeredadasALimpiar({ nombres: cookies, dominioCompartido: '.membego.com', anfitrion: aqui }))
    if (op.portadaConCookie && url.pathname === '/') setCookies.push('visitante=1; Path=/')
    return resp(200, { headers: cabeceras, setCookies, body: `<link rel="canonical" href="${LANDING}${url.pathname === '/' ? '' : url.pathname}"/>` })
  }
}

const fallosDe = (r: Awaited<ReturnType<typeof comprobarCorte>>) => r.filter((c) => !c.ok).map((c) => c.nombre)

test('el verificador da por bueno un despliegue que cumple, con y sin cookie compartida', async () => {
  const completa = await comprobarCorte({ landing: LANDING, app: APP, dominioCookie: '.membego.com' }, despliegue())
  assert.deepEqual(fallosDe(completa), [])
  assert.ok(completa.length >= 24, `solo ${completa.length} comprobaciones`)
  assert.ok(completa.every((c) => !c.omitida))
  const sinCookie = await comprobarCorte({ landing: LANDING, app: APP }, despliegue())
  assert.deepEqual(fallosDe(sinCookie), [])
  assert.equal(sinCookie.filter((c) => c.omitida).length, 2, 'sin --cookie-domain se omiten las dos de cookies compartidas')
  assert.match(resumir(completa).texto, /0 mal/)
})

test('con --permanente espera 308, y el 307 pasa a ser un fallo (y al revés)', async () => {
  assert.deepEqual(fallosDe(await comprobarCorte({ landing: LANDING, app: APP, permanente: true }, despliegue({ estado: 308 }))), [])
  assert.ok(fallosDe(await comprobarCorte({ landing: LANDING, app: APP, permanente: true }, despliegue())).length > 5)
  assert.ok(fallosDe(await comprobarCorte({ landing: LANDING, app: APP }, despliegue({ estado: 308 }))).length > 5)
})

test('el verificador detecta cada incumplimiento relevante', async () => {
  const casos: [string, Opciones, RegExp][] = [
    ['la app sin noindex', { sinNoindex: true }, /la app no se indexa/],
    ['un sitemap con rutas de la app', { sitemapAjeno: true }, /sitemap solo lista/],
    ['la cookie de canal sin dominio compartido', { canalSinDominio: true }, /cookie de canal/],
    ['sin limpieza de la sesión heredada', { sinLimpieza: true }, /sesión heredada/],
    ['una landing anónima que pone cookies', { portadaConCookie: true }, /anónima no responde con cookies/],
    ['un POST que se desvía', { postRedirige: true }, /POST/],
  ]
  for (const [nombre, op, esperado] of casos) {
    const fallos = fallosDe(await comprobarCorte({ landing: LANDING, app: APP, dominioCookie: '.membego.com' }, despliegue(op)))
    assert.ok(fallos.some((f) => esperado.test(f)), `${nombre}: no se detectó (fallos: ${fallos.join(' | ') || 'ninguno'})`)
  }
})

test('un despliegue sin el corte (todo en un host, nada redirige) falla en el enrutado', async () => {
  const sinCorte: Pedir = async () => ({ status: 200, headers: {}, setCookies: [], body: '' })
  const fallos = fallosDe(await comprobarCorte({ landing: LANDING, app: APP }, sinCorte))
  assert.ok(fallos.some((f) => /va a la app/.test(f)))
  assert.ok(fallos.some((f) => /va a la landing/.test(f)))
})

test('un error de red es un fallo con su causa, no una excepción', async () => {
  const caido: Pedir = async () => {
    throw new Error('ECONNREFUSED')
  }
  const r = await comprobarCorte({ landing: LANDING, app: APP }, caido)
  assert.ok(r.every((c) => c.omitida || (!c.ok && /ECONNREFUSED/.test(c.detalle ?? ''))))
})

test('cookieConDominio ignora el punto inicial y las mayúsculas', () => {
  assert.equal(cookieConDominio('a=1; Path=/; Domain=.Membego.com', 'membego.com'), true)
  assert.equal(cookieConDominio('a=1; Path=/; Domain=membego.com', '.membego.com'), true)
  assert.equal(cookieConDominio('a=1; Path=/', '.membego.com'), false)
  assert.equal(cookieConDominio('a=1; Domain=otro.com', '.membego.com'), false)
})
