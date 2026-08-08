'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logout } from '@/modules/auth/actions'
import { Logo } from '@/components/layout/Logo'
import {
  navContextsForRole,
  filtrarNavOculto,
  roleLabel,
  allLinks,
  type NavGroup,
} from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * Clave de persistencia del estado ABIERTO (ids de grupo, por rol).
 *
 * DS 2.0 · Fase 0: la versión anterior (`…collapsed.v1`) guardaba lo
 * CERRADO, porque el menú arrancaba con todo abierto y el usuario solo podía
 * plegar. Ahora arranca plegado salvo el dominio activo, así que lo que hay
 * que recordar es lo que el usuario decidió abrir. Se sube la versión de la
 * clave a propósito: reutilizarla habría interpretado los grupos plegados de
 * antes como grupos abiertos, justo al revés.
 */
const STORAGE_KEY = 'membego.nav.abiertos.v2'

const emptySubscribe = () => () => {}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

function groupHasActive(pathname: string, group: NavGroup) {
  return group.items.some((item) => isActive(pathname, item.href))
}

function loadAbiertos(role: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as Record<string, string[]>
    return new Set(parsed[role] ?? [])
  } catch {
    return new Set()
  }
}

function saveAbiertos(role: string, abiertos: Set<string>) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
    parsed[role] = Array.from(abiertos)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    /* almacenamiento no disponible: el menú funciona sin persistencia */
  }
}

