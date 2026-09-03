'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/layout/Logo'
import { NavPanel, type BadgesNav } from '@/components/layout/NavPanel'
import { MenuUsuario } from '@/components/layout/MenuUsuario'
import type { EspacioVisible } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * EL PRIMER NIVEL: el riel de espacios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES UN ICONO DE AQUÍ
 *
 * Una parcela de trabajo entera, no una carpeta. Pulsar uno REEMPLAZA el
 * segundo nivel: quien entra en Operaciones deja de tener delante los informes
 * de marketing. Ése es el punto del patrón — no ahorrar píxeles, sino que en
 * cada momento se vea el trabajo que se está haciendo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NUNCA SE MUEVE
 *
 * Configuración vive ANCLADA al pie, y con ella el perfil y el botón de
 * plegar. Son cosas que se usan poco y desde cualquier sitio: si flotaran
 * según cuántos espacios tenga delante cada rol, habría que buscarlas cada
 * vez. Van en el mismo píxel para todo el mundo.
 *
 * El pie está FUERA del contenedor con scroll, así que no se corta nunca —
 * tampoco en una pantalla de 600 px de alto, que es donde se descubrió que se
 * cortaba.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FLYOUT DEL MODO COMPACTO, CON TECLADO
 *
 * Plegado el segundo nivel, el riel enseña la navegación del espacio en un
 * panel flotante. Se abre al pasar el cursor Y AL ENFOCAR con el tabulador —
 * si solo respondiera al hover, quien navega con teclado se quedaría con
 * iconos mudos. El panel se pinta DENTRO del `<li>` del espacio, así que
 * tabular desde el icono entra en sus módulos en el orden natural; no hay
 * gestión de foco a mano que pueda desincronizarse.
 *
 * Va posicionado con `fixed`, y por eso el `overflow-y-auto` del riel no lo
 * recorta: `overflow` no afecta a los descendientes fijos. Es lo que permite
 * que el riel tenga scroll propio sin renunciar al flyout.
 */

const ANCHO_RIEL = 68
/** Margen inferior para que el flyout no toque el borde del viewport. */
const RESPIRO = 12

function BotonEspacio({
  espacio,
  href,
  activo,
  compacto,
  rutaActiva,
  badges,
  abierto,
  onAbrir,
  onCerrar,
  onElegir,
}: {
  espacio: EspacioVisible
  href: string
  activo: boolean
  compacto: boolean
  rutaActiva: string | null
  badges?: BadgesNav
  abierto: boolean
  onAbrir: () => void
  onCerrar: () => void
  /** Reemplaza el segundo nivel YA, sin esperar a que responda el servidor. */
  onElegir?: () => void
}) {
  const Icon = espacio.icon
  const liRef = useRef<HTMLLIElement>(null)
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    if (!abierto || !liRef.current) return
    const r = liRef.current.getBoundingClientRect()
    // Se ancla al icono y se sube lo justo para no salirse por abajo.
    const maximo = window.innerHeight - RESPIRO
    setTop(Math.max(RESPIRO, Math.min(r.top, maximo - 240)))
  }, [abierto])

  return (
    <li
      ref={liRef}
      className="relative"
      onMouseEnter={compacto ? onAbrir : undefined}
      onMouseLeave={compacto ? onCerrar : undefined}
      // `focusin`/`focusout` en el contenedor: cubre el icono Y los enlaces
      // del flyout con un solo par de manejadores. Salir con el tabulador al
      // siguiente espacio cierra éste y abre aquél, que es lo esperable.
      onFocus={compacto ? onAbrir : undefined}
      onBlur={
        compacto
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCerrar()
            }
          : undefined
      }
    >
      <Link
        href={href}
        prefetch={false}
        onClick={onElegir}
        aria-label={espacio.short ?? espacio.label}
        title={espacio.short ?? espacio.label}
        aria-current={activo ? 'true' : undefined}
        className={cn(
          'group relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-colors duration-fast',
          'focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          activo
            ? 'bg-sidebar-accent text-sidebar-primary'
            : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground'
        )}
      >
        {/* Barra lateral del espacio activo: la señal que se lee de reojo sin
            tener que distinguir el tono del fondo. */}
        {activo && (
          <span
            aria-hidden
            className="absolute -left-2.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary"
          />
        )}
        <Icon className="h-[20px] w-[20px]" aria-hidden />
      </Link>

      {compacto && abierto && (
        <div
          className="fixed z-dropdown w-64 overflow-hidden rounded-xl border border-sidebar-border elevation-3"
          style={{
            left: ANCHO_RIEL + 4,
            top,
            maxHeight: `calc(100vh - ${top + RESPIRO}px)`,
          }}
        >
          <NavPanel espacio={espacio} rutaActiva={rutaActiva} badges={badges} />
        </div>
      )}
    </li>
  )
}

