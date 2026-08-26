'use client'

/**
 * Formulario de excursión (crear y editar). Al CREAR pide además el precio
 * base (que nace como variante «Estándar»); al editar, los precios viven en
 * el editor de variantes. El servidor revalida todo (nucleo.validarExcursion).
 */

import { useActionState, useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  Clock,
  Plus,
  Trash2,
  MapPin,
  Check,
  Sparkles,
  Info,
  DollarSign,
  ImageIcon,
  AlertTriangle,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  crearExcursion,
  actualizarExcursion,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import { MONEDAS, DIAS_SEMANA, calcularHoraRegreso } from '@/modules/excursiones/catalogo/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExcursionImagenUpload } from './ExcursionImagenUpload'

const init: CatalogoActionState = {}

export interface ExcursionEditable {
  id: string
  nombre: string
  tipoItem?: string
  actividadesComboIds?: string[]
  descripcion: string | null
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: unknown
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  portadaUrl?: string | null
  galeria?: any
  horarios?: {
    id: string
    horaSalida: string
    diasSemana: unknown
    cupo?: number | null
  }[]
  comboItems?: {
    actividadId?: string
    horaSalida?: string | null
    actividad?: {
      id: string
      nombre?: string
      tipoItem?: string
      horaSalida?: string | null
      duracionMin?: number | null
      horarios?: { id: string; horaSalida: string; diasSemana: unknown; cupo?: number | null }[]
    }
  }[]
}

const CATEGORIAS_SUGERIDAS = [
  'Playa y Catamarán',
  'Aventura y Buggies',
  'Ecoturismo y Montaña',
  'Cultural e Histórica',
  'Paseo en Barco',
  'Snorkel y Buceo',
  'Gastronómica'
]

const DURACION_PRESETS = [
  { label: '1 hora', horas: 1 },
  { label: '2 horas', horas: 2 },
  { label: '3 horas', horas: 3 },
  { label: '4 horas (Medio día)', horas: 4 },
  { label: '6 horas', horas: 6 },
  { label: '8 horas (Día completo)', horas: 8 },
  { label: '10 horas', horas: 10 },
]

const HORAS_PRESETS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'
]

import {
  diasComunesCombo,
  validarItinerarioCombo,
  autoResolverItinerarioCombo,
  optimizarItinerarioCombo,
  generarCombinacionesCombo,
  type CombinacionItinerarioCombo,
  formatoMinutosAHora,
  minutosDesdeMedianoche,
} from '@/modules/excursiones/reservas/nucleo'

export interface ActividadParaComboItem {
  id: string
  nombre: string
  tipoItem?: string
  categoria: string | null
  moneda?: string
  duracionMin?: number | null
  horaSalida?: string | null
  horaRegreso?: string | null
  capacidad?: number | null
  precioAdulto?: number | null
  precioNino?: number | null
  horarios?: {
    id: string
    horaSalida: string
    diasSemana: number[]
    cupo?: number | null
  }[]
}

const DIAS_NOMBRES: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
}

