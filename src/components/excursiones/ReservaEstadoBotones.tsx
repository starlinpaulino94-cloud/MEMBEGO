'use client'

/**
 * Mover la reserva a mano. Cancelar exige motivo y su propio permiso: es el
 * estado que después explica un reembolso o una comisión que no se paga.
 * PAGADA y ABONADA no están aquí — esos los decide el dinero, no un botón.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  cambiarEstadoReserva,
  type ReservaActionState,
} from '@/modules/excursiones/reservas/actions'
import {
  ESTADO_RESERVA_LABEL,
  ESTADOS_CERRADOS,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const init: ReservaActionState = {}

/** Los estados que un humano decide (el resto los mueven los pagos). */
const MANUALES: EstadoReserva[] = ['CONFIRMADA', 'COMPLETADA', 'NO_SHOW', 'CANCELADA']

export function ReservaEstadoBotones({
  reservaId,
  estado,
}: {
  reservaId: string
  estado: EstadoReserva
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoReserva, init)
  const [cancelando, setCancelando] = useState(false)

  // Cancelada la reserva, el componente entra por la rama de «cerrada» al
  // refrescar: el formulario desaparece sin tocar el estado desde el efecto.
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  if (ESTADOS_CERRADOS.includes(estado)) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta reserva está cerrada como <strong className="text-foreground">{ESTADO_RESERVA_LABEL[estado]}</strong>.
        Su histórico no se reescribe.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {MANUALES.filter((e) => e !== 'CANCELADA').map((e) => (
        <form key={e} action={formAction}>
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="estado" value={e} />
          <Button type="submit" size="sm" variant="outline" disabled={pending || estado === e}>
            {ESTADO_RESERVA_LABEL[e]}
          </Button>
        </form>
      ))}

      {cancelando ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="estado" value="CANCELADA" />
          <Input
            name="motivo"
            required
            placeholder="Motivo de la cancelación"
            aria-label="Motivo de la cancelación"
            className="h-8 w-56"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Confirmar cancelación
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCancelando(false)}>
            Volver
          </Button>
        </form>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setCancelando(true)}>
          Cancelar reserva
        </Button>
      )}
    </div>
  )
}
