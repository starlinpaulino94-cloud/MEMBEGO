import { requireRole } from '@/lib/auth/guards'
import { AppShell } from '@/components/layout/AppShell'
import { SentryUserSync } from '@/components/SentryUserSync'
import { getUnreadCount } from '@/modules/notificaciones/actions'
import {
  getClienteCompaniesCached,
  getMembresiaActivaPrincipalId,
} from '@/modules/cliente/queries'
import { getNavOcultoClienteCached } from '@/modules/cliente/navDisponible'
import { BannerDemo } from '@/components/system/BannerDemo'
import { nombreSiEsDemo } from '@/modules/demo'

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireRole('CLIENTE')
  // Rendimiento: este layout corre en CADA clic. Lo cosmético (switcher de
  // empresas, módulos ocultos del menú) va cacheado 5 min por usuario; solo
  // el badge de notificaciones y el QR activo se consultan en vivo.
  const [notifCount, clienteCompanies, membresiaQrId, hiddenNav, demo] = await Promise.all([
    getUnreadCount().catch(() => 0),
    getClienteCompaniesCached(user.supabaseId).catch(() => []),
    getMembresiaActivaPrincipalId(user.supabaseId, user.metadata.clienteId),
    getNavOcultoClienteCached(user.metadata.clienteId, user.metadata.companyId),
    nombreSiEsDemo(user.metadata.companyId),
  ])
  const companies = clienteCompanies.map((c) => ({
    companyId: c.companyId,
    name: c.company.name,
    logoUrl: c.company.logoUrl,
    active: c.companyId === user.metadata.companyId,
  }))
  return (
    <AppShell
      role="CLIENTE"
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
      companies={companies}
      // Dock central "Mi QR" de la barra inferior (reemplaza al FAB flotante).
      qrHref={membresiaQrId ? `/membresia/${membresiaQrId}` : null}
      // Oculta del menú los módulos del cliente que aún no tienen contenido.
      hiddenNav={hiddenNav}
    >
      <SentryUserSync userId={user.metadata.dbUserId} email={user.email} role={user.metadata.role} companyId={user.metadata.companyId} />
      {/* El cliente de práctica también tiene que saberlo: si el personal usa
          un teléfono de prueba para enseñar el recorrido, quien mire la
          pantalla ve que nada de eso es un cobro de verdad. */}
      {demo && <BannerDemo nombreEmpresa={demo} />}
      {children}
    </AppShell>
  )
}
