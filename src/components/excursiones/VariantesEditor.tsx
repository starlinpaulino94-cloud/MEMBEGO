'use client'

/**
 * Variantes de la excursión (§15): individual, doble, VIP… cada una con sus
 * precios. Quitar una variante con reservas la DESACTIVA (histórico intacto);
 * la última no se quita nunca — toda excursión necesita su precio.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarVariante,
  eliminarVariante,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusChip } from '@/components/ui/status-chip'

const init: CatalogoActionState = {}

export interface VarianteFila {
  id: string
  nombre: string
  precioAdulto: string
  precioNino: string | null
  precioResidente: string | null
  precioTurista: string | null
  capacidad: number | null
  activa: boolean
}

function FormVariante({
  excursionId,
  variante,
  onCerrar,
}: {
  excursionId: string
  variante?: VarianteFila
  onCerrar: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(guardarVariante, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onCerrar()
    }
  }, [state, router, onCerrar])

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-dashed border-primary/40 bg-muted/40 p-3">
      <input type="hidden" name="excursionId" value={excursionId} />
      {variante ? <input type="hidden" name="varianteId" value={variante.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`var-nombre-${variante?.id ?? 'nueva'}`}>Nombre *</Label>
          <Input id={`var-nombre-${variante?.id ?? 'nueva'}`} name="nombre" defaultValue={variante?.nombre ?? ''} placeholder="Doble, Familiar, VIP…" required />
        </div>
        <div>
          <Label htmlFor={`var-cap-${variante?.id ?? 'nueva'}`}>Capacidad</Label>
          <Input id={`var-cap-${variante?.id ?? 'nueva'}`} name="capacidad" type="number" min="1" defaultValue={variante?.capacidad ?? ''} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor={`var-pa-${variante?.id ?? 'nueva'}`}>Adulto *</Label>
          <Input id={`var-pa-${variante?.id ?? 'nueva'}`} name="precioAdulto" type="number" min="0.01" step="0.01" defaultValue={variante?.precioAdulto ?? ''} required />
        </div>
        <div>
          <Label htmlFor={`var-pn-${variante?.id ?? 'nueva'}`}>Niño</Label>
          <Input id={`var-pn-${variante?.id ?? 'nueva'}`} name="precioNino" type="number" min="0" step="0.01" defaultValue={variante?.precioNino ?? ''} />
        </div>
        <div>
          <Label htmlFor={`var-pr-${variante?.id ?? 'nueva'}`}>Residente</Label>
          <Input id={`var-pr-${variante?.id ?? 'nueva'}`} name="precioResidente" type="number" min="0" step="0.01" defaultValue={variante?.precioResidente ?? ''} />
        </div>
        <div>
          <Label htmlFor={`var-pt-${variante?.id ?? 'nueva'}`}>Turista</Label>
          <Input id={`var-pt-${variante?.id ?? 'nueva'}`} name="precioTurista" type="number" min="0" step="0.01" defaultValue={variante?.precioTurista ?? ''} />
        </div>
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function QuitarVariante({ excursionId, varianteId }: { excursionId: string; varianteId: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(eliminarVariante, init)
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])
  return (
    <form action={formAction}>
      <input type="hidden" name="excursionId" value={excursionId} />
      <input type="hidden" name="varianteId" value={varianteId} />
      <button
        type="submit"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Quitar variante"
        title="Quitar variante"
      >
        <X className="h-4 w-4" />
      </button>
    </form>
  )
}

export function VariantesEditor({
  excursionId,
  moneda,
  variantes,
}: {
  excursionId: string
  moneda: string
  variantes: VarianteFila[]
}) {
  const [editando, setEditando] = useState<string | 'nueva' | null>(null)

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Variantes y precios</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        Precios en {moneda}. Cada variante puede tener su capacidad y sus tarifas.
      </p>
      <div className="mt-3 space-y-2">
        {variantes.map((v) =>
          editando === v.id ? (
            <FormVariante key={v.id} excursionId={excursionId} variante={v} onCerrar={() => setEditando(null)} />
          ) : (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-foreground">
                  {v.nombre}
                  {!v.activa ? <StatusChip tone="neutral">Desactivada</StatusChip> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  Adulto {v.precioAdulto}
                  {v.precioNino ? ` · Niño ${v.precioNino}` : ''}
                  {v.capacidad ? ` · Cupo ${v.capacidad}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditando(v.id)}
                  className="text-muted-foreground hover:text-primary"
                  aria-label={`Editar ${v.nombre}`}
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <QuitarVariante excursionId={excursionId} varianteId={v.id} />
              </div>
            </div>
          )
        )}
        {editando === 'nueva' ? (
          <FormVariante excursionId={excursionId} onCerrar={() => setEditando(null)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditando('nueva')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary"
          >
            <Plus className="h-4 w-4" /> Agregar variante
          </button>
        )}
      </div>
    </section>
  )
}
