'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registrarPagoAction, type EstadoAccion } from '@/modules/supply/actions'
import { SUPPLY_PAGO_TIPO_LABELS } from '@/modules/supply/catalogo'

/**
 * Registra un pago a un proveedor. Nace PENDIENTE y NO mueve el saldo: el
 * asiento se crea al confirmarlo. Registrar no es pagar.
 */
export function FormPago({
  acuerdos,
}: {
  acuerdos: { id: string; codigo: string; proveedor: string }[]
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(registrarPagoAction, {})

  if (acuerdos.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay acuerdos activos que liquidar.</p>
  }

  return (
    <form action={accion} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor="acuerdoId">Acuerdo</Label>
          <select
            id="acuerdoId"
            name="acuerdoId"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {acuerdos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} — {a.proveedor}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="tipo">Tipo</Label>
          <select
            id="tipo"
            name="tipo"
            defaultValue="ANTICIPO"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {(Object.keys(SUPPLY_PAGO_TIPO_LABELS) as (keyof typeof SUPPLY_PAGO_TIPO_LABELS)[]).map(
              (t) => (
                <option key={t} value={t}>
                  {SUPPLY_PAGO_TIPO_LABELS[t]}
                </option>
              )
            )}
          </select>
        </div>
        <div>
          <Label htmlFor="monto">Monto</Label>
          <Input id="monto" name="monto" type="number" min={0.01} step="0.01" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="metodo">Método</Label>
          <Input id="metodo" name="metodo" maxLength={100} placeholder="Transferencia" />
        </div>
        <div>
          <Label htmlFor="referencia">Referencia</Label>
          <Input id="referencia" name="referencia" maxLength={200} />
        </div>
        <div>
          <Label htmlFor="periodoDesde">Periodo desde</Label>
          <Input id="periodoDesde" name="periodoDesde" type="date" />
        </div>
        <div>
          <Label htmlFor="periodoHasta">Periodo hasta</Label>
          <Input id="periodoHasta" name="periodoHasta" type="date" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Registrando…' : 'Registrar pago'}
        </Button>
        <span className="text-caption text-muted-foreground">
          Queda pendiente hasta que alguien lo confirme. Solo al confirmarlo se mueve el saldo.
        </span>
      </div>

      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}
