'use client'

/**
 * Poner una meta. Todas las cifras son opcionales salvo que haya al menos una:
 * a un promotor se le pide captar, a un hotel vender — pedirles lo mismo a los
 * dos sería llenar su pantalla de barras que no significan nada.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearMeta, type MetaActionState } from '@/modules/excursiones/metricas/actions'
import {
  PERIODOS_META,
  PERIODO_META_LABEL,
  type PeriodoMeta,
} from '@/modules/excursiones/metricas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: MetaActionState = {}

export function MetaForm({
  vendedores,
}: {
  vendedores: { id: string; nombre: string; codigo: string }[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearMeta, init)
  const [periodo, setPeriodo] = useState<PeriodoMeta>('MENSUAL')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  if (vendedores.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Para poner metas necesitas al menos un vendedor activo.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Nueva meta</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="meta-vendedor">Vendedor *</Label>
          <select
            id="meta-vendedor"
            name="vendedorId"
            required
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">Elige el vendedor…</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.nombre} ({v.codigo})</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="meta-periodo">Período</Label>
          <select
            id="meta-periodo"
            name="periodo"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as PeriodoMeta)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {PERIODOS_META.map((p) => (
              <option key={p} value={p}>{PERIODO_META_LABEL[p]}</option>
            ))}
          </select>
        </div>
      </div>

      {periodo === 'RANGO' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="meta-desde">Desde *</Label>
            <Input id="meta-desde" name="desde" type="date" required />
          </div>
          <div>
            <Label htmlFor="meta-hasta">Hasta *</Label>
            <Input id="meta-hasta" name="hasta" type="date" required />
          </div>
        </div>
      ) : null}

      <fieldset className="rounded-xl border border-border p-3">
        <legend className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          Qué se le pide (al menos una)
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="meta-registros">Clientes captados</Label>
            <Input id="meta-registros" name="metaRegistros" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-reservas">Reservas</Label>
            <Input id="meta-reservas" name="metaReservas" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-ventas">Ventas</Label>
            <Input id="meta-ventas" name="metaVentas" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-pasajeros">Pasajeros</Label>
            <Input id="meta-pasajeros" name="metaPasajeros" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-ingresos">Ingresos</Label>
            <Input id="meta-ingresos" name="metaIngresos" type="number" min="1" step="0.01" placeholder="—" />
          </div>
        </div>
      </fieldset>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Crear meta
      </Button>
    </form>
  )
}
