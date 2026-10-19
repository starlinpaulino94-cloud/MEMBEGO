'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { registrarIncidenciaAction } from '@/modules/supply-v2/actions-canje'
import { INCIDENT_TYPE_LABELS } from '@/modules/supply-v2/core/catalogo'

/** SUPPLIER & FULFILLMENT COMMERCE · registrar una incidencia desde el portal (fuera del escáner). */
export function FormIncidencia({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(registrarIncidenciaAction, {})
  const [abierto, setAbierto] = useState(false)
  if (estado.success) return <p className="text-sm text-success" data-testid="incidencia-registrada">{estado.success}</p>
  if (!abierto) {
    return (
      <Button type="button" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-nueva-incidencia">
        Registrar incidencia
      </Button>
    )
  }
  return (
    <form action={enviar} className="space-y-3 rounded-lg border border-border p-3" data-testid="form-incidencia">
      {sucursales.length > 0 && (
        <div>
          <Label htmlFor="incidenciaSucursal">Sucursal</Label>
          <select id="incidenciaSucursal" name="branchId" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue={sucursales[0]?.id}>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor="incidenciaTipo">Qué pasó</Label>
        <select id="incidenciaTipo" name="type" className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue="OTHER" data-testid="select-tipo-incidencia">
          {(Object.keys(INCIDENT_TYPE_LABELS) as (keyof typeof INCIDENT_TYPE_LABELS)[]).map((k) => (
            <option key={k} value={k}>{INCIDENT_TYPE_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="incidenciaNotas">Notas</Label>
        <Textarea id="incidenciaNotas" name="notes" rows={3} maxLength={500} required />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-incidencia">Guardar</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
