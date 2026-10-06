'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmarPagoAction, type EstadoAccion } from '@/modules/supply/actions'

/**
 * Confirma un pago pendiente y lo asienta en el ledger financiero.
 *
 * La separación pendiente/confirmado existe para que alguien pueda preparar
 * una liquidación el viernes y tesorería la confirme el lunes sin que el saldo
 * del proveedor mienta durante el fin de semana.
 */
export function FormConfirmar({ pagoId }: { pagoId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(confirmarPagoAction, {})

  return (
    <form action={accion} className="flex items-center gap-2">
      <input type="hidden" name="pagoId" value={pagoId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente}>
        {pendiente ? 'Confirmando…' : 'Confirmar'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
    </form>
  )
}
