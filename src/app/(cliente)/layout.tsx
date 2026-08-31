import Link from 'next/link'
import Image from 'next/image'
import { headers } from 'next/headers'
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
import { ExcursionCarritoWrapper } from '@/components/excursiones/ExcursionCarritoWrapper'

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const h = await headers()
  const skipAuth = h.get('x-skip-cliente-auth') === '1'

  if (skipAuth) {
    return (
      <div className="theme-landing flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
          <div className="mb-8 flex flex-col items-center gap-2.5">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg text-2xl font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              <Image src="/logo.svg" alt="" width={38} height={38} priority aria-hidden />
              <span>
                Membe<span className="text-gradient">Go</span>
              </span>
            </Link>
            <p className="text-overline">Conecta · Disfruta · Ahorra</p>
          </div>

          <div className="w-full max-w-md">{children}</div>
        </main>

        <footer className="border-t border-border bg-sidebar py-5 text-center">
          <p className="text-caption text-sidebar-foreground">
            © {new Date().getFullYear()} MembeGo ·{' '}
            <Link href="/privacy" className="underline-offset-2 hover:underline">
              Privacidad
            </Link>{' '}
            ·{' '}
            <Link href="/terms" className="underline-offset-2 hover:underline">
              Términos
            </Link>
          </p>
        </footer>
      </div>
    )
  }

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
      <ExcursionCarritoWrapper>
        {children}
      </ExcursionCarritoWrapper>
    </AppShell>
  )
}
