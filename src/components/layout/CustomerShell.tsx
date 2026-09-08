import Link from 'next/link'
import { Search, QrCode, MapPin, ChevronDown, User } from 'lucide-react'
import { BottomNav } from '@/components/layout/BottomNav'
import { TabsEscritorio } from '@/components/layout/TabsEscritorio'
import { BannerDemo } from '@/components/system/BannerDemo'
import { SentryUserSync } from '@/components/SentryUserSync'
import { ExcursionCarritoWrapper } from '@/components/excursiones/ExcursionCarritoWrapper'

/**
 * Carcasa retail del cliente (contrato Stitch S01–S04).
 *
 * Cabecera en degradado con buscador + escáner + avatar, barra contextual de
 * ubicación, columna de contenido y dock inferior de 4 destinos fijos. En
 * escritorio los mismos 4 destinos se presentan como fila de pestañas; el
 * vocabulario y el orden no cambian entre dispositivos ni empresas.
 */
export function CustomerShell({
  iniciales,
  email,
  dbUserId,
  role,
  companyId,
  zonaLabel,
  demoNombre,
  children,
}: {
  iniciales: string
  email: string
  dbUserId: string
  role: string
  companyId: string | null
  zonaLabel: string | null
  demoNombre: string | null
  children: React.ReactNode
}) {
  return (
    <>
      <div className="sticky top-0 z-30">
        <div className="retail-header px-4 pb-2 pt-3">
          <div className="mx-auto flex w-full max-w-md items-center gap-2 lg:max-w-7xl">
            <form action="/cliente/buscar" role="search" className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <label htmlFor="buscador-membego" className="sr-only">
                Buscar en MembeGo
              </label>
              <input
                id="buscador-membego"
                name="q"
                type="search"
                autoComplete="off"
                placeholder="Buscar en MembeGo (empresas, ofertas…)"
                className="h-11 w-full rounded-lg border border-border bg-card pl-9 pr-4 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </form>
            <Link
              href="/cliente/qr"
              aria-label="Escanear mi código QR"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-sm transition outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
            >
              <QrCode className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/cliente/perfil"
              aria-label="Mi cuenta"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card font-semibold text-primary shadow-sm transition outline-none hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
            >
              {iniciales ? (
                <span aria-hidden>{iniciales}</span>
              ) : (
                <User className="h-5 w-5" aria-hidden />
              )}
            </Link>
          </div>
        </div>
        <Link
          href="/cliente/cerca"
          className="flex items-center gap-1.5 bg-retail-mist px-4 py-2 text-[13px] font-medium text-retail-deep outline-none transition hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="mx-auto flex w-full max-w-md items-center gap-1.5 lg:max-w-7xl">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {zonaLabel ? `Explorar cerca de ${zonaLabel}` : 'Explorar cerca de ti'} · Actualizar ubicación
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </span>
        </Link>
        <TabsEscritorio />
      </div>

      {demoNombre && <BannerDemo nombreEmpresa={demoNombre} />}
      <main className="con-dock-inferior mx-auto w-full max-w-md px-4 py-4 lg:max-w-7xl lg:px-6">
        <ExcursionCarritoWrapper>{children}</ExcursionCarritoWrapper>
      </main>

      <BottomNav />
      <SentryUserSync userId={dbUserId} email={email} role={role} companyId={companyId} />
    </>
  )
}
