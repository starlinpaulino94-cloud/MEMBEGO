'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { moverOrdenAction, type EstadoAccion } from '@/modules/supply/actions'
import { SUPPLY_ORDEN_ESTADO_LABELS } from '@/modules/supply/catalogo'

/**
 * MEMBEGO SUPPLY · mover una orden de compra por su ciclo.
 *
 * APROBADA se esconde cuando quien mira es quien la creó. El servidor lo
 * rechaza igual —esa es la barrera real— pero enseñar un botón que siempre va
 * a contestar «no puedes aprobar lo que creaste» es una trampa: la persona lo
 * pulsa, no entiende por qué falla y acaba pidiéndole a otro que lo intente.
 */
export function AccionesOrden({
  ordenId,
  estadosPosibles,
  soyElCreador,
  yaTieneLotes,
}: {
  ordenId: string
  estadosPosibles: string[]
  soyElCreador: boolean
  yaTieneLotes: boolean
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(moverOrdenAction, {})

  const disponibles = estadosPosibles.filter((e) => !(e === 'APROBADA' && soyElCreador))

  if (disponibles.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {soyElCreador && estadosPosibles.includes('APROBADA')
            ? 'Creaste esta orden, así que no puedes aprobarla. Una compra la aprueba otra persona: es lo único que impide que alguien comprometa el presupuesto por su cuenta.'
            : 'Esta orden llegó al final de su ciclo.'}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ciclo de la orden</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="ordenId" value={ordenId} />
          <div>
            <Label htmlFor="estado">Pasar a</Label>
            <select
              id="estado"
              name="estado"
              className="h-9 min-w-52 rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              {disponibles.map((e) => (
                <option key={e} value={e}>
                  {SUPPLY_ORDEN_ESTADO_LABELS[e as keyof typeof SUPPLY_ORDEN_ESTADO_LABELS] ?? e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="motivo">Motivo (si se cancela)</Label>
            <Input id="motivo" name="motivo" maxLength={500} className="min-w-64" />
          </div>
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </form>

        {!yaTieneLotes && estadosPosibles.includes('ACTIVA') && (
          <p className="mt-3 text-caption text-muted-foreground">
            Al pasar a <strong>Activa</strong> nacen los lotes y la compra queda asentada en el
            ledger: a partir de ahí las unidades existen y se pueden repartir. Activar dos veces no
            duplica el supply.
          </p>
        )}
        {soyElCreador && estadosPosibles.includes('APROBADA') && (
          <p className="mt-3 text-caption text-muted-foreground">
            No aparece «Aprobada» porque esta orden la creaste tú.
          </p>
        )}

        {estado.error && <p className="mt-3 text-sm text-destructive">{estado.error}</p>}
        {estado.success && <p className="mt-3 text-sm text-success">{estado.success}</p>}
      </CardContent>
    </Card>
  )
}
