'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronRight, ExternalLink, Menu, Search, X } from 'lucide-react'
import { breadcrumbs, buscarModulos, type ContextoNav } from '@/components/layout/nav-config'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MenuUsuario } from '@/components/layout/MenuUsuario'
import { ThemeToggle } from '@/components/ThemeToggle'
import { CompanySwitcher, type CompanyOption } from '@/components/cliente/CompanySwitcher'

/**
 * LA CABECERA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESPONDE Y QUÉ NO
 *
 * Responde «¿dónde estoy?» (migas), «¿de qué empresa?» (selector, cuando hay
 * más de una), «¿me falta algo?» (notificaciones reales) y «¿cómo llego a
 * otro sitio?» (buscador y paleta de comandos).
 *
 * NO saluda, no repite el nombre de la aplicación y no enseña el correo: eso
 * vive dentro del menú de perfil, que es donde se busca. Una cabecera que
 * gasta su ancho en decorar deja de tener sitio para lo que sí hace falta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS MIGAS SALEN DE LA MISMA RESOLUCIÓN QUE EL MENÚ
 *
 * `breadcrumbs()` y el resaltado del menú usan la misma coincidencia por
 * prefijo más largo. Escritas aparte se separan, y el síntoma es una cabecera
 * que dice que estás en un sitio mientras el menú resalta otro.
 */
export function AppHeader({
  ctx,
  title,
  notifCount = 0,
  companies,
  onMenuClick,
  sistemasExternos,
  userEmail,
  userName,
  ayudaHref,
}: {
  ctx: ContextoNav
  /** Nombre del producto: solo se usa cuando la ruta no está en ningún menú. */
  title: string
  notifCount?: number
  companies?: CompanyOption[]
  onMenuClick: () => void
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

  const migas = useMemo(() => breadcrumbs(pathname, ctx), [pathname, ctx])
  const resultados = useMemo(() => buscarModulos(query, ctx, 6), [query, ctx])

  // Atajo "/" para enfocar el buscador (estándar en SaaS modernos).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const escribiendo =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (e.key === '/' && !escribiendo) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function ir(href: string) {
    setQuery('')
    setOpen(false)
    router.push(href)
  }

  return (
    // z-modal: la cabecera sticky SIEMPRE por encima del contenido (las
    // tarjetas con sombras y transformaciones crean contextos de apilamiento
    // que la tapaban al hacer scroll).
    //
    // Y bg-background/95, no /80. Con 80 %, el desenfoque no bastaba para
    // separar: al bajar por una rejilla larga, los titulos de las tarjetas se
    // leian A TRAVES de la cabecera y competian con las migas. Un cristal que
    // deja leer lo de detras deja de ser un fondo.
    <header className="sticky top-0 z-modal flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-4 glass md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-fast hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {/* Migas: espacio › dominio › módulo › subpágina.
          En móvil se reducen a la última —el contexto es útil en escritorio,
          pero ahí compite con el buscador por un espacio que no hay—. */}
      <nav aria-label="Ruta de navegación" className="hidden min-w-0 items-center gap-1.5 md:flex">
        {migas.length === 0 ? (
          <span className="truncate text-h4 text-foreground">{title}</span>
        ) : (
          migas.map((miga, i) => {
            const ultima = i === migas.length - 1
            return (
              <span key={`${miga.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                )}
                {miga.href && !ultima ? (
                  <Link
                    href={miga.href}
                    className="shrink-0 truncate rounded-lg text-caption text-muted-foreground outline-none transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {miga.label}
                  </Link>
                ) : (
                  <span
                    className={
                      ultima
                        ? 'truncate text-h4 text-foreground'
                        : 'shrink-0 truncate text-caption text-muted-foreground'
                    }
                    aria-current={ultima ? 'page' : undefined}
                  >
                    {miga.label}
                  </span>
                )}
              </span>
            )
          })
        )}
      </nav>

      {/* Buscador global */}
      <div className="relative ml-auto w-full max-w-xs md:mx-auto md:ml-0">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
            aria-hidden
          />
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
            aria-label="Buscar un módulo"
            className="h-10 w-full rounded-xl border border-transparent bg-muted/70 pl-9 pr-12 text-sm text-foreground outline-none transition-all duration-fast placeholder:text-muted-foreground/50 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-colors duration-fast hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-lg border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[12px] leading-none text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>

        {open && resultados.length > 0 && (
          <div className="absolute left-0 right-0 top-11 z-dropdown animate-scale-in rounded-xl border border-border/70 bg-popover p-1.5 elevation-2">
            {resultados.map(({ item, workspace }) => {
              const Icon = item.icon
              return (
                <button
                  key={item.href}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => ir(item.href)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors duration-fast hover:bg-muted"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="truncate">{item.label}</span>
                  {/* De qué espacio es. Sin esto, dos «Planes» —el de la
                      plataforma y el de una empresa— son indistinguibles. */}
                  <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                    {workspace.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex shrink-0 items-center gap-1">
        {/* App Launcher: los sistemas satélite que esta empresa tiene
            habilitados Y a los que este usuario tiene acceso. Con uno, un
            botón; con varios, la lista. `target=_blank` porque el satélite es
            otra aplicación y MembeGo se queda abierta. */}
        {(sistemasExternos ?? []).map((s) => (
          <a
            key={s.slug}
            href={`/api/integraciones/abrir/${encodeURIComponent(s.slug)}`}
            target="_blank"
            rel="noopener"
            className="mr-1 inline-flex h-10 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-muted"
            title={`Abrir ${s.nombre}`}
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="hidden sm:inline">{s.nombre}</span>
          </a>
        ))}
        {companies && <CompanySwitcher companies={companies} />}
        <ThemeToggle />
        <NotificationBell initialCount={notifCount} />
        {userEmail && (
          <MenuUsuario
            role={ctx.role}
            userEmail={userEmail}
            userName={userName}
            ayudaHref={ayudaHref}
          />
        )}
      </div>

      {/* Cmd+K / Ctrl+K */}
      <CommandPalette ctx={ctx} />
    </header>
  )
}

export type { CompanyOption }
