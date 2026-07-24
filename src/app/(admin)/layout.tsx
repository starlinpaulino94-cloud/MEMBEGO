import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { AppShell } from '@/components/layout/AppShell'
import { AdminCompanySwitcher } from '@/components/admin/AdminCompanySwitcher'
import { SentryUserSync } from '@/components/SentryUserSync'
import { ADMIN_ROLES } from '@/types'
import { getUnreadCount } from '@/modules/notificaciones/actions'

/**
 * Empresas entre las que este usuario puede cambiar: superadmin ve todas;
 * el staff multi-empresa ve su empresa actual + las de UserCompanyAccess.
 * Con 0-1 opciones el selector no se muestra (caso común).
 */
async function empresasDisponibles(
  role: string,
  dbUserId: string,
  companyId: string | null
) {
  try {
    if (role === 'SUPERADMIN') {
      return await prisma.company.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    }
    const accesos = await prisma.userCompanyAccess.findMany({
      where: { userId: dbUserId },
      select: { company: { select: { id: true, name: true } } },
    })
    const mapa = new Map(accesos.map((a) => [a.company.id, a.company]))
    if (companyId && !mapa.has(companyId)) {
      const propia = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true },
      })
      if (propia) mapa.set(propia.id, propia)
    }
    return [...mapa.values()].sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/**
 * Plataforma modular · E2 (interruptor D7): con la capacidad NAVEGACION_V2
 * encendida, los módulos operativos salen del menú de MembeGo y viven solo
 * dentro de la app Car Wash (launchpad → shell). Apagada (el default), el
 * menú es EXACTAMENTE el de siempre. Fail-open ante cualquier error.
 */
async function navOcultaPorApps(companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return []
  try {
    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    const capacidades = await getCapacidadesEmpresa(companyId)
    if (!capacidades.navegacionV2) return []
    return ['/admin/scanner', '/admin/citas', '/admin/seguimiento', '/admin/sucursales']
  } catch {
    return []
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireRole(ADMIN_ROLES)
  const [notifCount, empresas, hiddenNav] = await Promise.all([
    getUnreadCount().catch(() => 0),
    empresasDisponibles(
      user.metadata.role,
      user.metadata.dbUserId,
      user.metadata.companyId ?? null
    ),
    navOcultaPorApps(user.metadata.companyId),
  ])
  return (
    <AppShell
      // Resolvemos el menú por el rol real del usuario. Así un SUPERADMIN que
      // entre a una página /admin/* conserva su barra lateral (Superadmin) en
      // vez de quedar "atrapado" en el menú de Administrador. Los roles admin
      // (ADMIN_EMPRESA, GERENTE, etc.) siguen viendo el menú Admin.
      role={user.metadata.role}
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
      hiddenNav={hiddenNav}
    >
      <SentryUserSync userId={user.metadata.dbUserId} email={user.email} role={user.metadata.role} companyId={user.metadata.companyId} />
      <AdminCompanySwitcher
        empresas={empresas}
        activaId={user.metadata.companyId ?? null}
      />
      {children}
    </AppShell>
  )
}
