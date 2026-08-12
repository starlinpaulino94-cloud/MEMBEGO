import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createRouteClient, redirectWithCookies } from '@/lib/supabase/route-client'
import { getAppUrl } from '@/lib/site'
import { registrarVerificacionReferido } from '@/lib/referidos-attribution'
import { registrarUsoEntrarComo } from '@/modules/superadmin/entrarComoUso'
import { ROLE_HOME, type AppRole } from '@/types'

/**
 * Callback de verificación de correo (Fase 1 · O-1). El enlace del correo de
 * confirmación apunta aquí con `token_hash` + `type`. Verificamos el token
 * (abre sesión) y redirigimos al home según el rol. Las cookies de sesión se
 * acumulan en un carrier y viajan en el redirect final para no perderlas.
 *
 * Aquí sí usamos getAppUrl: el enlace del correo se construyó con ese mismo
 * dominio canónico, así que request y destino comparten host.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const loginError = NextResponse.redirect(new URL('/login?error=verify', getAppUrl()))

  if (!tokenHash || !type) return loginError

  // Acumulador de cookies de sesión; el redirect final las conserva.
  const carrier = NextResponse.next()
  const supabase = createRouteClient(request, carrier)

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    console.error('[confirmar] verifyOtp falló:', error)
    return loginError
  }

  /**
   * ¿ERA UN ENLACE DE «ENTRAR COMO»?
   *
   * Este callback lo comparten dos cosas muy distintas: la verificación de
   * correo de cualquier usuario y la suplantación que genera el superadmin.
   * Las dos llegan con `type=magiclink` y son indistinguibles desde fuera; lo
   * único que las separa es si el token tiene una línea de
   * `ENTRAR_COMO_GENERADO` con su huella. Eso es lo que se comprueba aquí.
   *
   * Va DESPUÉS del `verifyOtp` porque solo se registra la suplantación que de
   * verdad ocurrió, no cada intento con un enlace ya gastado. Y no se espera
   * nada de ella: `registrarUsoEntrarComo` se traga sus propios errores y
   * devuelve `false`, para que un problema al escribir en la bitácora no deje a
   * nadie fuera de su cuenta.
   */
  if (type === 'magiclink') {
    await registrarUsoEntrarComo(tokenHash, {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
    })
  }

  // Sesión abierta: llevar al usuario directo a su panel según el rol.
  const { data } = await supabase.auth.getUser()

  // Fase E6 · Embudo de referidos: correo verificado (una vez por referido).
  if (data.user?.id) await registrarVerificacionReferido(data.user.id)
  const role = (data.user?.app_metadata?.role ?? 'CLIENTE') as AppRole
  const dest = ROLE_HOME[role] ?? '/mis-membresias'

  return redirectWithCookies(new URL(dest, getAppUrl()), carrier)
}
