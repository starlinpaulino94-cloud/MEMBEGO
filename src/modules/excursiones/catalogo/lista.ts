import type { TonoEstado } from '@/components/ui/estado-chip'
import { condicionDeVer, leerBusqueda, leerVer, opcionesDeVer, tonoDeChip } from '../lista-comun'
import { ESTADOS_EXCURSION, ESTADO_EXCURSION_LABEL, TONO_EXCURSION, type EstadoExcursion } from './nucleo'

/**
 * EL CATÁLOGO DE ACTIVIDADES COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Era una lista de cliente: la consulta traía TODAS las actividades (sin tope ni página) y la búsqueda y el botón de archivadas
 * filtraban en el navegador. Ahora la búsqueda, el estado y la página viajan en la URL y los resuelve la base. Por defecto se ven
 * las que no están archivadas.
 */

/** Lo que se muestra: las activas (por defecto: todo menos lo archivado), todas, o un estado concreto. */
export type VerCatalogo = 'activas' | 'todas' | EstadoExcursion

const OCULTAS_POR_DEFECTO: readonly EstadoExcursion[] = ['ARCHIVADA']

export function leerFiltrosCatalogo(sp: Record<string, string | string[] | undefined>): { q: string; ver: VerCatalogo } {
  return { q: leerBusqueda(sp.q), ver: leerVer(sp.ver, ESTADOS_EXCURSION, 'activas') }
}

/** «Activas» (por defecto, sin archivadas) no va en la lista: es «sin filtro». */
export const OPCIONES_VER_CATALOGO = opcionesDeVer(ESTADOS_EXCURSION, ESTADO_EXCURSION_LABEL, 'Todas (con las archivadas)')

export function condicionDeEstadoCatalogo(ver: VerCatalogo): { estado?: string | { notIn: EstadoExcursion[] } } {
  return condicionDeVer(ver, 'activas', OCULTAS_POR_DEFECTO)
}

export function tonoDeExcursion(estado: string): TonoEstado {
  return tonoDeChip(TONO_EXCURSION[estado as EstadoExcursion])
}
