'use client'

import { Check, Clock, Info, Sparkles, Wand2 } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { formato12h, type ActividadParaComboItem } from '@/modules/excursiones/catalogo/formulario'
import { formatoMinutosAHora, minutosDesdeMedianoche } from '@/modules/excursiones/reservas/nucleo'
import { ComboItinerario } from './ComboItinerario'
import type { ComboEstado } from './useCombo'

/**
 * LAS ACTIVIDADES DE UN COMBO: cuáles lo forman (mínimo 2), a qué turno sale cada una y el itinerario resultante. Al reservar el
 * combo, el sistema valida y descuenta cupo en cada una de ellas.
 */
export function ComboActividades({
  combo,
  actividadesDisponibles,
  duracionHoras,
  error,
}: {
  combo: ComboEstado
  actividadesDisponibles: ActividadParaComboItem[]
  duracionHoras: number
  error?: string
}) {
  const { seleccionadas, horariosPorActividad, permitirSolapamiento, actividadesConHorario, pasesDia } = combo

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">Configuración de actividades del combo</p>
          <p className="text-caption text-muted-foreground">
            Selecciona las 2 o más actividades que integran este combo. Al reservar este paquete, el sistema validará y descontará cupo en cada una de ellas automáticamente.
          </p>
        </div>
      </div>

      {actividadesDisponibles.length === 0 ? (
        <p className="text-caption text-warning">
          * No hay otras actividades individuales registradas para crear un combo. Crea primero las actividades individuales.
        </p>
      ) : (
        <Campo id="exc-combo-actividades" como="grupo" etiqueta="Actividades del combo" error={error}>
          {() => (
            <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 pt-1 sm:grid-cols-2">
              {actividadesDisponibles.map((act) => {
                const marcada = seleccionadas.includes(act.id)
                return (
                  <label
                    key={act.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                      marcada ? 'border-primary bg-card font-medium text-foreground shadow-xs' : 'border-border/70 bg-card/60 text-muted-foreground hover:bg-card'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        name="actividadesComboIds"
                        value={act.id}
                        checked={marcada}
                        onChange={() => combo.alternarActividad(act.id)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span>{act.nombre}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {act.tipoItem === 'PASE_DIA' && (
                        <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-bold text-success">Daypass</span>
                      )}
                      {act.categoria ? <span className="text-caption font-normal text-muted-foreground">{act.categoria}</span> : null}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </Campo>
      )}

      {seleccionadas.length < 2 ? (
        <p className="text-caption font-medium text-warning">
          * Selecciona al menos 2 actividades para habilitar este combo ({seleccionadas.length} seleccionadas).
        </p>
      ) : (
        <div className="space-y-3 pt-2">
          <p className="flex items-center gap-1 text-caption font-medium text-success">
            <Check className="h-3.5 w-3.5" aria-hidden /> Combo válido con {seleccionadas.length} actividades vinculadas.
          </p>

          <div className="space-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
                  <Clock className="h-4 w-4 text-primary" aria-hidden />
                  Turnos y horarios de las actividades
                </h4>
                <p className="text-xs text-muted-foreground">
                  Elige la hora de salida de cada actividad. El sistema auto-sincronizará los turnos para evitar solapamientos.
                </p>
              </div>
              <button
                type="button"
                onClick={combo.autoSincronizar}
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary shadow-2xs transition hover:bg-primary/20"
              >
                <Wand2 className="h-3.5 w-3.5" aria-hidden />
                Auto-sincronizar turnos
              </button>
            </div>

            <div className="space-y-2">
              {actividadesConHorario.length > 0 ? (
                actividadesConHorario.map((act) => {
                  const horaAsignada =
                    horariosPorActividad[act.id] || act.horaSalida || (act.horarios && act.horarios.length > 0 ? act.horarios[0].horaSalida : '09:00')
                  const duracionActMin = act.duracionMin && act.duracionMin > 0 ? act.duracionMin : 120
                  const horaFin = formatoMinutosAHora(minutosDesdeMedianoche(horaAsignada) + duracionActMin)
                  const turnos =
                    act.horarios && act.horarios.length > 0
                      ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort()
                      : [horaAsignada]

                  return (
                    <div key={act.id} className="flex flex-col justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs sm:flex-row sm:items-center">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{act.nombre}</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                          {formato12h(horaAsignada)} → {formato12h(horaFin)} ({(duracionActMin / 60).toFixed(1)}h)
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-xs font-medium text-muted-foreground">Turno:</span>
                        {turnos.map((s) => {
                          const elegido = horaAsignada === s
                          const finTurno = formatoMinutosAHora(minutosDesdeMedianoche(s) + duracionActMin)
                          return (
                            <button
                              key={s}
                              type="button"
                              aria-pressed={elegido}
                              title={`${formato12h(s)} a ${formato12h(finTurno)}`}
                              onClick={() => combo.cambiarHorario(act.id, s)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                                elegido
                                  ? 'bg-primary text-primary-foreground shadow-xs'
                                  : 'border border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                              }`}
                            >
                              {formato12h(s)}
                            </button>
                          )
                        })}
                        {(!act.horarios || act.horarios.length === 0) && <span className="text-xs italic text-muted-foreground">Sin horarios</span>}
                        <label
                          className="ml-2 flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted-foreground"
                          title="Permitir que esta actividad se solape con otras en el mismo turno"
                        >
                          <input
                            type="checkbox"
                            checked={!!permitirSolapamiento[act.id]}
                            onChange={() => combo.alternarSolapamiento(act.id)}
                            className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                          />
                          Solapar
                        </label>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="py-1 text-xs italic text-muted-foreground">
                  Las actividades seleccionadas son pases de día con acceso libre (no requieren turnos horarios).
                </p>
              )}

              {pasesDia.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-success/20 bg-success/5 p-3 text-xs text-success">
                  <div className="flex items-center gap-1.5 font-bold text-success">
                    <Sparkles className="h-4 w-4 text-success" aria-hidden />
                    Pases de día incluidos (acceso libre todo el día):
                  </div>
                  <p className="text-xs leading-relaxed text-success/90">
                    Los pases de día ofrecen acceso libre continuo durante la fecha reservada y no requieren asignación de turnos horarios fijos ni interfieren con el itinerario de horas.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {pasesDia.map((pd) => (
                      <span key={pd.id} className="inline-flex items-center gap-1 rounded-lg border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                        {pd.nombre}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <ComboItinerario combo={combo} duracionHoras={duracionHoras} />
        </div>
      )}
    </div>
  )
}
