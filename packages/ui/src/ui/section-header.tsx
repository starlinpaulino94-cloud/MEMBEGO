import { cn } from '../cn'

/**
 * Cabecera de una sección DENTRO de una pantalla. El escalón por debajo de
 * `PageHeader`: aquel lleva el único `h1`, este los `h2` que ordenan el
 * contenido.
 *
 * Existe para que las secciones dejen de componerse a mano. El patrón repetido
 * por las páginas era `<div className="flex items-center justify-between">` con
 * un `<h2>` de tamaño distinto en cada módulo; el resultado es que la misma
 * jerarquía se ve diferente según en qué pantalla estés.
 */
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  /** Acción de la sección: "Ver todo", "Añadir"… */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 className="text-h2 text-balance text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 max-w-prose text-small text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
