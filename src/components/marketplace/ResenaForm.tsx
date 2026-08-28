'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { guardarResena, type ResenaState } from '@/modules/resenas/actions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const init: ResenaState = {}

/**
 * "Escribe tu reseña": selector de estrellas táctil (≥48px por estrella) +
 * comentario opcional. Una reseña por cliente: si ya opinó, el formulario
 * llega precargado y guardar la actualiza.
 */
export function ResenaForm({
  companyId,
  companyName,
  miResena,
}: {
  companyId: string
  companyName: string
  miResena: { rating: number; comment: string | null } | null
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(guardarResena, init)
  const [rating, setRating] = useState(miResena?.rating ?? 0)
  const [hover, setHover] = useState(0)

  useEffect(() => {
    if (state.success) {
      toast.success('¡Gracias! Tu reseña quedó publicada.')
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  const activa = hover || rating

  return (
    <form
      action={action}
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm"
    >
      <p className="text-sm font-bold text-foreground">
        {miResena ? 'Actualiza tu reseña' : `¿Cómo ha sido tu experiencia en ${companyName}?`}
      </p>

      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="rating" value={rating} />

      {/* Selector de estrellas */}
      <div
        className="mt-3 flex items-center gap-1"
        role="radiogroup"
        aria-label="Calificación de 1 a 5 estrellas"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} estrella${n !== 1 ? 's' : ''}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="flex h-12 w-12 items-center justify-center rounded-xl transition hover:bg-muted active:scale-90"
          >
            <Star
              aria-hidden
              className={cn(
                'h-7 w-7 transition-all',
                n <= activa
                  ? 'scale-110 fill-amber-400 text-warning'
                  : 'text-muted-foreground/40'
              )}
            />
          </button>
        ))}
      </div>

      <textarea
        name="comment"
        rows={3}
        maxLength={600}
        defaultValue={miResena?.comment ?? ''}
        placeholder="Cuéntanos qué te gustó (opcional)…"
        className="mt-3 w-full resize-none rounded-2xl border border-border/60 bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/20"
      />

      <Button
        type="submit"
        disabled={pending || rating === 0}
        className="mt-3 min-h-12 w-full rounded-2xl font-bold sm:w-auto sm:px-8"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {miResena ? 'Guardar cambios' : 'Publicar reseña'}
      </Button>
    </form>
  )
}
