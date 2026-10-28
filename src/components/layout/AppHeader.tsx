'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronRight, ExternalLink, Menu, QrCode, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ATERRIZAJE_EMPRESA,
  ATERRIZAJE_PLATAFORMA,
  breadcrumbs,
  buscarModulos,
  ofreceEntradaAEmpresa,
  visibleWorkspaces,
  ofreceSalidaAPlataforma,
  type ContextoNav,
} from '@/components/layout/nav-config'
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CONMUTADOR DE ÁMBITO
 *
 * El superadministrador tiene dos mundos, Plataforma y Empresa, que nunca se
 * mezclan en el menú. El paso de uno a otro es ESTE conmutador: dos segmentos,
 * el activo como texto y el otro como enlace, siempre en el mismo sitio de la
 * cabecera. Quién lo ve lo dicen `ofreceEntradaAEmpresa` y
 * `ofreceSalidaAPlataforma` en nav-config; aquí no se mira el rol.
 */

/** Cómo se llama cada rol delante de una persona. Sin traducción, minúsculas. */
const ROTULO_ROL: Partial<Record<ContextoNav['role'], string>> = {
  SUPERADMIN: 'Superadministrador',
  ADMINISTRADOR: 'Administrador',
  ADMIN_EMPRESA: 'Administrador',
  GERENTE: 'Gerente',
  SUPERVISOR: 'Supervisor',
  MARKETING: 'Marketing',
  BODEGA: 'Bodega',
  CAJERO: 'Cajero',
  RECEPCION: 'Recepción',
  EMPLEADO: 'Empleado',
  CLIENTE: 'Cliente',
}

