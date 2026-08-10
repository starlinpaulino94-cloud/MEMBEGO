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
            n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
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
        <div className="flex items-center gap-5 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="text-center">
            <p className="text-4xl font-extrabold tabular-nums tracking-tight text-foreground">
              {resenas.promedio?.toFixed(1) ?? '—'}
            </p>
            <Estrellas rating={Math.round(resenas.promedio ?? 0)} className="mt-1" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {resenas.total} reseña{resenas.total !== 1 ? 's' : ''} de clientes
            </p>
            <p className="text-xs text-muted-foreground">
              Opiniones reales de miembros de esta empresa.
            </p>
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
              className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-teal-400/80 text-xs font-bold text-primary-foreground"
                >
                  {r.clienteNombre.trim().slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {r.clienteNombre}
                  </p>
                  <div className="flex items-center gap-2">
                    <Estrellas rating={r.rating} />
                    <span className="text-[11px] text-muted-foreground">
                      {fmtFecha(r.fecha)}
                    </span>
                  </div>
                </div>
              </div>
              {r.comment && (
                <p className="mt-2.5 text-sm leading-relaxed text-foreground/80">
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
