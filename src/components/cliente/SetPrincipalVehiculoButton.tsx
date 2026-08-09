'use client'

import { useActionState, useEffect } from 'react'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import {
  marcarVehiculoPrincipal,
  type VehiculoActionState,
} from '@/modules/cliente/vehiculosActions'

const init: VehiculoActionState = {}

/**
 * "Hacer principal" (§41).
 *
 * Ocupa el mismo sitio que la insignia "Principal" de la tarjeta: esa fila
 * responde siempre a la misma pregunta —¿es este mi vehículo de cabecera?— y
 * según la respuesta enseña un estado o la forma de cambiarlo.
 *
 * No pide confirmación a propósito: es reversible con un clic en otra tarjeta
 * y no borra nada. Un `confirm()` aquí sería ceremonia para un cambio de
 * etiqueta.
 */
export function SetPrincipalVehiculoButton({
  vehiculoId,
  label,
}: {
  vehiculoId: string
  label: string
}) {
  const [state, formAction, pending] = useActionState(marcarVehiculoPrincipal, init)

  useEffect(() => {
    if (state.success) toast.success('Vehículo principal actualizado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={formAction}>
      <input type="hidden" name="vehiculoId" value={vehiculoId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Hacer principal: ${label}`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-caption font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Star className="h-3.5 w-3.5" aria-hidden />
        )}
        Hacer principal
      </button>
    </form>
  )
}