export function NavRail({
  espacios,
  landings,
  espacioActivoId,
  rutaActiva,
  compacto,
  onToggleCompacto,
  badges,
  role,
  userEmail,
  userName,
  ayudaHref,
  onElegirEspacio,
}: {
  espacios: EspacioVisible[]
  /** Ruta de aterrizaje de cada espacio, ya resuelta con sus permisos. */
  landings: Record<string, string>
  espacioActivoId: string | null
  rutaActiva: string | null
  compacto: boolean
  /** Ausente en el cajón móvil: allí no hay nada que plegar. */
  onToggleCompacto?: () => void
  badges?: BadgesNav
  role: AppRole
  userEmail: string
  userName?: string | null
  ayudaHref?: string | null
  onElegirEspacio?: (id: string) => void
}) {
  const [flyout, setFlyout] = useState<string | null>(null)
  const cerrar = useCallback(() => setFlyout(null), [])

  const arriba = espacios.filter((e) => !e.anclado)
  const abajo = espacios.filter((e) => e.anclado)

  function pintar(lista: EspacioVisible[]) {
    return lista.map((espacio) => (
      <BotonEspacio
        key={espacio.id}
        espacio={espacio}
        href={landings[espacio.id] ?? '#'}
        activo={espacio.id === espacioActivoId}
        compacto={compacto}
        rutaActiva={rutaActiva}
        badges={badges}
        abierto={flyout === espacio.id}
        onAbrir={() => setFlyout(espacio.id)}
        onCerrar={cerrar}
        onElegir={() => {
          onElegirEspacio?.(espacio.id)
          cerrar()
        }}
      />
    ))
  }

  return (
    <div
      className="flex h-full min-h-0 w-[68px] shrink-0 flex-col items-center bg-sidebar-rail"
      // Escape cierra el flyout sin mover el foco: quien lo abrió con el
      // tabulador sigue donde estaba y puede seguir tabulando.
      onKeyDown={(e) => {
        if (e.key === 'Escape') cerrar()
      }}
    >
      <div className="flex h-14 w-full shrink-0 items-center justify-center">
        <Logo size={28} className="rounded-lg" />
      </div>

      {/* `min-h-0` + `overflow-y-auto`: con muchos espacios el riel hace scroll
          propio y el pie de abajo sigue en su sitio. */}
      <nav
        aria-label="Espacios de trabajo"
        className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden py-2"
      >
        <ul className="flex flex-col items-center gap-1">{pintar(arriba)}</ul>
      </nav>

      <div className="w-full shrink-0 border-t border-sidebar-border py-2">
        <ul className="flex flex-col items-center gap-1">{pintar(abajo)}</ul>

        <div className="mt-1 flex flex-col items-center gap-1">
          <MenuUsuario
            role={role}
            userEmail={userEmail}
            userName={userName}
            ayudaHref={ayudaHref}
            align="start"
            side="right"
            triggerClassName="h-11 w-11 rounded-xl hover:bg-sidebar-hover focus-visible:ring-sidebar-ring"
          />

          {onToggleCompacto && (
            <button
              type="button"
              onClick={onToggleCompacto}
              title={compacto ? 'Expandir menú' : 'Plegar menú'}
              aria-label={compacto ? 'Expandir menú' : 'Plegar menú'}
              aria-pressed={compacto}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-sidebar-foreground outline-none transition-colors duration-fast hover:bg-sidebar-hover hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              {compacto ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
