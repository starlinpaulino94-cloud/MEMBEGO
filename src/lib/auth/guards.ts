import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { FULL_ADMIN_ROLES, type AppRole, type SessionUser } from '@/types'
import { canAccessAdminSection, type AdminSection } from '@/lib/auth/permissions'

function setSentryContext(user: SessionUser) {
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.setUser({ id: user.metadata.dbUserId || user.supabaseId, email: user.email })
      Sentry.setTag('user.role', user.metadata.role)
      if (user.metadata.companyId) Sentry.setTag('company.id', user.metadata.companyId)
    })
    .catch(() => {})
}

export async function requireUser(): Promise<SessionUser> {
  // getUser() revalida el token contra el servidor de Supabase en cada
  // request (a diferencia de getSession(), que solo decodifica la cookie sin
  // verificar la firma). Es el método recomendado para decisiones de
  // autorización en código de servidor.
  const user = await getUser()
  if (!user) redirect('/login')

  setSentryContext(user)
  return user
}

export async function requireRole(
  roles: AppRole | AppRole[]
): Promise<SessionUser> {
  const user = await requireUser()
  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(user.metadata.role)) {
    redirect('/login')
  }
  return user
}

/**
 * Guard NO-redirect para server actions: devuelve el usuario admin PLENO
 * (rol en FULL_ADMIN_ROLES) o null.
 *
 * Fail-closed por diseño: los roles acotados (MARKETING, SUPERVISOR) NO pasan
 * este guard. Como una server action se despacha por su ID sobre cualquier
 * path permitido, el gate por sección del middleware NO la protege; por eso
 * las mutaciones exigen admin pleno por defecto. Las pocas acciones que un rol
 * acotado sí puede ejecutar usan `requireSection(...)` en su lugar.
 */
export async function requireAdminUser(): Promise<SessionUser | null> {
  const user = await getUser()
  if (!user || !FULL_ADMIN_ROLES.includes(user.metadata.role)) return null
  return user
}

/**
 * Guard NO-redirect para server actions acotadas por sección: devuelve el
 * usuario si su rol puede acceder a `section` (admin pleno o rol acotado con
 * esa sección permitida), o null. Segunda barrera server-side que NO depende
 * del path del request (a diferencia del middleware).
 */
export async function requireSection(
  section: AdminSection
): Promise<SessionUser | null> {
  const user = await getUser()
  if (!user) return null
  if (!canAccessAdminSection(user.metadata.role, section)) return null

  // Plataforma modular · E1: capa de CAPACIDADES por empresa (rol Y capacidad
  // deben permitir). El superadmin no se gatea; el resolutor es fail-open
  // (empresa sin configurar o migración pendiente = todo lo actual permitido).
  if (user.metadata.role !== 'SUPERADMIN') {
    const { seccionPermitidaPorCapacidades } = await import('@/modules/capacidades/resolver')
    if (!(await seccionPermitidaPorCapacidades(user.metadata.companyId, section))) {
      return null
    }
  }
  return user
}
