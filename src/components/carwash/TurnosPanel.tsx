'use client'

/**
 * App Car Wash · Fase 3 — turnos y asistencia.
 *
 * EL NÚMERO QUE JUSTIFICA EL MÓDULO ES EL COSTO LABORAL POR LAVADO. Va primero
 * y en grande. Todo lo demás —quién está dentro, cuántas horas lleva cada
 * quien— es el detalle que lo sostiene.
 *
 * Ese número solo aparece si los turnos llevan costo por hora. Si no, la
 * pantalla lo dice en vez de mostrar cero y dejar creer que la mano de obra
 * es gratis.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Clock, LogIn, LogOut, Loader2, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  marcarEntrada,
  marcarSalida,
  corregirTurno,
  eliminarTurno,
  type Fase3State,
} from '@/modules/carwash/fase3-actions'
import type { PanelTurnos, TurnoFila } from '@/modules/carwash/turnos'

const initial: Fase3State = {}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtHora(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

/** Fecha en el formato que entiende <input type="datetime-local">. */
function paraInput(d: Date | null): string {
  if (!d) return ''
  const f = new Date(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}T${pad(f.getHours())}:${pad(f.getMinutes())}`
}

function useAviso(state: Fase3State) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export function TurnosPanel({ panel }: { panel: PanelTurnos }) {
  const sinCosto = panel.kpis.horas > 0 && panel.kpis.costo === 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Costo por lavado"
          valor={
            panel.kpis.costoPorVehiculo == null ? '—' : fmtRD(panel.kpis.costoPorVehiculo)
          }
          pie="mano de obra"
          destacar
        />
        <Kpi label="Horas" valor={String(panel.kpis.horas)} pie="trabajadas en el período" />
        <Kpi label="Costo laboral" valor={fmtRD(panel.kpis.costo)} pie="del período" />
        <Kpi label="Vehículos" valor={String(panel.kpis.vehiculos)} pie="entregados" />
      </div>

      {sinCosto && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-muted-foreground">
          Hay horas registradas pero ningún turno lleva <b>costo por hora</b>, así que el costo
          por lavado no se puede calcular. Ponlo al marcar la entrada, o corrígelo en los turnos
          de abajo.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Entrada empleados={panel.empleados} />
          <Adentro abiertos={panel.abiertos} filas={panel.filas} />
        </div>

        <div className="space-y-6">
          {panel.porEmpleado.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Por persona
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {panel.porEmpleado.map((e) => (
                  <div key={e.userId} className="rounded-2xl border border-border/70 bg-card p-4">
                    <p className="truncate font-semibold text-foreground">{e.nombre}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{e.horas} h</p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.turnos} turno(s) · {fmtRD(e.costo)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <Historial filas={panel.filas} />
        </div>
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
      <p className="mt-1 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </div>
  )
}

function Entrada({ empleados }: { empleados: { id: string; nombre: string }[] }) {
  const [state, formAction, pending] = useActionState(marcarEntrada, initial)
  useAviso(state)

  if (empleados.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        No tienes personal registrado. Los turnos se marcan sobre los usuarios de la empresa que
        no son clientes.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <LogIn className="h-4 w-4" /> Marcar entrada
      </h2>
      <select name="userId" required className={input} defaultValue="">
        <option value="" disabled>
          Elige a la persona
        </option>
        {empleados.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nombre}
          </option>
        ))}
      </select>
      <input
        name="costoHora"
        inputMode="decimal"
        placeholder="Costo por hora (RD$)"
        className={input}
      />
      <p className="text-xs text-muted-foreground">
        El costo por hora se congela en este turno: subir el sueldo mañana no reescribe lo que
        costó esta semana.
      </p>
      <Button type="submit" disabled={pending} className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Marcar entrada
      </Button>
    </form>
  )
}

function Adentro({
  abiertos,
  filas,
}: {
  abiertos: PanelTurnos['abiertos']
  filas: TurnoFila[]
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Users className="h-4 w-4" /> Dentro ahora
      </h2>
      {abiertos.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nadie tiene turno abierto.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {abiertos.map((a) => {
            const turno = filas.find((f) => f.userId === a.userId && f.abierto)
            return (
              <li
                key={a.userId}
                className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{a.nombre}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {a.horas} h · desde {fmtHora(a.entradaAt)}
                  </p>
                </div>
                {turno && <BotonSalida id={turno.id} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function BotonSalida({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      className="shrink-0 gap-1.5"
      onClick={() =>
        start(async () => {
          const r = await marcarSalida(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
      Salida
    </Button>
  )
}

function Historial({ filas }: { filas: TurnoFila[] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Turnos del período
      </h2>
      {filas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-2 h-7 w-7 opacity-40" />
          Sin turnos en este período.
        </p>
      ) : (
        <div className="space-y-2">
          {filas.map((f) => (
            <FilaTurno key={f.id} f={f} />
          ))}
        </div>
      )}
    </section>
  )
}

function FilaTurno({ f }: { f: TurnoFila }) {
  const [state, formAction, pending] = useActionState(corregirTurno, initial)
  const [abiertoManual, setAbiertoManual] = useState(false)
  useAviso(state)

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {f.empleado}
            {f.abierto && (
              <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                abierto
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {fmtHora(f.entradaAt)} → {f.salidaAt ? fmtHora(f.salidaAt) : 'sin cerrar'} ·{' '}
            <b className="text-foreground">{f.horas} h</b>
            {f.costoHora != null && ` · ${fmtRD(f.costoHora)}/h = ${fmtRD(f.costo)}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAbiertoManual((v) => !v)}>
            {abiertoManual ? 'Cerrar' : 'Corregir'}
          </Button>
          <BotonEliminar id={f.id} />
        </div>
      </div>

      {abiertoManual && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <input type="hidden" name="id" value={f.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Entrada</span>
              <input
                type="datetime-local"
                name="entradaAt"
                defaultValue={paraInput(f.entradaAt)}
                className={input}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Salida</span>
              <input
                type="datetime-local"
                name="salidaAt"
                defaultValue={paraInput(f.salidaAt)}
                className={input}
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              name="costoHora"
              inputMode="decimal"
              defaultValue={f.costoHora ?? ''}
              placeholder="Costo por hora"
              className={input}
            />
            <input name="notas" maxLength={300} placeholder="Nota" className={input} />
          </div>
          <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </Button>
        </form>
      )}
    </div>
  )
}

function BotonEliminar({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className="text-muted-foreground hover:text-destructive"
      onClick={() => {
        if (!window.confirm('¿Eliminar este turno? No se puede deshacer.')) return
        start(async () => {
          const r = await eliminarTurno(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  )
}
