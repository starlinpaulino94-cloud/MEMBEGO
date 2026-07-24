'use client'

/**
 * Plataforma modular · E4 — panel de capacidades de UNA empresa (superadmin).
 * Muestra cada capacidad con su estado efectivo; lo no tocado sigue al
 * paquete base de la categoría (solo se guardan las diferencias).
 */

import { useActionState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  guardarCapacidades,
  type CapacidadesActionState,
} from '@/modules/capacidades/actions'
import {
  CAPACIDADES,
  CAPACIDAD_LABELS,
  CATEGORIAS,
  CATEGORIA_LABELS,
  type Capacidad,
  type CategoriaNegocio,
} from '@/modules/capacidades/catalogo'

const init: CapacidadesActionState = {}

export function CapacidadesPanel({
  companyId,
  categoria,
  activas,
}: {
  companyId: string
  categoria: CategoriaNegocio
  /** Estado EFECTIVO actual (base + overrides) para precargar los toggles. */
  activas: Capacidad[]
}) {
  const [state, action, pending] = useActionState(guardarCapacidades, init)
  const activasSet = new Set(activas)

  useEffect(() => {
    if (state.success) toast.success(state.success)
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="companyId" value={companyId} />

      <label className="block max-w-xs space-y-1.5 text-sm font-medium text-foreground">
        Categoría del negocio
        <select
          name="categoria"
          defaultValue={categoria}
          className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {CATEGORIA_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="block text-xs font-normal text-muted-foreground">
          Define el paquete base de capacidades. Solo Car Wash está operativa.
        </span>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {CAPACIDADES.map((cap) => (
          <label
            key={cap}
            className="flex items-start gap-3 rounded-xl border border-border/60 p-3 text-sm"
          >
            <input
              type="checkbox"
              name={`cap_${cap}`}
              defaultChecked={activasSet.has(cap)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <span className="font-medium text-foreground">{CAPACIDAD_LABELS[cap]}</span>
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                {cap}
              </span>
            </span>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Los cambios aplican de inmediato (menús, launchpad y barreras de servidor).
        Apagar una capacidad bloquea también sus acciones en el servidor, no solo la
        esconde.
      </p>

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Guardar capacidades
      </Button>
    </form>
  )
}
