'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { recalcularLoteAction, type EstadoAccion } from '@/modules/supply/actions'

/**
 * Recalcula los contadores de un lote desde su ledger.
 *
 * SIEMPRE en esa dirección. Si los dos números discrepan, el equivocado es el
 * contador: el ledger tiene un asiento por cada cosa que pasó, con fecha,
 * motivo y actor. Un botón que hiciera lo contrario —ajustar el ledger al
 * contador— convertiría la caché en la verdad y borraría la única explicación
 * disponible de por qué quedan 742 unidades.
 */
export function BotonRecalcular({ loteId }: { loteId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(
    recalcularLoteAction,
    {}
  )

  return (
    <form action={accion} className="flex items-center gap-2">
      <input type="hidden" name="loteId" value={loteId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente}>
        {pendiente ? 'Recalculando…' : 'Recalcular desde el ledger'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
      {estado.success && <span className="text-caption text-success">{estado.success}</span>}
    </form>
  )
}
