'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolverIncidenciaAction, type EstadoAccion } from '@/modules/supply/actions'
import { SUPPLY_INCIDENCIA_ESTADO_LABELS } from '@/modules/supply/catalogo'

/**
 * Mueve una disputa por su flujo. Resolver EXIGE escribir cómo se resolvió: un
 * «resuelta» sin explicación no sirve para hablar con el proveedor ni para
 * entender, seis meses después, por qué se le dio la razón a alguien.
 */
export function FormResolverIncidencia({
  incidenciaId,
  estadosPosibles,
}: {
  incidenciaId: string
  estadosPosibles: string[]
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(
    resolverIncidenciaAction,
    {}
  )

  return (
    <form action={accion} className="flex flex-1 flex-wrap items-center gap-2">
      <input type="hidden" name="incidenciaId" value={incidenciaId} />
      <select
        name="estado"
        className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
        aria-label="Nuevo estado de la incidencia"
      >
        {estadosPosibles.map((e) => (
          <option key={e} value={e}>
            {SUPPLY_INCIDENCIA_ESTADO_LABELS[e as keyof typeof SUPPLY_INCIDENCIA_ESTADO_LABELS] ?? e}
          </option>
        ))}
      </select>
      <Input
        name="resolucion"
        placeholder="Cómo se resolvió…"
        maxLength={2000}
        className="min-w-64 flex-1"
        aria-label="Resolución"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Aplicar'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
      {estado.success && <span className="text-caption text-success">{estado.success}</span>}
    </form>
  )
}
