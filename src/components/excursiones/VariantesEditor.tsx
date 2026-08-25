'use client'

/**
 * Variantes de la excursión (§15): individual, doble, VIP… cada una con sus
 * precios. Quitar una variante con reservas la DESACTIVA (histórico intacto);
 * la última no se quita nunca — toda excursión necesita su precio.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, X, Trash2, Clock } from 'lucide-react'
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
  preciosDinamicosJson?: string
}

// ── Editor interactivo de precios dinámicos ──────────────────────────────────

interface ReglaUI {
  diasSemana: number[]
  horas: string[]
  precioAdulto: string
  precioNino: string
}

const DIAS = [
  { iso: 1, label: 'L' },
  { iso: 2, label: 'M' },
  { iso: 3, label: 'X' },
  { iso: 4, label: 'J' },
  { iso: 5, label: 'V' },
  { iso: 6, label: 'S' },
  { iso: 7, label: 'D' },
] as const

function parsearReglasDesdeJson(json?: string): ReglaUI[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.map((r: any) => ({
      diasSemana: Array.isArray(r.diasSemana) ? r.diasSemana : [],
      horas: Array.isArray(r.horasSalida) ? r.horasSalida.map(String) : [],
      precioAdulto: r.precioAdulto != null ? String(r.precioAdulto) : '',
      precioNino: r.precioNino != null ? String(r.precioNino) : '',
    }))
  } catch {
    return []
  }
}

function reglasAJson(reglas: ReglaUI[]): string {
  if (reglas.length === 0) return ''
  const salida = reglas.map((r) => ({
    diasSemana: r.diasSemana,
    horasSalida: r.horas.filter(Boolean),
    precioAdulto: Number(r.precioAdulto) || 0,
    precioNino: r.precioNino ? Number(r.precioNino) : null,
  }))
  return JSON.stringify(salida)
}

function EditorPreciosDinamicos({ defaultValue, horariosDisponibles = [] }: { defaultValue?: string; horariosDisponibles?: string[] }) {
  const [reglas, setReglas] = useState<ReglaUI[]>(() => parsearReglasDesdeJson(defaultValue))

  const agregar = () =>
    setReglas((prev) => [...prev, { diasSemana: [], horas: [], precioAdulto: '', precioNino: '' }])

  const eliminar = (idx: number) => setReglas((prev) => prev.filter((_, i) => i !== idx))

  const actualizar = (idx: number, cambios: Partial<ReglaUI>) =>
    setReglas((prev) => prev.map((r, i) => (i === idx ? { ...r, ...cambios } : r)))

  const toggleDia = (idx: number, dia: number) =>
    setReglas((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        const tiene = r.diasSemana.includes(dia)
        return { ...r, diasSemana: tiene ? r.diasSemana.filter((d) => d !== dia) : [...r.diasSemana, dia].sort() }
      })
    )

  const toggleHora = (reglaIdx: number, hora: string) =>
    setReglas((prev) =>
      prev.map((r, i) => {
        if (i !== reglaIdx) return r
        const tiene = r.horas.includes(hora)
        return { ...r, horas: tiene ? r.horas.filter((h) => h !== hora) : [...r.horas, hora].sort() }
      })
    )
  return (
    <div className="space-y-2">
      <input type="hidden" name="preciosDinamicosJson" value={reglasAJson(reglas)} />
      <div className="flex items-center justify-between">
        <Label className="text-sm">Precios por día / hora</Label>
        <button
          type="button"
          onClick={agregar}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" /> Añadir regla
        </button>
      </div>

      {reglas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin reglas — se usa el precio base.</p>
      ) : (
        reglas.map((regla, idx) => (
          <div
            key={idx}
            className="space-y-2 rounded-lg border border-border bg-background p-3"
          >
            {/* Fila 1: Días de la semana */}
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Días de la semana</span>
              <div className="flex gap-1">
                {DIAS.map((d) => {
                  const activo = regla.diasSemana.includes(d.iso)
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => toggleDia(idx, d.iso)}
                      className={`h-8 w-8 rounded-md text-xs font-semibold transition-colors ${
                        activo
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-muted text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
              {regla.diasSemana.length === 0 && (
                <span className="mt-1 block text-[11px] text-muted-foreground">Vacío = todos los días</span>
              )}
            </div>

            {/* Fila 2: Horas de salida */}
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Horas de salida</span>
              {horariosDisponibles.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">No hay horarios configurados — aplica a cualquier hora</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {horariosDisponibles.map((h) => {
                    const activo = regla.horas.includes(h)
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => toggleHora(idx, h)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                          activo
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-muted text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        {h}
                      </button>
                    )
                  })}
                </div>
              )}
              {regla.horas.length === 0 && horariosDisponibles.length > 0 && (
                <span className="mt-1 block text-[11px] text-muted-foreground">Ninguna seleccionada = todas las horas</span>
              )}
            </div>

            {/* Fila 3: Precios + Eliminar regla */}
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Adulto *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={regla.precioAdulto}
                  onChange={(e) => actualizar(idx, { precioAdulto: e.target.value })}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Niño</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={regla.precioNino}
                  onChange={(e) => actualizar(idx, { precioNino: e.target.value })}
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => eliminar(idx)}
                  className="mb-0.5 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                  title="Eliminar regla"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Quitar regla
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function FormVariante({
  excursionId,
  variante,
  onCerrar,
  horariosDisponibles = [],
}: {
  excursionId: string
  variante?: VarianteFila
  onCerrar: () => void
  horariosDisponibles?: string[]
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
      <EditorPreciosDinamicos defaultValue={variante?.preciosDinamicosJson} horariosDisponibles={horariosDisponibles} />
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
  horariosDisponibles = [],
}: {
  excursionId: string
  moneda: string
  variantes: VarianteFila[]
  horariosDisponibles?: string[]
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
            <FormVariante key={v.id} excursionId={excursionId} variante={v} onCerrar={() => setEditando(null)} horariosDisponibles={horariosDisponibles} />
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
