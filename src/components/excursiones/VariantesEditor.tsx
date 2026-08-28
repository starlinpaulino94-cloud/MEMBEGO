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
import { SugerenciasReglas } from '@/components/excursiones/SugerenciasReglas'
import { CalendarioPreviewPrecios } from '@/components/excursiones/CalendarioPreviewPrecios'

const init: CatalogoActionState = {}

export interface VarianteFila {
  id: string
  nombre: string
  precioAdulto: string
  precioNino: string | null
  precioResidente: string | null
  precioNinoResidente: string | null
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
  precioResidente: string
  precioNinoResidente: string
  gratisAdulto: boolean
  gratisNino: boolean
  gratisResidente: boolean
  gratisNinoResidente: boolean
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
    // Sale de `JSON.parse`: la forma no está garantizada. `unknown` obliga a
    // comprobar cada campo antes de leerlo, que es lo que este bloque ya hacía.
    return arr.map((crudo: unknown) => {
      const r = (crudo ?? {}) as Record<string, unknown>
      return {
        diasSemana: Array.isArray(r.diasSemana) ? (r.diasSemana as number[]) : [],
        horas: Array.isArray(r.horasSalida) ? r.horasSalida.map(String) : [],
        precioAdulto: r.precioAdulto != null ? String(r.precioAdulto) : '',
        precioNino: r.precioNino != null ? String(r.precioNino) : '',
        precioResidente: r.precioResidente != null ? String(r.precioResidente) : '',
        precioNinoResidente: r.precioNinoResidente != null ? String(r.precioNinoResidente) : '',
        gratisAdulto: r.precioAdulto === 0,
        gratisNino: r.precioNino === 0,
        gratisResidente: r.precioResidente === 0,
        gratisNinoResidente: r.precioNinoResidente === 0,
      }
    })
  } catch {
    return []
  }
}

function reglasAJson(reglas: ReglaUI[]): string {
  if (reglas.length === 0) return ''
  const salida = reglas.map((r) => ({
    diasSemana: r.diasSemana,
    horasSalida: r.horas.filter(Boolean),
    precioAdulto: r.gratisAdulto ? 0 : (Number(r.precioAdulto) || 0),
    precioNino: r.gratisNino ? 0 : (r.precioNino ? Number(r.precioNino) : null),
    precioResidente: r.gratisResidente ? 0 : (r.precioResidente ? Number(r.precioResidente) : null),
    precioNinoResidente: r.gratisNinoResidente ? 0 : (r.precioNinoResidente ? Number(r.precioNinoResidente) : null),
  }))
  return JSON.stringify(salida)
}

