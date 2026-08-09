import { cn } from '../cn'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  /** Acción recomendada (botón primario). */
  action?: React.ReactNode
  /** Acción alternativa (enlace o botón ghost). */
  secondaryAction?: React.ReactNode
  /**
   * `plain` — sin caja, para vaciar el interior de una tarjeta o tabla que ya
   * tiene su propio borde. Es el caso normal.
   *
   * `card` — tarjeta propia con halos de color e icono flotante, para cuando
   * el vacío ES la pantalla (un módulo entero sin contenido todavía).
   */
  variant?: 'plain' | 'card'
  className?: string
}

/**
 * Empty state del sistema: ilustración suave + título + descripción + acción
 * recomendada. Nunca dejar un módulo en "No hay datos" a secas: siempre
 * proponer el siguiente paso.
 *
 * DS 2.0 · Fase 0 — implementación ÚNICA. Existían dos: esta y la de
 * `src/components/system/EmptyState`, con APIs incompatibles (una recibía el
 * icono ya renderizado, la otra el componente). Las dos siguen disponibles
 * por su ruta de siempre, pero el que dibuja es este: la de `system` pasó a
 * ser un adaptador que traduce su API y pide `variant="card"`.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'plain',
  className,
}: EmptyStateProps) {
  const esTarjeta = variant === 'card'

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center text-center',
        esTarjeta
          ? 'overflow-hidden rounded-2xl border border-border/70 bg-card px-6 py-12 elevation-1'
          : 'px-6 py-16',
        className
      )}
    >
      {esTarjeta && (
        <>
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-info/10 blur-3xl" />
        </>
      )}

      {icon && (
        <div className="relative mb-5">
          {esTarjeta ? (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-info/15 text-primary ring-1 ring-inset ring-primary/10 [&_svg]:size-9">
              {icon}
            </div>
          ) : (
            <>
              {/* Halo decorativo en anillos concéntricos */}
              <div className="absolute left-1/2 top-1/2 -z-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/50" />
              <div className="absolute left-1/2 top-1/2 -z-10 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/30" />
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted text-muted-foreground elevation-1">
                {icon}
              </div>
            </>
          )}
        </div>
      )}

      <h3 className={cn('relative text-foreground', esTarjeta ? 'text-h2' : 'text-h3')}>
        {title}
      </h3>
      {description && (
        <p className="relative mt-1.5 max-w-sm text-small text-muted-foreground">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="relative mt-6 flex flex-col items-center gap-2 sm:flex-row">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
