'use client'

/**
 * Aprobar, pagar o anular una liquidación. Pagar pide método y referencia
 * porque un pago sin rastro no se puede reconciliar después; anular pide
 * motivo y devuelve las comisiones al pozo.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  cambiarEstadoLiquidacion,
  type LiquidacionActionState,
} from '@/modules/excursiones/liquidaciones/actions'
import {
  ESTADO_LIQUIDACION_LABEL,
  puedeTransicionarLiquidacion,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { METODOS_PAGO, METODO_PAGO_LABEL } from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: LiquidacionActionState = {}

export function LiquidacionAcciones({
  liquidacionId,
  estado,
}: {
  liquidacionId: string
  estado: EstadoLiquidacion
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoLiquidacion, init)
  const [vista, setVista] = useState<'botones' | 'pagar' | 'anular'>('botones')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  if (estado === 'ANULADA') {
    return (
      <p className="text-sm text-muted-foreground">
        Esta liquidación está anulada. Su histórico no se reescribe.
      </p>
    )
  }

  if (vista === 'pagar') {
    return (
      <form action={formAction} className="space-y-3 rounded-xl border border-border p-4">
        <input type="hidden" name="liquidacionId" value={liquidacionId} />
        <input type="hidden" name="estado" value="PAGADA" />
        <p className="text-sm text-muted-foreground">
          Al registrar el pago, las comisiones de esta liquidación quedan pagadas y ya no se
          podrán anular: lo que haya que corregir se hará con un ajuste.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="liq-metodo">Método</Label>
            <select
              id="liq-metodo"
              name="metodo"
              className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
            >
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>{METODO_PAGO_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="liq-ref">Referencia</Label>
            <Input id="liq-ref" name="referencia" placeholder="Transferencia, cheque, depósito…" />
          </div>
        </div>
        <div>
          <Label htmlFor="liq-notas">Notas</Label>
          <Input id="liq-notas" name="notas" placeholder="Opcional" />
        </div>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Registrar el pago
          </Button>
          <Button type="button" variant="ghost" onClick={() => setVista('botones')}>
            Volver
          </Button>
        </div>
      </form>
    )
  }

  if (vista === 'anular') {
    return (
      <form action={formAction} className="space-y-3 rounded-xl border border-border p-4">
        <input type="hidden" name="liquidacionId" value={liquidacionId} />
        <input type="hidden" name="estado" value="ANULADA" />
        <p className="text-sm text-muted-foreground">
          Las comisiones que aún no se habían pagado vuelven a quedar disponibles para la
          siguiente liquidación.
        </p>
        <div>
          <Label htmlFor="liq-motivo">Motivo *</Label>
          <Input id="liq-motivo" name="motivo" required placeholder="Por qué se anula" />
        </div>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={pending}>
            Anular liquidación
          </Button>
          <Button type="button" variant="ghost" onClick={() => setVista('botones')}>
            Volver
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {puedeTransicionarLiquidacion(estado, 'APROBADA') ? (
        <form action={formAction}>
          <input type="hidden" name="liquidacionId" value={liquidacionId} />
          <input type="hidden" name="estado" value="APROBADA" />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {ESTADO_LIQUIDACION_LABEL.APROBADA}
          </Button>
        </form>
      ) : null}

      {puedeTransicionarLiquidacion(estado, 'PAGADA') ? (
        <Button type="button" size="sm" onClick={() => setVista('pagar')}>
          Registrar el pago
        </Button>
      ) : null}

      {puedeTransicionarLiquidacion(estado, 'ANULADA') ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setVista('anular')}>
          Anular
        </Button>
      ) : null}

      {state.error ? (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
