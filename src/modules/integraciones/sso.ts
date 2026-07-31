import 'server-only'
import { prisma } from '@/lib/prisma'
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
  if (!user.metadata.companyId) return { error: 'Tu cuenta no tiene empresa activa.' }

  const sistema = await prisma.sistemaConectado
    .findUnique({ where: { slug }, select: { urlBase: true, secreto: true, activo: true, categoria: true } })
    .catch(() => null)
  if (!sistema || !sistema.activo) return { error: 'Sistema no disponible.' }

  // La empresa debe pertenecer a la categoría que el sistema atiende: un
  // empleado de una barbería no abre el sistema de car wash.
  try {
    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    const { categoria } = await getCapacidadesEmpresa(user.metadata.companyId)
    if (categoria !== sistema.categoria) return { error: 'Este sistema no aplica a tu empresa.' }
  } catch {
    return { error: 'No se pudo verificar tu empresa.' }
  }

  const token = crearTokenSSO(sistema.secreto, {
    sub: user.supabaseId,
    email: user.email,
    rol: user.metadata.role,
    companyId: user.metadata.companyId,
    exp: Math.floor(Date.now() / 1000) + TTL_SEGUNDOS,
  })
  const base = sistema.urlBase.replace(/\/$/, '')
  return { url: `${base}/sso/membego?token=${encodeURIComponent(token)}` }
}
