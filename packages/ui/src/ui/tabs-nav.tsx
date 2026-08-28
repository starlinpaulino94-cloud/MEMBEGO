import { cn } from '../cn'

export interface TabsNavItem {
  /** Texto de la pestaña. */
  label: string
  /** Contador opcional a la derecha (resultados, pendientes…). */
  badge?: number | string | null
  /** Marca la pestaña activa. Lo decide quien la usa, con su router. */
  active?: boolean
  /** Nodo que envuelve la pestaña: normalmente un `<Link>`. */
  render: (props: { className: string; children: React.ReactNode }) => React.ReactNode
}

/**
 * Navegación secundaria de una sección: las pestañas bajo el título.
 *
 * Es la pieza que responde a "¿dónde estoy dentro de esto?" cuando un módulo
 * tiene varias vistas — Pagos con sus estados, un cliente con sus membresías y
 * visitas, Audiencia con sus segmentos. Sin ella, cada vista parece una página
 * suelta y el usuario acaba navegando por el menú lateral para moverse dentro
 * de la misma sección.
 *
 * No trae router: cada pestaña se pinta con `render`, así el design system no
 * depende de Next.js y la misma pieza sirve para enlaces, botones o estado
 * local.
 *
 * Desplaza en horizontal cuando no caben, sin barra visible: en móvil las
 * pestañas se arrastran con el dedo en vez de apilarse y comerse la pantalla.
 */
export function TabsNav({
  items,
  className,
  'aria-label': ariaLabel = 'Secciones',
}: {
  items: TabsNavItem[]
  className?: string
  'aria-label'?: string
}) {
  if (items.length === 0) return null

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('no-scrollbar -mb-px overflow-x-auto border-b border-border', className)}
    >
      <ul className="flex min-w-max items-stretch gap-1">
        {items.map((item, i) => {
          const contenido = (
            <>
              <span>{item.label}</span>
              {item.badge !== null && item.badge !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-caption tabular-nums',
                    item.active
                      ? 'bg-primary/12 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </>
          )

          return (
            <li key={i} className="flex">
              {item.render({
                className: cn(
                  // min-h-11: la pestaña es un destino táctil, no una etiqueta.
                  'flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-small font-medium transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  item.active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                ),
                children: contenido,
              })}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
