import { requireRole } from '@/lib/auth/guards'
import { AppShell } from '@/components/layout/AppShell'
import { SentryUserSync } from '@/components/SentryUserSync'
import { getUnreadCount } from '@/modules/notificaciones/actions'
import { SCANNER_ROLES } from '@/types'
import {
  ROLES_EXENTOS_PERMISOS,
  resolverPermisosUsuario,
} from '@/lib/auth/permissions'
import { contextoDeNavegacion } from '@/modules/navegacion/contexto'
import { badgesDeNavegacion } from '@/modules/navegacion/badges'

/** Ajustes de permisos del empleado (null = su rol tal cual). Nunca lanza. */
async function permisosDelEmpleado(role: string, dbUserId: string) {
  if (ROLES_EXENTOS_PERMISOS.includes(role as (typeof ROLES_EXENTOS_PERMISOS)[number])) {
    return null
  }
  try {
    const { sinEmpresa } = await import('@/lib/tenant')
    const fila = await sinEmpresa('permisos: ajustes del propio usuario (users es global)', (tx) =>
      tx.user.findUnique({ where: { id: dbUserId }, select: { permisos: true } })
    )
    return resolverPermisosUsuario(fila?.permisos)
  } catch {
    return null
  }
}

export default async function EmpleadoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Alineado con el proxy edge y la página del scanner (SCANNER_ROLES). Antes
  // usaba una lista que excluía RECEPCION/ADMINISTRADOR/GERENTE/CAJERO, lo que
  // provocaba un bucle de redirección para RECEPCION (su home es el scanner).
  const user = await requireRole(SCANNER_ROLES)
  const [notifCount, ctx, badges] = await Promise.all([
    getUnreadCount().catch(() => 0),
    // El mostrador SI depende de capacidades: sin POS_CAJA, «Caja» no existe
    // para esta empresa y ofrecerla seria ensenar una puerta cerrada.
    contextoDeNavegacion({
      role: user.metadata.role,
      companyId: user.metadata.companyId,
      // LOS PERMISOS TAMBIEN LLEGAN AQUI. Sin esto, conceder un modulo del
      // panel a un empleado se guardaba y no aparecia por ningun sitio: su
      // menu se construia solo con su rol, asi que el permiso existia y no
      // habia desde donde usarlo.
      permisos: await permisosDelEmpleado(user.metadata.role, user.metadata.dbUserId),
    }),
    badgesDeNavegacion(user.metadata.role, user.metadata.companyId).catch(() => ({})),
  ])
  return (
    <AppShell
      ctx={ctx}
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
      badges={badges}
    >
      <SentryUserSync userId={user.metadata.dbUserId} email={user.email} role={user.metadata.role} companyId={user.metadata.companyId} />
      {children}
    </AppShell>
  )
}
