'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ExternalLink, Menu, Search, X } from 'lucide-react'
import Link from 'next/link'
import {
  navForRole,
  filtrarNavOculto,
  allLinks,
  migasDeRuta,
} from '@/components/layout/nav-config'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MenuUsuario } from '@/components/layout/MenuUsuario'
import { ThemeToggle } from '@/components/ThemeToggle'
import { CompanySwitcher, type CompanyOption } from '@/components/cliente/CompanySwitcher'
import type { AppRole } from '@/types'

export function AppHeader({
  role,
  notifCount = 0,
  companies,
  onMenuClick,
  hiddenNav,
  sistemasExternos,
  userEmail,
  userName,
  ayudaHref,
}: {
  role: AppRole
  notifCount?: number
  companies?: CompanyOption[]
  onMenuClick: () => void
  /** Rutas a ocultar por no tener contenido todavía (cliente). */
  hiddenNav?: string[]
  /** Sistema satélite conectado (p. ej. el car wash): acceso directo por SSO. */
  sistemasExternos?: { slug: string; nombre: string }[]
  userEmail?: string
  userName?: string | null
  /** Destino de "Ayuda"; sin él, la entrada no se muestra. */
  ayudaHref?: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(
    () => filtrarNavOculto(navForRole(role), hiddenNav ?? []),
    [role, hiddenNav]
  )
  const links = useMemo(() => allLinks(groups), [groups])

  // Breadcrumb: DOMINIO / módulo / subpágina. El dominio es lo que estaba
  // faltando — antes decía "MembeGo / Campañas", que dice qué página es pero
  // no dónde está. Ahora dice "Marketing / Campañas".
  const migas = useMemo(() => migasDeRuta(groups, pathname), [groups, pathname])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return links.filter((l) => l.label.toLowerCase().includes(q)).slice(0, 6)
  }, [links, query])

  // Atajo "/" para enfocar el buscador (estándar en SaaS modernos).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(href: string) {
    setQuery('')
    setOpen(false)
    router.push(href)
  }

  return (
    // z-50: el header sticky SIEMPRE por encima del contenido de la página
    // (tarjetas con sombras/transforms creaban stacking contexts que lo
    // tapaban al hacer scroll, p. ej. los botones del QR).
    <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 glass md:px-6">
      {/* Menú móvil */}
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumb: Dominio / Módulo / Subpágina.
          En móvil se reduce al módulo actual — el dominio es contexto útil en
          escritorio, pero ahí compite con el buscador por un espacio que no
          hay. */}
      <nav aria-label="Ruta de navegación" className="hidden min-w-0 items-baseline gap-2 md:flex">
        {migas.dominio && (
          <>
            <span className="shrink-0 text-caption">{migas.dominio}</span>
            <span className="shrink-0 text-border" aria-hidden>
              /
            </span>
          </>
        )}
        {migas.seccion &&
          (migas.hoja ? (
            <Link
              href={migas.seccion.href}
              className="truncate text-h4 text-muted-foreground transition-colors hover:text-foreground"
            >
              {migas.seccion.label}
            </Link>
          ) : (
            <span className="truncate text-h4 text-foreground" aria-current="page">
              {migas.seccion.label}
            </span>
          ))}
        {migas.hoja && (
          <>
            <span className="shrink-0 text-border" aria-hidden>
              /
            </span>
            <span className="truncate text-h4 text-foreground" aria-current="page">
              {migas.hoja}
            </span>
          </>
        )}
      </nav>

      {/* Buscador global */}
      <div className="relative ml-auto w-full max-w-xs md:mx-auto md:ml-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar…"
            className="h-10 w-full rounded-xl border border-transparent bg-muted/70 pl-9 pr-12 text-sm text-foreground outline-none transition-all duration-fast placeholder:text-muted-foreground/50 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-lg border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[12px] leading-none text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>

        {open && results.length > 0 && (
          <div className="absolute left-0 right-0 top-11 z-50 animate-scale-in rounded-xl border border-border/70 bg-popover p-1.5 elevation-2">
            {results.map((r) => {
              const Icon = r.icon
              return (
                <button
                  key={r.href}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r.href)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <Icon className="h-4 w-4 text-muted-foreground/60" />
                  {r.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex shrink-0 items-center gap-1">
        {/* App Launcher: los sistemas satélite que esta empresa tiene
            habilitados Y a los que este usuario tiene acceso.

            Con uno, un botón —lo de siempre—. Con varios, la lista: elegir por
            el usuario sería esconderle los demás. target _blank porque el
            satélite es otra app y MembeGo se queda abierta. */}
        {(sistemasExternos ?? []).map((s) => (
          <a
            key={s.slug}
            href={`/api/integraciones/abrir/${encodeURIComponent(s.slug)}`}
            target="_blank"
            rel="noopener"
            className="mr-1 inline-flex h-10 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            title={`Abrir ${s.nombre}`}
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="hidden sm:inline">{s.nombre}</span>
          </a>
        ))}
        {companies && <CompanySwitcher companies={companies} />}
        <ThemeToggle />
        <NotificationBell initialCount={notifCount} />
        {/* Perfil y sesión. Antes solo vivían en el pie del menú lateral, que
            en móvil está detrás del drawer: cerrar sesión exigía abrir el menú
            y bajar hasta el final. */}
        {userEmail && (
          <MenuUsuario
            role={role}
            userEmail={userEmail}
            userName={userName}
            ayudaHref={ayudaHref}
          />
        )}
      </div>

      {/* Cmd+K / Ctrl+K */}
      <CommandPalette role={role} hiddenNav={hiddenNav} />
    </header>
  )
}

export type { CompanyOption }
