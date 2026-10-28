'use client'

import { useActionState, useEffect } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { guardarAgendaConfig, type CitaActionState } from '@/modules/citas/actions'
import type { AgendaConfigData } from '@/modules/citas/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { SelectNativo } from '@/components/ui/select-nativo'

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
    <form action={formAction} className="space-y-8">
      <FormSection title="Encendido" description="Si los clientes pueden reservar y cómo se confirman las citas.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <input type="checkbox" name="activa" defaultChecked={config?.activa ?? false} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="block text-sm font-semibold text-foreground">Agenda activa</span>
              <span className="block text-caption text-muted-foreground">Los clientes pueden reservar citas desde la app.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <input type="checkbox" name="autoConfirmar" defaultChecked={config?.autoConfirmar ?? true} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="block text-sm font-semibold text-foreground">Confirmación automática</span>
              <span className="block text-caption text-muted-foreground">Apagada: cada cita entra &quot;por confirmar&quot; y tú la apruebas.</span>
            </span>
          </label>
        </div>
      </FormSection>

      <FormSection title="Capacidad" description="Cuánto dura cada turno y cuántas citas caben por turno y por día.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo id="duracionMin" etiqueta="Duración del turno">
            {(control) => (
              <SelectNativo name="duracionMin" defaultValue={String(config?.duracionMin ?? 30)} {...control}>
                {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </SelectNativo>
            )}
          </Campo>
          <Campo id="maxPorSlot" etiqueta="Límite por turno" ayuda="Cupo por hora.">
            {(control) => <Input type="number" name="maxPorSlot" min={1} max={100} defaultValue={config?.maxPorSlot ?? 1} {...control} />}
          </Campo>
          <Campo id="maxPorDia" etiqueta="Límite por día" ayuda="0 = sin límite.">
            {(control) => <Input type="number" name="maxPorDia" min={0} max={500} defaultValue={config?.maxPorDia ?? 0} {...control} />}
          </Campo>
        </div>
      </FormSection>

      <FormSection title="Reglas de reserva" description="Con cuánta anticipación y hasta cuándo pueden reservar los clientes.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="anticipacionHoras" etiqueta="Anticipación mínima (horas)">
            {(control) => <Input type="number" name="anticipacionHoras" min={0} max={168} defaultValue={config?.anticipacionHoras ?? 1} {...control} />}
          </Campo>
          <Campo id="ventanaDias" etiqueta="Reservas hasta (días adelante)">
            {(control) => <Input type="number" name="ventanaDias" min={1} max={60} defaultValue={config?.ventanaDias ?? 14} {...control} />}
          </Campo>
        </div>
        <Campo id="notas" etiqueta="Instrucciones para el cliente" opcional>
          {(control) => (
            <Textarea
              name="notas"
              rows={2}
              maxLength={500}
              defaultValue={config?.notas ?? ''}
              placeholder="Ej.: llega 5 minutos antes; si no puedes venir, cancela con tiempo."
              {...control}
            />
          )}
        </Campo>
      </FormSection>

      <FormSection title="Horario semanal" description="Marca los días que atiendes con cita y su horario. Los días sin marcar quedan cerrados.">
        <div className="space-y-2">
          {DIAS.map(({ d, label }) => {
            const rango = config?.horarios?.[String(d)]?.[0]
            return (
              <div key={d} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5">
                <label className="flex min-w-28 items-center gap-2 text-sm font-medium text-foreground">
                  <input type="checkbox" name={`dia_${d}_activo`} defaultChecked={!!rango} className="size-4 accent-primary" />
                  {label}
                </label>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Input type="time" name={`dia_${d}_desde`} aria-label={`${label}: desde`} defaultValue={rango?.desde ?? '08:00'} className="h-9 w-32" />
                  <span>a</span>
                  <Input type="time" name={`dia_${d}_hasta`} aria-label={`${label}: hasta`} defaultValue={rango?.hasta ?? '18:00'} className="h-9 w-32" />
                </div>
              </div>
            )
          })}
        </div>
      </FormSection>

      <FormActions>
        <Button type="submit" loading={pending}>
          {!pending && <Save className="h-4 w-4" aria-hidden />}
          Guardar configuración
        </Button>
      </FormActions>
    </form>
  )
}
