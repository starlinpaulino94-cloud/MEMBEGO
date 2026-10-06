'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registrarPagoAction, type EstadoAccion } from '@/modules/supply/actions'
import { FormComprobantePago } from './form-comprobante-pago'

export const METODOS_PAGO_PROVEEDOR = [
  ['TRANSFERENCIA', 'Transferencia'],
  ['DEPOSITO_BANCARIO', 'Depósito bancario'],
  ['EFECTIVO', 'Efectivo'],
  ['TARJETA', 'Tarjeta'],
  ['CREDITO', 'Crédito del proveedor'],
  ['OTRO', 'Otro'],
] as const

/**
 * Registra un pago de una ORDEN (anticipo o pago final) y, una vez registrado,
 * permite adjuntar el comprobante. Dos pasos porque la ruta del archivo se
 * firma contra el id del pago, que no existe hasta registrarlo.
 */
export function FormPagoOrden({ acuerdoId, ordenId, pendiente }: { acuerdoId: string; ordenId: string; pendiente: number }) {
  const [estado, accion, enviando] = useActionState<EstadoAccion, FormData>(registrarPagoAction, {})
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  if (estado.success && estado.id) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-success">{estado.success}</p>
        <p className="text-caption text-muted-foreground">Adjunta el comprobante (opcional) y confírmalo en Finanzas → Pagos para que fondee la orden.</p>
        <FormComprobantePago pagoId={estado.id} />
      </div>
    )
  }

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="acuerdoId" value={acuerdoId} />
      <input type="hidden" name="ordenId" value={ordenId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="tipoPago">Tipo</Label>
          <select id="tipoPago" name="tipo" defaultValue="ANTICIPO" className={select}>
            <option value="ANTICIPO">Anticipo</option>
            <option value="LIQUIDACION_FINAL">Pago final</option>
          </select>
        </div>
        <div>
          <Label htmlFor="montoPago">Monto</Label>
          <Input id="montoPago" name="monto" type="number" min={0.01} step="0.01" required defaultValue={pendiente > 0 ? pendiente.toFixed(2) : ''} />
        </div>
        <div>
          <Label htmlFor="metodoPago">Método</Label>
          <select id="metodoPago" name="metodo" defaultValue="TRANSFERENCIA" className={select}>
            {METODOS_PAGO_PROVEEDOR.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="referenciaPago">Referencia bancaria</Label>
          <Input id="referenciaPago" name="referencia" maxLength={200} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar pago'}
        </Button>
        <span className="text-caption text-muted-foreground">Pagos parciales permitidos. Nace pendiente; al confirmarse suma a «Pagado».</span>
      </div>
      {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
    </form>
  )
}