export function AppSidebar({
  role,
  title,
  userEmail,
  userName,
  onNavigate,
  rail = false,
  onToggleRail,
  hiddenNav,
}: {
  role: AppRole
  title: string
  userEmail: string
  /**
   * Nombre de la persona, cuando se conoce. La sesión solo trae el correo,
   * así que hoy ningún layout lo pasa y el pie del menú cae al correo. El
   * prop existe para que la fase que cargue el perfil pueda darle un nombre
   * sin volver a tocar el shell — no se inventa uno a partir del correo.
   */
  userName?: string | null
  onNavigate?: () => void
  /** DXS · Modo riel: solo iconos con tooltip (desktop colapsado). */
  rail?: boolean
  /** Presente solo en desktop: muestra el botón de colapsar/expandir. */
  onToggleRail?: () => void
  /** Rutas a ocultar por no tener contenido todavía (cliente). */
  hiddenNav?: string[]
}) {
  const pathname = usePathname()

  // DS 2.0 · Contextos: solo el superadmin tiene más de uno. El contexto
  // visible se deduce de la ruta —si estás en /admin/... estás en el panel de
  // empresa—, así que navegar ya cambia de contexto sin estado que sincronizar.
  const contextos = useMemo(
    () =>
      navContextsForRole(role)
        .map((c) => ({ ...c, groups: filtrarNavOculto(c.groups, hiddenNav ?? []) }))
        .filter((c) => c.groups.length > 0),
    [role, hiddenNav]
  )
  const [contextoElegido, setContextoElegido] = useState<string | null>(null)
  const contextoActivo =
    contextos.find((c) => c.id === contextoElegido) ??
    contextos.find((c) => c.groups.some((g) => groupHasActive(pathname, g))) ??
    contextos[0]
  const groups = contextoActivo?.groups ?? []

  const identidad = userName?.trim() || userEmail
  const inicial = (identidad[0] ?? 'U').toUpperCase()

  // Estado ABIERTO por grupo. En SSR y primer render solo se abre el dominio
  // activo (mounted=false ⇒ sin mismatch de hidratación); tras montar se suma
  // lo que el usuario había abierto. Sus toggles pisan vía `override`.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
  const [override, setOverride] = useState<Set<string> | null>(null)
  const stored = useMemo(
    () => (mounted ? loadAbiertos(role) : new Set<string>()),
    [mounted, role]
  )
  const abiertos = override ?? stored

  function toggleGroup(id: string) {
    const next = new Set(abiertos)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saveAbiertos(role, next)
    setOverride(next)
  }

  // ── DXS · Modo riel: iconos con tooltip; máximo espacio para el contenido ──
  if (rail) {
    const links = allLinks(groups)
    return (
      <div className="flex h-full flex-col items-center bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-sidebar-border/50">
          <Logo size={28} className="rounded-lg" />
        </div>
        {onToggleRail && (
          <button
            type="button"
            onClick={onToggleRail}
            title="Expandir menú"
            aria-label="Expandir menú"
            className="mt-2 flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </button>
        )}
        <nav className="mt-1 flex-1 overflow-y-auto px-2 pb-3">
          <ul className="space-y-1">
            {links.map((item) => {
              const active = isActive(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    onClick={onNavigate}
                    title={item.label}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-150',
                      active
                        ? 'bg-sidebar-active text-sidebar-primary'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-white'
                    )}
                  >
                    {active && (
                      <span className="absolute -left-2 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                    )}
                    <Icon className="h-[18px] w-[18px]" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="w-full shrink-0 border-t border-sidebar-border/60 py-2.5">
          <div className="flex flex-col items-center gap-1.5">
            <div
              title={identidad}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-white"
            >
              {inicial}
            </div>
            <form action={logout}>
              <button
                type="submit"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-hover hover:text-white"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border/50 px-4">
        <Logo size={28} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-tight text-white">
            {title}
          </p>
          <p className="truncate text-[12px] uppercase tracking-wider text-sidebar-foreground/70">
            {roleLabel(role)}
          </p>
        </div>
        {onToggleRail && (
          <button
            type="button"
            onClick={onToggleRail}
            title="Colapsar menú"
            aria-label="Colapsar menú"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {/* Selector de contexto — solo aparece si el rol tiene más de uno
          (hoy, únicamente el superadmin). */}
      {contextos.length > 1 && (
        <div
          role="tablist"
          aria-label="Contexto de trabajo"
          className="mx-2.5 mt-3 flex shrink-0 gap-1 rounded-lg bg-sidebar-hover p-1"
        >
          {contextos.map((c) => {
            const activo = c.id === contextoActivo?.id
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={activo}
                onClick={() => setContextoElegido(c.id)}
                className={cn(
                  'min-h-9 flex-1 rounded-md px-2 text-[12.5px] font-medium transition-colors duration-150',
                  activo
                    ? 'bg-sidebar-active text-white'
                    : 'text-sidebar-foreground/70 hover:text-white'
                )}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 pt-3">
        {groups.map((group, gi) => {
          const hasActive = groupHasActive(pathname, group)
          // DS 2.0 · Abierto SOLO el dominio activo, más lo que el usuario
          // haya abierto a mano. Antes arrancaban todos abiertos y el panel
          // pintaba 33 enlaces de golpe; ahora son ~13. El dominio activo se
          // fuerza abierto siempre: el contexto nunca se esconde.
          const isOpen = hasActive || abiertos.has(group.id)
          const single = group.items.length === 1

          return (
            <div key={group.id} className={cn('mb-1', gi > 0 && 'mt-2')}>
              {/* Cabecera del grupo: los grupos de un solo ítem no colapsan. */}
              {single ? (
                gi > 0 && (
                  <p className="mb-1 px-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/70">
                    {group.label}
                  </p>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.id}`}
                  className={cn(
                    'group/header mb-0.5 flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150',
                    hasActive
                      ? 'text-sidebar-primary'
                      : 'text-sidebar-foreground/70 hover:text-white'
                  )}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                      !isOpen && '-rotate-90',
                      hasActive
                        ? 'text-sidebar-primary/80'
                        : 'text-sidebar-foreground/50 group-hover/header:text-sidebar-foreground/80'
                    )}
                  />
                </button>
              )}

              {/* Ítems (colapso animado con grid-rows) */}
              <div
                id={`nav-group-${group.id}`}
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out',
                  isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                )}
              >
                <ul className="min-h-0 space-y-px overflow-hidden">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href)
                    const Icon = item.icon
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          // Sin prefetch: con 9-26 links por rol sobre rutas
                          // force-dynamic, cada prefetch dispara middleware +
                          // queries; multiplicaba por ~10 las llamadas de auth.
                          prefetch={false}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14.5px] font-medium transition-colors duration-150',
                            active
                              ? 'bg-sidebar-active text-white'
                              : 'text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-white'
                          )}
                        >
                          {active && (
                            <span className="absolute -left-2.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                          )}
                          <Icon
                            className={cn(
                              'h-[18px] w-[18px] shrink-0 transition-colors duration-150',
                              active
                                ? 'text-sidebar-primary'
                                : 'text-sidebar-foreground/70 group-hover:text-white'
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="shrink-0 border-t border-sidebar-border/60 p-2.5">
        <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-white">
            {inicial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white" title={identidad}>
              {identidad}
            </p>
            <p className="truncate text-[12px] text-sidebar-foreground/70">{roleLabel(role)}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-hover hover:text-white"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
