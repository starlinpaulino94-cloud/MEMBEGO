import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { crearTokenSSO } from '@/modules/integraciones/nucleo'
import type { SessionUser } from '@/types'

/**
 * SSO hacia los sistemas satélite: MembeGo actúa como proveedor de identidad.
 * Un empleado/admin abre el satélite desde MembeGo con un token firmado de
 * vida corta; el satélite lo verifica con el secreto compartido y crea SU
 * propia sesión. El token lleva la empresa (tenant) — el satélite acota todo
 * a esa empresa.
 */

const TTL_SEGUNDOS = 90

export async function urlAperturaSSO(
  slug: string,
  user: SessionUser
): Promise<{ url: string } | { error: string }> {
  // El SUPERADMIN de la plataforma no siempre carga companyId en su sesión;
  // en modo marca única opera sobre la empresa principal, y con ese tenant
  // entra al satélite.
  let companyId = user.metadata.companyId
  if (!companyId && user.metadata.role === 'SUPERADMIN') {
    const { getEmpresaPrincipal } = await import('@/modules/marketplace/marcaUnica')
    companyId = (await getEmpresaPrincipal())?.id ?? null
  }
  if (!companyId) return { error: 'Tu cuenta no tiene empresa activa.' }

  const sistema = await sinEmpresa('sso: sistema conectado por slug (catálogo global)', (tx) =>
    tx.sistemaConectado
      .findUnique({ where: { slug }, select: { urlBase: true, secreto: true, activo: true, categoria: true } })
  ).catch(() => null)
  if (!sistema || !sistema.activo) return { error: 'Sistema no disponible.' }

  // La empresa debe pertenecer a la categoría que el sistema atiende: un
  // empleado de una barbería no abre el sistema de car wash.
  try {
    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    const { categoria } = await getCapacidadesEmpresa(companyId)
    if (categoria !== sistema.categoria) return { error: 'Este sistema no aplica a tu empresa.' }
  } catch {
    return { error: 'No se pudo verificar tu empresa.' }
  }

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
 * wash"). Es el sistema ACTIVO cuya categoría coincide con la de la empresa
 * del usuario (o la empresa principal para el SUPERADMIN). Null = sin botón.
 * Nunca lanza: un fallo aquí no puede tumbar el layout.
 */
export async function sistemaExternoParaHeader(user: SessionUser): Promise<SistemaExterno | null> {
  try {
    let companyId = user.metadata.companyId
    if (!companyId && user.metadata.role === 'SUPERADMIN') {
      const { getEmpresaPrincipal } = await import('@/modules/marketplace/marcaUnica')
      companyId = (await getEmpresaPrincipal())?.id ?? null
    }
    if (!companyId) return null

    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    const { categoria } = await getCapacidadesEmpresa(companyId)

    const sistema = await sinEmpresa('header: sistema satélite de la categoría (catálogo global)', (tx) =>
      tx.sistemaConectado.findFirst({
        where: { activo: true, categoria },
        select: { slug: true, nombre: true },
        orderBy: { createdAt: 'asc' },
      })
    )
    return sistema ?? null
  } catch (e) {
    console.error('[sso] sistemaExternoParaHeader:', e)
    return null
  }
}
