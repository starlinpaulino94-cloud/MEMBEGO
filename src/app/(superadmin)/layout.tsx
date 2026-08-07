import { requireRole } from '@/lib/auth/guards'
import { AppShell } from '@/components/layout/AppShell'
import { SentryUserSync } from '@/components/SentryUserSync'
import { getUnreadCount } from '@/modules/notificaciones/actions'
import { AvisoMigraciones } from '@/components/superadmin/AvisoMigraciones'

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireRole('SUPERADMIN')
  const notifCount = await getUnreadCount().catch(() => 0)
  return (
    <AppShell
      role="SUPERADMIN"
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
    >
      <SentryUserSync userId={user.metadata.dbUserId} email={user.email} role={user.metadata.role} companyId={user.metadata.companyId} />
      {/* Solo aparece si hay migraciones sin correr: la falla silenciosa que
          el código tolera a propósito y por eso nadie nota (F5 del plan). */}
      <div className="mb-4 empty:mb-0">
        <AvisoMigraciones />
      </div>
      {children}
    </AppShell>
  )
}
