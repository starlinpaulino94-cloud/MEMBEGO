'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmarPedidoAction, rechazarPedidoAction, type EstadoAccion } from '@/modules/supply/actions'

/**
 * Confirmar o rechazar el pago de un cliente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL MONTO SE ESCRIBE A MANO Y NO VIENE RELLENADO
 *
 * Es lo único de esta pantalla que parece una molestia y no lo es. El campo
 * empieza VACÍO: quien revisa tiene que leer el comprobante y teclear lo que ve.
 *
 * Si viniera rellenado con el importe del pedido, confirmar sería pulsar un
 * botón, y la comparación de montos —que es la regla que impide que un
 * comprobante de RD$39 pague un pedido de RD$399— se convertiría en un adorno
 * que se aprueba a sí mismo. El servidor compara igual; esto es para que la
 * persona mire.
 */
export function FormRevisarPedido({ pedidoId, monto, manual = false }: { pedidoId: string; monto: number; manual?: boolean }) {
  const [okEstado, confirmar, confirmando] = useActionState<EstadoAccion, FormData>(
    confirmarPedidoAction,
    {}
  )
  const [noEstado, rechazar, rechazando] = useActionState<EstadoAccion, FormData>(
    rechazarPedidoAction,
    {}
  )

  return (
    <div className="flex flex-col gap-2">
      <form action={confirmar} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="pedidoId" value={pedidoId} />
        {manual && (
          <select name="metodoManual" defaultValue="EFECTIVO" aria-label="Cómo se cobró" className="h-9 rounded-lg border border-input bg-background px-2 text-body">
            <option value="EFECTIVO">Efectivo validado</option>
            <option value="MANUAL">Pago manual</option>
          </select>
        )}
        <label className="text-caption text-muted-foreground" htmlFor={`monto-${pedidoId}`}>
          {manual ? 'Monto recibido' : 'Monto del comprobante'}
        </label>
        <input
          id={`monto-${pedidoId}`}
          name="montoVisto"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder={`debe ser ${monto.toFixed(2)}`}
          className="h-9 w-36 rounded-lg border border-input bg-background px-2 text-body"
        />
        <Button type="submit" size="sm" disabled={confirmando}>
          {confirmando ? 'Confirmando…' : manual ? 'Confirmar cobro' : 'Confirmar pago'}
        </Button>
      </form>

      <form action={rechazar} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="pedidoId" value={pedidoId} />
        {/* Obligatorio: es lo único que el cliente va a leer del rechazo. */}
        <input
          name="motivo"
          required
          maxLength={500}
          placeholder="Motivo del rechazo"
          className="h-9 flex-1 min-w-48 rounded-lg border border-input bg-background px-2 text-body"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={rechazando}>
          {rechazando ? 'Rechazando…' : 'Rechazar'}
        </Button>
      </form>

      {okEstado.error && <span className="text-caption text-destructive">{okEstado.error}</span>}
      {okEstado.success && <span className="text-caption text-success">{okEstado.success}</span>}
      {noEstado.error && <span className="text-caption text-destructive">{noEstado.error}</span>}
      {noEstado.success && <span className="text-caption">{noEstado.success}</span>}
    </div>
  )
}
