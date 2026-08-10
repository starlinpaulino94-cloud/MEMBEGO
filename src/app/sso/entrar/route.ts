import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { verificarTokenSSOEntrante } from '@/modules/integraciones/nucleo'
import { accesoASistema, sistemaParaVerificarFirma } from '@/modules/plataforma/registro'
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
 * Los rechazos aterrizan en /login?error=sso&motivo=<grueso>: lo justo para
 * que el satélite sepa a quién le toca arreglarlo. El detalle exacto va al log
 * del servidor, nunca al navegador.
 */
/**
 * Motivos GRUESOS del rechazo, para que el satélite y el usuario sepan a quién
 * le toca arreglarlo sin convertir esto en un oráculo:
 *   token   — firma/vigencia/formato (no dice nada de ninguna cuenta)
 *   sistema — slug desconocido, no ACTIVE, o sin acceso a la empresa del token
 *   cuenta  — usuario inexistente o ajeno a la empresa. Solo se llega aquí con
 *             una firma VÁLIDA, o sea con el secreto compartido en la mano:
 *             quien puede provocar este motivo ya podría preguntarlo de mil
 *             formas, así que no filtra nada nuevo.
 *   sesion  — falló abrir la sesión de nuestro lado (culpa nuestra)
 */
type MotivoSSO = 'token' | 'sistema' | 'cuenta' | 'sesion'

export async function GET(req: NextRequest) {
  const rechazar = (motivo: MotivoSSO) =>
    NextResponse.redirect(new URL(`/login?error=sso&motivo=${motivo}`, getAppUrl()))

  // Rate limit por IP: este endpoint acepta credenciales al portador.
  if (!(await loginLimiter(getClientIdentifier(req)))) return rechazar('token')

  const slug = req.nextUrl.searchParams.get('sistema') ?? ''
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!slug) return rechazar('sistema')
  if (!token) return rechazar('token')

  try {
    const sistema = await sistemaParaVerificarFirma(slug)
    if (!sistema) {
      console.warn('[sso-entrar] sistema desconocido o inactivo:', slug)
      return rechazar('sistema')
    }

    const datos = verificarTokenSSOEntrante(sistema.secreto, token)
    if (!datos) {
      console.warn('[sso-entrar] token inválido o vencido (sistema:', slug, ')')
      return rechazar('token')
    }

    // ── El sistema debe tener acceso a la empresa del token ─────────────────
    //
    // ESTA COMPROBACIÓN NO EXISTÍA. La consulta anterior leía `categoria` del
    // sistema y no la usaba nunca: con la firma válida, el satélite del car
    // wash podía abrir la sesión de un usuario de un restaurante. Una firma
    // demuestra QUIÉN pide, no SOBRE QUIÉN puede pedir.
    //
    // Va aquí y no antes porque `companyId` viene DENTRO del token, y leerlo
    // exige haber verificado la firma primero.
    const { decision } = await accesoASistema(slug, datos.companyId)
    if (!decision.permitido) {
      console.warn('[sso-entrar] sistema sin acceso a la empresa del token:', slug, decision.motivo)
      return rechazar('sistema')
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
      return rechazar('cuenta')
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
      return rechazar('cuenta')
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
      return rechazar('sesion')
    }

    const carrier = NextResponse.next()
    const supabase = createRouteClient(req, carrier)
    const { error: errorOtp } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    })
    if (errorOtp) {
      console.error('[sso-entrar] verifyOtp falló:', errorOtp)
      return rechazar('sesion')
    }

    const dest = ROLE_HOME[user.role as AppRole] ?? '/mis-membresias'
    return redirectWithCookies(new URL(dest, getAppUrl()), carrier)
  } catch (e) {
    console.error('[sso-entrar] error inesperado:', e)
    return rechazar('sesion')
  }
}
