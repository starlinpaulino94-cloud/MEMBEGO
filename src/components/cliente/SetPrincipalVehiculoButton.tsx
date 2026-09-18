'use client'

import { useActionState, useEffect } from 'react'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
 * LAS DOS CARAS VIVEN AQUÍ DENTRO, y no es un detalle de estilo. Cuando
 * `VehicleCard` elegía entre `<Badge>` y este botón, marcar principal cambiaba
 * el TIPO del nodo en esa posición: React desmontaba este componente justo en
 * el commit en que llegaba `success`, y el `useEffect` que muestra el toast
 * —código de un componente ya retirado— no llegaba a correr. Al conservar la
 * misma instancia y alternar solo su render, el aviso sobrevive a la
 * revalidación.
 *
 * No pide confirmación a propósito: es reversible con un clic en otra tarjeta
 * y no borra nada. Un `confirm()` aquí sería ceremonia para un cambio de
 * etiqueta.
 */
export function SetPrincipalVehiculoButton({
  vehiculoId,
  label,
  esPrincipal,
}: {
  vehiculoId: string
  label: string
  esPrincipal: boolean
}) {
  const [state, formAction, pending] = useActionState(marcarVehiculoPrincipal, init)

  useEffect(() => {
    if (state.success) toast.success('Vehículo principal actualizado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  if (esPrincipal) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Star className="h-3 w-3 fill-current" aria-hidden />
        Principal
      </Badge>
    )
  }

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
