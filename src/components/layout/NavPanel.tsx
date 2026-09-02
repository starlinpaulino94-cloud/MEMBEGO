'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ClaveBadge, EspacioVisible, NavLink } from '@/components/layout/nav-config'

/**
 * EL SEGUNDO NIVEL: los módulos del espacio activo, y nada más.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN SOLO COMPONENTE PARA TRES SITIOS
 *
 * Este panel se pinta igual en el menú de escritorio, dentro del cajón móvil y
 * dentro del flyout del modo compacto. No hay tres listas de módulos: hay una,
 * y las tres superficies la reciben ya filtrada por `visibleWorkspaces`.
 *
 * Es la diferencia entre añadir un módulo en un sitio y añadirlo en tres —que
 * es como se acaba con un menú móvil al que le falta la mitad de las entradas
 * porque nadie se acordó de la segunda copia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SCROLL VIVE AQUÍ DENTRO
 *
 * La lista lleva `min-h-0` junto a `flex-1 overflow-y-auto`. Sin `min-h-0` un
 * hijo flexible NO baja de su altura de contenido —el mínimo automático de
 * flexbox—, así que la lista empuja la columna hacia abajo en vez de hacer
 * scroll y lo que va debajo se sale del viewport. Con doce módulos en una
 * pantalla de portátil, lo que se salía era el pie.
 */

/** Contadores REALES, resueltos en el servidor. Sin dato, no se pinta nada. */
export type BadgesNav = Partial<Record<ClaveBadge, number>>

function Contador({ valor }: { valor: number }) {
  return (
    <span
      className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-sidebar-selected px-1.5 py-0.5 text-[12px] font-semibold leading-none text-sidebar-selected-foreground"
      // El número por sí solo no dice de qué es. En el menú se entiende por
      // contexto; para un lector de pantalla hay que decirlo.
      aria-label={`${valor} pendientes`}
    >
      {valor > 99 ? '99+' : valor}
    </span>
  )
}

function Etiqueta({ texto }: { texto: string }) {
  return (
    <span className="ml-auto shrink-0 rounded-full border border-sidebar-border px-1.5 py-0.5 text-[12px] font-semibold uppercase leading-none tracking-wide text-sidebar-foreground">
      {texto}
    </span>
  )
}

export function ModuloNav({
  item,
  activo,
  badges,
  onNavigate,
}: {
  item: NavLink
  activo: boolean
  badges?: BadgesNav
  onNavigate?: () => void
}) {
  const Icon = item.icon
  /**
   * Un contador de CERO no se pinta. «0 tickets» no es información: es ruido
   * con forma de aviso, y entrena a no mirar el sitio donde de verdad aparece
   * un número cuando lo hay. Y si el conteo falló, `badges` no trae la clave
   * y aquí no pasa nada — la navegación nunca depende de que cuadre un número.
   */
  const contador = item.badge ? badges?.[item.badge] : undefined
  const muestraContador = typeof contador === 'number' && contador > 0

  return (
    <li>
      <Link
        href={item.href}
        // Sin prefetch: con decenas de enlaces sobre rutas `force-dynamic`,
        // cada prefetch dispara middleware y consultas de autenticación.
        prefetch={false}
        onClick={onNavigate}
        aria-current={activo ? 'page' : undefined}
        title={item.description ?? item.label}
        className={cn(
          'group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14.5px] font-medium outline-none transition-colors duration-fast',
          'focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          activo
            ? 'bg-sidebar-selected text-sidebar-selected-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground'
        )}
      >
        <Icon
          className={cn(
            'h-[18px] w-[18px] shrink-0 transition-colors duration-fast',
            activo
              ? 'text-sidebar-selected-foreground'
              : 'text-sidebar-foreground group-hover:text-sidebar-accent-foreground'
          )}
          aria-hidden
        />
        <span className="truncate">{item.label}</span>
        {muestraContador ? (
          <Contador valor={contador} />
        ) : item.etiqueta ? (
          <Etiqueta texto={item.etiqueta} />
        ) : null}
      </Link>
    </li>
  )
}

export function NavPanel({
  espacio,
  rutaActiva,
  badges,
  onNavigate,
  className,
  /** El flyout ya se anuncia solo: no repite el nombre del espacio. */
  conCabecera = true,
}: {
  espacio: EspacioVisible
  /** Ruta del módulo activo, ya resuelta por prefijo más largo. */
  rutaActiva: string | null
  badges?: BadgesNav
  onNavigate?: () => void
  className?: string
  conCabecera?: boolean
}) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground', className)}>
      {conCabecera && (
        <div className="shrink-0 px-4 pb-3 pt-4">
          <p className="truncate text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
            {espacio.label}
          </p>
          {espacio.description && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-sidebar-foreground">
              {espacio.description}
            </p>
          )}
        </div>
      )}

      {/* `min-h-0` es lo que permite que ESTA lista haga scroll en vez de
          empujar la columna. Ver la nota de cabecera del archivo. */}
      <nav
        aria-label={`Módulos de ${espacio.label}`}
        className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4"
      >
        {espacio.groups.map((group, gi) => {
          /**
           * UN SOLO GRUPO NO SE ROTULA.
           *
           * La cabecera del panel ya dice el nombre del espacio justo encima.
           * Con un único grupo, su rótulo es una segunda etiqueta para lo
           * mismo: «Clientes» y debajo «CLIENTES», o peor, «Inicio» y debajo
           * «INICIO» con un solo enlace llamado «Resumen». El rótulo de grupo
           * gana su sitio cuando hay algo de lo que distinguirse.
           */
          const sinTitulo = espacio.groups.length === 1

          return (
            <div key={group.id} className={cn(gi > 0 && 'mt-4')}>
              {!sinTitulo && (
                <p className="mb-1 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground">
                  {group.label}
                </p>
              )}
              <ul className="space-y-px">
                {group.items.map((item) => (
                  <ModuloNav
                    key={item.href}
                    item={item}
                    activo={item.href === rutaActiva}
                    badges={badges}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
    </div>
  )
}
