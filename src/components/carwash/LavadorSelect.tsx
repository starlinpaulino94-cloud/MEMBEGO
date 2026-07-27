'use client'

/**
 * App Car Wash · Fase 2 — quién trabajó este vehículo.
 *
 * Vive en la tarjeta de la cola y no en una pantalla aparte porque el momento
 * de asignarlo es cuando el carro entra a la bahía, con el encargado de pie
 * frente a él. Cualquier paso adicional garantiza que no se llene, y sin esto
 * la comisión no tiene a quién pagarle.
 *
 * Se guarda al cambiar el selector: sin botón "guardar", que en esa mano
 * mojada es un clic más que nadie da.
 */

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, User } from 'lucide-react'
import { asignarLavador } from '@/modules/carwash/fase2-actions'

export interface LavadorOpcion {
  id: string
  nombre: string
}

export function LavadorSelect({
  colaId,
  actual,
  lavadores,
}: {
  colaId: string
  actual: string | null
  lavadores: LavadorOpcion[]
}) {
  const [pending, start] = useTransition()

  if (lavadores.length === 0) return null

  return (
    <label className="mt-2 flex items-center gap-1.5">
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="sr-only">Lavador asignado</span>
      <select
        defaultValue={actual ?? ''}
        disabled={pending}
        className="min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
        onChange={(e) => {
          const valor = e.target.value
          start(async () => {
            const r = await asignarLavador(colaId, valor)
            if (r.error) toast.error(r.error)
            else if (r.success) toast.success(r.success)
          })
        }}
      >
        <option value="">Sin lavador asignado</option>
        {lavadores.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nombre}
          </option>
        ))}
      </select>
    </label>
  )
}
