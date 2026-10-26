'use client'

import { Check, Clock, Sparkles } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { formatPrice } from '@/lib/format'
import type { CombinacionItinerarioCombo } from '@/modules/excursiones/reservas/nucleo'
import type { ExcursionOpcion } from '@/modules/excursiones/reservas/formulario'
import { ComboProgramacion } from './ComboProgramacion'
import { Paso } from './Paso'
import type { PasoProps } from './tipos'

/** PASO 2 · la tarifa (variante) y el turno: horas de salida, pase de día o la programación de un combo. */
export function PasoModalidad({
  v,
  poner,
  errores,
  excursion,
  esCombo,
  combinaciones,
}: PasoProps & { excursion: ExcursionOpcion; esCombo: boolean; combinaciones: CombinacionItinerarioCombo[] }) {
  return (
    <Paso numero={2} id="paso-modalidad" titulo="Modalidad, tarifas y turnos">
      <Campo id="reserva-tarifa" como="grupo" etiqueta="Opciones de tarifa" error={errores.varianteId}>
        {() => (
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            {excursion.variantes.map((variante) => {
              const elegida = variante.id === v.varianteId
              return (
                <button
                  type="button"
                  key={variante.id}
                  aria-pressed={elegida}
                  onClick={() => poner({ varianteId: variante.id })}
                  className={`flex w-full min-w-0 flex-col rounded-xl border p-3.5 text-left transition-all active:scale-[0.99] ${
                    elegida ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20' : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className="flex w-full min-w-0 items-center justify-between">
                    <span className="truncate text-xs font-bold text-foreground sm:text-sm">{variante.nombre}</span>
                    {elegida && <Check className="ml-1 h-4 w-4 shrink-0 text-primary" />}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="font-mono font-bold text-primary">
                      {formatPrice(variante.precioAdulto, { moneda: excursion.moneda })} <span className="text-xs font-normal text-muted-foreground">/adulto</span>
                    </span>
                    {variante.precioNino != null && (
                      <span className="font-mono text-xs text-muted-foreground">
                        • {formatPrice(variante.precioNino, { moneda: excursion.moneda })} <span className="text-xs">/niño</span>
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Campo>

      <Campo id="reserva-turno" como="grupo" etiqueta={esCombo ? 'Programación del paquete combo' : 'Turno / hora de salida'}>
        {() =>
          esCombo ? (
            <ComboProgramacion v={v} poner={poner} excursion={excursion} combinaciones={combinaciones} />
          ) : excursion.tipoItem === 'PASE_DIA' ? (
            <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs font-medium text-primary">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span>Pase de día — acceso libre válido durante toda la fecha reservada (sin turno rígido).</span>
            </div>
          ) : (
            <div className="flex w-full min-w-0 flex-wrap gap-2">
              {excursion.horarios && excursion.horarios.length > 0 ? (
                excursion.horarios.map((h) => {
                  const elegido = h.horaSalida === v.hora
                  return (
                    <button
                      type="button"
                      key={h.id}
                      aria-pressed={elegido}
                      onClick={() => poner({ hora: h.horaSalida })}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all active:scale-95 ${
                        elegido ? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30' : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      {h.horaSalida}
                    </button>
                  )
                })
              ) : (
                <p className="text-xs text-muted-foreground">Esta excursión no requiere selección de turno cerrado.</p>
              )}
            </div>
          )
        }
      </Campo>
    </Paso>
  )
}
