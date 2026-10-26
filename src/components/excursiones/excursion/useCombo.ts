'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  autoResolverItinerarioCombo,
  diasComunesCombo,
  generarCombinacionesCombo,
  optimizarItinerarioCombo,
  validarItinerarioCombo,
} from '@/modules/excursiones/reservas/nucleo'
import type { ActividadParaComboItem, TipoItem } from '@/modules/excursiones/catalogo/formulario'
import type { ExcursionEditable } from './tipos'

/**
 * EL ESTADO Y LAS CUENTAS DE UN COMBO (auditoría admin · fase 7, 7.2): qué actividades lo forman, a qué hora sale cada una, cuáles
 * pueden solaparse, qué días tienen en común, si el itinerario se cruza y qué combinaciones de turnos quedan. Salía del
 * formulario de 1 641 líneas; aquí solo hay lo del combo, y el formulario lo consume.
 */
export function useCombo({
  excursion,
  actividadesDisponibles,
  tipoItem,
}: {
  excursion?: ExcursionEditable
  actividadesDisponibles: ActividadParaComboItem[]
  tipoItem: TipoItem
}) {
  const [seleccionadas, setSeleccionadas] = useState<string[]>(() => {
    if (excursion?.comboItems && excursion.comboItems.length > 0) {
      return excursion.comboItems.map((ci) => ci.actividad?.id || ci.actividadId || '').filter(Boolean)
    }
    return excursion?.actividadesComboIds ?? []
  })

  // actividadId → hora de salida asignada
  const [horariosPorActividad, setHorariosPorActividad] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {}
    for (const ci of excursion?.comboItems ?? []) {
      const actId = ci.actividad?.id || ci.actividadId
      if (actId) inicial[actId] = (ci.horaSalida || ci.actividad?.horaSalida || '09:00').trim().slice(0, 5)
    }
    return inicial
  })

  // actividadId → ¿se permite que se solape con otras?
  const [permitirSolapamiento, setPermitirSolapamiento] = useState<Record<string, boolean>>(() => {
    const inicial: Record<string, boolean> = {}
    for (const ci of excursion?.comboItems ?? []) {
      const actId = ci.actividad?.id || ci.actividadId
      if (actId && ci.permitirSolapamiento) inicial[actId] = true
    }
    return inicial
  })

  // actividadId → horas fijas. Solo se lee lo que ya traía la excursión: el formulario no las edita.
  const [horarioFijo] = useState<Record<string, string[]>>(() => {
    const inicial: Record<string, string[]> = {}
    for (const ci of excursion?.comboItems ?? []) {
      const actId = ci.actividad?.id || ci.actividadId
      if (actId && ci.horarioFijo) {
        const crudo = ci.horarioFijo
        inicial[actId] = Array.isArray(crudo) ? (crudo as string[]) : typeof crudo === 'string' ? [crudo] : []
      }
    }
    return inicial
  })

  const actividadesSeleccionadas = useMemo(
    () => actividadesDisponibles.filter((a) => seleccionadas.includes(a.id)),
    [actividadesDisponibles, seleccionadas]
  )
  const actividadesConHorario = useMemo(() => actividadesSeleccionadas.filter((a) => a.tipoItem !== 'PASE_DIA'), [actividadesSeleccionadas])
  const pasesDia = useMemo(() => actividadesSeleccionadas.filter((a) => a.tipoItem === 'PASE_DIA'), [actividadesSeleccionadas])

  // Cada actividad con su hora ya asignada (la fija, la elegida, la suya o la primera que tenga).
  const actividadesConHorasAsignadas = useMemo(
    () =>
      actividadesConHorario.map((a) => {
        const fijos = horarioFijo[a.id]
        return {
          ...a,
          horaSalida:
            (fijos && fijos.length > 0 ? fijos[0] : null) ||
            horariosPorActividad[a.id] ||
            a.horaSalida ||
            (a.horarios && a.horarios.length > 0 ? a.horarios[0].horaSalida : '09:00'),
          permitirSolapamiento: !!permitirSolapamiento[a.id],
        }
      }),
    [actividadesConHorario, horariosPorActividad, permitirSolapamiento, horarioFijo]
  )

  const diasComunes = useMemo(() => diasComunesCombo(actividadesSeleccionadas), [actividadesSeleccionadas])
  const itinerario = useMemo(() => validarItinerarioCombo(actividadesConHorasAsignadas), [actividadesConHorasAsignadas])
  const combinaciones = useMemo(() => {
    if (tipoItem !== 'COMBO' || actividadesSeleccionadas.length < 2) return []
    return generarCombinacionesCombo(
      actividadesSeleccionadas.map((a) => {
        const fijos = horarioFijo[a.id]
        return { ...a, horarioFijo: fijos && fijos.length > 0 ? fijos : null }
      })
    )
  }, [tipoItem, actividadesSeleccionadas, horarioFijo])

  /** Cambia el turno de una actividad; si se cruza con otra, busca el horario más cercano que no se cruce. */
  const cambiarHorario = (actId: string, nuevaHora: string) => {
    const actualizados = { ...horariosPorActividad, [actId]: nuevaHora.trim().slice(0, 5) }
    const conNuevaHora = actividadesConHorario.map((a) => ({ ...a, horaSalida: actualizados[a.id] || a.horaSalida || '09:00' }))
    const validacion = validarItinerarioCombo(conNuevaHora)
    if (validacion.ok) {
      setHorariosPorActividad(actualizados)
      toast.success('Horario actualizado.')
      return
    }
    const resolucion = autoResolverItinerarioCombo(conNuevaHora, actId)
    if (resolucion.ok) {
      setHorariosPorActividad(resolucion.horariosAsignados)
      toast.info(resolucion.ajustes.length > 0 ? `⚡ Sincronizado: ${resolucion.ajustes[0]}` : 'Horario sincronizado sin solapamientos.')
    } else {
      setHorariosPorActividad(actualizados)
      toast.warning(`⚠️ Horarios solapados: ${validacion.error}`)
    }
  }

  /** Busca una combinación de turnos de todo el combo sin cruces. */
  const autoSincronizar = () => {
    const opt = optimizarItinerarioCombo(actividadesConHorario)
    if (opt.ok) {
      setHorariosPorActividad(opt.horariosAsignados)
      toast.success('Itinerario optimizado automáticamente sin solapamiento.')
    } else {
      toast.error(opt.error || 'No se encontró combinación válida sin solapamiento.')
    }
  }

  const alternarActividad = (id: string) => {
    setSeleccionadas((prev) => {
      const siguientes = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      const conHorario = actividadesDisponibles.filter((a) => siguientes.includes(a.id) && a.tipoItem !== 'PASE_DIA')
      const auto = autoResolverItinerarioCombo(conHorario)
      if (auto.ok) setHorariosPorActividad(auto.horariosAsignados)
      return siguientes
    })
  }

  const alternarSolapamiento = (actId: string) => setPermitirSolapamiento((prev) => ({ ...prev, [actId]: !prev[actId] }))

  return {
    seleccionadas,
    horariosPorActividad,
    permitirSolapamiento,
    horarioFijo,
    actividadesSeleccionadas,
    actividadesConHorario,
    pasesDia,
    diasComunes,
    itinerario,
    combinaciones,
    cambiarHorario,
    autoSincronizar,
    alternarActividad,
    alternarSolapamiento,
  }
}

export type ComboEstado = ReturnType<typeof useCombo>
