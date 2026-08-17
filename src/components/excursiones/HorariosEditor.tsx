'use client'

/**
 * Horarios de salida (§14): qué días sale y a qué hora, con cupo opcional por
 * salida. Es agenda, no histórico financiero: los horarios sí se eliminan.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarHorario,
  eliminarHorario,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import { DIAS_SEMANA } from '@/modules/excursiones/catalogo/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: CatalogoActionState = {}

export interface HorarioFila {
  id: string
  diasSemana: unknown
  horaSalida: string
  cupo: number | null
}

function diasDe(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map(Number).filter((n) => n >= 1 && n <= 7) : []
}

function etiquetaDias(raw: unknown): string {
  const dias = diasDe(raw)
  if (dias.length === 7) return 'Todos los días'
  return DIAS_SEMANA.filter((d) => dias.includes(d.n)).map((d) => d.label).join(', ') || '—'
}

function FormHorario({
  excursionId,
  horario,
  onCerrar,
}: {
  excursionId: string
  horario?: HorarioFila
  onCerrar: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(guardarHorario, init)
  const idBase = horario?.id ?? 'nuevo'
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
      {horario ? <input type="hidden" name="horarioId" value={horario.id} /> : null}
      <div>
        <p className="text-sm font-medium text-foreground">Días de salida *</p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {DIAS_SEMANA.map((d) => (
            <label key={d.n} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                name="dias"
                value={d.n}
                defaultChecked={horario ? diasDe(horario.diasSemana).includes(d.n) : false}
                className="h-4 w-4 accent-primary"
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`hor-hora-${idBase}`}>Hora de salida *</Label>
          <Input id={`hor-hora-${idBase}`} name="horaSalida" type="time" defaultValue={horario?.horaSalida ?? ''} required />
        </div>
        <div>
          <Label htmlFor={`hor-cupo-${idBase}`}>Cupo de esta salida</Label>
          <Input id={`hor-cupo-${idBase}`} name="cupo" type="number" min="1" defaultValue={horario?.cupo ?? ''} placeholder="El de la excursión" />
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

function QuitarHorario({ excursionId, horarioId }: { excursionId: string; horarioId: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(eliminarHorario, init)
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
      <input type="hidden" name="horarioId" value={horarioId} />
      <button
        type="submit"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Eliminar horario"
        title="Eliminar horario"
      >
        <X className="h-4 w-4" />
      </button>
    </form>
  )
}

export function HorariosEditor({
  excursionId,
  horarios,
}: {
  excursionId: string
  horarios: HorarioFila[]
}) {
  const [editando, setEditando] = useState<string | 'nuevo' | null>(null)

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Horarios de salida</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        Qué días sale y a qué hora. El cupo por salida es opcional.
      </p>
      <div className="mt-3 space-y-2">
        {horarios.map((h) =>
          editando === h.id ? (
            <FormHorario key={h.id} excursionId={excursionId} horario={h} onCerrar={() => setEditando(null)} />
          ) : (
            <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{h.horaSalida}</p>
                <p className="text-sm text-muted-foreground">
                  {etiquetaDias(h.diasSemana)}
                  {h.cupo ? ` · Cupo ${h.cupo}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditando(h.id)}
                  className="text-muted-foreground hover:text-primary"
                  aria-label={`Editar salida de ${h.horaSalida}`}
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <QuitarHorario excursionId={excursionId} horarioId={h.id} />
              </div>
            </div>
          )
        )}
        {editando === 'nuevo' ? (
          <FormHorario excursionId={excursionId} onCerrar={() => setEditando(null)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditando('nuevo')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary"
          >
            <Plus className="h-4 w-4" /> Agregar horario
          </button>
        )}
      </div>
    </section>
  )
}
