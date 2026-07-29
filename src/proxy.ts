import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env'
import { sessionCookieDomain } from '@/lib/site'
import { ROLE_HOME, ROUTE_PROTECTION, FULL_ADMIN_ROLES, type AppMetadata } from '@/types'
import { adminSectionForPath, canAccessAdminSection } from '@/lib/auth/permissions'
import { CANAL_COOKIE, CANAL_COOKIE_MAX_AGE, sanitizarCanal } from '@/modules/adquisicion/shared'
import {
  COOKIE_MANTENIMIENTO,
  HORAS_PASE,
  PARAM_MANTENIMIENTO,
  decidirMantenimiento,
  esRutaDeApi,
  htmlMantenimiento,
} from '@/modules/mantenimiento'

type CookieToSet = { name: string; value: string; options?: CookieOptions }

/**
 * Devuelve la regla de protección que aplica a un path, o undefined si es
 * público. Fuente única de verdad: `ROUTE_PROTECTION` en `src/types`.
 */
function matchProtected(path: string) {
  return ROUTE_PROTECTION.find((r) => path.startsWith(r.prefix))
}

/**
 * Redirect que conserva los Set-Cookie ya escritos en `from` (tokens de
 * sesión refrescados durante getUser). Un redirect "limpio" descartaría el
 * refresh token recién rotado y el navegador reutilizaría el anterior →
 * "Invalid Refresh Token: Already Used" → sesión muerta.
 */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}

/** ¿El request trae una cookie de sesión de Supabase? (sb-<ref>-auth-token). */
function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
}

