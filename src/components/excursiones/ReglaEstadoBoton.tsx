'use client'

/** Encender o apagar una regla. Nunca se borra: sigue explicando su pasado. */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  alternarRegla,
  type ComisionActionState,
} from '@/modules/excursiones/comisiones/actions'
import { Button } from '@/components/ui/button'

const init: ComisionActionState = {}

export function ReglaEstadoBoton({ reglaId, activa }: { reglaId: string; activa: boolean }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(alternarRegla, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <form action={formAction}>
      <input type="hidden" name="reglaId" value={reglaId} />
      <input type="hidden" name="activa" value={activa ? 'false' : 'true'} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {activa ? 'Desactivar' : 'Activar'}
      </Button>
    </form>
  )
}
