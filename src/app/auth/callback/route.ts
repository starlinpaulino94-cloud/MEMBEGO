import { NextResponse, type NextRequest } from 'next/server'
import { createRouteClient, redirectWithCookies } from '@/lib/supabase/route-client'
import { getRequestMeta } from '@/lib/server-utils'
import { isGoogleAuthEnabled } from '@/lib/auth/googleAuth'
import {
  completeGoogleOnboarding,
  type GoogleOnboardingResult,
} from '@/lib/auth/googleOnboarding'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Callback de OAuth (Onboarding Fase 5 · O-16). Google redirige aquí con un
 * `code`; lo canjeamos por sesión y luego damos de alta / afiliamos al cliente
 * según el contexto de empresa (`companySlug`, `ref`) que viajó en el
 * redirectTo. Detrás del flag `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.
 *
 * Todos los redirects usan el ORIGEN DEL REQUEST (no getAppUrl): el botón
 * arranca el OAuth desde window.location.origin, así que la sesión se abre en
 * este host; redirigir a otro host (www vs apex, staging/preview) perdería las
 * cookies recién puestas.
 */

/** Destino por resultado cuando NO se completa el alta (sin sesión). */
const DEST_ERROR: Record<Exclude<GoogleOnboardingResult['kind'], 'ok'>, string> = {
  // Cuenta nueva sin empresa: que elija una; la página muestra el aviso.
  'need-company': '/empresas?google=registro',
  'email-exists': '/login?error=google_email',
  'company-not-found': '/login?error=google_company',
  'rate-limited': '/login?error=google_rate',
  failed: '/login?error=google',
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const companySlug = searchParams.get('companySlug')
  const ref = searchParams.get('ref') ?? ''

  const toLogin = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin))

  // Feature flag apagado o sin código: no procesamos OAuth.
  if (!isGoogleAuthEnabled()) return toLogin('google_off')
  if (!code) return toLogin('google')

  // Acumulador de las cookies de sesión que escribe exchangeCodeForSession.
  // Solo se copian al redirect final en la rama 'ok': en las ramas de error el
  // navegador NUNCA recibe los tokens (solo existieron aquí), así que aunque
  // el signOut remoto falle no queda una sesión a medias en el cliente.
  const carrier = NextResponse.next()
  const supabase = createRouteClient(request, carrier)

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession falló:', error)
    return toLogin('google')
  }

  const { data, error: userError } = await supabase.auth.getUser()
  if (userError || !data.user || !data.user.email) {
    console.error('[auth/callback] getUser tras OAuth falló:', userError)
    return toLogin('google')
  }

  // Defensa: no aceptar identidades cuyo correo venga explícitamente sin
  // verificar por el proveedor (Google lo marca en user_metadata).
  if (data.user.user_metadata?.email_verified === false) {
    await supabase.auth.signOut().catch(anotarFallo('auth:signout-email-no-verificado'))
    return toLogin('google')
  }

  const { ipAddress } = await getRequestMeta()
  const nombre =
    (data.user.user_metadata?.full_name as string | undefined) ??
    (data.user.user_metadata?.name as string | undefined) ??
    ''
  const avatarUrl =
    (data.user.user_metadata?.avatar_url as string | undefined) ??
    (data.user.user_metadata?.picture as string | undefined) ??
    null

  const result = await completeGoogleOnboarding({
    supabaseId: data.user.id,
    email: data.user.email,
    name: nombre,
    avatarUrl,
    companySlug,
    refCode: ref,
    ipAddress,
  })

  if (result.kind === 'ok') {
    // El JWT se acuñó en exchangeCodeForSession ANTES de fijar el app_metadata
    // (role/clienteId/companyId). Refrescamos (con un reintento) para que la
    // sesión ya lleve esos claims; si no, el middleware vería un rol/empresa
    // vacíos en la primera navegación tras el alta.
    const refresh = await supabase.auth.refreshSession()
    if (refresh.error) {
      console.error('[auth/callback] refreshSession falló, reintentando:', refresh.error)
      await supabase.auth.refreshSession().catch((e) =>
        console.error('[auth/callback] reintento de refreshSession falló:', e)
      )
    }
    return redirectWithCookies(new URL(result.dest, origin), carrier)
  }

  // No se completó el alta: invalidamos la sesión server-side (best-effort) y
  // redirigimos SIN las cookies de sesión — el navegador nunca las recibe.
  await supabase.auth.signOut().catch((e) =>
    console.error('[auth/callback] signOut falló:', e)
  )
  return NextResponse.redirect(new URL(DEST_ERROR[result.kind], origin))
}
