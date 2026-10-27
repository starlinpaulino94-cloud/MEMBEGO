'use client'

import { Clock, Sparkles } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import type { CombinacionItinerarioCombo } from '@/modules/excursiones/reservas/nucleo'
import { hoyISO, type ExcursionOpcion, type ModoComboFechas } from '@/modules/excursiones/reservas/formulario'
import type { PasoProps } from './tipos'

const BOTON_MODO = 'rounded-lg px-3 py-1.5 transition'
const ACTIVO = 'bg-primary text-primary-foreground font-bold shadow-xs'
const INACTIVO = 'text-muted-foreground hover:text-foreground'

/**
 * La programación de un COMBO: «mismo día» (turnos coordinados sin solapamiento) o «días separados» (fecha y turno de cada
 * actividad).
 */
export function ComboProgramacion({
  v,
  poner,
  excursion,
  combinaciones,
}: Pick<PasoProps, 'v' | 'poner'> & { excursion: ExcursionOpcion; combinaciones: CombinacionItinerarioCombo[] }) {
  const cambiarModo = (modoCombo: ModoComboFechas) => poner({ modoCombo })

  return (
    <div className="w-full min-w-0 space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex w-full min-w-0 flex-col gap-2 border-b border-primary/15 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 truncate text-xs font-bold text-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            Modalidad de fechas
          </span>
          <p className="text-xs text-muted-foreground">¿El cliente hará las actividades el mismo día o en fechas separadas?</p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border bg-background p-0.5 text-xs font-semibold">
          <button type="button" aria-pressed={v.modoCombo === 'MISMO_DIA'} onClick={() => cambiarModo('MISMO_DIA')} className={`${BOTON_MODO} ${v.modoCombo === 'MISMO_DIA' ? ACTIVO : INACTIVO}`}>
            Mismo día
          </button>
          <button type="button" aria-pressed={v.modoCombo === 'DIAS_DIFERENTES'} onClick={() => cambiarModo('DIAS_DIFERENTES')} className={`${BOTON_MODO} ${v.modoCombo === 'DIAS_DIFERENTES' ? ACTIVO : INACTIVO}`}>
            Días separados
          </button>
        </div>
      </div>

      {v.modoCombo === 'MISMO_DIA' ? (
        <div className="w-full min-w-0 space-y-2.5">
          <p className="text-xs text-muted-foreground">Turnos coordinados sin solapamiento horario para el paquete:</p>
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5">
            {combinaciones.map((comb, idx) => {
              const elegido = comb.id === v.turnoCombo
              return (
                <button
                  type="button"
                  key={comb.id}
                  aria-pressed={elegido}
                  onClick={() => poner({ turnoCombo: comb.id, hora: comb.horaInicio })}
                  className={`flex w-full min-w-0 flex-col rounded-xl border p-3.5 text-left transition-all active:scale-[0.99] ${
                    elegido ? 'border-primary bg-primary/10 shadow-xs ring-2 ring-primary/60' : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className="flex w-full min-w-0 items-center justify-between">
                    <span className={`flex items-center gap-1.5 truncate text-xs font-bold sm:text-sm ${elegido ? 'font-extrabold text-primary' : 'text-foreground'}`}>
                      <Clock className="h-4 w-4 shrink-0 text-primary" />
                      {comb.nombre}
                      {idx === 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">Recomendado</span>}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-semibold text-primary">
                      {comb.horaInicio} → {comb.horaFin} ({(comb.duracionTotalMin / 60).toFixed(1)}h)
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-medium leading-relaxed text-muted-foreground">{comb.resumenTexto}</p>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="w-full min-w-0 space-y-3">
          <p className="text-xs text-muted-foreground">Configura la fecha y el turno de cada actividad o Daypass:</p>
          <div className="w-full min-w-0 space-y-3">
            {excursion.comboItems?.map((ci) => {
              const esPase = ci.tipoItem === 'PASE_DIA'
              const config = v.itinerario[ci.id] || { fecha: v.fecha, hora: ci.horaSalida || '09:00' }
              const cambiar = (parcial: Partial<{ fecha: string; hora: string }>) =>
                poner({ itinerario: { ...v.itinerario, [ci.id]: { ...config, ...parcial } } })
              return (
                <div key={ci.id} className="w-full min-w-0 space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-foreground">{ci.nombre}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                        esPase ? 'border border-success/20 bg-success-soft text-success-ink' : 'border border-primary/20 bg-primary/10 text-primary'
                      }`}
                    >
                      {esPase ? 'Daypass (acceso libre)' : 'Actividad'}
                    </span>
                  </div>
                  <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <Campo id={`combo-fecha-${ci.id}`} etiqueta={`Fecha · ${ci.nombre}`}>
                      {(control) => (
                        <Input type="date" min={hoyISO()} value={config.fecha} onChange={(e) => cambiar({ fecha: e.target.value })} className="h-10 w-full bg-background text-xs" {...control} />
                      )}
                    </Campo>
                    {esPase ? (
                      <div className="grid min-w-0 gap-1.5">
                        <span className="text-small font-medium text-foreground">Turno · {ci.nombre}</span>
                        <div className="flex h-10 items-center rounded-lg border border-dashed border-success/30 bg-success/5 px-3 text-xs font-medium text-success">
                          Acceso libre todo el día
                        </div>
                      </div>
                    ) : (
                      <Campo id={`combo-hora-${ci.id}`} etiqueta={`Turno · ${ci.nombre}`}>
                        {(control) => (
                          <select
                            value={config.hora}
                            onChange={(e) => cambiar({ hora: e.target.value })}
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs font-medium"
                            {...control}
                          >
                            {ci.horarios && ci.horarios.length > 0 ? (
                              ci.horarios.map((h) => (
                                <option key={h.id} value={h.horaSalida}>
                                  {h.horaSalida}
                                </option>
                              ))
                            ) : (
                              <option value={ci.horaSalida || '09:00'}>{ci.horaSalida || '09:00'}</option>
                            )}
                          </select>
                        )}
                      </Campo>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
