import { requireRole } from '@/lib/auth/guards'
import { AppShell } from '@/components/layout/AppShell'
import { SentryUserSync } from '@/components/SentryUserSync'
import { getUnreadCount } from '@/modules/notificaciones/actions'
import { AvisoMigraciones } from '@/components/superadmin/AvisoMigraciones'
import { sistemasParaLanzador } from '@/modules/integraciones/sso'
import { contextoDeNavegacion } from '@/modules/navegacion/contexto'
import { badgesDeNavegacion } from '@/modules/navegacion/badges'

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireRole('SUPERADMIN')
  const [notifCount, sistemasExternos, ctx, badges] = await Promise.all([
    getUnreadCount().catch(() => 0),
    sistemasParaLanzador(user),
    contextoDeNavegacion({ role: 'SUPERADMIN', companyId: null, scope: 'PLATFORM' }),
    // Los contadores del menu: si alguno falla, su clave no viene y el modulo
    // se pinta sin insignia. La navegacion nunca depende de que cuadren.
    badgesDeNavegacion('SUPERADMIN', null).catch(() => ({})),
  ])
  return (
    <AppShell
      ctx={ctx}
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
      badges={badges}
      sistemasExternos={sistemasExternos}
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
