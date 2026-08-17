'use client'

/**
 * Confirmar la venta desde la reserva saldada, y cancelarla si hiciera falta.
 * El botón solo aparece cuando el dinero ya entró: la comisión nace del cobro,
 * no de la promesa.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmarVenta,
  cancelarVenta,
  type VentaActionState,
} from '@/modules/excursiones/ventas/actions'
import { ESTADO_VENTA_LABEL, TONO_VENTA, type EstadoVenta } from '@/modules/excursiones/ventas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusChip } from '@/components/ui/status-chip'

const init: VentaActionState = {}

export function VentaAcciones({
  reservaId,
  saldo,
  venta,
}: {
  reservaId: string
  saldo: number
  venta: { id: string; numero: string; estado: string } | null
}) {
  const router = useRouter()
  const [state, confirmarAction, pending] = useActionState(confirmarVenta, init)
  const [cancelState, cancelarAction, cancelando] = useActionState(cancelarVenta, init)
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  useEffect(() => {
    if (cancelState.success) {
      toast.success(cancelState.success)
      router.refresh()
    }
    if (cancelState.error) toast.error(cancelState.error)
  }, [cancelState, router])

  if (venta) {
    const estado = venta.estado as EstadoVenta
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-h3 text-foreground">
              Venta <span className="font-mono">{venta.numero}</span>
            </h2>
            <p className="text-caption text-muted-foreground">
              La comisión de esta venta nació con la regla vigente en este momento y ya no
              cambia.
            </p>
          </div>
          <StatusChip tone={TONO_VENTA[estado] ?? 'neutral'}>
            {ESTADO_VENTA_LABEL[estado] ?? venta.estado}
          </StatusChip>
        </div>

        {venta.estado !== 'CANCELADA' ? (
          pidiendoMotivo ? (
            <form action={cancelarAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="ventaId" value={venta.id} />
              <Input
                name="motivo"
                required
                placeholder="Motivo de la cancelación"
                aria-label="Motivo de la cancelación de la venta"
                className="h-8 w-56"
              />
              <Button type="submit" size="sm" variant="destructive" disabled={cancelando}>
                Confirmar cancelación
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPidiendoMotivo(false)}>
                Volver
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => setPidiendoMotivo(true)}
            >
              Cancelar venta
            </Button>
          )
        ) : null}
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Venta y comisión</h2>
      {saldo > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          La venta se confirma cuando la reserva queda saldada. Falta cobrar el saldo pendiente.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            La reserva está saldada. Al confirmar la venta se genera la comisión del vendedor
            con la regla vigente hoy, y queda congelada.
          </p>
          {state.error ? (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <form action={confirmarAction} className="mt-3">
            <input type="hidden" name="reservaId" value={reservaId} />
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirmar venta
            </Button>
          </form>
        </>
      )}
    </section>
  )
}
