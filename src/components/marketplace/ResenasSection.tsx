import { Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { CompanyResenas } from '@/modules/resenas/queries'

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d))
}

/** Fila de 5 estrellas (solo lectura). */
function Estrellas({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${rating} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'h-3.5 w-3.5',
            n <= rating ? 'fill-retail-star text-retail-star' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </span>
  )
}

/**
 * Reseñas del mini-sitio de la empresa: promedio grande + opiniones reales
 * de clientes con avatar de iniciales, estrellas y fecha. `formSlot` recibe
 * el formulario "Escribe tu reseña" cuando el visitante puede opinar.
 */
export function ResenasSection({
  resenas,
  formSlot,
}: {
  resenas: CompanyResenas
  formSlot?: ReactNode
}) {
  return (
    <div className="space-y-6">
      {/* Resumen: promedio protagonista */}
      {resenas.total > 0 && (
        <div className="flex items-center gap-5 rounded-lg border border-border bg-card p-5 elevation-1">
          <div className="text-center">
            <p className="text-h1 tabular-nums text-foreground">
              {resenas.promedio != null && Number.isFinite(Number(resenas.promedio))
                ? Number(resenas.promedio).toFixed(1)
                : '—'}
            </p>
            <Estrellas rating={Math.round(Number(resenas.promedio) || 0)} className="mt-1" />
          </div>
          <div className="min-w-0">
            <p className="text-small font-semibold text-foreground">
              {resenas.total} reseña{resenas.total !== 1 ? 's' : ''} de clientes
            </p>
            <p className="text-caption">Opiniones reales de miembros de esta empresa.</p>
          </div>
        </div>
      )}

      {formSlot}

      {/* Lista de opiniones */}
      {resenas.items.length > 0 && (
        <ul className="space-y-4">
          {resenas.items.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-border bg-card p-4 elevation-1"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft text-label-sm font-bold text-primary"
                >
                  {r.clienteNombre.trim().slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-semibold text-foreground">
                    {r.clienteNombre}
                  </p>
                  <div className="flex items-center gap-2">
                    <Estrellas rating={r.rating} />
                    <span className="text-caption">{fmtFecha(r.fecha)}</span>
                  </div>
                </div>
              </div>
              {r.comment && (
                <p className="mt-2.5 text-small leading-relaxed text-foreground/80">
                  {r.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
