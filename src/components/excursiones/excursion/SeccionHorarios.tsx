'use client'

import { Check, Clock, Info, Plus, Trash2 } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DIAS_SEMANA, calcularHoraRegreso } from '@/modules/excursiones/catalogo/nucleo'
import { DURACION_PRESETS, HORAS_PRESETS, duracionEnMinutos, formato12h, type TipoItem } from '@/modules/excursiones/catalogo/formulario'

const PRESET_DIAS = 'rounded-lg px-2.5 py-1 text-caption font-bold transition'
const PRESET_ACTIVO = 'bg-primary text-primary-foreground'
const PRESET_INACTIVO = 'border border-border bg-card text-muted-foreground hover:bg-muted'

/**
 * DURACIÓN Y HORARIOS DE SALIDA, y los días de operación. Un pase de día no tiene horario: solo los días en que se puede reservar.
 * La hora de llegada se calcula sola con la duración.
 */
export function SeccionHorarios({
  tipoItem,
  duracionHoras,
  alCambiarDuracion,
  horasSalida,
  alAgregarHora,
  alQuitarHora,
  nuevaHora,
  alCambiarNuevaHora,
  dias,
  alAlternarDia,
  alElegirPreset,
  error,
}: {
  tipoItem: TipoItem
  duracionHoras: number
  alCambiarDuracion: (horas: number) => void
  horasSalida: string[]
  alAgregarHora: (hora: string) => void
  alQuitarHora: (hora: string) => void
  nuevaHora: string
  alCambiarNuevaHora: (hora: string) => void
  dias: number[]
  alAlternarDia: (dia: number) => void
  alElegirPreset: (tipo: 'todos' | 'laborables' | 'finde') => void
  error?: string
}) {
  const esPase = tipoItem === 'PASE_DIA'
  const duracionMin = duracionEnMinutos(duracionHoras)

  return (
    <div className="space-y-6 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <Clock className="h-5 w-5 text-primary" aria-hidden />
          {esPase ? 'Días de operación y disponibilidad' : 'Duración y horarios de salida'}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          {esPase
            ? 'Este ítem es un pase de día o entrada con acceso libre. Selecciona los días de la semana en que estará disponible para reservar.'
            : 'La hora de llegada se calcula automáticamente según la duración seleccionada.'}
        </p>
      </div>

      {esPase ? (
        <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">Acceso libre sin horario rígido</p>
              <p className="text-caption text-muted-foreground">
                El cliente reserva su fecha y puede ingresar durante el día. No se requiere elegir turno. El control de cupos se realiza sobre el acumulado del día.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/40 p-4">
            <Campo id="exc-duracion" etiqueta="Duración de la excursión (en horas)">
              {(control) => (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-36">
                    <Input
                      type="number"
                      min="0.5"
                      max="24"
                      step="0.5"
                      value={duracionHoras}
                      onChange={(e) => alCambiarDuracion(Math.max(0.5, parseFloat(e.target.value) || 1))}
                      className="h-11 pr-12 text-base font-bold text-primary"
                      {...control}
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">hrs</span>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground sm:text-sm">({duracionMin} minutos de recorrido)</span>
                </div>
              )}
            </Campo>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {DURACION_PRESETS.map((p) => {
                const activo = duracionHoras === p.horas
                return (
                  <button
                    key={p.horas}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => alCambiarDuracion(p.horas)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      activo ? 'bg-primary text-primary-foreground shadow-sm' : 'border border-border bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <Campo id="exc-horas" como="grupo" etiqueta={`Horas de salida programadas (${horasSalida.length})`} error={error}>
            {() => (
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {horasSalida.map((h) => {
                    const llegada = calcularHoraRegreso(h, duracionMin) || '--:--'
                    return (
                      <div key={h} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs transition hover:border-primary/40">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-black text-primary">{formato12h(h)}</span>
                            <span className="text-xs font-bold text-muted-foreground">Salida</span>
                          </div>
                          <p className="flex items-center gap-1 text-caption font-medium text-muted-foreground">
                            Llegada estimada: <strong className="text-foreground">{formato12h(llegada)}</strong>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => alQuitarHora(h)}
                          disabled={horasSalida.length <= 1}
                          className="p-2 text-muted-foreground transition hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                          title="Eliminar este horario"
                          aria-label={`Eliminar el horario de las ${formato12h(h)}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-wrap items-end gap-2 pt-2">
                  <Campo id="exc-nueva-hora" etiqueta="Nueva hora de salida">
                    {(control) => (
                      <Input type="time" value={nuevaHora} onChange={(e) => alCambiarNuevaHora(e.target.value)} className="h-10 w-32 text-sm font-bold" {...control} />
                    )}
                  </Campo>
                  <Button type="button" variant="outline" size="sm" onClick={() => alAgregarHora(nuevaHora)} className="h-10 gap-1.5 text-xs font-bold sm:text-sm">
                    <Plus className="h-4 w-4" aria-hidden />
                    Agregar horario
                  </Button>

                  <div className="flex flex-wrap items-center gap-1 pl-2">
                    <span className="hidden text-caption text-muted-foreground sm:inline">Rápidos:</span>
                    {HORAS_PRESETS.filter((h) => !horasSalida.includes(h)).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => alAgregarHora(h)}
                        className="rounded-lg border border-border/80 bg-muted/60 px-2 py-1 text-caption font-semibold text-foreground transition hover:bg-primary/10 hover:text-primary"
                      >
                        + {formato12h(h)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Campo>
        </>
      )}

      <div className="space-y-3 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-foreground sm:text-sm" id="exc-dias-titulo">
            Días de operación semanales
          </span>
          <div className="flex gap-1.5" role="group" aria-labelledby="exc-dias-titulo">
            <button type="button" aria-pressed={dias.length === 7} onClick={() => alElegirPreset('todos')} className={`${PRESET_DIAS} ${dias.length === 7 ? PRESET_ACTIVO : PRESET_INACTIVO}`}>
              Todos los días
            </button>
            <button
              type="button"
              aria-pressed={dias.length === 5 && !dias.includes(6) && !dias.includes(7)}
              onClick={() => alElegirPreset('laborables')}
              className={`${PRESET_DIAS} ${dias.length === 5 && !dias.includes(6) && !dias.includes(7) ? PRESET_ACTIVO : PRESET_INACTIVO}`}
            >
              Lun a Vie
            </button>
            <button
              type="button"
              aria-pressed={dias.length === 2 && dias.includes(6) && dias.includes(7)}
              onClick={() => alElegirPreset('finde')}
              className={`${PRESET_DIAS} ${dias.length === 2 && dias.includes(6) && dias.includes(7) ? PRESET_ACTIVO : PRESET_INACTIVO}`}
            >
              Fin de semana
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-labelledby="exc-dias-titulo">
          {DIAS_SEMANA.map((d) => {
            const marcado = dias.includes(d.n)
            return (
              <button
                key={d.n}
                type="button"
                aria-pressed={marcado}
                onClick={() => alAlternarDia(d.n)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                  marcado ? 'border-primary bg-primary/10 font-black text-primary shadow-xs' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {marcado && <Check className="h-3.5 w-3.5" aria-hidden />}
                {d.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
