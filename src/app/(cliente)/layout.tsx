import Link from 'next/link'
import Image from 'next/image'
import { headers } from 'next/headers'
import { Inter } from 'next/font/google'
import { requireRole } from '@/lib/auth/guards'
import { CustomerShell } from '@/components/layout/CustomerShell'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { nombreSiEsDemo } from '@/modules/demo'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })

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
  const [ubicacion, demo] = await Promise.all([
    user.metadata.dbUserId
      ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
      : Promise.resolve(null),
    nombreSiEsDemo(user.metadata.companyId),
  ])
  const zona = ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null

  return (
    <div className={`${inter.variable} retail min-h-screen bg-background text-foreground`}>
      <CustomerShell
        iniciales={(user.email || '?').trim().slice(0, 1).toUpperCase()}
        email={user.email}
        dbUserId={user.metadata.dbUserId}
        role={user.metadata.role}
        companyId={user.metadata.companyId ?? null}
        zonaLabel={zona}
        demoNombre={demo ?? null}
      >
        {children}
      </CustomerShell>
    </div>
  )
}
