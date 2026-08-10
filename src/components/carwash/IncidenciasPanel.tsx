'use client'

/**
 * App Car Wash · Fase 2 — incidencias, daños y rewash.
 *
 * EL KPI QUE MANDA ES LA TASA DE REWASH. Todo lo demás de esta pantalla es
 * gestión de casos; ese número es el que dice si la pista está haciendo bien
 * el trabajo la primera vez. Por eso va arriba y en grande.
 *
 * "Mandar a repetir" crea una entrada NUEVA en la cola en vez de reabrir la
 * vieja: el rewash consume bahía, minutos y químicos como cualquier otro
 * trabajo, y esconderlo dentro de la orden original borraría ese costo.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  registrarIncidencia,
  resolverIncidencia,
  ordenarRewash,
  type Fase2State,
} from '@/modules/carwash/fase2-actions'
import {
  INCIDENCIA_TIPOS,
  INCIDENCIA_TIPO_LABELS,
  INCIDENCIA_ESTADOS,
  INCIDENCIA_ESTADO_LABELS,
  GRAVEDADES,
  GRAVEDAD_LABELS,
  type IncidenciaTipo,
  type IncidenciaEstado,
  type Gravedad,
  type PanelIncidencias,
} from '@/modules/carwash/incidencias'

const initial: Fase2State = {}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

const CHIP_ESTADO: Record<string, string> = {
  ABIERTA: 'bg-destructive/10 text-destructive',
  EN_PROCESO: 'bg-warning/15 text-warning',
  RESUELTA: 'bg-success/15 text-success',
}

const CHIP_GRAVEDAD: Record<string, string> = {
  ALTA: 'bg-destructive/10 text-destructive',
  MEDIA: 'bg-warning/15 text-warning',
  BAJA: 'bg-muted text-muted-foreground',
}

export interface EntregadoOpcion {
  id: string
  placa: string | null
  descripcion: string | null
  cliente: string | null
  entregadoAt: Date | null
}

export function IncidenciasPanel({
  panel,
  entregados,
}: {
  panel: PanelIncidencias
  entregados: EntregadoOpcion[]
}) {
  return (
    <div className="space-y-6">
      {/* ── El número que importa ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Tasa de rewash"
          valor={panel.kpis.tasaRewash == null ? '—' : `${panel.kpis.tasaRewash}%`}
          pie="trabajos repetidos"
          destacar
        />
        <Kpi label="Abiertas" valor={String(panel.kpis.abiertas)} pie="sin resolver, de siempre" />
        <Kpi label="Del período" valor={String(panel.kpis.delPeriodo)} pie="incidencias nuevas" />
        <Kpi label="Costo asumido" valor={fmtRD(panel.kpis.costo)} pie="reposiciones y regalos" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Registrar entregados={entregados} />

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Incidencias
          </h2>
          {panel.filas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              <ShieldAlert className="mx-auto mb-2 h-7 w-7 opacity-40" />
              Sin incidencias en este período. Registrar hasta las pequeñas es lo que hace que la
              tasa de rewash signifique algo.
            </p>
          ) : (
            <div className="space-y-3">
              {panel.filas.map((f) => (
                <Fila key={f.id} f={f} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({
  label,
  valor,
  pie,
  destacar,
}: {
  label: string
  valor: string
  pie: string
  destacar?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destacar ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </div>
  )
}

function Registrar({ entregados }: { entregados: EntregadoOpcion[] }) {
  const [state, formAction, pending] = useActionState(registrarIncidencia, initial)
  const [tipo, setTipo] = useState<string>('REWASH')

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  return (
    <form
      action={formAction}
      className="h-fit space-y-3 rounded-2xl border border-border/70 bg-card p-5"
    >
      <h2 className="text-sm font-bold text-foreground">Registrar incidencia</h2>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Qué pasó</span>
        <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
          {INCIDENCIA_TIPOS.map((t) => (
            <option key={t} value={t}>
              {INCIDENCIA_TIPO_LABELS[t as IncidenciaTipo]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Vehículo entregado
        </span>
        <select name="colaId" className={input} defaultValue="">
          <option value="">— No está en la lista —</option>
          {entregados.map((e) => (
            <option key={e.id} value={e.id}>
              {[e.placa, e.cliente, e.entregadoAt ? fmtFecha(e.entregadoAt) : null]
                .filter(Boolean)
                .join(' · ')}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          O escribe la placa
        </span>
        <input name="placa" maxLength={20} className={`${input} font-mono uppercase`} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Gravedad</span>
          <select name="gravedad" defaultValue="MEDIA" className={input}>
            {GRAVEDADES.map((g) => (
              <option key={g} value={g}>
                {GRAVEDAD_LABELS[g as Gravedad]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Costo (RD$)</span>
          <input name="costo" inputMode="decimal" placeholder="Opcional" className={input} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Descripción</span>
        <textarea
          name="descripcion"
          required
          rows={3}
          maxLength={1000}
          placeholder="Quedó sucio el interior del lado del pasajero…"
          className="w-full rounded-xl border border-input bg-background p-3 text-sm"
        />
      </label>

      {tipo === 'REWASH' && (
        <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          Después de registrarla, el botón <b>Repetir trabajo</b> devuelve el vehículo a la cola
          como una entrada nueva. Así el tiempo de pista que cuesta repetirlo queda contado.
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
      </Button>
    </form>
  )
}

function Fila({ f }: { f: PanelIncidencias['filas'][number] }) {
  const [state, formAction, pending] = useActionState(resolverIncidencia, initial)
  const [abiertoManual, setAbiertoManual] = useState(false)

  // El formulario se cierra solo cuando la incidencia queda RESUELTA, derivado
  // del dato revalidado. Cerrarlo desde el efecto de la respuesta encadenaba
  // un render extra por cada guardado.
  const abierto = abiertoManual && f.estado !== 'RESUELTA'

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {INCIDENCIA_TIPO_LABELS[f.tipo as IncidenciaTipo] ?? f.tipo}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                CHIP_ESTADO[f.estado] ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {INCIDENCIA_ESTADO_LABELS[f.estado as IncidenciaEstado] ?? f.estado}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                CHIP_GRAVEDAD[f.gravedad] ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {GRAVEDAD_LABELS[f.gravedad as Gravedad] ?? f.gravedad}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[f.placa, f.cliente, fmtFecha(f.fecha), f.reportadaPor && `por ${f.reportadaPor}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-2 text-sm text-foreground">{f.descripcion}</p>
          {f.resolucion && (
            <p className="mt-1 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
              <b>Resolución:</b> {f.resolucion}
            </p>
          )}
          {f.costo != null && f.costo > 0 && (
            <p className="mt-1 text-xs font-semibold text-foreground">Costó {fmtRD(f.costo)}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          {f.tipo === 'REWASH' && !f.tieneRewash && f.estado !== 'RESUELTA' && (
            <BotonRewash id={f.id} />
          )}
          {f.tieneRewash && (
            <span className="rounded-lg bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
              En la cola para repetir
            </span>
          )}
          {f.estado !== 'RESUELTA' && (
            <Button size="sm" variant="ghost" onClick={() => setAbiertoManual((v) => !v)}>
              {abierto ? 'Cerrar' : 'Actualizar'}
            </Button>
          )}
        </div>
      </div>

      {abierto && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <input type="hidden" name="id" value={f.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="estado" defaultValue={f.estado} className={input}>
              {INCIDENCIA_ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {INCIDENCIA_ESTADO_LABELS[e as IncidenciaEstado]}
                </option>
              ))}
            </select>
            <input
              name="costo"
              inputMode="decimal"
              defaultValue={f.costo ?? ''}
              placeholder="Costo asumido (RD$)"
              className={input}
            />
          </div>
          <textarea
            name="resolucion"
            rows={2}
            maxLength={1000}
            defaultValue={f.resolucion ?? ''}
            placeholder="Qué se hizo"
            className="w-full rounded-xl border border-input bg-background p-3 text-sm"
          />
          <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </Button>
        </form>
      )}
    </div>
  )
}

function BotonRewash({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      className="gap-1.5"
      onClick={() =>
        start(async () => {
          const r = await ordenarRewash(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      Repetir trabajo
    </Button>
  )
}
