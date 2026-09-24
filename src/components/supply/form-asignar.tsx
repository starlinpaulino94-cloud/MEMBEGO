'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { asignarAction, type EstadoAccion } from '@/modules/supply/actions'
import { SUPPLY_DESTINOS, SUPPLY_DESTINO_LABELS } from '@/modules/supply/catalogo'

/**
 * MEMBEGO SUPPLY · apartar unidades para una campaña (Fase 8).
 *
 * El texto de abajo no es decorativo: «asignar no es consumir» es la
 * confusión que destruye la contabilidad de una campaña, y decirlo en el punto
 * exacto donde alguien está a punto de apartar 200 unidades evita la pregunta
 * de después — «¿ya gasté esas 200?».
 */
export function FormAsignar({ loteId, disponibles }: { loteId: string; disponibles: number }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(asignarAction, {})

  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="loteId" value={loteId} />
      <p className="text-sm font-medium">Apartar unidades para una campaña</p>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor="etiqueta">Nombre</Label>
          <Input
            id="etiqueta"
            name="etiqueta"
            required
            maxLength={200}
            placeholder="Bienvenida Membego"
          />
        </div>

        <div>
          <Label htmlFor="destinoTipo">Destino</Label>
          <select
            id="destinoTipo"
            name="destinoTipo"
            defaultValue="CAMPANA"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {SUPPLY_DESTINOS.map((d) => (
              <option key={d} value={d}>
                {SUPPLY_DESTINO_LABELS[d]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="cantidad">Cantidad</Label>
          <Input
            id="cantidad"
            name="cantidad"
            type="number"
            min={1}
            max={disponibles}
            required
            placeholder={String(Math.min(200, disponibles))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Apartando…' : 'Apartar'}
        </Button>
        <span className="text-caption text-muted-foreground">
          Quedan {disponibles.toLocaleString('es-DO')} sin asignar. Apartar no consume: las unidades
          siguen siendo del pool hasta que un cliente reclame la suya, y liberarlas es un clic.
        </span>
      </div>

      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}
