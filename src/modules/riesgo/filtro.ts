import { DIAS_PARA_VENCER, DIAS_SIN_VISITAS, leerVentana } from '@/modules/admin/filtrosComunes'

/**
 * Los UMBRALES del reporte de riesgo. Puros y aparte del módulo que consulta la
 * base: son la parte que se prueba sola y la que comparten pantalla, CSV y los
 * enlaces del Resumen.
 */

export interface FiltroRiesgo {
  /** Sin visitas en al menos N días. 0 = no filtrar por visitas. */
  sinVisitas: number
  /** Vence dentro de N días. 0 = no filtrar por vencimiento. */
  vence: number
  /** Solo quien tiene usos pagados sin consumir. */
  soloConUsos: boolean
}

export const RIESGO_POR_DEFECTO: FiltroRiesgo = {
  sinVisitas: 30,
  vence: 0,
  soloConUsos: false,
}

/** Lee el filtro de la URL, tolerante a basura (fuera de la lista → sin filtro). */
export function leerFiltroRiesgo(sp: Record<string, string | undefined>): FiltroRiesgo {
  // `sinVisitas=0` es una elección legítima («no me filtres por visitas»), así
  // que se distingue de «no vino ningún parámetro», que sí toma el defecto.
  const sinVisitas =
    sp.sinVisitas === '0'
      ? 0
      : (leerVentana(sp.sinVisitas, DIAS_SIN_VISITAS) ??
        (sp.sinVisitas === undefined ? RIESGO_POR_DEFECTO.sinVisitas : 0))
  const vence =
    sp.vence === '0' ? 0 : (leerVentana(sp.vence, DIAS_PARA_VENCER) ?? RIESGO_POR_DEFECTO.vence)
  return { sinVisitas, vence, soloConUsos: sp.usos === 'con' }
}
