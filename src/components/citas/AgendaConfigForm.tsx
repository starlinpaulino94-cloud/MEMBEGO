'use client'

import { useActionState, useEffect } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { guardarAgendaConfig, type CitaActionState } from '@/modules/citas/actions'
import type { AgendaConfigData } from '@/modules/citas/queries'
import { Button } from '@/components/ui/button'

const DIAS = [
  { d: 1, label: 'Lunes' },
  { d: 2, label: 'Martes' },
  { d: 3, label: 'Miércoles' },
  { d: 4, label: 'Jueves' },
  { d: 5, label: 'Viernes' },
  { d: 6, label: 'Sábado' },
  { d: 0, label: 'Domingo' },
]

const init: CitaActionState = {}

const inputClase =
  'mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Configuración de la agenda: encendido, duración del turno, LÍMITE POR
 * TURNO/HORA, LÍMITE POR DÍA, reglas de reserva y horario semanal.
 */
export function AgendaConfigForm({ config }: { config: AgendaConfigData | null }) {
  const [state, formAction, pending] = useActionState(guardarAgendaConfig, init)

  useEffect(() => {
    if (state.success) toast.success(state.mensaje ?? 'Configuración guardada.')
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-6">
      {/* Encendido y confirmación */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4">
          <input
            type="checkbox"
            name="activa"
            defaultChecked={config?.activa ?? false}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block text-sm font-semibold text-foreground">Agenda activa</span>
            <span className="block text-xs text-muted-foreground">
              Los clientes pueden reservar citas desde la app.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4">
          <input
            type="checkbox"
            name="autoConfirmar"
            defaultChecked={config?.autoConfirmar ?? true}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block text-sm font-semibold text-foreground">Confirmación automática</span>
            <span className="block text-xs text-muted-foreground">
              Apagada: cada cita entra &quot;por confirmar&quot; y tú la apruebas.
            </span>
          </span>
        </label>
      </div>

      {/* Capacidad: los dos límites que pediste + duración del turno */}
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Capacidad</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Duración del turno
            <select name="duracionMin" defaultValue={String(config?.duracionMin ?? 30)} className={inputClase}>
              {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} minutos
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Límite por turno (cupo por hora)
            <input
              type="number"
              name="maxPorSlot"
              min={1}
              max={100}
              defaultValue={config?.maxPorSlot ?? 1}
              className={inputClase}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Límite por día (0 = sin límite)
            <input
              type="number"
              name="maxPorDia"
              min={0}
              max={500}
              defaultValue={config?.maxPorDia ?? 0}
              className={inputClase}
            />
          </label>
        </div>
      </div>

      {/* Reglas de reserva */}
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Reglas de reserva</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-muted-foreground">
            Anticipación mínima (horas)
            <input
              type="number"
              name="anticipacionHoras"
              min={0}
              max={168}
              defaultValue={config?.anticipacionHoras ?? 1}
              className={inputClase}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Reservas hasta (días adelante)
            <input
              type="number"
              name="ventanaDias"
              min={1}
              max={60}
              defaultValue={config?.ventanaDias ?? 14}
              className={inputClase}
            />
          </label>
        </div>
        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          Instrucciones para el cliente (opcional)
          <textarea
            name="notas"
            rows={2}
            maxLength={500}
            defaultValue={config?.notas ?? ''}
            placeholder="Ej.: llega 5 minutos antes; si no puedes venir, cancela con tiempo."
            className={inputClase}
          />
        </label>
      </div>

      {/* Horario semanal */}
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Horario semanal</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Marca los días que atiendes con cita y su horario. Los días sin marcar
          quedan cerrados.
        </p>
        <div className="mt-3 space-y-2">
          {DIAS.map(({ d, label }) => {
            const rango = config?.horarios?.[String(d)]?.[0]
            return (
              <div
                key={d}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5"
              >
                <label className="flex min-w-28 items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    name={`dia_${d}_activo`}
                    defaultChecked={!!rango}
                    className="h-4 w-4 accent-primary"
                  />
                  {label}
                </label>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="time"
                    name={`dia_${d}_desde`}
                    aria-label={`${label}: desde`}
                    defaultValue={rango?.desde ?? '08:00'}
                    className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  />
                  <span>a</span>
                  <input
                    type="time"
                    name={`dia_${d}_hasta`}
                    aria-label={`${label}: hasta`}
                    defaultValue={rango?.hasta ?? '18:00'}
                    className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Button type="submit" disabled={pending} className="min-h-11 gap-2 font-semibold">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Guardar configuración
      </Button>
    </form>
  )
}
