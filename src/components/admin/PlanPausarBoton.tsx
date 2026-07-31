'use client'

import { useActionState, useEffect } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { alternarPlanActivo, type PlanActionState } from '@/modules/admin/planActions'
import { Button } from '@/components/ui/button'

const init: PlanActionState = {}

/**
 * Pausar/reanudar un plan con UN clic desde la lista. Pausado = los clientes
 * no lo ven ni lo pueden comprar; las membresías ya vendidas no se tocan.
 */
export function PlanPausarBoton({ planId, activo, nombre }: { planId: string; activo: boolean; nombre: string }) {
  const [state, action, pending] = useActionState(alternarPlanActivo, init)

  useEffect(() => {
    if (state.success) {
      toast.success(activo ? `"${nombre}" pausado: ya no es visible para clientes.` : `"${nombre}" activado de nuevo.`)
    }
    if (state.error) toast.error(state.error)
    // Solo reaccionar al resultado de ESTE envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        disabled={pending}
        title={activo ? 'Pausar (ocultar a clientes)' : 'Reanudar (visible de nuevo)'}
        aria-label={activo ? 'Pausar plan' : 'Reanudar plan'}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : activo ? (
          <Pause className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Play className="h-4 w-4 text-success" />
        )}
      </Button>
    </form>
  )
}
