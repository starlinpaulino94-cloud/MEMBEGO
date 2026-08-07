import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { verificarTokenSSOEntrante } from '@/modules/integraciones/nucleo'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRouteClient, redirectWithCookies } from '@/lib/supabase/route-client'
import { getAppUrl } from '@/lib/site'
import { loginLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { ROLE_HOME, type AppRole } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * SSO DE ENTRADA (satélite → MembeGo) — el inverso de
 * /api/integraciones/abrir/[slug].
 *
 * El satélite firma `base64url(JSON).hmacHex` con el MISMO secreto compartido
 * de su fila en SistemaConectado y redirige aquí:
 *
 *   GET /sso/entrar?sistema=<slug>&token=<TOKEN>
 *
 * Payload: { sub?, email?, companyId, exp } — `sub` (el supabaseId que
 * NUESTRO token saliente le entregó) es lo preferido; `email` basta si no lo
 * guardó (es único en MembeGo). Vigencia corta (90 s recomendados).
 *
 * Verificamos firma y vigencia, resolvemos al usuario, comprobamos que
 * pertenece a la empresa del token, y abrimos SU sesión con el mismo
 * mecanismo del enlace de verificación de correo (generateLink + verifyOtp,
 * ver (auth)/confirmar). NUNCA se crean cuentas desde aquí: un token válido
 * de un usuario inexistente termina en /login con aviso.
 *
 * Todos los rechazos aterrizan en /login?error=sso sin detalle — el detalle
 * (qué falló exactamente) va al log del servidor, no al navegador de un
 * atacante probando tokens.
 */
export async function GET(req: NextRequest) {
  const rechazo = NextResponse.redirect(new URL('/login?error=sso', getAppUrl()))

  // Rate limit por IP: este endpoint acepta credenciales al portador.
  if (!(await loginLimiter(getClientIdentifier(req)))) return rechazo

  const slug = req.nextUrl.searchParams.get('sistema') ?? ''
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!slug || !token) return rechazo

  try {
    const sistema = await sinEmpresa('sso entrante: sistema conectado por slug (catálogo global)', (tx) =>
      tx.sistemaConectado.findUnique({
        where: { slug },
        select: { secreto: true, activo: true, categoria: true },
      })
    )
    if (!sistema || !sistema.activo) {
      console.warn('[sso-entrar] sistema desconocido o inactivo:', slug)
      return rechazo
    }

    const datos = verificarTokenSSOEntrante(sistema.secreto, token)
    if (!datos) {
      console.warn('[sso-entrar] token inválido o vencido (sistema:', slug, ')')
      return rechazo
    }

    // ── Resolver al usuario de MembeGo: sub preferido, email como respaldo ──
    const user = await sinEmpresa('sso entrante: resolver usuario (cross-tenant por identidad)', (tx) =>
      datos.sub
        ? tx.user.findUnique({
            where: { supabaseId: datos.sub },
            select: { supabaseId: true, email: true, role: true, companyId: true },
          })
        : tx.user.findUnique({
            where: { email: String(datos.email).trim().toLowerCase() },
            select: { supabaseId: true, email: true, role: true, companyId: true },
          })
    )
    if (!user) {
      console.warn('[sso-entrar] usuario no encontrado (sistema:', slug, ')')
      return rechazo
    }

    // ── El usuario debe pertenecer a la empresa del token ───────────────────
    // Staff: su companyId directo. Cliente: su ficha en esa empresa. Un token
    // válido de la empresa A jamás abre una cuenta de la empresa B.
    const esCliente = user.role === 'CLIENTE'
    const perteneceStaff = !esCliente && user.companyId === datos.companyId
    const perteneceCliente = esCliente
      ? await sinEmpresa('sso entrante: comprobar ficha del cliente en la empresa del token', (tx) =>
          tx.cliente
            .findUnique({
              where: {
                supabaseId_companyId: { supabaseId: user.supabaseId, companyId: datos.companyId },
              },
              select: { id: true },
            })
            .then((c) => !!c)
        )
      : false
    if (!perteneceStaff && !perteneceCliente) {
      console.warn('[sso-entrar] usuario no pertenece a la empresa del token (sistema:', slug, ')')
      return rechazo
    }

    // ── Abrir sesión: el mismo mecanismo probado del enlace de correo ───────
    const admin = createAdminClient()
    const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    })
    const tokenHash = enlace?.properties?.hashed_token
    if (errorEnlace || !tokenHash) {
      console.error('[sso-entrar] generateLink falló:', errorEnlace)
      return rechazo
    }

    const carrier = NextResponse.next()
    const supabase = createRouteClient(req, carrier)
    const { error: errorOtp } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    })
    if (errorOtp) {
      console.error('[sso-entrar] verifyOtp falló:', errorOtp)
      return rechazo
    }

    const dest = ROLE_HOME[user.role as AppRole] ?? '/mis-membresias'
    return redirectWithCookies(new URL(dest, getAppUrl()), carrier)
  } catch (e) {
    console.error('[sso-entrar] error inesperado:', e)
    return rechazo
  }
}
