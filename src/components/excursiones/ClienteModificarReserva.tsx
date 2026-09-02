'use client'

import { startTransition, useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Minus, Plus, Users, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  modificarMiReserva,
  type ReservaClienteState,
} from '@/modules/excursiones/reservas/cliente-actions'
import {
  calcularModificacion,
  type PoliticaReembolso,
} from '@/modules/excursiones/reservas/nucleo'
import { formatMoney } from '@/lib/format'

const init: ReservaClienteState = {}

interface ClienteModificarReservaProps {
  reservaId: string
  adultos: number
  ninos: number
  precioAdulto: number
  precioNino: number | null
  impuestoPct: number | null
  descuento: number
  pagado: number
  moneda: string
  politica: PoliticaReembolso
  horasRestantes: number
  modificable: boolean
}

export function ClienteModificarReserva({
  reservaId,
  adultos,
  ninos,
  precioAdulto,
  precioNino,
  impuestoPct,
  descuento,
  pagado,
  moneda,
  politica,
  horasRestantes,
  modificable,
}: ClienteModificarReservaProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(modificarMiReserva, init)
  const [abierto, setAbierto] = useState(false)

  const [nuevosAdultos, setNuevosAdultos] = useState(adultos)
  const [nuevosNinos, setNuevosNinos] = useState(ninos)

  // SINCRONIZAR CON LAS PROPIEDADES SIN EFECTO.
  //
  // Cuando el servidor devuelve una reserva ya modificada, los contadores
  // tienen que volver a partir de los valores nuevos. Hacerlo con un
  // `useEffect` provoca un render de más y lo prohíbe la regla de la casa; el
  // patrón que documenta React es ajustar el estado DURANTE el render,
  // comparando contra el valor anterior.
  const [base, setBase] = useState({ adultos, ninos })
  if (base.adultos !== adultos || base.ninos !== ninos) {
    setBase({ adultos, ninos })
    setNuevosAdultos(adultos)
    setNuevosNinos(ninos)
  }

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      // `startTransition`: cerrar el panel no es urgente y así el cambio de
      // estado ocurre en un callback, no en el cuerpo del efecto.
      startTransition(() => setAbierto(false))
      router.refresh()
    }
    if (state.error) {
      toast.error(state.error)
    }
  }, [state, router])

  if (!politica.permitirReduccionPasajeros) {
    return null
  }

  const maxAdultos = adultos
  const maxNinos = ninos
  const totalOriginal = adultos + ninos
  const totalNuevo = nuevosAdultos + nuevosNinos

  // Cálculo en vivo del nuevo total y reembolso
  const preview = calcularModificacion({
    adultosOriginales: adultos,
    ninosOriginales: ninos,
    adultosNuevos: nuevosAdultos,
    ninosNuevos: nuevosNinos,
    precioAdulto,
    precioNino,
    impuestoPct,
    descuentoActual: descuento,
    pagado,
    politica,
    horasRestantes,
  })

  const haCambiado = nuevosAdultos !== adultos || nuevosNinos !== ninos

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-foreground">
              Modificar Pasajeros
            </h3>
            <p className="text-xs text-muted-foreground">
              {modificable
                ? `Puedes reducir pasajeros hasta ${politica.anticipacionMinimaHoras}h antes (quedan ${horasRestantes}h).`
                : `Tiempo límite vencido (${horasRestantes}h restantes, mínimo requerido: ${politica.anticipacionMinimaHoras}h).`}
            </p>
          </div>
        </div>

        {!abierto ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAbierto(true)}
            disabled={!modificable}
            className="text-xs font-semibold"
          >
            Modificar reserva
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAbierto(false)
              setNuevosAdultos(adultos)
              setNuevosNinos(ninos)
            }}
            className="text-xs text-muted-foreground"
          >
            Cerrar
          </Button>
        )}
      </div>

      {abierto && (
        <form action={formAction} className="pt-2 space-y-4 border-t border-border/60">
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="adultos" value={nuevosAdultos} />
          <input type="hidden" name="ninos" value={nuevosNinos} />

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Adultos */}
            <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3.5">
              <div>
                <p className="text-xs font-bold text-foreground">Adultos</p>
                <p className="text-xs text-muted-foreground">Original: {adultos}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={nuevosAdultos <= 0 || (nuevosAdultos === 1 && nuevosNinos === 0)}
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
                  className="h-8 w-8 rounded-lg"
                  disabled={nuevosAdultos >= maxAdultos}
                  onClick={() => setNuevosAdultos((prev) => Math.min(maxAdultos, prev + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Niños */}
            <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3.5">
              <div>
                <p className="text-xs font-bold text-foreground">Niños</p>
                <p className="text-xs text-muted-foreground">Original: {ninos}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={nuevosNinos <= 0 || (nuevosNinos === 1 && nuevosAdultos === 0)}
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
                  className="h-8 w-8 rounded-lg"
                  disabled={nuevosNinos >= maxNinos}
                  onClick={() => setNuevosNinos((prev) => Math.min(maxNinos, prev + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Resumen dinámico del cambio */}
          {haCambiado && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3.5 space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between font-medium">
                <span className="text-muted-foreground">Pasajeros seleccionados:</span>
                <span className="font-bold text-foreground">
                  {totalNuevo} de {totalOriginal} originales
                </span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-muted-foreground">Nuevo total de la reserva:</span>
                <span className="font-bold text-foreground">
                  {formatMoney(preview.nuevoTotal, { moneda })}
                </span>
              </div>
              {preview.montoReembolso > 0 && (
                <div className="flex justify-between font-bold text-success border-t border-border/40 pt-1.5">
                  <span>Reembolso estimado a procesar:</span>
                  <span className="tabular-nums">
                    +{formatMoney(preview.montoReembolso, { moneda })}
                  </span>
                </div>
              )}
            </div>
          )}

          {totalNuevo === 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                La reserva necesita al menos 1 pasajero. Si deseas cancelar toda la reserva, contacta directamente con soporte.
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAbierto(false)
                setNuevosAdultos(adultos)
                setNuevosNinos(ninos)
              }}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || !haCambiado || totalNuevo === 0 || !modificable}
              className="text-xs font-semibold gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              {pending ? 'Actualizando...' : 'Confirmar cambios'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
