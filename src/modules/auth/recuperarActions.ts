'use server'

/**
 * RECUPERAR CONTRASEÑA EN EL SERVIDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * `/recuperar` llamaba a `supabase.auth.resetPasswordForEmail(...)` DESDE EL
 * NAVEGADOR, directo a `<proyecto>.supabase.co`. Cuando el teléfono del usuario
 * no lograba abrir esa conexión (DNS del operador, red inestable, bloqueador,
 * VPN, "DNS privado"), el SDK devolvía un error de red (status 0) y la pantalla
 * mostraba esto, con el dominio interno del proyecto incluido:
 *
 *   "No pudimos enviar el correo (Failed to fetch (xxxx.supabase.co))..."
 *
 * Dos problemas en uno:
 *   · la recuperación dependía de que el NAVEGADOR alcanzara Supabase, cuando el
 *     login ya viaja por el dominio de la app (ver loginActions.ts);
 *   · el mensaje filtraba el host del proyecto y un detalle técnico que a la
 *     persona no le sirve de nada.
 *
 * QUÉ HACE AHORA
 *
 * El navegador solo habla con el dominio de la app. Es el servidor quien pide el
 * correo a Supabase, con un reintento ante fallos de red/5xx, y quien devuelve
 * un mensaje ya traducido. El enlace del correo sigue aterrizando en
 * `/actualizar-password` (el flujo PKCE guarda el verificador en una cookie que
 * el cliente de navegador lee igual que antes: @supabase/ssr no la marca
 * httpOnly).
 *
 * Además se aplica el limitador distribuido (por IP y por correo): antes el
 * único freno a quien dispara correos de recuperación era el de Supabase.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isTransientAuthError } from '@/lib/auth/transient'
import {
  getClientIdentifier,
  recoveryEmailLimiter,
  recoveryIpLimiter,
} from '@/lib/rate-limit'
import { absoluteUrl } from '@/lib/site'
import { registrarEvento } from '@/modules/observabilidad/eventos'

export interface RecuperarState {
  /** El correo se pidió con éxito (no confirma que la cuenta exista). */
  ok?: boolean
  error?: string
}

const ESPERA_UN_MINUTO =
  'Por seguridad solo se puede pedir un correo por minuto. Espera 60 segundos y vuelve a intentar.'
const DEMASIADOS =
  'Demasiadas solicitudes de recuperación. Espera unos minutos y vuelve a intentarlo.'
const NO_SE_PUDO =
  'No pudimos enviar el correo en este momento. Revisa tu conexión e intenta de nuevo en unos minutos.'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Validación mínima: el control fino del formato lo hace Supabase. */
function correoPlausible(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function solicitarRecuperacion(email: string): Promise<RecuperarState> {
  const correo = String(email ?? '').trim().toLowerCase()
  if (!correoPlausible(correo)) {
    return { error: 'Escribe un correo electrónico válido.' }
  }

  const h = await headers()
  const ip = getClientIdentifier({ headers: h })

  // Las dos claves se consultan SIEMPRE (misma razón que en loginActions.ts):
  // si se cortocircuitara, un ataque repartido por IP no gastaría la cuota de
  // la clave por correo.
  const [okIp, okEmail] = await Promise.all([
    recoveryIpLimiter(`ip:${ip}`),
    recoveryEmailLimiter(`email:${correo}`),
  ])
  if (!okIp || !okEmail) {
    registrarEvento({ dominio: 'auth', accion: 'recuperar', ok: false, motivo: 'limite_alcanzado' })
    return { error: DEMASIADOS }
  }

  try {
    const supabase = await createClient()
    const redirectTo = absoluteUrl('/actualizar-password')

    let { error } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo })

    // Un fallo de red o un 5xx puntual se reintenta una vez antes de rendirse;
    // un 429 NO (reintentar solo lo agrava).
    if (error && error.status !== 429 && isTransientAuthError(error)) {
      await sleep(500)
      ;({ error } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo }))
    }

    if (!error) {
      registrarEvento({ dominio: 'auth', accion: 'recuperar', ok: true })
      return { ok: true }
    }

    // El detalle real queda en el log del servidor; a la persona nunca se le
    // muestra el host del proyecto ni el mensaje crudo del proveedor.
    console.error(
      '[recuperar] resetPasswordForEmail:',
      JSON.stringify({
        status: error.status,
        code: (error as { code?: string }).code,
        name: error.name,
        message: error.message,
      })
    )

    const msg = typeof error.message === 'string' ? error.message : ''
    if (error.status === 429 || /security purposes|rate limit/i.test(msg)) {
      registrarEvento({ dominio: 'auth', accion: 'recuperar', ok: false, motivo: 'limite_proveedor' })
      return { error: ESPERA_UN_MINUTO }
    }

    registrarEvento({ dominio: 'auth', accion: 'recuperar', ok: false, motivo: 'proveedor' })
    return { error: NO_SE_PUDO }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : ''
    if (mensaje.includes('Missing env var')) {
      // El detalle (qué variable falta) se queda en el servidor: al navegador solo le toca saber que el entorno no está listo.
      console.error('[%s] entorno sin configurar: %s', 'recuperar', mensaje)
      return {
        error: 'Este entorno no está configurado todavía. Avisa al administrador.',
      }
    }
    console.error('[recuperar] error inesperado:', e)
    return { error: NO_SE_PUDO }
  }
}
