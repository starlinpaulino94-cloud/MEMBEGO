import 'server-only'
import { crearTokenSSO } from '@/modules/integraciones/nucleo'
import { mensajeDenegado } from '@/modules/plataforma/acceso'
import { accesoASistema, sistemasDeEmpresa } from '@/modules/plataforma/registro'
import type { SessionUser } from '@/types'

/**
 * SSO hacia los sistemas satélite: MembeGo actúa como proveedor de identidad.
 * Un empleado/admin abre el satélite desde MembeGo con un token firmado de
 * vida corta; el satélite lo verifica con el secreto compartido y crea SU
 * propia sesión. El token lleva la empresa (tenant) — el satélite acota todo
 * a esa empresa.
 */

const TTL_SEGUNDOS = 90

/**
 * Empresa con la que el usuario entra al satélite. El SUPERADMIN de la
 * plataforma no siempre carga `companyId` en su sesión; en modo marca única
 * opera sobre la empresa principal, y con ese tenant entra.
 */
async function empresaDelUsuario(user: SessionUser): Promise<string | null> {
  if (user.metadata.companyId) return user.metadata.companyId
  if (user.metadata.role !== 'SUPERADMIN') return null
  const { getEmpresaPrincipal } = await import('@/modules/marketplace/marcaUnica')
  return (await getEmpresaPrincipal())?.id ?? null
}

export async function urlAperturaSSO(
  slug: string,
  user: SessionUser
): Promise<{ url: string } | { error: string }> {
  const companyId = await empresaDelUsuario(user)
  if (!companyId) return { error: 'Tu cuenta no tiene empresa activa.' }

  // Una sola pregunta al registro: estado del sistema, compatibilidad de
  // vertical y habilitación de la empresa se deciden juntas en `acceso.ts`.
  const { decision, sistema } = await accesoASistema(slug, companyId, { conSecreto: true })
  if (!decision.permitido) {
    console.warn('[sso] acceso denegado:', slug, decision.motivo, 'empresa:', companyId)
    return { error: mensajeDenegado(decision.motivo) }
  }
  if (!sistema?.secreto) return { error: 'Sistema no disponible.' }

  const token = crearTokenSSO(sistema.secreto, {
    sub: user.supabaseId,
    email: user.email,
    rol: user.metadata.role,
    companyId,
    exp: Math.floor(Date.now() / 1000) + TTL_SEGUNDOS,
  })
  const base = sistema.urlBase.replace(/\/$/, '')
  return { url: `${base}/sso/membego?token=${encodeURIComponent(token)}` }
}

export interface SistemaExterno {
  slug: string
  nombre: string
}

/**
 * Sistema satélite que el header ofrece como acceso directo ("ir al car
 * wash"): el primero que la empresa del usuario tiene habilitado. Null = sin
 * botón. Nunca lanza: un fallo aquí no puede tumbar el layout.
 *
 * Solo se ofrece UNO aunque la empresa tenga varios habilitados. El día que eso
 * sea normal, el botón pasa a ser un menú — pero eso es el App Launcher de la
 * Fase 5, no un desplegable improvisado en la cabecera.
 */
export async function sistemaExternoParaHeader(user: SessionUser): Promise<SistemaExterno | null> {
  try {
    const companyId = await empresaDelUsuario(user)
    if (!companyId) return null

    const [primero] = await sistemasDeEmpresa(companyId)
    return primero ? { slug: primero.slug, nombre: primero.nombre } : null
  } catch (e) {
    console.error('[sso] sistemaExternoParaHeader:', e)
    return null
  }
}
