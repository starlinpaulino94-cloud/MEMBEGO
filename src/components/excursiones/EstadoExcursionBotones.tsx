'use client'

/**
 * Cambiar el estado de la excursión con un clic. Archivar exige su permiso
 * propio (catalogo_archivar) — el servidor lo hace cumplir.
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  cambiarEstadoExcursion,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import {
  ESTADOS_EXCURSION,
  ESTADO_EXCURSION_LABEL,
  type EstadoExcursion,
} from '@/modules/excursiones/catalogo/nucleo'
import { Button } from '@/components/ui/button'

const init: CatalogoActionState = {}

export function EstadoExcursionBotones({
  excursionId,
  estado,
}: {
  excursionId: string
  estado: EstadoExcursion
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoExcursion, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <div className="flex flex-wrap gap-2">
      {ESTADOS_EXCURSION.map((e) => (
        <form key={e} action={formAction}>
          <input type="hidden" name="excursionId" value={excursionId} />
          <input type="hidden" name="estado" value={e} />
          <Button type="submit" size="sm" variant={estado === e ? 'default' : 'outline'} disabled={pending || estado === e}>
            {ESTADO_EXCURSION_LABEL[e]}
          </Button>
        </form>
      ))}
    </div>
  )
}
