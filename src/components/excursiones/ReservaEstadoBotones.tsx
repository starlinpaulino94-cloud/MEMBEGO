'use client'

/**
 * Mover la reserva a mano o modificar pasajeros.
 * Cancelar exige motivo y su propio permiso: es el estado que después explica un reembolso
 * o una comisión que no se paga.
 * PAGADA y ABONADA no están aquí — esos los decide el dinero, no un botón.
 */

import { startTransition, useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  cambiarEstadoReserva,
  modificarReserva,
  type ReservaActionState,
} from '@/modules/excursiones/reservas/actions'
import {
  ESTADO_RESERVA_LABEL,
  ESTADOS_CERRADOS,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Users, Minus, Plus, AlertCircle } from 'lucide-react'

const init: ReservaActionState = {}

/** Los estados que un humano decide (el resto los mueven los pagos). */
const MANUALES: EstadoReserva[] = ['CONFIRMADA', 'COMPLETADA', 'NO_SHOW', 'CANCELADA']

export function ReservaEstadoBotones({
  reservaId,
  estado,
  adultos = 0,
  ninos = 0,
}: {
  reservaId: string
  estado: EstadoReserva
  adultos?: number
  ninos?: number
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoReserva, init)
  const [modState, modAction, modPending] = useActionState(modificarReserva, init)

  const [cancelando, setCancelando] = useState(false)
  const [modificando, setModificando] = useState(false)

  const [nuevosAdultos, setNuevosAdultos] = useState(adultos)
  const [nuevosNinos, setNuevosNinos] = useState(ninos)

  // Sincronizar con las propiedades DURANTE el render, que es el patrón que
  // documenta React: con `useEffect` se paga un render de más y lo prohíbe la
  // regla de la casa.
  const [base, setBase] = useState({ adultos, ninos })
  if (base.adultos !== adultos || base.ninos !== ninos) {
    setBase({ adultos, ninos })
    setNuevosAdultos(adultos)
    setNuevosNinos(ninos)
  }

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      // En un callback y no en el cuerpo del efecto: cerrar no es urgente.
      startTransition(() => setCancelando(false))
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  useEffect(() => {
    if (modState.success) {
      toast.success(modState.success)
      startTransition(() => setModificando(false))
      router.refresh()
    }
    if (modState.error) toast.error(modState.error)
  }, [modState, router])

  if (ESTADOS_CERRADOS.includes(estado)) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta reserva está cerrada como <strong className="text-foreground">{ESTADO_RESERVA_LABEL[estado]}</strong>.
        Su histórico no se reescribe.
      </p>
    )
  }

  const maxAdultos = adultos
  const maxNinos = ninos
  const totalOriginal = adultos + ninos
  const totalNuevo = nuevosAdultos + nuevosNinos

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {MANUALES.filter((e) => e !== 'CANCELADA').map((e) => (
          <form key={e} action={formAction}>
            <input type="hidden" name="reservaId" value={reservaId} />
            <input type="hidden" name="estado" value={e} />
            <Button type="submit" size="sm" variant="outline" disabled={pending || modPending || estado === e}>
              {ESTADO_RESERVA_LABEL[e]}
            </Button>
          </form>
        ))}

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setModificando(!modificando)
            setCancelando(false)
          }}
          disabled={pending || modPending}
          className="gap-1.5"
        >
          <Users className="h-3.5 w-3.5" />
          Reducir pasajeros
        </Button>

        {cancelando ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="reservaId" value={reservaId} />
            <input type="hidden" name="estado" value="CANCELADA" />
            <Input
              name="motivo"
              required
              placeholder="Motivo de la cancelación"
              aria-label="Motivo de la cancelación"
              className="h-8 w-56"
            />
            <Button type="submit" size="sm" variant="destructive" disabled={pending}>
              Confirmar cancelación
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCancelando(false)}>
              Volver
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCancelando(true)
              setModificando(false)
            }}
          >
            Cancelar reserva
          </Button>
        )}
      </div>

      {/* Formulario de reducción de pasajeros */}
      {modificando && (
        <form
          action={modAction}
          className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm"
        >
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="adultos" value={nuevosAdultos} />
          <input type="hidden" name="ninos" value={nuevosNinos} />

          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-foreground">
                Reducción de Pasajeros y Reembolso Parcial
              </h4>
              <p className="text-xs text-muted-foreground">
                Original: {totalOriginal} pasajeros ({adultos} adultos, {ninos} niños).
              </p>
            </div>
            <span className="text-xs font-mono font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-full">
              Nuevo total: {totalNuevo} pax
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Adultos */}
            <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
              <div>
                <p className="text-xs font-bold text-foreground">Adultos</p>
                <p className="text-xs text-muted-foreground">Máximo: {maxAdultos}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={nuevosAdultos <= 0}
                  onClick={() => setNuevosAdultos((prev) => Math.max(0, prev - 1))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center font-mono font-bold text-sm">
                  {nuevosAdultos}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={nuevosAdultos >= maxAdultos}
                  onClick={() => setNuevosAdultos((prev) => Math.min(maxAdultos, prev + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Niños */}
            <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
              <div>
                <p className="text-xs font-bold text-foreground">Niños</p>
                <p className="text-xs text-muted-foreground">Máximo: {maxNinos}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={nuevosNinos <= 0}
                  onClick={() => setNuevosNinos((prev) => Math.max(0, prev - 1))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center font-mono font-bold text-sm">
                  {nuevosNinos}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={nuevosNinos >= maxNinos}
                  onClick={() => setNuevosNinos((prev) => Math.min(maxNinos, prev + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {totalNuevo === 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Reducir a 0 pasajeros cancelará la reserva completa.</p>
                <label className="mt-1 flex items-center gap-1.5 cursor-pointer font-bold">
                  <input
                    type="checkbox"
                    name="confirmarCancelacion"
                    value="true"
                    required
                    className="h-3.5 w-3.5 rounded border-destructive text-destructive"
                  />
                  Confirmo cancelar la reserva y procesar reembolso según política
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setModificando(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={modPending || (nuevosAdultos === adultos && nuevosNinos === ninos)}
            >
              {modPending ? 'Procesando...' : 'Confirmar modificación'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
