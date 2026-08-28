'use client'

import { useActionState, useEffect, useState } from 'react'
import { CalendarCheck2, Car, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { reservarCita, type CitaActionState } from '@/modules/citas/actions'
import type { SlotDisponible } from '@/modules/citas/queries'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface VehiculoOption {
  id: string
  marca: string
  modelo: string
}

const init: CitaActionState = {}

/**
 * Grid de turnos del día + diálogo de confirmación de la reserva.
 * La disponibilidad viene calculada del servidor; el servidor la revalida
 * de todos modos al reservar.
 */
export function ReservarCita({
  fecha,
  etiquetaFecha,
  slots,
  vehiculos,
  limiteDiaAlcanzado,
  notas,
  compraId,
  compraTitulo,
}: {
  fecha: string
  etiquetaFecha: string
  slots: SlotDisponible[]
  vehiculos: VehiculoOption[]
  limiteDiaAlcanzado: boolean
  notas: string | null
  /** Recompensa gratis a canjear: al reservar se habilita su QR. */
  compraId?: string | null
  compraTitulo?: string | null
}) {
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(reservarCita, init)

  useEffect(() => {
    if (state.success) {
      toast.success(state.mensaje ?? 'Cita reservada.')
      // Cerrar fuera del cuerpo del efecto (regla set-state-in-effect).
      const t = setTimeout(() => setHoraSeleccionada(null), 0)
      return () => clearTimeout(t)
    }
    if (state.error) toast.error(state.error)
  }, [state])

  if (limiteDiaAlcanzado) {
    return (
      <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Este día ya alcanzó el máximo de citas. Prueba con otro día.
      </p>
    )
  }

  const hayDisponibles = slots.some((s) => s.libres > 0 && !s.vencido)

  return (
    <div>
      {!hayDisponibles ? (
        <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No quedan turnos disponibles para este día.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {slots.map((s) => {
            const agotado = s.libres <= 0 || s.vencido
            return (
              <button
                key={s.hm}
                type="button"
                disabled={agotado}
                onClick={() => setHoraSeleccionada(s.hm)}
                aria-label={`Reservar a las ${s.hm}`}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
                  agotado
                    ? 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/50 line-through'
                    : 'border-border/70 bg-card text-foreground hover:border-foreground/40 hover:-translate-y-0.5'
                )}
              >
                {s.hm}
                {!agotado && s.libres > 1 && (
                  <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
                    {s.libres} cupos
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <Dialog open={horaSeleccionada != null} onOpenChange={(o) => !o && setHoraSeleccionada(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck2 className="h-5 w-5 text-primary" />
              Confirmar cita
            </DialogTitle>
            <DialogDescription>
              {etiquetaFecha} a las{' '}
              <span className="font-semibold text-foreground">{horaSeleccionada}</span>
            </DialogDescription>
          </DialogHeader>

          {notas && (
            <p className="rounded-xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {notas}
            </p>
          )}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="fecha" value={fecha} />
            <input type="hidden" name="hora" value={horaSeleccionada ?? ''} />
            {compraId && <input type="hidden" name="compraId" value={compraId} />}
            {compraId && compraTitulo && (
              <p className="rounded-xl border border-success/25 bg-success/10 p-3 text-xs leading-relaxed text-foreground">
                Esta cita es para canjear tu <strong>{compraTitulo}</strong> gratis.
                Al confirmarla, tu QR quedará habilitado.
              </p>
            )}

            {vehiculos.length > 0 && (
              <label className="block text-sm font-medium text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Car className="h-4 w-4 text-muted-foreground" /> Vehículo (opcional)
                </span>
                <select
                  name="vehiculoId"
                  defaultValue={vehiculos.length === 1 ? vehiculos[0].id : ''}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Sin especificar</option>
                  {vehiculos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.marca} {v.modelo}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm font-medium text-foreground">
              ¿Qué necesitas? (opcional)
              <textarea
                name="servicio"
                rows={2}
                maxLength={300}
                placeholder="Ej.: lavado completo y aspirado"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <Button type="submit" disabled={pending} className="min-h-12 w-full gap-2 font-bold">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck2 className="h-4 w-4" />}
              Reservar este turno
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
