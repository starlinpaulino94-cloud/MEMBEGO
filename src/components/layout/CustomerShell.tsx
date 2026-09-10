import Link from 'next/link'
import { Search, QrCode, MapPin, ChevronDown, User, Bell, Mic } from 'lucide-react'
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
      {/* Cabecera del rediseño violeta (Stitch «amazon style»): buscador en
          píldora translúcida, escáner, campana (→ novedades) y avatar sobre
          el degradado; debajo, la píldora oscura de ubicación. El micrófono
          es decorativo (el diseño lo trae; dictar no existe todavía). */}
      <div className="sticky top-0 z-30">
        <div className="grad-vibe-header px-4 pb-2.5 pt-3">
          <div className="mx-auto flex w-full max-w-md items-center gap-2 md:max-w-3xl lg:max-w-7xl">
            <form
              action="/cliente/buscar"
              role="search"
              className="relative flex h-11 min-w-0 flex-1 items-center rounded-full border border-white/25 bg-white/15 pl-4 pr-2 backdrop-blur"
            >
              <Search className="h-4 w-4 shrink-0 text-white" aria-hidden />
              <label htmlFor="buscador-membego" className="sr-only">
                Buscar en MembeGo
              </label>
              <input
                id="buscador-membego"
                name="q"
                type="search"
                autoComplete="off"
                placeholder="Buscar beneficios, membresías…"
                className="h-full w-full min-w-0 bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/70"
              />
              <Mic className="h-4 w-4 shrink-0 text-white/80" aria-hidden />
            </form>
            <Link
              href="/cliente/qr"
              aria-label="Escanear mi código QR"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white outline-none transition-colors duration-fast hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white active:scale-95"
            >
              <QrCode className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/cliente/novedades"
              aria-label="Novedades de tus empresas"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white outline-none transition-colors duration-fast hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white active:scale-95"
            >
              <Bell className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/cliente/perfil"
              aria-label="Mi cuenta"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/20 font-semibold text-white outline-none transition-colors duration-fast hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-white active:scale-95"
            >
              {iniciales ? (
                <span aria-hidden>{iniciales}</span>
              ) : (
                <User className="h-5 w-5" aria-hidden />
              )}
            </Link>
          </div>
          <Link
            href="/cliente/cerca"
            className="mx-auto mt-2 flex h-9 w-full max-w-md items-center gap-1.5 rounded-full border border-white/15 bg-black/20 px-3.5 outline-none backdrop-blur transition-colors duration-fast hover:bg-black/30 focus-visible:ring-2 focus-visible:ring-white md:max-w-3xl lg:max-w-7xl"
          >
            <MapPin className="h-4 w-4 shrink-0 text-vibe-sky" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-label-sm font-bold text-white">
              {zonaLabel ? `Explorar cerca de ${zonaLabel}` : 'Explorar cerca de ti'} · Actualizar ubicación
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-label-sm font-bold text-vibe-aqua">
              Cambiar
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Link>
        </div>
        <TabsEscritorio />
      </div>

      {demoNombre && <BannerDemo nombreEmpresa={demoNombre} />}
      <main className="con-dock-inferior mx-auto w-full max-w-md px-4 py-4 md:max-w-3xl lg:max-w-7xl lg:px-6">
        <ExcursionCarritoWrapper>{children}</ExcursionCarritoWrapper>
      </main>

      <BottomNav />
      <SentryUserSync userId={dbUserId} email={email} role={role} companyId={companyId} />
    </>
  )
}
