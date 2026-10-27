'use client'

import { Calendar as CalendarIcon } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { formatPrice } from '@/lib/format'
import { diasDespuesISO, hoyISO, type ExcursionOpcion } from '@/modules/excursiones/reservas/formulario'
import { Paso } from './Paso'
import type { PasoProps } from './tipos'

const ATAJO = 'min-h-[40px] rounded-lg border px-3 py-2 text-xs font-medium transition active:scale-95'

/** Un contador táctil de pasajeros: restar, la cifra y sumar. La cifra se anuncia al cambiar. */
function Contador({
  etiqueta,
  precio,
  valor,
  minimo,
  alCambiar,
}: {
  etiqueta: string
  precio: string
  valor: number
  minimo: number
  alCambiar: (nuevo: number) => void
}) {
  return (
    <div className="flex min-h-[56px] w-full min-w-0 items-center justify-between rounded-xl border border-border bg-background p-3 sm:px-4">
      <div className="min-w-0 flex-1 pr-2">
        <span className="block truncate text-sm font-bold text-foreground">{etiqueta}</span>
        <span className="block truncate text-xs text-muted-foreground">{precio} c/u</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => alCambiar(Math.max(minimo, valor - 1))}
          disabled={valor <= minimo}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/70 font-bold text-foreground hover:bg-muted active:scale-95 disabled:opacity-40"
          aria-label={`Disminuir ${etiqueta.toLowerCase()}`}
        >
          -
        </button>
        <span className="w-7 text-center font-mono text-lg font-bold text-foreground" aria-live="polite" aria-label={`${etiqueta}: ${valor}`}>
          {valor}
        </span>
        <button
          type="button"
          onClick={() => alCambiar(valor + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 font-bold text-primary hover:bg-primary/20 active:scale-95"
          aria-label={`Aumentar ${etiqueta.toLowerCase()}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * PASO 3 · la fecha y los pasajeros. Un combo «por días separados» no tiene UNA fecha: se muestra lo programado y la reserva se
 * fecha con la primera actividad (la dice el resumen).
 */
export function PasoFechaPasajeros({
  v,
  poner,
  errores,
  excursion,
  variante,
  porDias,
}: PasoProps & {
  excursion: ExcursionOpcion
  variante: ExcursionOpcion['variantes'][number] | undefined
  /** Combo con fechas separadas: no hay un solo campo de fecha. */
  porDias: boolean
}) {
  const hoy = hoyISO()
  const atajos: { texto: string; fecha: string }[] = [
    { texto: 'Hoy', fecha: hoy },
    { texto: 'Mañana', fecha: diasDespuesISO(1) },
    { texto: 'Pasado mañana', fecha: diasDespuesISO(2) },
  ]

  return (
    <Paso numero={3} id="paso-fecha-pasajeros" titulo="Fecha y pasajeros">
      <div className="grid w-full min-w-0 grid-cols-1 gap-6 sm:grid-cols-2">
        {porDias ? (
          <Campo id="reserva-fechas-combo" como="grupo" etiqueta="Fechas programadas (varias fechas)">
            {() => (
              <div className="w-full min-w-0 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs">
                {excursion.comboItems?.map((ci) => {
                  const config = v.itinerario[ci.id] || { fecha: v.fecha, hora: ci.horaSalida ?? '' }
                  return (
                    <div key={ci.id} className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-foreground">{ci.nombre}:</span>
                      <span className="shrink-0 font-mono font-bold text-primary">
                        {config.fecha} {ci.tipoItem === 'PASE_DIA' ? '(acceso libre)' : config.hora ? `(${config.hora})` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Campo>
        ) : (
          <div className="w-full min-w-0 space-y-3">
            <Campo id="reserva-fecha" etiqueta="Fecha del tour" error={errores.fecha}>
              {(control) => (
                <div className="relative w-full min-w-0">
                  <CalendarIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    name="fecha"
                    min={hoy}
                    value={v.fecha}
                    onChange={(e) => poner({ fecha: e.target.value })}
                    className="h-12 w-full bg-background pl-9 text-sm font-semibold"
                    required
                    {...control}
                  />
                </div>
              )}
            </Campo>
            <div className="flex w-full min-w-0 flex-wrap gap-2">
              {atajos.map((a) => (
                <button
                  type="button"
                  key={a.texto}
                  aria-pressed={v.fecha === a.fecha}
                  onClick={() => poner({ fecha: a.fecha })}
                  className={`${ATAJO} ${
                    v.fecha === a.fecha ? 'border-primary bg-primary/10 font-bold text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {a.texto}
                </button>
              ))}
            </div>
          </div>
        )}

        <Campo id="reserva-pasajeros" como="grupo" etiqueta="Cantidad de pasajeros" error={errores.pasajeros}>
          {() => (
            <div className="w-full min-w-0 space-y-2.5">
              <Contador
                etiqueta="Adultos"
                precio={variante ? formatPrice(variante.precioAdulto, { moneda: excursion.moneda }) : ''}
                valor={v.adultos}
                minimo={1}
                alCambiar={(adultos) => poner({ adultos })}
              />
              <Contador
                etiqueta="Niños"
                precio={variante ? formatPrice(variante.precioNino ?? variante.precioAdulto, { moneda: excursion.moneda }) : ''}
                valor={v.ninos}
                minimo={0}
                alCambiar={(ninos) => poner({ ninos })}
              />
            </div>
          )}
        </Campo>
      </div>
    </Paso>
  )
}