export async function proxy(request: NextRequest) {
  // Nonce por petición para la CSP (auditoría · A-04).
  //
  // Se EMITE ya, pero la CSP todavía lleva `'unsafe-inline'` (ver la nota en
  // next.config.ts). Tenerlo disponible es lo que permite dar el último paso
  // —cambiar `'unsafe-inline'` por `'nonce-…'`— cuando se pueda verificar en
  // navegador que ni la hidratación de Next ni el escáner se rompen. Emitirlo
  // ahora no cuesta nada y evita que ese día haya que tocar el proxy bajo
  // presión.
  //
  // `crypto.randomUUID` y no un contador: un nonce predecible es un nonce
  // inútil, porque un XSS podría incluirlo en el script que inyecta.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  request.headers.set('x-nonce', nonce)

  let response = NextResponse.next({ request })
  const path = request.nextUrl.pathname
  const matched = matchProtected(path)
  const isLoginPage = path === '/login' || path === '/acceso'

  // MODO MANTENIMIENTO (auditoría · A-08, Fase 5) — lo PRIMERO que se decide.
  //
  // Va antes de Supabase, antes de la cookie de canal y antes de cualquier
  // consulta, porque el momento en que se enciende es justo aquel en que no se
  // puede confiar en la base: restauración en curso, migración a medias,
  // esquema desfasado. Todo lo que haya después de esta comprobación es código
  // que puede fallar; esto no.
  //
  // Ver docs/RECUPERACION.md y docs/runbooks/modo-mantenimiento.md.
  const mantenimiento = decidirMantenimiento({
    modo: process.env.MODO_MANTENIMIENTO,
    pase: process.env.MANTENIMIENTO_PASE,
    path,
    cookie: request.cookies.get(COOKIE_MANTENIMIENTO)?.value,
    parametro: request.nextUrl.searchParams.get(PARAM_MANTENIMIENTO),
  })

  if (mantenimiento === 'bloquear') {
    // 503 y no 200: los buscadores no desindexan por un 503, y QStash y
    // cualquier otro cliente automático reintentan con espera creciente en vez
    // de dar el trabajo por hecho.
    const cabeceras = {
      'Retry-After': '300',
      'Cache-Control': 'no-store',
    }
    return esRutaDeApi(path)
      ? NextResponse.json(
          { error: 'mantenimiento', mensaje: 'Servicio en mantenimiento.' },
          { status: 503, headers: cabeceras }
        )
      : new NextResponse(htmlMantenimiento(), {
          status: 503,
          headers: { ...cabeceras, 'Content-Type': 'text/html; charset=utf-8' },
        })
  }

  if (mantenimiento === 'abrir') {
    // El pase venía en la URL. Se guarda en cookie y se redirige a la MISMA
    // ruta sin el parámetro: así el pase no queda en el historial del
    // navegador, ni en el Referer que se envía al navegar a otro sitio, ni en
    // los enlaces que se copien y peguen desde la barra de direcciones.
    const limpia = request.nextUrl.clone()
    limpia.searchParams.delete(PARAM_MANTENIMIENTO)
    const redirect = NextResponse.redirect(limpia)
    redirect.cookies.set(COOKIE_MANTENIMIENTO, process.env.MANTENIMIENTO_PASE!.trim(), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: HORAS_PASE * 60 * 60,
    })
    return redirect
  }

  // Atribución de marketing (docs/ADQUISICION.md): si el visitante llega con
  // ?src=facebook (o utm_source), se siembra la cookie de canal ANTES de que
  // se registre. Primer toque: una cookie existente no se sobreescribe.
  const canal = sanitizarCanal(
    request.nextUrl.searchParams.get('src') ??
      request.nextUrl.searchParams.get('utm_source')
  )
  if (canal && !request.cookies.get(CANAL_COOKIE)) {
    response.cookies.set(CANAL_COOKIE, canal, {
      maxAge: CANAL_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
    })
  }

  // Rutas públicas SIN sesión: continuar sin tocar Supabase. Evita una llamada
  // de red por cada request anónimo, prefetch o telemetría (el grueso del
  // tráfico) que bajo carga agotaba el rate limit de Auth. Si el request SÍ
  // trae cookie de sesión, seguimos adelante aunque la ruta sea pública: hay
  // que refrescar/rotar el token (getUser lo hace) para no dejar la sesión sin
  // renovar mientras el usuario navega páginas públicas.
  if (!matched && !isLoginPage && !hasSupabaseAuthCookie(request)) {
    return response
  }

  try {
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: CookieToSet[]) {
            // Etapa 6 · dominio de cookie (SSO cross-subdominio). undefined = host-only.
            const domain = sessionCookieDomain()
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, domain ? { ...options, domain } : options)
            )
          },
        },
      }
    )

    // Rendimiento (auditoría Enterprise): el middleware corre en CADA request
    // y una validación de red contra Supabase aquí añadía 100–300 ms a cada
    // click de navegación. Camino rápido: getSession() decodifica la cookie
    // SIN red; si el token sigue fresco (>5 min para expirar) usamos ese user
    // solo para las REDIRECCIONES de UX. La AUTORIZACIÓN real no vive aquí:
    // todas las páginas y server actions validan con getUser() contra el
    // servidor (fail-closed, verificado en docs/MATURITY.md) — una cookie
    // falsificada pasaría el redirect pero muere en la capa de datos.
    // Cerca de expirar (o sin sesión legible) sí llamamos getUser(): valida
    // en el servidor Y refresca/rota el token en las cookies — ese refresco
    // solo puede persistirse desde el middleware.
    const REFRESH_MARGIN_S = 5 * 60
    const {
      data: { session },
    } = await supabase.auth.getSession()

    let user = session?.user ?? null
    const expiraEn = session?.expires_at ?? 0
    const tokenFresco = expiraEn * 1000 > Date.now() + REFRESH_MARGIN_S * 1000
    if (!session || !tokenFresco) {
      const {
        data: { user: validado },
      } = await supabase.auth.getUser()
      user = validado
    }

    if (matched) {
      if (!user) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('redirect', path)
        return redirectWithCookies(url, response)
      }
      const metadata = (user.app_metadata ?? {}) as Partial<AppMetadata>
      const role = metadata.role ?? 'CLIENTE'
      if (!matched.roles.includes(role)) {
        const url = request.nextUrl.clone()
        url.pathname = ROLE_HOME[role]
        return redirectWithCookies(url, response)
      }
      // Autorización fina del panel: roles acotados (Marketing/Supervisor)
      // solo acceden a sus secciones; el resto se les redirige al dashboard.
      // 'dashboard' siempre se permite para cualquier rol admin, para que el
      // destino del redirect nunca vuelva a fallar el gate (evita bucles).
      if (path.startsWith('/admin') && !FULL_ADMIN_ROLES.includes(role)) {
        const section = adminSectionForPath(path)
        if (section !== 'dashboard' && (!section || !canAccessAdminSection(role, section))) {
          const url = request.nextUrl.clone()
          url.pathname = '/admin/dashboard'
          return redirectWithCookies(url, response)
        }
      }
    }

    // Redirect logged-in users away from the login pages
    if (isLoginPage && user) {
      const metadata = (user.app_metadata ?? {}) as Partial<AppMetadata>
      const role = metadata.role ?? 'CLIENTE'
      const url = request.nextUrl.clone()
      url.pathname = ROLE_HOME[role]
      return redirectWithCookies(url, response)
    }
  } catch (err) {
    // Fail-closed: si la verificación de auth falla (Supabase caído, env
    // faltante) NO dejamos pasar rutas protegidas — redirigimos a /login.
    // Las rutas públicas continúan normalmente.
    console.error('[proxy] auth check failed:', err)
    if (matched) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('redirect', path)
      return redirectWithCookies(url, response)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Excluye estáticos, imágenes, el túnel de Sentry (/monitoring) y
    // endpoints operativos que nunca requieren sesión.
    '/((?!_next/static|_next/image|favicon.ico|monitoring|api/health|api/cron|sitemap\\.xml|robots\\.txt|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
