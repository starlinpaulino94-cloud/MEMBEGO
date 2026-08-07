'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Search, X } from 'lucide-react'
import Link from 'next/link'
import { navForRole, filtrarNavOculto, allLinks } from '@/components/layout/nav-config'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { ThemeToggle } from '@/components/ThemeToggle'
import { CompanySwitcher, type CompanyOption } from '@/components/cliente/CompanySwitcher'
import type { AppRole } from '@/types'

/** Etiquetas de los sub-segmentos comunes para el breadcrumb jerárquico. */
const SEGMENT_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  nueva: 'Nueva',
  editar: 'Editar',
  plantillas: 'Plantillas',
}

export function AppHeader({
  role,
  notifCount = 0,
  companies,
  onMenuClick,
  hiddenNav,
}: {
  role: AppRole
  notifCount?: number
  companies?: CompanyOption[]
  onMenuClick: () => void
  /** Rutas a ocultar por no tener contenido todavía (cliente). */
  hiddenNav?: string[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const links = useMemo(
    () => allLinks(filtrarNavOculto(navForRole(role), hiddenNav ?? [])),
    [role, hiddenNav]
  )

  // Breadcrumb jerárquico: sección del nav + sub-segmento actual si existe
  // (nuevo/editar/plantillas/detalle). El nombre de la sección enlaza de vuelta.
  const crumb = useMemo(() => {
    const matches = links
      .filter((l) => pathname === l.href || pathname.startsWith(l.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)
    const section = matches[0] ?? null
    if (!section) return { section: null, child: null }
    const rest = pathname.slice(section.href.length).split('/').filter(Boolean)
    if (rest.length === 0) return { section, child: null }
    // Último segmento legible: etiqueta conocida, o "Detalle" para ids.
    const named = [...rest].reverse().find((s) => SEGMENT_LABELS[s])
    const child = named ? SEGMENT_LABELS[named] : 'Detalle'
    return { section, child }
  }, [links, pathname])

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
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumb jerárquico: MembeGo / Sección / Subpágina */}
      <nav aria-label="Ruta de navegación" className="hidden min-w-0 items-baseline gap-2 md:flex">
        <span className="text-caption">MembeGo</span>
        {crumb.section && (
          <>
            <span className="text-border" aria-hidden>/</span>
            {crumb.child ? (
              <Link
                href={crumb.section.href}
                className="truncate text-h4 text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.section.label}
              </Link>
            ) : (
              <span className="truncate text-h4 text-foreground" aria-current="page">
                {crumb.section.label}
              </span>
            )}
          </>
        )}
        {crumb.child && (
          <>
            <span className="text-border" aria-hidden>/</span>
            <span className="truncate text-h4 text-foreground" aria-current="page">
              {crumb.child}
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
            className="h-9 w-full rounded-xl border border-transparent bg-muted/70 pl-9 pr-12 text-sm text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/50 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
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
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60 sm:block">
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
        {companies && <CompanySwitcher companies={companies} />}
        <ThemeToggle />
        <NotificationBell initialCount={notifCount} />
      </div>

      {/* Cmd+K / Ctrl+K */}
      <CommandPalette role={role} hiddenNav={hiddenNav} />
    </header>
  )
}

export type { CompanyOption }