export function ExcursionForm({
  companyId,
  excursion,
  actividadesDisponibles = [],
}: {
  companyId: string
  excursion?: ExcursionEditable
  actividadesDisponibles?: ActividadParaComboItem[]
}) {
  const router = useRouter()
  const accion = excursion ? actualizarExcursion : crearExcursion
  const [state, formAction, pending] = useActionState(accion, init)

  // Tipo de ítem: ACTIVIDAD, PASE_DIA o COMBO
  const [tipoItem, setTipoItem] = useState<'ACTIVIDAD' | 'COMBO' | 'PASE_DIA'>(() => {
    if (excursion?.tipoItem === 'COMBO') return 'COMBO'
    if (excursion?.tipoItem === 'PASE_DIA') return 'PASE_DIA'
    return 'ACTIVIDAD'
  })

  // Actividades seleccionadas para el combo
  const [actividadesComboSeleccionadas, setActividadesComboSeleccionadas] = useState<string[]>(() => {
    if (excursion?.comboItems && excursion.comboItems.length > 0) {
      return excursion.comboItems.map((ci) => ci.actividad?.id || ci.actividadId || '').filter(Boolean)
    }
    return excursion?.actividadesComboIds ?? []
  })

  console.log(actividadesDisponibles)

  // Mapeo interactivo de horario asignado por actividad (actividadId -> '09:00')
  const [horariosPorActividad, setHorariosPorActividad] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    if (excursion?.comboItems && excursion.comboItems.length > 0) {
      for (const ci of excursion.comboItems) {
        const actId = ci.actividad?.id || ci.actividadId
        if (actId) {
          initial[actId] = (
            ci.horaSalida ||
            ci.actividad?.horaSalida ||
            '09:00'
          ).trim().slice(0, 5)
        }
      }
    }
    return initial
  })

  // Objetos de las actividades seleccionadas
  const actividadesSeleccionadasObjs = useMemo(() => {
    return actividadesDisponibles.filter((a) =>
      actividadesComboSeleccionadas.includes(a.id)
    )
  }, [actividadesDisponibles, actividadesComboSeleccionadas])

  // Actividades que tienen turnos/horarios programados
  const actividadesConHorario = useMemo(() => {
    return actividadesSeleccionadasObjs.filter((a) => a.tipoItem !== 'PASE_DIA')
  }, [actividadesSeleccionadasObjs])

  // Pases de día (acceso libre continuo)
  const pasesDiaSeleccionados = useMemo(() => {
    return actividadesSeleccionadasObjs.filter((a) => a.tipoItem === 'PASE_DIA')
  }, [actividadesSeleccionadasObjs])

  // Actividades con horario seleccionadas con sus horas asignadas
  const actividadesConHorariosAsignados = useMemo(() => {
    return actividadesConHorario.map((a) => ({
      ...a,
      horaSalida:
        horariosPorActividad[a.id] ||
        a.horaSalida ||
        (a.horarios && a.horarios.length > 0 ? a.horarios[0].horaSalida : '09:00'),
    }))
  }, [actividadesConHorario, horariosPorActividad])

  // Días comunes compatibles (intersección)
  const diasComunes = useMemo(() => {
    return diasComunesCombo(actividadesSeleccionadasObjs)
  }, [actividadesSeleccionadasObjs])

  // Validación de itinerario de horas (sin solapamiento)
  const itinerarioResult = useMemo(() => {
    return validarItinerarioCombo(actividadesConHorariosAsignados)
  }, [actividadesConHorariosAsignados])

  // Combinaciones válidas completas de horarios para el combo
  const combinacionesDisponibles = useMemo(() => {
    if (tipoItem !== 'COMBO' || actividadesSeleccionadasObjs.length < 2) return []
    return generarCombinacionesCombo(actividadesSeleccionadasObjs)
  }, [tipoItem, actividadesSeleccionadasObjs])

  // Cambiar turno de una actividad con auto-resolución de solapamientos
  const cambiarHorarioActividad = (actId: string, nuevaHora: string) => {
    const updatedHorarios = { ...horariosPorActividad, [actId]: nuevaHora.trim().slice(0, 5) }
    const actsConNuevaHora = actividadesConHorario.map((a) => ({
      ...a,
      horaSalida: updatedHorarios[a.id] || a.horaSalida || '09:00',
    }))

    const validacion = validarItinerarioCombo(actsConNuevaHora)
    if (validacion.ok) {
      setHorariosPorActividad(updatedHorarios)
      toast.success('Horario actualizado.')
    } else {
      // Auto-resolver hacia el horario más cercano no solapado
      const resolucion = autoResolverItinerarioCombo(actsConNuevaHora, actId)
      if (resolucion.ok) {
        setHorariosPorActividad(resolucion.horariosAsignados)
        toast.info(
          resolucion.ajustes.length > 0
            ? `⚡ Sincronizado: ${resolucion.ajustes[0]}`
            : 'Horario sincronizado sin solapamientos.'
        )
      } else {
        setHorariosPorActividad(updatedHorarios)
        toast.warning(`⚠️ Horarios solapados: ${validacion.error}`)
      }
    }
  }

  // Auto-sincronizar / optimizar combinación completa
  const autoSincronizarCombo = () => {
    const opt = optimizarItinerarioCombo(actividadesConHorario)
    if (opt.ok) {
      setHorariosPorActividad(opt.horariosAsignados)
      toast.success('Itinerario optimizado automáticamente sin solapamiento.')
    } else {
      toast.error(opt.error || 'No se encontró combinación válida sin solapamiento.')
    }
  }

  const toggleActividadCombo = (id: string) => {
    setActividadesComboSeleccionadas((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      const nextConHorario = actividadesDisponibles.filter(
        (a) => next.includes(a.id) && a.tipoItem !== 'PASE_DIA'
      )
      const autoRes = autoResolverItinerarioCombo(nextConHorario)
      if (autoRes.ok) {
        setHorariosPorActividad(autoRes.horariosAsignados)
      }
      return next
    })
  }

  // Duración en horas (por defecto 3 horas o convertido desde duracionMin)
  const [duracionHoras, setDuracionHoras] = useState<number>(() => {
    if (excursion?.duracionMin) return Number((excursion.duracionMin / 60).toFixed(1))
    return 3
  })

  // Lista de horas de salida configuradas
  const [horasSalida, setHorasSalida] = useState<string[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      return Array.from(new Set(excursion.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort()
    }
    if (excursion?.horaSalida) return [excursion.horaSalida.trim().slice(0, 5)]
    return ['09:00']
  })

  // Días de la semana seleccionados (por defecto todos los días [1..7])
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      const allDias = new Set<number>()
      excursion.horarios.forEach((h) => {
        if (Array.isArray(h.diasSemana)) {
          h.diasSemana.forEach((d) => allDias.add(Number(d)))
        }
      })
      if (allDias.size > 0) return Array.from(allDias).sort()
    }
    return [1, 2, 3, 4, 5, 6, 7]
  })

  // Sincronización automática de días y horas cuando es un COMBO
  useEffect(() => {
    if (tipoItem === 'COMBO' && actividadesSeleccionadasObjs.length > 0) {
      if (diasComunes.length > 0) {
        setDiasSeleccionados(diasComunes)
      }
      if (combinacionesDisponibles.length > 0) {
        const todasHoras = Array.from(
          new Set(combinacionesDisponibles.map((c) => c.horaInicio))
        ).sort((a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b))
        setHorasSalida(todasHoras)
        const maxDur = Math.max(...combinacionesDisponibles.map((c) => c.duracionTotalMin))
        if (maxDur > 0) {
          setDuracionHoras(Number((maxDur / 60).toFixed(1)))
        }
      } else if (itinerarioResult.itinerario.length > 0) {
        const primeraHora = itinerarioResult.itinerario[0].inicio
        setHorasSalida([primeraHora])
        const ultimaHoraFin = itinerarioResult.itinerario[itinerarioResult.itinerario.length - 1].fin
        const durTotalMin =
          minutosDesdeMedianoche(ultimaHoraFin) - minutosDesdeMedianoche(primeraHora)
        if (durTotalMin > 0) {
          setDuracionHoras(Number((durTotalMin / 60).toFixed(1)))
        }
      }
    }
  }, [tipoItem, actividadesSeleccionadasObjs, diasComunes, combinacionesDisponibles, itinerarioResult])

  const [nuevaHoraInput, setNuevaHoraInput] = useState('14:00')

  // Estados de precios para cálculo interactivo
  const [precioAdultoInput, setPrecioAdultoInput] = useState<string>('')
  const [precioNinoInput, setPrecioNinoInput] = useState<string>('')
  const [precioResidenteInput, setPrecioResidenteInput] = useState<string>('')
  const [precioNinoResidenteInput, setPrecioNinoResidenteInput] = useState<string>('')

  // Suma de precios individuales de las actividades del combo
  const sumaPreciosActividades = useMemo(() => {
    if (tipoItem !== 'COMBO' || actividadesSeleccionadasObjs.length === 0) return null
    const adulto = actividadesSeleccionadasObjs.reduce((acc, a) => acc + (a.precioAdulto || 0), 0)
    const nino = actividadesSeleccionadasObjs.reduce(
      (acc, a) => acc + (a.precioNino != null ? a.precioNino : a.precioAdulto || 0),
      0
    )
    return { adulto, nino }
  }, [tipoItem, actividadesSeleccionadasObjs])

  // Cálculo en tiempo real del ahorro del combo
  const ahorroCombo = useMemo(() => {
    if (!sumaPreciosActividades || !precioAdultoInput) return null
    const precioCombo = parseFloat(precioAdultoInput) || 0
    if (precioCombo <= 0 || sumaPreciosActividades.adulto <= 0) return null
    const ahorro = sumaPreciosActividades.adulto - precioCombo
    const pct = Math.round((ahorro / sumaPreciosActividades.adulto) * 100)
    return { ahorro, pct }
  }, [sumaPreciosActividades, precioAdultoInput])

  // Minutos calculados
  const duracionMin = useMemo(() => {
    return Math.max(15, Math.round(duracionHoras * 60))
  }, [duracionHoras])

  // Formato visual amigable de hora en 12h (AM/PM)
  const formato12h = (h24: string) => {
    if (!h24 || !h24.includes(':')) return h24
    const [hStr, mStr] = h24.split(':')
    const h = parseInt(hStr, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${mStr} ${ampm}`
  }

  // Agregar una nueva hora
  const agregarHora = (hora: string) => {
    const limpia = hora.trim().slice(0, 5)
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(limpia)) return
    if (!horasSalida.includes(limpia)) {
      setHorasSalida([...horasSalida, limpia].sort())
    }
  }

  const removerHora = (hora: string) => {
    if (horasSalida.length <= 1) {
      toast.error('Debe haber al menos una hora de salida')
      return
    }
    setHorasSalida(horasSalida.filter((h) => h !== hora))
  }

  // Preset de días
  const seleccionarPresetDias = (tipo: 'todos' | 'laborables' | 'finde') => {
    if (tipo === 'todos') setDiasSeleccionados([1, 2, 3, 4, 5, 6, 7])
    if (tipo === 'laborables') setDiasSeleccionados([1, 2, 3, 4, 5])
    if (tipo === 'finde') setDiasSeleccionados([6, 7])
  }

  const toggleDia = (dia: number) => {
    if (diasSeleccionados.includes(dia)) {
      if (diasSeleccionados.length <= 1) {
        toast.error('Debe seleccionar al menos un día de salida')
        return
      }
      setDiasSeleccionados(diasSeleccionados.filter((d) => d !== dia))
    } else {
      setDiasSeleccionados([...diasSeleccionados, dia].sort())
    }
  }

  // Preparar JSON para el backend
  const horariosDataJson = useMemo(() => {
    return JSON.stringify(
      horasSalida.map((h) => ({
        horaSalida: h,
        diasSemana: diasSeleccionados,
        cupo: null,
      }))
    )
  }, [horasSalida, diasSeleccionados])

  // Primera hora de salida y su hora de regreso calculada
  const primeraHoraSalida = horasSalida[0] || '09:00'
  const primeraHoraRegreso = useMemo(() => {
    return calcularHoraRegreso(primeraHoraSalida, duracionMin) || ''
  }, [primeraHoraSalida, duracionMin])

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      if (state.excursionId) router.replace(`/admin/excursiones/catalogo/${state.excursionId}`)
      else router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="space-y-8">
      {excursion ? <input type="hidden" name="excursionId" value={excursion.id} /> : null}

      {/* Campos ocultos calculados */}
      <input type="hidden" name="duracionMin" value={tipoItem === 'PASE_DIA' ? '' : duracionMin} />
      <input type="hidden" name="horaSalida" value={tipoItem === 'PASE_DIA' ? '' : primeraHoraSalida} />
      <input type="hidden" name="horaRegreso" value={tipoItem === 'PASE_DIA' ? '' : primeraHoraRegreso} />
      <input type="hidden" name="horariosData" value={horariosDataJson} />
      {tipoItem === 'PASE_DIA' && diasSeleccionados.map((d) => (
        <input key={d} type="hidden" name="diasSemanaPaseDia" value={d} />
      ))}
      <input
        type="hidden"
        name="comboActividadesHorarios"
        value={JSON.stringify(horariosPorActividad)}
      />

      {/* SECCIÓN 0: IMÁGENES Y MULTIMEDIA */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          Imágenes de la excursión
        </h3>

        <ExcursionImagenUpload
          companyId={companyId}
          excursionId={excursion?.id ?? null}
          currentPortadaUrl={excursion?.portadaUrl ?? null}
          currentGaleria={excursion?.galeria ?? null}
        />
      </div>

      {/* SECCIÓN 1: DATOS PRINCIPALES */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Información general
          </h3>

          {/* Selector de Tipo: ACTIVIDAD vs PASE_DIA vs COMBO */}
          <div className="flex flex-wrap items-center rounded-xl bg-muted/60 p-1 border border-border/60 gap-1">
            <button
              type="button"
              onClick={() => setTipoItem('ACTIVIDAD')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tipoItem === 'ACTIVIDAD'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              Tour / Actividad
            </button>
            <button
              type="button"
              onClick={() => setTipoItem('PASE_DIA')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tipoItem === 'PASE_DIA'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              Pase de Día (Sin horario)
            </button>
            <button
              type="button"
              onClick={() => setTipoItem('COMBO')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tipoItem === 'COMBO'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              Combo / Paquete
            </button>
          </div>
        </div>

        <input type="hidden" name="tipoItem" value={tipoItem} />

        {tipoItem === 'COMBO' ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Configuración de Actividades del Combo
                </p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-56 overflow-y-auto pr-1">
                {actividadesDisponibles.map((act) => {
                  const checked = actividadesComboSeleccionadas.includes(act.id)
                  return (
                    <label
                      key={act.id}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition ${checked
                        ? 'border-primary bg-card text-foreground font-medium shadow-xs'
                        : 'border-border/70 bg-card/60 text-muted-foreground hover:bg-card'
                        }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          name="actividadesComboIds"
                          value={act.id}
                          checked={checked}
                          onChange={() => toggleActividadCombo(act.id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span>{act.nombre}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {act.tipoItem === 'PASE_DIA' && (
                          <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            Daypass
                          </span>
                        )}
                        {act.categoria ? (
                          <span className="text-caption text-muted-foreground font-normal">
                            {act.categoria}
                          </span>
                        ) : null}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}

            {actividadesComboSeleccionadas.length < 2 ? (
              <p className="text-caption text-warning font-medium">
                * Selecciona al menos 2 actividades para habilitar este combo ({actividadesComboSeleccionadas.length} seleccionadas).
              </p>
            ) : (
              <div className="space-y-3 pt-2">
                <p className="text-caption text-success font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Combo válido con {actividadesComboSeleccionadas.length} actividades vinculadas.
                </p>

                {/* Configuración de Turnos por Actividad */}
                <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-primary" />
                        Turnos y Horarios de las Actividades
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Elige la hora de salida de cada actividad. El sistema auto-sincronizará los turnos para evitar solapamientos.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={autoSincronizarCombo}
                      className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition shadow-2xs"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Auto-Sincronizar Turnos
                    </button>
                  </div>

                  <div className="space-y-2">
                    {actividadesConHorario.length > 0 ? (
                      actividadesConHorario.map((act) => {
                        const horaAsignada =
                          horariosPorActividad[act.id] ||
                          act.horaSalida ||
                          (act.horarios && act.horarios.length > 0 ? act.horarios[0].horaSalida : '09:00')

                        const duracionActMin = act.duracionMin && act.duracionMin > 0 ? act.duracionMin : 120
                        const horaFinAsignada = formatoMinutosAHora(minutosDesdeMedianoche(horaAsignada) + duracionActMin)

                        const slots =
                          act.horarios && act.horarios.length > 0
                            ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5)))).sort()
                            : [horaAsignada]

                        return (
                          <div
                            key={act.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">{act.nombre}</span>
                              <span className="font-mono text-[11px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                                {formato12h(horaAsignada)} → {formato12h(horaFinAsignada)} ({(duracionActMin / 60).toFixed(1)}h)
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] text-muted-foreground font-medium mr-1">Turno:</span>
                              {slots.map((s) => {
                                const seleccionado = horaAsignada === s
                                const finSlot = formatoMinutosAHora(minutosDesdeMedianoche(s) + duracionActMin)
                                return (
                                  <button
                                    key={s}
                                    type="button"
                                    title={`${formato12h(s)} a ${formato12h(finSlot)}`}
                                    onClick={() => cambiarHorarioActividad(act.id, s)}
                                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${seleccionado
                                      ? 'bg-primary text-primary-foreground shadow-xs'
                                      : 'border border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                                      }`}
                                  >
                                    {formato12h(s)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-xs text-muted-foreground italic py-1">
                        Las actividades seleccionadas son pases de día con acceso libre (no requieren turnos horarios).
                      </p>
                    )}

                    {/* Tarjeta informativa de Daypasses incluidos */}
                    {pasesDiaSeleccionados.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-800 space-y-1.5">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-700">
                          <Sparkles className="h-4 w-4 text-emerald-600" />
                          Pases de Día Incluidos (Acceso Libre todo el día):
                        </div>
                        <p className="text-[11px] text-emerald-700/90 leading-relaxed">
                          Los pases de día ofrecen acceso libre continuo durante la fecha reservada y no requieren asignación de turnos horarios fijos ni interfieren con el itinerario de horas.
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {pasesDiaSeleccionados.map((pd) => (
                            <span
                              key={pd.id}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-900 border border-emerald-500/20"
                            >
                              {pd.nombre}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Widget Interactivo de Itinerario */}
                <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2.5 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Itinerario del Mismo Día (Sin Solapamiento)
                      </h4>
                    </div>
                    <div className="text-caption font-medium">
                      {diasComunes.length > 0 ? (
                        <span className="text-muted-foreground">
                          Días comunes: <span className="font-semibold text-foreground">{diasComunes.map((d) => DIAS_NOMBRES[d]).join(', ')}</span>
                        </span>
                      ) : (
                        <span className="text-destructive font-semibold">
                          ⚠️ No hay días de salida en común entre las actividades
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Estado de solapamiento */}
                  {itinerarioResult.ok ? (
                    <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {actividadesConHorario.length > 0
                          ? `Secuencia coordinada sin cruces de horario (${duracionHoras}h en total en el día).`
                          : 'Pase(s) con acceso libre para la fecha seleccionada.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">{itinerarioResult.error}</p>
                        <p className="text-[11px] opacity-90 mt-0.5">
                          Haz clic en &quot;Auto-Sincronizar Turnos&quot; arriba o cambia los turnos para resolver el conflicto.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Pasos del Itinerario */}
                  {itinerarioResult.itinerario.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      {itinerarioResult.itinerario.map((bloque, idx) => (
                        <div
                          key={bloque.id || idx}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="font-medium text-foreground">{bloque.nombre}</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-muted-foreground text-[11px]">
                            <span className="font-semibold text-foreground">{formato12h(bloque.inicio)}</span>
                            <span>→</span>
                            <span className="font-semibold text-foreground">{formato12h(bloque.fin)}</span>
                            <span>({(bloque.duracionMin / 60).toFixed(1)}h)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : pasesDiaSeleccionados.length > 0 ? (
                    <div className="rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-800 font-medium text-center">
                      Acceso libre durante todo el día para la fecha reservada
                    </div>
                  ) : null}
                </div>

                {/* Listado de todas las combinaciones de turnos que el cliente podrá elegir */}
                {combinacionesDisponibles.length > 0 && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4" />
                        Opciones de Turnos del Paquete ({combinacionesDisponibles.length} disponibles)
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Guardadas automáticamente en el catálogo
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {combinacionesDisponibles.map((c, i) => (
                        <div
                          key={c.id || i}
                          className="rounded-lg border border-border/80 bg-background/90 p-2.5 text-xs space-y-1 shadow-2xs"
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="text-foreground">{c.nombre}</span>
                            <span className="font-mono text-primary font-bold">
                              {formato12h(c.horaInicio)} → {formato12h(c.horaFin)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            {c.resumenTexto}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div>
          <Label htmlFor="exc-nombre" className="text-xs sm:text-sm font-semibold">Nombre de la excursión *</Label>
          <Input
            id="exc-nombre"
            name="nombre"
            defaultValue={excursion?.nombre ?? ''}
            placeholder="Ej.: Isla Saona Premium & Piscinas Naturales"
            className="mt-1 h-11 text-sm sm:text-base font-medium"
            required
          />
        </div>

        <div>
          <Label htmlFor="exc-desc" className="text-xs sm:text-sm font-semibold">Descripción</Label>
          <Textarea
            id="exc-desc"
            name="descripcion"
            defaultValue={excursion?.descripcion ?? ''}
            placeholder="Describe la experiencia, actividades, paradas y lo que hace único a este tour."
            rows={3}
            className="mt-1 text-sm resize-y"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-categoria" className="text-xs sm:text-sm font-semibold">Categoría</Label>
            <Input
              id="exc-categoria"
              name="categoria"
              defaultValue={excursion?.categoria ?? ''}
              placeholder="Ej.: Playa, Aventura, Buggies…"
              className="mt-1 h-10 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CATEGORIAS_SUGERIDAS.slice(0, 4).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const input = document.getElementById('exc-categoria') as HTMLInputElement
                    if (input) input.value = cat
                  }}
                  className="rounded-lg border border-border/80 bg-muted/50 px-2 py-0.5 text-caption font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition"
                >
                  + {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="exc-capacidad" className="text-xs sm:text-sm font-semibold">
              {tipoItem === 'PASE_DIA' ? 'Cupo máximo por día' : 'Capacidad total por salida'}
            </Label>
            <Input
              id="exc-capacidad"
              name="capacidad"
              type="number"
              min="1"
              defaultValue={excursion?.capacidad ?? 30}
              placeholder={tipoItem === 'PASE_DIA' ? 'Ej.: 100 cupos/día' : 'Ej.: 30 cupos'}
              className="mt-1 h-10 text-sm font-medium"
            />
            <p className="mt-1 text-caption text-muted-foreground">
              {tipoItem === 'PASE_DIA'
                ? 'Límite máximo diario de pasajeros que pueden reservar para la misma fecha.'
                : 'Número máximo de pasajeros por turno.'}
            </p>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: LOGÍSTICA Y HORARIOS / DÍAS DE OPERACIÓN */}
      <div className="rounded-2xl border border-primary/20 bg-card p-5 sm:p-6 space-y-6 shadow-sm">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            {tipoItem === 'PASE_DIA' ? 'Días de Operación y Disponibilidad' : 'Duración y Horarios de Salida'}
          </h3>
          <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
            {tipoItem === 'PASE_DIA'
              ? 'Este ítem es un Pase de Día / Entrada con acceso libre. Selecciona los días de la semana en que estará disponible para reservar.'
              : 'La hora de llegada se calcula automáticamente según la duración seleccionada.'}
          </p>
        </div>

        {tipoItem === 'PASE_DIA' ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
            <div className="flex items-start gap-2.5">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Acceso libre sin horario rígido
                </p>
                <p className="text-caption text-muted-foreground">
                  El cliente reserva su fecha y puede ingresar durante el día. No se requiere elegir turno. El control de cupos se realiza sobre el acumulado del día.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 1. Selección de Duración en Horas */}
            <div className="space-y-2.5 rounded-xl bg-muted/40 p-4 border border-border/60">
              <Label className="text-xs sm:text-sm font-bold text-foreground">
                Duración de la excursión (en horas) *
              </Label>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-36">
                  <Input
                    type="number"
                    min="0.5"
                    max="24"
                    step="0.5"
                    value={duracionHoras}
                    onChange={(e) => setDuracionHoras(Math.max(0.5, parseFloat(e.target.value) || 1))}
                    className="h-11 text-base font-bold pr-12 text-primary"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">
                    hrs
                  </span>
                </div>

                <span className="text-xs sm:text-sm font-semibold text-muted-foreground">
                  ({duracionMin} minutos de recorrido)
                </span>
              </div>

              {/* Presets rápidos de duración */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {DURACION_PRESETS.map((p) => {
                  const activo = duracionHoras === p.horas
                  return (
                    <button
                      key={p.horas}
                      type="button"
                      onClick={() => setDuracionHoras(p.horas)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${activo
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'border border-border bg-background hover:bg-muted text-foreground'
                        }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. Lista de Horarios de Salida y Llegadas Calculadas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs sm:text-sm font-bold text-foreground">
                  Horas de salida programadas ({horasSalida.length})
                </Label>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {horasSalida.map((h) => {
                  const llegadaCalc = calcularHoraRegreso(h, duracionMin) || '--:--'
                  return (
                    <div
                      key={h}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs hover:border-primary/40 transition"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-black text-primary">
                            {formato12h(h)}
                          </span>
                          <span className="text-xs font-bold text-muted-foreground">Salida</span>
                        </div>
                        <p className="text-caption font-medium text-muted-foreground flex items-center gap-1">
                          🏁 Llegada estimada: <strong className="text-foreground">{formato12h(llegadaCalc)}</strong>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => removerHora(h)}
                        disabled={horasSalida.length <= 1}
                        className="p-2 text-muted-foreground hover:text-destructive transition disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Eliminar este horario"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Agregar nueva hora */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Input
                  type="time"
                  value={nuevaHoraInput}
                  onChange={(e) => setNuevaHoraInput(e.target.value)}
                  className="h-10 w-32 text-sm font-bold"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => agregarHora(nuevaHoraInput)}
                  className="h-10 gap-1.5 text-xs sm:text-sm font-bold"
                >
                  <Plus className="h-4 w-4" />
                  Agregar horario
                </Button>

                {/* Presets rápidos para agregar */}
                <div className="flex flex-wrap items-center gap-1 pl-2">
                  <span className="text-caption text-muted-foreground hidden sm:inline">Rápidos:</span>
                  {HORAS_PRESETS.map((hPreset) => {
                    const yaEsta = horasSalida.includes(hPreset)
                    if (yaEsta) return null
                    return (
                      <button
                        key={hPreset}
                        type="button"
                        onClick={() => agregarHora(hPreset)}
                        className="rounded-lg border border-border/80 bg-muted/60 px-2 py-1 text-caption font-semibold text-foreground hover:bg-primary/10 hover:text-primary transition"
                      >
                        + {formato12h(hPreset)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* 3. Días de la Semana en que opera */}
        <div className="space-y-3 pt-2 border-t border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs sm:text-sm font-bold text-foreground">
              Días de operación semanales
            </Label>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => seleccionarPresetDias('todos')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${diasSeleccionados.length === 7
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                  }`}
              >
                Todos los días
              </button>
              <button
                type="button"
                onClick={() => seleccionarPresetDias('laborables')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${diasSeleccionados.length === 5 && !diasSeleccionados.includes(6) && !diasSeleccionados.includes(7)
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                  }`}
              >
                Lun a Vie
              </button>
              <button
                type="button"
                onClick={() => seleccionarPresetDias('finde')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${diasSeleccionados.length === 2 && diasSeleccionados.includes(6) && diasSeleccionados.includes(7)
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                  }`}
              >
                Fin de semana
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {DIAS_SEMANA.map((d) => {
              const seleccionado = diasSeleccionados.includes(d.n)
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDia(d.n)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${seleccionado
                    ? 'border-primary bg-primary/10 text-primary font-black shadow-xs'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                >
                  {seleccionado && <Check className="h-3.5 w-3.5" />}
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* SECCIÓN 3: PRECIOS Y MONEDA */}
      {!excursion ? (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6 space-y-4 shadow-sm">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Precio base de la excursión (Variante Estándar)
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Podrás agregar más variantes de precio (VIP, niños, residentes) en cualquier momento desde el catálogo.
            </p>
          </div>

          {tipoItem === 'COMBO' && sumaPreciosActividades && sumaPreciosActividades.adulto > 0 ? (
            <div className="rounded-xl border border-primary/20 bg-background/80 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Suma individual de actividades
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    ${sumaPreciosActividades.adulto.toFixed(2)} por adulto
                    {sumaPreciosActividades.nino > 0
                      ? ` • $${sumaPreciosActividades.nino.toFixed(2)} por niño`
                      : ''}
                  </p>
                </div>

                {ahorroCombo && ahorroCombo.ahorro > 0 ? (
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    🔥 Ahorro para el cliente: ${ahorroCombo.ahorro.toFixed(2)} ({ahorroCombo.pct}% descuento)
                  </span>
                ) : null}
              </div>

              {/* Botones de sugerencia rápida */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-muted-foreground font-medium">Sugerencias:</span>
                <button
                  type="button"
                  onClick={() => {
                    setPrecioAdultoInput(sumaPreciosActividades.adulto.toFixed(2))
                    if (sumaPreciosActividades.nino > 0) {
                      setPrecioNinoInput(sumaPreciosActividades.nino.toFixed(2))
                    }
                  }}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition"
                >
                  Copiar suma total (${sumaPreciosActividades.adulto.toFixed(2)})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const desc15 = (sumaPreciosActividades.adulto * 0.85).toFixed(2)
                    setPrecioAdultoInput(desc15)
                    if (sumaPreciosActividades.nino > 0) {
                      setPrecioNinoInput((sumaPreciosActividades.nino * 0.85).toFixed(2))
                    }
                  }}
                  className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition"
                >
                  Aplicar 15% de descuento (${(sumaPreciosActividades.adulto * 0.85).toFixed(2)})
                </button>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Configuración de Tarifas y Moneda
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="exc-moneda" className="text-xs font-semibold text-muted-foreground">
                  Moneda:
                </Label>
                <select
                  id="exc-moneda"
                  name="moneda"
                  defaultValue="DOP"
                  className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground outline-none focus:ring-2 focus:ring-primary"
                >
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Tarifa Turistas / General */}
              <div className="rounded-xl border border-border/80 bg-background/90 p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🌍</span>
                    <div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wide">
                        Tarifa Turistas / General
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Boleto estándar internacional
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Principal
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label
                      htmlFor="exc-precio-adulto"
                      className="text-xs font-semibold text-foreground"
                    >
                      Adulto Turista *
                    </Label>
                    <Input
                      id="exc-precio-adulto"
                      name="precioAdulto"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="80.00"
                      value={precioAdultoInput}
                      onChange={(e) => setPrecioAdultoInput(e.target.value)}
                      className="mt-1 h-10 text-sm font-bold"
                      required
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="exc-precio-nino"
                      className="text-xs font-semibold text-foreground"
                    >
                      Niño Turista
                    </Label>
                    <Input
                      id="exc-precio-nino"
                      name="precioNino"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="40.00"
                      value={precioNinoInput}
                      onChange={(e) => setPrecioNinoInput(e.target.value)}
                      className="mt-1 h-10 text-sm font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Tarifa Residentes / Locales */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🇩🇴</span>
                    <div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wide">
                        Tarifa Residentes / Locales
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Precio especial para locales
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    Opcional
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label
                      htmlFor="exc-precio-residente"
                      className="text-xs font-semibold text-foreground"
                    >
                      Adulto Residente
                    </Label>
                    <Input
                      id="exc-precio-residente"
                      name="precioResidente"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="50.00"
                      value={precioResidenteInput}
                      onChange={(e) => setPrecioResidenteInput(e.target.value)}
                      className="mt-1 h-10 text-sm font-bold"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="exc-precio-nino-residente"
                      className="text-xs font-semibold text-foreground"
                    >
                      Niño Residente
                    </Label>
                    <Input
                      id="exc-precio-nino-residente"
                      name="precioNinoResidente"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="25.00"
                      value={precioNinoResidenteInput}
                      onChange={(e) => setPrecioNinoResidenteInput(e.target.value)}
                      className="mt-1 h-10 text-sm font-medium"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
          <h3 className="text-base font-bold text-foreground">Moneda e Impuestos</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="exc-moneda" className="text-xs sm:text-sm font-semibold">Moneda</Label>
              <select
                id="exc-moneda"
                name="moneda"
                defaultValue={excursion.moneda}
                className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary"
              >
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="exc-impuesto" className="text-xs sm:text-sm font-semibold">Impuesto (%)</Label>
              <Input
                id="exc-impuesto"
                name="impuestoPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={excursion.impuestoPct != null ? String(excursion.impuestoPct) : ''}
                className="mt-1 h-11 text-sm"
              />
            </div>
          </div>
        </div>
      )}
      {!excursion ? <input type="hidden" name="impuestoPct" value="" /> : null}

      {/* SECCIÓN 4: UBICACIÓN Y PUNTO DE ENCUENTRO */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Ubicación y Punto de Salida
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-ubicacion" className="text-xs sm:text-sm font-semibold">Ciudad / Región</Label>
            <Input
              id="exc-ubicacion"
              name="ubicacion"
              defaultValue={excursion?.ubicacion ?? ''}
              placeholder="Ej.: Bayahíbe, La Romana"
              className="mt-1 h-11 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="exc-punto" className="text-xs sm:text-sm font-semibold">Punto exacto de encuentro</Label>
            <Input
              id="exc-punto"
              name="puntoSalida"
              defaultValue={excursion?.puntoSalida ?? ''}
              placeholder="Ej.: Muelle Principal de Bayahíbe, frente al faro"
              className="mt-1 h-11 text-sm"
            />
          </div>
        </div>
      </div>

      {/* SECCIÓN 5: QUÉ INCLUYE Y POLÍTICAS */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <Info className="h-5 w-5 text-primary" />
          Inclusiones y Políticas
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-incluye" className="text-xs sm:text-sm font-semibold">¿Qué incluye?</Label>
            <Textarea
              id="exc-incluye"
              name="incluye"
              defaultValue={excursion?.incluye ?? ''}
              placeholder="Transporte en lancha, almuerzo buffet, bebidas abiertas, chalecos, guía certificado…"
              rows={3}
              className="mt-1 text-sm resize-y"
            />
          </div>
          <div>
            <Label htmlFor="exc-noincluye" className="text-xs sm:text-sm font-semibold">¿Qué NO incluye?</Label>
            <Textarea
              id="exc-noincluye"
              name="noIncluye"
              defaultValue={excursion?.noIncluye ?? ''}
              placeholder="Propinas, fotos profesionales, compras personales…"
              rows={3}
              className="mt-1 text-sm resize-y"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="exc-politicas" className="text-xs sm:text-sm font-semibold">Políticas y recomendaciones</Label>
          <Textarea
            id="exc-politicas"
            name="politicas"
            defaultValue={excursion?.politicas ?? ''}
            placeholder="Llevar protector solar, toalla, traje de baño. Cancelaciones con 24h de anticipación…"
            rows={3}
            className="mt-1 text-sm resize-y"
          />
        </div>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {tipoItem === 'COMBO' && !itinerarioResult.ok ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">
            ⚠️ No se puede guardar el combo: {itinerarioResult.error}
          </AlertDescription>
        </Alert>
      ) : null}

      {tipoItem === 'COMBO' && actividadesComboSeleccionadas.length >= 2 && diasComunes.length === 0 ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">
            ⚠️ No se puede guardar el combo: Las actividades seleccionadas no comparten ningún día operativo en común.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
        <Button
          type="submit"
          disabled={
            pending ||
            (tipoItem === 'COMBO' && (!itinerarioResult.ok || actividadesComboSeleccionadas.length < 2 || diasComunes.length === 0))
          }
          className="h-12 w-full sm:w-auto px-8 rounded-xl font-bold text-sm sm:text-base shadow-sm gap-2"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {excursion ? 'Guardar cambios' : 'Crear y publicar excursión'}
        </Button>
      </div>
    </form>
  )
}
