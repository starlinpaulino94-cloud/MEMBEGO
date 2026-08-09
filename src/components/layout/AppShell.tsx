'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppHeader } from '@/components/layout/AppHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import type { CompanyOption } from '@/components/cliente/CompanySwitcher'
import type { AppRole } from '@/types'

/** Roles con navegación inferior en móvil (experiencia principalmente táctil). */
const BOTTOM_NAV_ROLES: readonly AppRole[] = ['CLIENTE']

/** DXS · Persistencia del riel colapsado de la sidebar (desktop). */
const RAIL_KEY = 'membego.sidebar.rail.v1'
const emptySubscribe = () => () => {}

function leerRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Destino de "Ayuda" en el menú de usuario, por rol. Solo el cliente tiene
 * hoy una pantalla de ayuda propia; el personal la pide por Soporte, que ya
 * está en su menú lateral. Sin destino, la entrada no se pinta.
 */
function ayudaParaRol(role: AppRole): string | null {
  return role === 'CLIENTE' ? '/cliente/ayuda' : null
}

export function AppShell({
  role,
  title,
  userEmail,
  userName,
  notifCount = 0,
  companies,
  qrHref,
  hiddenNav,
  sistemaExterno,
  children,
}: {
  role: AppRole
  title: string
  userEmail: string
  /** Nombre de la persona cuando se conoce; si no, manda el correo. */
  userName?: string | null
  notifCount?: number
  companies?: CompanyOption[]
  /** Destino del dock central "Mi QR" en la barra inferior (cliente). */
  qrHref?: string | null
  /** Rutas a ocultar por no tener contenido todavía (cliente). */
  hiddenNav?: string[]
  /** Sistema satélite conectado: el header ofrece el acceso directo por SSO. */
  sistemaExterno?: { slug: string; nombre: string } | null
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  /** Quién abrió el menú, para devolverle el foco al cerrarlo. */
  const abridorRef = useRef<HTMLElement | null>(null)
  const hasBottomNav = BOTTOM_NAV_ROLES.includes(role)

  // DXS · Riel colapsado (desktop): SSR/1er render expandido (sin mismatch de
  // hidratación); tras montar aplica lo guardado. El toggle pisa con override.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [railOverride, setRailOverride] = useState<boolean | null>(null)
  const rail = railOverride ?? (mounted ? leerRail() : false)

  function toggleRail() {
    const next = !rail
    setRailOverride(next)
    try {
      localStorage.setItem(RAIL_KEY, next ? '1' : '0')
    } catch {
      /* sin almacenamiento: el riel funciona sin memoria */
    }
  }

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // A11y del drawer: Escape cierra, el foco entra al abrir, se queda dentro
  // mientras está abierto (si no, tabular se escapa al contenido de atrás que
  // el diálogo dice estar tapando) y vuelve al botón que lo abrió al cerrar.
  useEffect(() => {
    if (!mobileOpen) {
      abridorRef.current?.focus()
      abridorRef.current = null
      return
    }
    abridorRef.current = document.activeElement as HTMLElement | null
    const enfocables = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null)

    enfocables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const lista = enfocables()
      if (lista.length === 0) return
      const primero = lista[0]
      const ultimo = lista[lista.length - 1]
      const activo = document.activeElement
      if (e.shiftKey && (activo === primero || !drawerRef.current?.contains(activo))) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar — fija, colapsable a riel de iconos (DXS).
          DS 2.0 · 256px (w-64): con la tipografía del menú a 14.5px e iconos
          de 18px, los 240px anteriores truncaban etiquetas como
          "Campañas segmentadas" o "Métodos de pago". */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 ease-out lg:block',
          rail ? 'w-[68px]' : 'w-64'
        )}
      >
        <AppSidebar
          role={role}
          title={title}
          userEmail={userEmail}
          userName={userName}
          rail={rail}
          onToggleRail={toggleRail}
          hiddenNav={hiddenNav}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        inert={!mobileOpen}
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'
        )}
      >
        <div
          onClick={() => setMobileOpen(false)}
          className={cn(
            'absolute inset-0 bg-black/50 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
        />
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
          className={cn(
            'absolute inset-y-0 left-0 w-64 overflow-hidden rounded-r-2xl elevation-3 transition-transform duration-300',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-white"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
          <AppSidebar
            role={role}
            title={title}
            userEmail={userEmail}
            userName={userName}
            onNavigate={() => setMobileOpen(false)}
            hiddenNav={hiddenNav}
          />
        </aside>
      </div>

      {/* Main column */}
      <div
        className={cn(
          'transition-[padding] duration-200 ease-out',
          rail ? 'lg:pl-[68px]' : 'lg:pl-64'
        )}
      >
        <AppHeader
          role={role}
          notifCount={notifCount}
          companies={companies}
          onMenuClick={() => setMobileOpen(true)}
          hiddenNav={hiddenNav}
          sistemaExterno={sistemaExterno}
          userEmail={userEmail}
          userName={userName}
          ayudaHref={ayudaParaRol(role)}
        />
        {/* Contenedor de página — la convención de espaciado vive AQUÍ, no en
            cada pantalla. Ancho máximo 1280px, padding 16/24/32 según tamaño
            y 32px arriba y abajo. Una página no debe volver a declarar su
            propio `max-w-*` ni su padding lateral: si lo hace, se desalinea
            con el resto del producto. Lo que sí decide cada pantalla es la
            separación entre SUS secciones (`space-y-8`). */}
        <main
          className={cn(
            'mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8',
            // Espacio para que la barra inferior no tape el contenido en móvil.
            hasBottomNav && 'pb-24 lg:pb-8'
          )}
        >
          {children}
        </main>
      </div>

      {hasBottomNav && <BottomNav role={role} qrHref={qrHref} hiddenNav={hiddenNav} />}
    </div>
  )
}