function SegmentoAmbito({
  activo,
  href,
  title,
  testId,
  children,
}: {
  activo: boolean
  href: string
  title: string
  testId?: string
  children: React.ReactNode
}) {
  const base =
    'inline-flex max-w-[16rem] items-center truncate rounded-full px-2.5 py-1 text-caption font-semibold outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring'
  if (activo) {
    return (
      <span
        data-testid={testId}
        title={title}
        aria-current="true"
        className={cn(base, 'bg-sidebar-accent text-sidebar-accent-foreground')}
      >
        {children}
      </span>
    )
  }
  return (
    <Link href={href} title={title} className={cn(base, 'text-muted-foreground hover:text-foreground')}>
      {children}
    </Link>
  )
}

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
  nombreEmpresa,
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
  /** Nombre de la empresa activa (ámbito COMPANY). Solo texto: no autoriza. */
  nombreEmpresa?: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  // El mismo menú filtrado que pinta la barra lateral: si el escáner no está
  // ahí para este rol, el atajo tampoco.
  const puedeCanjear = useMemo(
    () =>
      visibleWorkspaces(ctx).some((w) =>
        w.groups.some((g) => g.items.some((i) => i.href === '/admin/scanner'))
      ),
    [ctx]
  )
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [buscarMovil, setBuscarMovil] = useState(false)
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
        // Por debajo de xl el campo está escondido tras la lupa: el atajo la abre y el efecto de abajo pone el cursor.
        if (inputRef.current?.offsetParent === null) setBuscarMovil(true)
        else inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Al abrir el buscador desde la lupa, el cursor va directo al campo (el campo ya existía escondido: `autoFocus` no basta).
  useEffect(() => {
    if (buscarMovil) inputRef.current?.focus()
  }, [buscarMovil])

  function ir(href: string) {
    setQuery('')
    setOpen(false)
    setBuscarMovil(false)
    router.push(href)
  }

  // La última miga es el nombre de la pantalla: en móvil es lo único que cabe a la izquierda.
  const tituloMovil = migas.at(-1)?.label ?? title

  return (
    // z-modal: la cabecera sticky SIEMPRE por encima del contenido (las
    // tarjetas con sombras y transformaciones crean contextos de apilamiento
    // que la tapaban al hacer scroll).
    //
    // Y bg-background/95, no /80. Con 80 %, el desenfoque no bastaba para
    // separar: al bajar por una rejilla larga, los titulos de las tarjetas se
    // leian A TRAVES de la cabecera y competian con las migas. Un cristal que
    // deja leer lo de detras deja de ser un fondo.
    //
    // DOS GRUPOS, NO UNA FILA SUELTA (oct 2026). Antes el buscador iba centrado con `mx-auto` y cada pieza flotaba donde le
    // tocaba: la cabecera cambiaba de forma en cada pantalla y en el móvil el buscador quedaba en un óvalo de 40 px sin sitio
    // para escribir. Ahora a la izquierda está «dónde estoy» (ámbito y migas, que se quedan con el ancho que sobra) y a la
    // derecha «qué puedo hacer», siempre en el mismo orden: buscar · atajos · tema y avisos · cuenta, separados por líneas.
    <header className="sticky top-0 z-modal flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 glass md:gap-4 md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-fast hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {/* ── Izquierda: dónde estoy ─────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Conmutador de ámbito (solo superadmin): en qué mundo estoy y cómo
            paso al otro. El personal de una empresa ve solo su nombre. En móvil
            se oculta: ahí manda el título de la pantalla. */}
        {ofreceEntradaAEmpresa(ctx) || ofreceSalidaAPlataforma(ctx) ? (
          <div
            role="group"
            aria-label="Ámbito"
            className="hidden shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5 md:flex"
          >
            <SegmentoAmbito
              activo={ctx.scope === 'PLATFORM'}
              href={ATERRIZAJE_PLATAFORMA}
              title="Panel de plataforma"
            >
              Plataforma
            </SegmentoAmbito>
            <SegmentoAmbito
              activo={ctx.scope === 'COMPANY'}
              href={ATERRIZAJE_EMPRESA}
              title={ctx.scope === 'COMPANY' && nombreEmpresa ? `Panel de ${nombreEmpresa}` : 'Panel de empresa'}
              testId="ambito-pildora"
            >
              {/* Solo «Empresa»: con el nombre (hasta 16rem) la píldora dejaba sin sitio al título de la pantalla a
                  1 366 px. Qué empresa es lo dice el conmutador del menú lateral, que además sirve para cambiarla. */}
              Empresa
            </SegmentoAmbito>
          </div>
        ) : null}

        {/* Migas: espacio › dominio › módulo › subpágina. */}
        {/* `overflow-hidden`: con cuatro migas («Empresa › Operaciones › Pagos › Conciliación») ya no caben junto al buscador y, sin
            recorte, se pisaban unas a otras. Solo la última cede ancho y se trunca; las anteriores conservan el suyo y es la derecha
            la que se recorta. */}
        <nav aria-label="Ruta de navegación" className="hidden min-w-0 items-center gap-1.5 overflow-hidden md:flex">
          {migas.length === 0 ? (
            <span className="truncate text-h4 text-foreground">{title}</span>
          ) : (
            // Solo las dos últimas: la sección y la pantalla. Con cuatro («Empresa › Operaciones › Pagos › Conciliación»), las
            // primeras se comían el ancho y la que importa —el nombre de la pantalla— se quedaba en «D». El espacio y el dominio
            // ya los dice el menú lateral, resaltado. La sección solo desde 2xl: a 1 280 px, junto al conmutador de ámbito del
            // superadmin, «Negocio › Empresas» dejaba la pantalla en «Emp…».
            migas.slice(-2).map((miga, i, visibles) => {
              const ultima = i === visibles.length - 1
              return (
                <span key={`${miga.label}-${i}`} className={cn('flex items-center gap-1.5', ultima ? 'min-w-0' : 'shrink-0', !ultima && 'max-2xl:hidden')}>
                  {i > 0 && (
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 max-2xl:hidden"
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
        {/* En el móvil no caben las migas: queda el nombre de la pantalla, que antes no se veía en ningún sitio de la cabecera. */}
        <span className="truncate text-h4 text-foreground md:hidden">{tituloMovil}</span>
      </div>

      {/* ── Derecha: qué puedo hacer ───────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Buscador global. Ancho FIJO desde xl (antes ocupaba lo que sobraba y cambiaba en cada pantalla). Por debajo es una
            lupa: entre lg y xl la columna lateral ya se lleva 280 px y un buscador abierto dejaba las migas en «R.». Al pulsarla,
            el buscador cubre la cabecera entera, con sitio para escribir y un botón para salir. */}
        <button
          type="button"
          onClick={() => {
            setBuscarMovil(true)
            setOpen(true)
          }}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-fast hover:bg-muted xl:hidden"
          aria-label="Buscar un módulo"
        >
          <Search className="h-5 w-5" aria-hidden />
        </button>
        <div
          className={cn(
            buscarMovil
              ? 'absolute inset-0 z-10 flex items-center gap-2 bg-background px-3'
              : 'relative hidden w-64 xl:block 2xl:w-80'
          )}
        >
          <div className="relative min-w-0 flex-1">
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
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  setBuscarMovil(false)
                  e.currentTarget.blur()
                }
              }}
              placeholder="Buscar…"
              aria-label="Buscar un módulo"
              className="h-10 w-full rounded-full border border-transparent bg-muted pl-9 pr-12 text-sm text-foreground outline-none transition-all duration-fast placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
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
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-lg border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[12px] leading-none text-muted-foreground md:block">
                /
              </kbd>
            )}

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
          {buscarMovil && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setBuscarMovil(false)
              }}
              className="h-10 shrink-0 rounded-lg px-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancelar
            </button>
          )}
        </div>

        <span aria-hidden className="mx-1.5 hidden h-6 w-px bg-border md:block" />

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
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-muted max-sm:hidden"
            title={`Abrir ${s.nombre}`}
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
            {/* El rótulo solo desde xl: entre lg y xl la columna lateral ya
                ocupa 280 px y, con el nombre del sistema, las acciones no
                cabían y empujaban la cabecera fuera de la pantalla. */}
            <span className="hidden xl:inline">{s.nombre}</span>
            <span className="sr-only xl:hidden">{s.nombre}</span>
          </a>
        ))}
        {/* CANJE RÁPIDO — el atajo que el diseño pone en la barra superior.
            Está ahí porque el mostrador lo usa decenas de veces al día y
            llegar por el menú cuesta dos clics con un cliente delante.

            Solo se ofrece a quien de verdad puede canjear: se comprueba contra
            el MISMO menú filtrado que pinta la barra lateral, así que un rol
            sin permiso sobre el escáner tampoco lo ve aquí. Ocultar un botón
            no autoriza nada —el servidor sigue mandando—, pero ofrecer un
            atajo a una pantalla prohibida es prometer algo que no se cumple. */}
        {puedeCanjear && (
          <Link
            href="/admin/scanner"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-label-lg text-primary-foreground shadow-sm transition-colors duration-fast hover:bg-brand-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
          >
            <QrCode className="size-4" aria-hidden />
            <span className="hidden lg:inline">Canje rápido</span>
            <span className="sr-only lg:hidden">Canje rápido</span>
          </Link>
        )}
        {((sistemasExternos ?? []).length > 0 || puedeCanjear) && (
          <span aria-hidden className="mx-1.5 hidden h-6 w-px bg-border sm:block" />
        )}
        {companies && <CompanySwitcher companies={companies} />}
        {/* El tema en el móvil no cabe: queda en escritorio, donde sobra sitio. */}
        <span className="hidden sm:contents">
          <ThemeToggle />
        </span>
        <NotificationBell initialCount={notifCount} />
        {userEmail && (
          <>
            <span aria-hidden className="mx-1.5 hidden h-6 w-px bg-border md:block" />
            <MenuUsuario
              role={ctx.role}
              userEmail={userEmail}
              userName={userName}
              ayudaHref={ayudaHref}
              rotuloRol={ROTULO_ROL[ctx.role] ?? ctx.role.toLowerCase()}
            />
          </>
        )}
      </div>

      {/* Cmd+K / Ctrl+K */}
      <CommandPalette ctx={ctx} />
    </header>
  )
}

export type { CompanyOption }
