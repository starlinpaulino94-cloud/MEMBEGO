import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  estadoDeRedireccion,
  anfitrionDeRuta,
  anfitrionDelHost,
  anfitrionesDe,
  cabecerasDelAnfitrion,
  decidirAnfitrion,
  haciaLaApp,
  haciaLaLanding,
} from '../src/lib/anfitriones'
import { rutasDe } from '../scripts/docs/rutas-por-espacio'

/**
 * SEPARACIÓN LANDING · APP — F7: dos dominios, un proyecto.
 *
 * Con las dos variables de entorno apagadas todo es como antes; con ellas, `membego.com` sirve la landing y
 * `app.membego.com` la app, y lo que llega al host equivocado se redirige sin bucles ni redirecciones abiertas.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const A = anfitrionesDe('https://membego.com', 'https://app.membego.com')!
const LANDING = 'membego.com'
const APP = 'app.membego.com'

test('el modo dividido solo existe con los dos orígenes definidos, válidos y con host distinto', () => {
  assert.deepEqual(A, { landing: 'https://membego.com', app: 'https://app.membego.com' })
  assert.equal(anfitrionesDe(undefined, undefined), null)
  assert.equal(anfitrionesDe('https://membego.com', undefined), null)
  assert.equal(anfitrionesDe(undefined, 'https://app.membego.com'), null)
  assert.equal(anfitrionesDe('https://membego.com', 'https://membego.com/'), null, 'el mismo host no es dividir')
  assert.equal(anfitrionesDe('no es una url', 'https://app.membego.com'), null)
  assert.equal(anfitrionesDe('javascript:alert(1)', 'https://app.membego.com'), null)
  assert.deepEqual(anfitrionesDe('https://membego.com/', 'https://app.membego.com/'), A, 'tolera la barra final')
})

test('qué ruta es de qué host: la portada y la consulta, de la landing; el acceso, la app y los paneles, de la app; la API, de ambos', () => {
  for (const r of ['/', '/empresas', '/empresas/x/catalogo/y', '/catalogo', '/ofertas', '/oferta/ABC', '/promociones/membego/z', '/plan/1', '/faq', '/terms', '/eliminar-cuenta', '/registro-empresa', '/solicitud-empresa']) {
    assert.equal(anfitrionDeRuta(r), 'landing', r)
  }
  for (const r of ['/e/luis-tours', '/r/ABC', '/i/ABC', '/invita/x', '/invitar/x']) assert.equal(anfitrionDeRuta(r), 'landing', `${r}: los enlaces compartidos e impresos se quedan`)
  for (const r of ['/login', '/acceso', '/registro', '/registro/cuenta', '/registro/mi-empresa', '/recuperar', '/auth/callback', '/sso/entrar', '/invitacion/t', '/cliente/inicio', '/cliente/oferta/ABC', '/mis-membresias', '/membresia/1', '/admin/dashboard', '/superadmin/x', '/empleado/scanner', '/vendedor', '/onboarding']) {
    assert.equal(anfitrionDeRuta(r), 'app', r)
  }
  for (const r of ['/api/v1/auth/sesion', '/api/health', '/_next/static/x.js', '/monitoring', '/offline', '/og/campana', '/manifest.json', '/sw.js']) assert.equal(anfitrionDeRuta(r), 'ambos', r)
  // Segmento completo, no prefijo de texto: `/registro-empresa` no es `/registro`, ni `/oferta` es `/ofertas`.
  assert.equal(anfitrionDeRuta('/registro-empresa'), 'landing')
  assert.equal(anfitrionDeRuta('/registro'), 'app')
  assert.equal(anfitrionDeRuta('/ofertas'), 'landing')
  assert.equal(anfitrionDeRuta('/clientes'), 'ambos', 'lo desconocido se deja pasar')
  assert.equal(anfitrionDeRuta('/login?redirect=/cliente/x'), 'app', 'la consulta no cuenta')
})

test('la clasificación por host coincide, ruta por ruta, con la tabla de espacios de F6', () => {
  const esperado: Record<string, string> = { landing: 'landing', enlaces: 'landing', acceso: 'app', cliente: 'app', paneles: 'app', api: 'ambos', sistema: 'ambos' }
  const rutas = rutasDe()
  assert.ok(rutas.length > 400)
  const mal = rutas.filter((r) => anfitrionDeRuta(r.url) !== esperado[r.espacio as string]).map((r) => `${r.url} (${r.espacio}) → ${anfitrionDeRuta(r.url)}`)
  assert.deepEqual(mal, [], 'una ruta cambió de espacio sin que cambie su host: actualiza anfitriones.ts (o la clasificación de F6)')
})

test('sin las variables no se redirige nada, y con un host que no es ninguno de los dos (local, previews) tampoco', () => {
  for (const ruta of ['/', '/login', '/cliente/inicio', '/empresas', '/api/x']) {
    assert.deepEqual(decidirAnfitrion({ host: 'localhost:3000', ruta }, null), { accion: 'seguir' }, ruta)
    assert.deepEqual(decidirAnfitrion({ host: 'membego-git-x.vercel.app', ruta }, A), { accion: 'seguir' }, ruta)
    assert.deepEqual(decidirAnfitrion({ host: 'localhost:3000', ruta }, A), { accion: 'seguir' }, ruta)
  }
  assert.equal(anfitrionDelHost('app.membego.com', null), null)
})

test('la landing manda lo de la app a app.membego.com y la app lo de la landing a membego.com, conservando ruta y consulta', () => {
  assert.deepEqual(decidirAnfitrion({ host: LANDING, ruta: '/login', busqueda: '?redirect=%2Fcliente%2Fcarrito' }, A), {
    accion: 'redirigir',
    destino: 'https://app.membego.com/login?redirect=%2Fcliente%2Fcarrito',
  })
  assert.deepEqual(decidirAnfitrion({ host: LANDING, ruta: '/cliente/ofertas-membego/x', busqueda: '?cupon=A&beneficio=B' }, A), {
    accion: 'redirigir',
    destino: 'https://app.membego.com/cliente/ofertas-membego/x?cupon=A&beneficio=B',
  })
  assert.deepEqual(decidirAnfitrion({ host: APP, ruta: '/empresas/mi-negocio', busqueda: '?utm=x' }, A), {
    accion: 'redirigir',
    destino: 'https://membego.com/empresas/mi-negocio?utm=x',
  })
  assert.deepEqual(decidirAnfitrion({ host: APP, ruta: '/e/luis-tours' }, A), { accion: 'redirigir', destino: 'https://membego.com/e/luis-tours' })
  // Lo que es de este host sigue.
  for (const [host, ruta] of [[LANDING, '/'], [LANDING, '/empresas'], [LANDING, '/e/luis'], [APP, '/login'], [APP, '/cliente/inicio'], [APP, '/admin/dashboard'], [LANDING, '/api/v1/auth/sesion'], [APP, '/api/v1/cliente/inicio'], [APP, '/offline']] as const) {
    assert.deepEqual(decidirAnfitrion({ host, ruta }, A), { accion: 'seguir' }, `${host}${ruta}`)
  }
  // La portada del host de la app no es de nadie: manda al acceso.
  assert.deepEqual(decidirAnfitrion({ host: APP, ruta: '/' }, A), { accion: 'redirigir', destino: 'https://app.membego.com/login' })
})

test('sin bucles: lo que se redirige a un host SIEMPRE se queda ahí, para todas las rutas de la tabla', () => {
  for (const r of rutasDe()) {
    for (const host of [LANDING, APP]) {
      const d = decidirAnfitrion({ host, ruta: r.url }, A)
      if (d.accion === 'seguir') continue
      const destino = new URL(d.destino)
      const siguiente = decidirAnfitrion({ host: destino.host, ruta: destino.pathname, busqueda: destino.search }, A)
      assert.deepEqual(siguiente, { accion: 'seguir' }, `${host}${r.url} → ${d.destino} no se estabiliza`)
    }
  }
})

test('el destino sale de los orígenes configurados, nunca del Host de la petición: no hay redirección abierta', () => {
  for (const host of ['evil.example', 'membego.com.evil.example', 'app.membego.com.evil.example']) {
    assert.deepEqual(decidirAnfitrion({ host, ruta: '/login' }, A), { accion: 'seguir' }, host)
  }
  const d = decidirAnfitrion({ host: LANDING, ruta: '//evil.example/x' }, A)
  if (d.accion === 'redirigir') assert.ok(d.destino.startsWith('https://app.membego.com/') || d.destino.startsWith('https://membego.com/'))
  const e = decidirAnfitrion({ host: 'MEMBEGO.COM', ruta: '/login' }, A)
  assert.equal(e.accion, 'redirigir', 'el host no distingue mayúsculas')
})

test('solo se redirigen GET y HEAD: un POST o una acción de servidor que llegan al host equivocado no se desvían a ciegas', () => {
  assert.equal(decidirAnfitrion({ host: LANDING, ruta: '/login', metodo: 'HEAD' }, A).accion, 'redirigir')
  assert.equal(decidirAnfitrion({ host: LANDING, ruta: '/login', metodo: 'get' }, A).accion, 'redirigir')
  for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal(decidirAnfitrion({ host: LANDING, ruta: '/login', metodo }, A).accion, 'seguir', metodo)
})

test('la app no se indexa: el host de la app añade X-Robots-Tag, el de la landing no', () => {
  assert.deepEqual(cabecerasDelAnfitrion(APP, A), { 'X-Robots-Tag': 'noindex, nofollow' })
  assert.deepEqual(cabecerasDelAnfitrion(LANDING, A), {})
  assert.deepEqual(cabecerasDelAnfitrion('localhost:3000', A), {})
  assert.deepEqual(cabecerasDelAnfitrion(APP, null), {})
})

test('los enlaces entre dominios: absolutos en el modo dividido, relativos si no', () => {
  assert.equal(haciaLaApp('/login?redirect=%2Fcliente', A), 'https://app.membego.com/login?redirect=%2Fcliente')
  assert.equal(haciaLaApp('cliente/inicio', A), 'https://app.membego.com/cliente/inicio')
  assert.equal(haciaLaLanding('/empresas/x', A), 'https://membego.com/empresas/x')
  assert.equal(haciaLaApp('/login', null), '/login')
  assert.equal(haciaLaLanding('/empresas/x', null), '/empresas/x')
})

test('el proxy pasa por la puerta de los anfitriones y no cambia nada con las variables apagadas', () => {
  const proxy = sinComentarios('src/proxy.ts')
  assert.match(proxy, /export async function proxy\(request: NextRequest\) \{\s*const anfitriones = anfitrionesDelEntorno\(\)/)
  assert.match(proxy, /decidirAnfitrion\(/)
  assert.match(proxy, /NextResponse\.redirect\(decision\.destino, estadoDeRedireccion\(/, '307 por defecto (reversible); 308 solo con el interruptor de F8')
  assert.equal(estadoDeRedireccion(false), 307)
  assert.match(proxy, /return procesar\(request\)\s*\}/, 'sin anfitriones, el mismo camino de siempre')
})

// ── Enlaces entre dominios y URL absolutas ───────────────────────────────────

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cookieDeCelebracion, CLAVE_CELEBRACION, valorDeCookieDeCelebracion } from '../src/lib/celebracion-entre-dominios'

function archivosDe(dir: string): string[] {
  if (!existsSync(dir)) return []
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(p))
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(relative('.', p))
  }
  return acc.sort()
}

test('ninguna URL absoluta se arma a mano: nadie lee NEXT_PUBLIC_APP_URL fuera de site.ts, y absoluteUrl/getAppUrl no se usan en el código', () => {
  const todos = archivosDe('src')
  const lectores = todos.filter((f) => f !== 'src/lib/site.ts').filter((f) => /process\.env\.NEXT_PUBLIC_APP_URL/.test(sinComentarios(f)))
  assert.deepEqual(lectores, [], 'lee NEXT_PUBLIC_APP_URL a mano: usa appUrl()/landingUrl() (src/lib/site.ts), que respetan los dos dominios')
  const usos = todos
    .filter((f) => f !== 'src/lib/site.ts')
    .filter((f) => /\b(absoluteUrl|getAppUrl)\(/.test(sinComentarios(f)))
  assert.deepEqual(usos, ['src/lib/auth/mobile-cors.ts'], 'decide si el enlace es de la app (appUrlFor) o de la landing (landingUrlFor); solo el CORS móvil acepta el origen genérico')
})

test('cada enlace que sale del servidor va al host que le toca: la app para acceso y confirmaciones; la landing para lo que se comparte', () => {
  const casos: Array<[string, RegExp]> = [
    ['src/modules/admin/invitacionActions.ts', /appUrlFor\(`\/invitacion\//],
    ['src/modules/auth/recuperarActions.ts', /appUrlFor\('\/actualizar-password'\)/],
    ['src/modules/superadmin/accesoActions.ts', /appUrlFor\(`\/confirmar\?token_hash=/],
    ['src/lib/auth/emailVerification.ts', /new URL\('\/confirmar', appUrl\(\)\)/],
    ['src/app/api/v1/auth/solicitar-eliminacion/route.ts', /new URL\('\/confirmar', appUrl\(\)\)/],
    ['src/app/(auth)/confirmar/route.ts', /new URL\('\/eliminar-cuenta\/confirmar', landingUrl\(\)\)/],
    ['src/app/(auth)/confirmar/route.ts', /new URL\(dest, appUrl\(\)\)/],
    ['src/app/sso/entrar/route.ts', /new URL\(dest, appUrl\(\)\)/],
    ['src/modules/growth/actions.ts', /landingUrlFor\(`\/r\//],
    ['src/modules/excursiones/vendedores/nucleo.ts', /landingUrlFor\(`\/e\/\$\{slug\}`\)/],
    ['src/app/(admin)/admin/ofertas/[id]/page.tsx', /landingUrlFor\(`\/oferta\//],
    ['src/app/(admin)/admin/invitaciones/[id]/page.tsx', /landingUrlFor\(`\/invita\//],
    ['src/app/(cliente)/cliente/invita-y-gana/page.tsx', /landingUrlFor\(\s*`\/invitar\//],
    ['src/app/api/v1/cliente/referidos/route.ts', /landingUrlFor\(\s*`\/invitar\//],
    ['src/app/(admin)/admin/perfil/page.tsx', /appUrlFor\(`\/registro\//],
    ['src/modules/mensajeria/autoReply.ts', /landingUrl\(\)/],
    ['src/lib/jobs/qstash.ts', /appUrl\(\)/],
  ]
  for (const [archivo, patron] of casos) assert.match(sinComentarios(archivo), patron, archivo)
  // Los correos de excursiones llevan a la app (establecer contraseña, mis excursiones).
  for (const f of ['src/modules/excursiones/reservas/actions.ts', 'src/modules/excursiones/reservas/vendedor-actions.ts', 'src/modules/excursiones/reservas/cliente-actions.ts', 'src/modules/excursiones/vendedores/actions.ts']) {
    assert.match(sinComentarios(f), /urlBase[:=]? ?(?:appUrl\(\)|,)|urlBase = appUrl\(\)|urlBase: appUrl\(\)/, f)
  }
})

test('los enlaces cortos mandan al host que corresponde y siembran sus cookies en el dominio compartido', () => {
  const corto = sinComentarios('src/app/e/[slug]/route.ts')
  assert.match(corto, /const base = appUrl\(\)/, 'el destino del QR es el registro de la app')
  assert.match(corto, /NextResponse\.redirect\(landingUrl\(\)\)/, 'un enlace apagado vuelve a la landing')
  assert.equal((corto.match(/\.\.\.dominioDeCookieCompartida\(\)/g) ?? []).length, 2, 'cookie del visitante y del vendedor')
  const referido = sinComentarios('src/app/r/[code]/route.ts')
  assert.match(referido, /`\$\{landingUrl\(\)\}\/i\/\$\{growth\.code\}`/)
  assert.match(referido, /`\$\{appUrl\(\)\}\/registro\//)
  assert.equal((referido.match(/\.\.\.dominioDeCookieCompartida\(\)/g) ?? []).length, 3, 'visitante (dos veces) y referido')
  assert.match(sinComentarios('src/proxy.ts'), /\.\.\.dominioDeCookieCompartida\(\)/, 'la cookie de canal también cruza')
})

test('la landing no escribe a mano un enlace a la app: pasa por haciaLaApp/irALaApp (o por el traspaso, que lo hace por dentro)', () => {
  const raices = ['src/app/(public)', 'src/components/public', 'src/app/invitar', 'src/app/invita', 'src/components/invitaciones']
  const prefijos = '(?:login|acceso|registro|recuperar|actualizar-password|confirmar|auth|sso|invitacion|cliente|mis-membresias|membresia|admin|superadmin|empleado|vendedor|onboarding)'
  const enlaces = new RegExp(`(?:href=(?:"|\\{['"\`])|\\.(?:push|replace|assign)\\(\\s*['"\`]|location\\.href\\s*=\\s*['"\`])\\/${prefijos}(?:[/?'"\`]|$)`)
  const mal: string[] = []
  // Se montan en el panel (host de la app), no en la landing: su `/admin/...` es relativo a su propio host.
  const delPanelOCliente = ['FollowButton.tsx', 'CampanaEliminarButton.tsx', 'CampanaInvitacionForm.tsx']
  for (const f of raices.flatMap(archivosDe)) {
    if (delPanelOCliente.some((n) => f.endsWith(n))) continue
    const lineas = sinComentarios(f).split('\n')
    lineas.forEach((linea, i) => {
      // `EnlaceDeCuenta` recibe la ruta como prop y la convierte por dentro.
      if (/^\s*<EnlaceDeCuenta\b/.test(lineas[i - 1] ?? '')) return
      if (enlaces.test(linea)) mal.push(`${f}:${i + 1}  ${linea.trim().slice(0, 90)}`)
    })
  }
  assert.deepEqual(mal, [], 'un enlace de la landing a una ruta de la app es relativo: con dos dominios caería en el host equivocado (haciaLaApp(...))')
  // Los traspasos y la barra convierten por dentro.
  assert.match(sinComentarios('src/components/public/TraspasoALaApp.tsx'), /haciaLaApp\(rutaDeLogin\(destino\)\)/)
  assert.match(sinComentarios('src/components/public/TraspasoALaApp.tsx'), /haciaLaApp\(destino\)/)
  assert.match(sinComentarios('src/components/public/AccionesDeSesion.tsx'), /haciaLaApp\('\/login'\)/)
  assert.match(sinComentarios('src/components/public/EnlaceDeInicio.tsx'), /haciaLaLanding\('\/'\)/)
})

test('SEO por host: la base canónica y el sitemap son los de la landing, y robots deja la app sin indexar', () => {
  assert.equal(existsSync('public/robots.txt'), false, 'un robots.txt estático tapa a robots.ts: la app dejaría de ser noindex por host')
  assert.match(sinComentarios('src/app/layout.tsx'), /metadataBase: new URL\(landingUrl\(\)\)/)
  assert.match(sinComentarios('src/app/sitemap.ts'), /const base = landingUrl\(\)/)
  const robots = sinComentarios('src/app/robots.ts')
  assert.match(robots, /anfitrionDelHost\(\(await headers\(\)\)\.get\('host'\), anfitriones\) === 'app'/)
  assert.match(robots, /disallow: '\/'/)
  assert.match(robots, /if \(anfitriones &&/, 'solo con dos dominios se lee el host: con uno sigue siendo estático')
  assert.match(sinComentarios('src/lib/auth/mobile-cors.ts'), /landingUrl\(\),/)
})

test('la cookie de la celebración cabe y se arma con el dominio compartido solo cuando hay uno', () => {
  const json = JSON.stringify({ regalo: 'Un lavado GRATIS', empresaName: 'Lavado Express', codigoInvitacion: 'ABC123', vigenciaDias: 30 })
  const c = cookieDeCelebracion(json, { dominio: '.membego.com', seguro: true })!
  assert.ok(c.startsWith(`${CLAVE_CELEBRACION}=`))
  assert.match(c, /Max-Age=120/)
  assert.match(c, /Domain=\.membego\.com/)
  assert.match(c, /; Secure/)
  assert.match(c, /SameSite=Lax/)
  assert.doesNotMatch(cookieDeCelebracion(json, {})!, /Domain=|Secure/)
  assert.equal(decodeURIComponent(valorDeCookieDeCelebracion(json)!), json)
  assert.equal(valorDeCookieDeCelebracion('x'.repeat(5000)), null, 'una cookie demasiado grande se omite: es un realce')
  const landing = sinComentarios('src/components/invitaciones/CampanaLanding.tsx')
  assert.match(landing, /if \(anfitrionesDelEntorno\(\)\) guardarCelebracionParaLaApp\(/)
  assert.match(sinComentarios('src/components/cliente/CelebracionBienvenida.tsx'), /sessionStorage\.getItem\(KEY\) \?\? tomarCelebracionDeCookie\(/)
})
