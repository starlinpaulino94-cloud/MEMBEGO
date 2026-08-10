'use client'

/**
 * App Car Wash · Fase 3 — equipos y mantenimiento.
 *
 * LO QUE ENCABEZA LA PANTALLA ES LA PISTA PARADA, no el inventario de equipos.
 * Un car wash con dos hidrolavadoras y una dañada trabaja al 50%, y eso hoy se
 * nota como una cola que no baja — nunca como un número.
 *
 * Los equipos con mantenimiento vencido salen primero y en rojo: el valor de
 * este módulo es avisar ANTES de que el equipo pare, no llevar un inventario.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  guardarActivo,
  cambiarEstadoActivo,
  registrarMantenimiento,
  type Fase3State,
} from '@/modules/carwash/fase3-actions'
import {
  ACTIVO_ESTADOS,
  ACTIVO_ESTADO_LABELS,
  MANTENIMIENTO_TIPOS,
  MANTENIMIENTO_TIPO_LABELS,
  type ActivoEstado,
  type ActivoFila,
  type MantenimientoTipo,
  type PanelActivos,
  type UrgenciaMantenimiento,
} from '@/modules/carwash/activos'

const initial: Fase3State = {}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtFecha(d: Date | null) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(d)
  )
}

const CHIP_ESTADO: Record<string, string> = {
  OPERATIVO: 'bg-success/15 text-success',
  EN_MANTENIMIENTO: 'bg-warning/15 text-warning',
  DANADO: 'bg-destructive/10 text-destructive',
  BAJA: 'bg-muted text-muted-foreground',
}

const URGENCIA: Record<UrgenciaMantenimiento, { label: string; clase: string } | null> = {
  VENCIDO: { label: 'Mantenimiento vencido', clase: 'bg-destructive/10 text-destructive' },
  PRONTO: { label: 'Le toca pronto', clase: 'bg-warning/15 text-warning' },
  AL_DIA: null,
  SIN_PROGRAMA: null,
}

function useAviso(state: Fase3State) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export function ActivosPanel({
  panel,
  editando,
}: {
  panel: PanelActivos
  editando: ActivoFila | null
}) {
  // Vencidos primero, después los que paran la pista, después el resto. El
  // orden de la lista ES la lista de prioridades del día.
  const orden: Record<string, number> = { VENCIDO: 0, PRONTO: 1, AL_DIA: 2, SIN_PROGRAMA: 3 }
  const filas = [...panel.filas].sort((a, b) => {
    const paradoA = a.estado !== 'OPERATIVO' ? 0 : 1
    const paradoB = b.estado !== 'OPERATIVO' ? 0 : 1
    if (paradoA !== paradoB) return paradoA - paradoB
    return orden[a.urgencia] - orden[b.urgencia]
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Equipos parados"
          valor={String(panel.kpis.parados)}
          pie={`de ${panel.kpis.total} equipos`}
          destacar={panel.kpis.parados > 0}
        />
        <Kpi
          label="Mantenimiento vencido"
          valor={String(panel.kpis.vencidos)}
          pie="ya pasó la fecha"
          destacar={panel.kpis.vencidos > 0}
        />
        <Kpi
          label="Horas paradas"
          valor={String(panel.kpis.horasParadoPeriodo)}
          pie="en el período"
        />
        <Kpi label="Gasto" valor={fmtRD(panel.kpis.costoPeriodo)} pie="en mantenimiento" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <FormActivo editando={editando} />

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Equipos
          </h2>
          {filas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              <Wrench className="mx-auto mb-2 h-7 w-7 opacity-40" />
              Sin equipos registrados. Empieza por los que paran la pista si fallan:
              hidrolavadoras, aspiradoras, compresor.
            </p>
          ) : (
            <div className="space-y-3">
              {filas.map((f) => (
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
        destacar ? 'border-destructive/40 bg-destructive/5' : 'border-border/70 bg-card'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </div>
  )
}

function FormActivo({ editando }: { editando: ActivoFila | null }) {
  const [state, formAction, pending] = useActionState(guardarActivo, initial)
  useAviso(state)

  return (
    <form
      action={formAction}
      key={editando?.id ?? 'nuevo'}
      className="h-fit space-y-3 rounded-2xl border border-border/70 bg-card p-5"
    >
      <input type="hidden" name="id" value={editando?.id ?? ''} />
      <h2 className="text-sm font-bold text-foreground">
        {editando ? `Editar ${editando.nombre}` : 'Nuevo equipo'}
      </h2>
      <input
        name="nombre"
        required
        maxLength={80}
        defaultValue={editando?.nombre ?? ''}
        placeholder="Hidrolavadora 1"
        className={input}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          name="categoria"
          maxLength={60}
          defaultValue={editando?.categoria ?? ''}
          placeholder="Categoría"
          className={input}
        />
        <input
          name="ubicacion"
          maxLength={60}
          defaultValue={editando?.ubicacion ?? ''}
          placeholder="Ubicación"
          className={input}
        />
        <input
          name="marca"
          maxLength={60}
          defaultValue={editando?.marca ?? ''}
          placeholder="Marca"
          className={input}
        />
        <input
          name="modelo"
          maxLength={60}
          defaultValue={editando?.modelo ?? ''}
          placeholder="Modelo"
          className={input}
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Mantenimiento cada (días)
        </span>
        <input
          name="frecuenciaDias"
          inputMode="numeric"
          defaultValue={editando?.frecuenciaDias ?? 0}
          placeholder="0 = sin programa"
          className={input}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Con una frecuencia, el panel avisa antes de que toque. En cero, el equipo
        aparece sin programa y no genera avisos.
      </p>
      <Button type="submit" disabled={pending} className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {editando ? 'Guardar cambios' : 'Agregar equipo'}
      </Button>
    </form>
  )
}

function Fila({ f }: { f: ActivoFila }) {
  const [abierto, setAbierto] = useState(false)
  const urgencia = URGENCIA[f.urgencia]

  return (
    <div
      className={`rounded-2xl border p-4 ${
        f.estado !== 'OPERATIVO' || f.urgencia === 'VENCIDO'
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-border/70 bg-card'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {f.nombre}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                CHIP_ESTADO[f.estado] ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {ACTIVO_ESTADO_LABELS[f.estado as ActivoEstado] ?? f.estado}
            </span>
            {urgencia && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${urgencia.clase}`}
              >
                {urgencia.label}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[f.categoria, f.marca, f.modelo, f.ubicacion].filter(Boolean).join(' · ') ||
              'Sin detalle'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Último mantenimiento: {fmtFecha(f.ultimoMantenimiento)}
            {f.proximoMantenimiento && ` · próximo: ${fmtFecha(f.proximoMantenimiento)}`}
            {f.horasParado > 0 && ` · ${f.horasParado} h paradas acumuladas`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <SelectorEstado id={f.id} estado={f.estado} />
          <Button size="sm" variant="ghost" onClick={() => setAbierto((v) => !v)}>
            <Wrench className="mr-1 h-3.5 w-3.5" />
            {abierto ? 'Cerrar' : 'Mantenimiento'}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={`/admin/app/carwash/activos?editar=${f.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {abierto && <FormMantenimiento activoId={f.id} />}
    </div>
  )
}

function SelectorEstado({ id, estado }: { id: string; estado: string }) {
  const [pending, start] = useTransition()
  return (
    <select
      defaultValue={estado}
      disabled={pending}
      className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
      onChange={(e) => {
        const valor = e.target.value
        start(async () => {
          const r = await cambiarEstadoActivo(id, valor)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }}
    >
      {ACTIVO_ESTADOS.map((e) => (
        <option key={e} value={e}>
          {ACTIVO_ESTADO_LABELS[e as ActivoEstado]}
        </option>
      ))}
    </select>
  )
}

function FormMantenimiento({ activoId }: { activoId: string }) {
  const [state, formAction, pending] = useActionState(registrarMantenimiento, initial)
  useAviso(state)

  return (
    <form action={formAction} className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <input type="hidden" name="activoId" value={activoId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="tipo" defaultValue="PREVENTIVO" className={input}>
          {MANTENIMIENTO_TIPOS.map((t) => (
            <option key={t} value={t}>
              {MANTENIMIENTO_TIPO_LABELS[t as MantenimientoTipo]}
            </option>
          ))}
        </select>
        <input name="proveedor" maxLength={80} placeholder="Técnico o taller" className={input} />
        <input name="costo" inputMode="decimal" placeholder="Costo (RD$)" className={input} />
        <input
          name="horasParado"
          inputMode="decimal"
          placeholder="Horas que estuvo parado"
          className={input}
        />
      </div>
      <textarea
        name="descripcion"
        required
        rows={2}
        maxLength={1000}
        placeholder="Qué se le hizo"
        className="w-full rounded-xl border border-input bg-background p-3 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Al registrarlo, el equipo vuelve a <b>Operativo</b> y se reprograma el próximo
        mantenimiento según su frecuencia.
      </p>
      <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar mantenimiento
      </Button>
    </form>
  )
}
