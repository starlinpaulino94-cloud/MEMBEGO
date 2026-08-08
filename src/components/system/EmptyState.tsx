import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState as EmptyStateBase } from '@/components/ui/empty-state'

/**
 * Estado vacío ilustrado: icono grande sobre gradiente con halos de luz,
 * título corto, descripción de una línea y CTA destacado. Para cuando el
 * vacío ES la pantalla.
 *
 * DS 2.0 · Fase 0 — ADAPTADOR, ya no una segunda implementación. Había dos
 * `EmptyState` distintos en el proyecto y este dibujaba el suyo. Ahora dibuja
 * el del design system (`variant="card"`); lo único propio que queda es la
 * traducción de la API: aquí `icon` es el COMPONENTE del icono
 * (`icon={Users}`) y allí es el nodo ya renderizado (`icon={<Users />}`).
 *
 * En pantallas nuevas, importar directamente de `@/components/ui/empty-state`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <EmptyStateBase
      variant="card"
      icon={<Icon aria-hidden />}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  )
}