function EditorPreciosDinamicos({
  defaultValue,
  horariosDisponibles = [],
  precioBaseAdulto = 0,
  precioBaseNino = null,
  precioBaseResidente = null,
  precioBaseNinoResidente = null,
  moneda = 'DOP',
}: {
  defaultValue?: string
  horariosDisponibles?: string[]
  precioBaseAdulto?: number
  precioBaseNino?: number | null
  precioBaseResidente?: number | null
  precioBaseNinoResidente?: number | null
  moneda?: string
}) {
  const [reglas, setReglas] = useState<ReglaUI[]>(() => parsearReglasDesdeJson(defaultValue))

  const agregar = () =>
    setReglas((prev) => [...prev, { diasSemana: [], horas: [], precioAdulto: '', precioNino: '', precioResidente: '', precioNinoResidente: '', gratisAdulto: false, gratisNino: false, gratisResidente: false, gratisNinoResidente: false }])

  const eliminar = (idx: number) => setReglas((prev) => prev.filter((_, i) => i !== idx))

  const agregarDesdeSugerencia = (regla: { diasSemana: number[]; horas: string[]; precioAdulto: string; precioNino: string; precioResidente: string; precioNinoResidente: string }) =>
    setReglas((prev) => [...prev, { ...regla, gratisAdulto: false, gratisNino: false, gratisResidente: false, gratisNinoResidente: false }])

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

  const toggleHora = (idx: number, hora: string) =>
    setReglas((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        const tiene = r.horas.includes(hora)
        return { ...r, horas: tiene ? r.horas.filter((h) => h !== hora) : [...r.horas, hora].sort() }
      })
    )

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-background/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span>Precios Dinámicos por Día y Turno (Opcional)</span>
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={agregar}>
          <Plus className="mr-1 h-3 w-3" /> Agregar Regla
        </Button>
      </div>

      <input type="hidden" name="preciosDinamicosJson" value={reglasAJson(reglas)} />

      <SugerenciasReglas
        precioBaseAdulto={precioBaseAdulto}
        precioBaseNino={precioBaseNino}
        precioBaseResidente={precioBaseResidente}
        precioBaseNinoResidente={precioBaseNinoResidente}
        horariosDisponibles={horariosDisponibles}
        onAplicar={agregarDesdeSugerencia}
      />

      {reglas.length === 0 ? (
        <p className="text-caption text-muted-foreground italic">
          No hay reglas específicas. Se aplicarán las tarifas base configuradas arriba.
        </p>
      ) : (
        <div className="space-y-3">
          {reglas.map((r, idx) => (
            <div key={idx} className="relative rounded-lg border bg-card p-3 shadow-2xs space-y-3">
              <button
                type="button"
                onClick={() => eliminar(idx)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">1. Días de la semana</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {DIAS.map((d) => {
                    const sel = r.diasSemana.includes(d.iso)
                    return (
                      <button
                        key={d.iso}
                        type="button"
                        onClick={() => toggleDia(idx, d.iso)}
                        className={`h-6 w-6 rounded text-xs font-bold transition ${
                          sel ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {horariosDisponibles.length > 0 && (
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    2. Turnos aplicables
                  </Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {horariosDisponibles.map((h) => {
                      const sel = r.horas.includes(h)
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => toggleHora(idx, h)}
                          title={sel ? `Turno ${h} activo — clic para desactivar` : `Activar turno ${h}`}
                          className={`rounded px-1.5 py-0.5 text-xs font-semibold transition ${
                            sel ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent'
                          }`}
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {h}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-muted-foreground">Turista Adulto *</Label>
                      <button
                        type="button"
                        onClick={() => {
                          const nuevoGratis = !r.gratisAdulto
                          actualizar(idx, {
                            gratisAdulto: nuevoGratis,
                            precioAdulto: nuevoGratis ? '0' : '',
                          })
                        }}
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded transition ${r.gratisAdulto ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      >
                        {r.gratisAdulto ? '✓ Gratis' : 'Gratis'}
                      </button>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Ej.: 90"
                      className="h-8 text-xs"
                      value={r.precioAdulto}
                      disabled={r.gratisAdulto}
                      onChange={(e) => actualizar(idx, { precioAdulto: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-muted-foreground">Turista Niño</Label>
                      <button
                        type="button"
                        onClick={() => {
                          const nuevoGratis = !r.gratisNino
                          actualizar(idx, {
                            gratisNino: nuevoGratis,
                            precioNino: nuevoGratis ? '0' : '',
                          })
                        }}
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded transition ${r.gratisNino ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      >
                        {r.gratisNino ? '✓ Gratis' : 'Gratis'}
                      </button>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Ej.: 45"
                      className="h-8 text-xs"
                      value={r.precioNino}
                      disabled={r.gratisNino}
                      onChange={(e) => actualizar(idx, { precioNino: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-success">Residente Adulto</Label>
                      <button
                        type="button"
                        onClick={() => {
                          const nuevoGratis = !r.gratisResidente
                          actualizar(idx, {
                            gratisResidente: nuevoGratis,
                            precioResidente: nuevoGratis ? '0' : '',
                          })
                        }}
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded transition ${r.gratisResidente ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      >
                        {r.gratisResidente ? '✓ Gratis' : 'Gratis'}
                      </button>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Opcional"
                      className="h-8 text-xs border-success/30"
                      value={r.precioResidente}
                      disabled={r.gratisResidente}
                      onChange={(e) => actualizar(idx, { precioResidente: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-success">Residente Niño</Label>
                      <button
                        type="button"
                        onClick={() => {
                          const nuevoGratis = !r.gratisNinoResidente
                          actualizar(idx, {
                            gratisNinoResidente: nuevoGratis,
                            precioNinoResidente: nuevoGratis ? '0' : '',
                          })
                        }}
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded transition ${r.gratisNinoResidente ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      >
                        {r.gratisNinoResidente ? '✓ Gratis' : 'Gratis'}
                      </button>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Opcional"
                      className="h-8 text-xs border-success/30"
                      value={r.precioNinoResidente}
                      disabled={r.gratisNinoResidente}
                      onChange={(e) => actualizar(idx, { precioNinoResidente: e.target.value })}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground italic">
                  Si los campos de residente se dejan vacíos, se usan los precios base de la variante.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {reglas.length > 0 && (
        <CalendarioPreviewPrecios
          reglas={reglas.map((r) => ({
            diasSemana: r.diasSemana,
            horasSalida: r.horas,
            precioAdulto: Number(r.precioAdulto) || precioBaseAdulto,
            precioNino: r.precioNino ? Number(r.precioNino) : precioBaseNino,
            precioResidente: r.precioResidente ? Number(r.precioResidente) : precioBaseResidente,
            precioNinoResidente: r.precioNinoResidente ? Number(r.precioNinoResidente) : precioBaseNinoResidente,
          }))}
          precioBaseAdulto={precioBaseAdulto}
          precioBaseNino={precioBaseNino}
          precioBaseResidente={precioBaseResidente}
          precioBaseNinoResidente={precioBaseNinoResidente}
          moneda={moneda}
        />
      )}
    </div>
  )
}

function FormVariante({
  excursionId,
  variante,
  onCerrar,
  horariosDisponibles = [],
  moneda = 'DOP',
}: {
  excursionId: string
  variante?: VarianteFila
  onCerrar: () => void
  horariosDisponibles?: string[]
  moneda?: string
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
    <form action={formAction} className="space-y-4 rounded-xl border border-dashed border-primary/40 bg-muted/40 p-4">
      <input type="hidden" name="excursionId" value={excursionId} />
      {variante ? <input type="hidden" name="varianteId" value={variante.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`var-nombre-${variante?.id ?? 'nueva'}`}>Nombre de la variante *</Label>
          <Input
            id={`var-nombre-${variante?.id ?? 'nueva'}`}
            name="nombre"
            defaultValue={variante?.nombre ?? ''}
            placeholder="Estándar, VIP, Familiar, Pareja…"
            className="mt-1"
            required
          />
        </div>
        <div>
          <Label htmlFor={`var-cap-${variante?.id ?? 'nueva'}`}>Cupo límite por salida (opcional)</Label>
          <Input
            id={`var-cap-${variante?.id ?? 'nueva'}`}
            name="capacidad"
            type="number"
            min="1"
            defaultValue={variante?.capacidad ?? ''}
            placeholder="Ej.: 15 cupos"
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Tarifas Turistas */}
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
          <div className="flex items-center justify-between border-b pb-1.5">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>🌍</span> Tarifa Turistas / General
            </span>
            <span className="text-xs font-semibold text-primary">Principal</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label htmlFor={`var-pa-${variante?.id ?? 'nueva'}`} className="text-xs">Adulto *</Label>
              <Input
                id={`var-pa-${variante?.id ?? 'nueva'}`}
                name="precioAdulto"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={variante?.precioAdulto ?? ''}
                placeholder="80.00"
                className="mt-1 h-9 text-xs font-bold"
                required
              />
            </div>
            <div>
              <Label htmlFor={`var-pn-${variante?.id ?? 'nueva'}`} className="text-xs">Niño</Label>
              <Input
                id={`var-pn-${variante?.id ?? 'nueva'}`}
                name="precioNino"
                type="number"
                min="0"
                step="0.01"
                defaultValue={variante?.precioNino ?? ''}
                placeholder="40.00"
                className="mt-1 h-9 text-xs font-medium"
              />
            </div>
          </div>
        </div>

        {/* Tarifas Residentes */}
        <div className="rounded-xl border border-success/25 bg-success/5 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between border-b border-success/20 pb-1.5">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>🇩🇴</span> Tarifa Residentes / Locales
            </span>
            <span className="text-xs font-semibold text-success">Preferencial</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label htmlFor={`var-pr-${variante?.id ?? 'nueva'}`} className="text-xs">Adulto</Label>
              <Input
                id={`var-pr-${variante?.id ?? 'nueva'}`}
                name="precioResidente"
                type="number"
                min="0"
                step="0.01"
                defaultValue={variante?.precioResidente ?? ''}
                placeholder="50.00"
                className="mt-1 h-9 text-xs font-bold"
              />
            </div>
            <div>
              <Label htmlFor={`var-pnr-${variante?.id ?? 'nueva'}`} className="text-xs">Niño</Label>
              <Input
                id={`var-pnr-${variante?.id ?? 'nueva'}`}
                name="precioNinoResidente"
                type="number"
                min="0"
                step="0.01"
                defaultValue={variante?.precioNinoResidente ?? ''}
                placeholder="25.00"
                className="mt-1 h-9 text-xs font-medium"
              />
            </div>
          </div>
        </div>
      </div>

      <EditorPreciosDinamicos
        defaultValue={variante?.preciosDinamicosJson}
        horariosDisponibles={horariosDisponibles}
        precioBaseAdulto={variante?.precioAdulto ? Number(variante.precioAdulto) : 0}
        precioBaseNino={variante?.precioNino ? Number(variante.precioNino) : null}
        precioBaseResidente={variante?.precioResidente ? Number(variante.precioResidente) : null}
        precioBaseNinoResidente={variante?.precioNinoResidente ? Number(variante.precioNinoResidente) : null}
        moneda={moneda}
      />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar Variante
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
        Precios en {moneda}. Cada variante puede tener tarifas diferenciadas para turistas y residentes.
      </p>
      <div className="mt-3 space-y-2">
        {variantes.map((v) =>
          editando === v.id ? (
            <FormVariante key={v.id} excursionId={excursionId} variante={v} onCerrar={() => setEditando(null)} horariosDisponibles={horariosDisponibles} moneda={moneda} />
          ) : (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 hover:border-primary/30 transition">
              <div className="min-w-0 space-y-1">
                <p className="flex items-center gap-2 font-semibold text-foreground">
                  {v.nombre}
                  {!v.activa ? <StatusChip tone="neutral">Desactivada</StatusChip> : null}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground font-semibold">Turista:</strong> Ad {v.precioAdulto}
                    {v.precioNino ? ` · Ni ${v.precioNino}` : ''}
                  </span>
                  {(v.precioResidente || v.precioNinoResidente) ? (
                    <span className="text-success">
                      <strong className="font-semibold">Residente:</strong> {v.precioResidente ? `Ad ${v.precioResidente}` : ''}
                      {v.precioNinoResidente ? ` · Ni ${v.precioNinoResidente}` : ''}
                    </span>
                  ) : null}
                  {v.capacidad ? <span>· Cupo {v.capacidad}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditando(v.id)}
                  className="text-muted-foreground hover:text-primary p-1 rounded-lg hover:bg-muted transition"
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
          <FormVariante excursionId={excursionId} onCerrar={() => setEditando(null)} horariosDisponibles={horariosDisponibles} moneda={moneda} />
        ) : (
          <button
            type="button"
            onClick={() => setEditando('nueva')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5 transition"
          >
            <Plus className="h-4 w-4" /> Agregar variante
          </button>
        )}
      </div>
    </section>
  )
}
