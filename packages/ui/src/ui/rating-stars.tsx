import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '../cn'

/**
 * MUK · RatingStars — calificación de solo lectura (reseñas de empresas).
 *
 * Pinta 5 estrellas con relleno proporcional (media estrella incluida) y el
 * promedio/total opcional. Para CAPTURAR una calificación se usa el form de
 * reseñas del módulo (interactivo); esto es solo display.
 *
 *   <RatingStars value={4.5} total={128} />
 */
function RatingStars({
  value,
  total,
  size = 'sm',
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Promedio 0–5. */
  value: number
  /** Cantidad de reseñas (muestra "(128)"). */
  total?: number
  size?: 'sm' | 'md'
}) {
  const v = Math.max(0, Math.min(5, value))
  const px = size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <div
      data-slot="rating-stars"
      role="img"
      aria-label={`${v.toFixed(1)} de 5 estrellas${total != null ? `, ${total} reseñas` : ''}`}
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    >
      <span className="relative inline-flex" aria-hidden>
        <span className="flex text-border">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} className={cn(px, 'fill-current')} />
          ))}
        </span>
        <span
          className="absolute inset-0 flex overflow-hidden text-warning"
          style={{ width: `${(v / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} className={cn(px, 'shrink-0 fill-current')} />
          ))}
        </span>
      </span>
      <span className="text-caption font-medium tabular-nums">
        {v.toFixed(1)}
        {total != null && <span className="text-muted-foreground"> ({total})</span>}
      </span>
    </div>
  )
}

export { RatingStars }
