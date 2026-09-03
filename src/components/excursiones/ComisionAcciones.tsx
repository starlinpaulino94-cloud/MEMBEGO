'use client'

/**
 * El ciclo de vida de una comisión y su ajuste. Los botones que se ven son
 * SOLO las transiciones que el núcleo permite: una comisión pagada no muestra
 * un botón de anular que después el servidor va a rechazar.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  cambiarEstadoComision,
  ajustarComision,
  type ComisionActionState,
} from '@/modules/excursiones/comisiones/actions'
import {
  ESTADO_COMISION_LABEL,
  ESTADOS_COMISION,
  puedeTransicionarManualComision,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const init: ComisionActionState = {}

export function ComisionAcciones({
  comisionId,
  estado,
}: {
  comisionId: string
  estado: EstadoComision
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoComision, init)
  const [ajusteState, ajusteAction, ajustando] = useActionState(ajustarComision, init)
  const [ajustando_, setAjustando] = useState(false)
  const [tipoAjuste, setTipoAjuste] = useState<'RESTAR' | 'SUMAR'>('RESTAR')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  useEffect(() => {
    if (ajusteState.success) {
      toast.success(ajusteState.success)
      router.refresh()
    }
    if (ajusteState.error) toast.error(ajusteState.error)
  }, [ajusteState, router])

  const siguientes = ESTADOS_COMISION.filter((e) => puedeTransicionarManualComision(estado, e))

  const LABEL: Partial<Record<EstadoComision, string>> = {
    APROBADA: 'Aprobar',
    ANULADA: 'Anular',
    GENERADA: 'Reanudar',
  }
  const PUEDE_AJUSTAR = estado === 'GENERADA'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {siguientes.map((e) => (
        <form key={e} action={formAction}>
          <input type="hidden" name="comisionId" value={comisionId} />
          <input type="hidden" name="estado" value={e} />
          <Button
            type="submit"
            size="sm"
            variant={e === 'ANULADA' ? 'ghost' : e === 'APROBADA' ? 'default' : 'outline'}
            disabled={pending}
          >
            {LABEL[e] ?? ESTADO_COMISION_LABEL[e]}
          </Button>
        </form>
      ))}

      {ajustando_ ? (
        <form action={ajusteAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="comisionId" value={comisionId} />
          <input type="hidden" name="tipoAjuste" value={tipoAjuste} />

          {/* Selector para determinar si resta o suma */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setTipoAjuste('RESTAR')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                tipoAjuste === 'RESTAR'
                  ? 'bg-destructive text-destructive-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Restar (−)
            </button>
            <button
              type="button"
              onClick={() => setTipoAjuste('SUMAR')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                tipoAjuste === 'SUMAR'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sumar (+)
            </button>
          </div>

          <Input
            name="monto"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder={tipoAjuste === 'RESTAR' ? 'Monto a restar' : 'Monto a sumar'}
            aria-label={tipoAjuste === 'RESTAR' ? 'Monto a restar' : 'Monto a sumar'}
            className="h-8 w-36"
          />
          <Input
            name="motivo"
            required
            placeholder="Motivo del ajuste"
            aria-label="Motivo del ajuste"
            className="h-8 w-44"
          />
          <Button type="submit" size="sm" disabled={ajustando}>
            Guardar ajuste
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAjustando(false)}>
            Volver
          </Button>
        </form>
      ) : (
        PUEDE_AJUSTAR && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAjustando(true)}>
            Ajustar
          </Button>
        )
      )}
    </div>
  )
}
