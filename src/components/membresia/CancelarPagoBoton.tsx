'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarPago, type CancelarPagoState } from '@/modules/membresia/actions'
import { Button } from '@/components/ui/button'

const initial: CancelarPagoState = {}

interface Props {
  membershipId: string
  /** true = hay un cambio de plan pendiente (no una compra nueva). */
  esCambioPlan: boolean
}

/**
 * Deja que el cliente cancele un pago pendiente. Pide confirmación (para no
 * cancelar por accidente) y, al lograrlo, lo saca de la pantalla de pago.
 */
export function CancelarPagoBoton({ membershipId, esCambioPlan }: Props) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [state, formAction, pending] = useActionState(cancelarPago, initial)

  useEffect(() => {
    if (state.success) {
      toast.success(
        state.eraCambioDePlan ? 'Cambio de plan cancelado.' : 'Pago cancelado.'
      )
      // Si era un cambio de plan, la membresía sigue activa: refrescar basta.
      // Si era una compra nueva, ya no hay nada que pagar aquí: volver a la lista.
      if (state.eraCambioDePlan) router.refresh()
      else router.push('/mis-membresias')
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="mx-auto block text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
      >
        {esCambioPlan ? 'Cancelar el cambio de plan' : 'Cancelar y no pagar'}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-center">
      <p className="text-sm font-medium text-foreground">
        {esCambioPlan
          ? '¿Cancelar el cambio de plan? Tu plan actual seguirá activo.'
          : '¿Cancelar este pago? Podrás volver a solicitarlo cuando quieras.'}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmando(false)}
          disabled={pending}
        >
          No, seguir pagando
        </Button>
        <form action={formAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-2 h-4 w-4" />
            )}
            Sí, cancelar
          </Button>
        </form>
      </div>
    </div>
  )
}
