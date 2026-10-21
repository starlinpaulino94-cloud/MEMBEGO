import type { TonoEstado } from '@/components/ui/estado-chip'
import { condicionDeVer, leerBusqueda, leerVer, opcionesDeVer, tonoDeChip } from '../lista-comun'
import {
  ESTADOS_CERRADOS,
  ESTADOS_RESERVA,
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from './nucleo'

/**
 * LAS RESERVAS DE PARQUES Y TOURS COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05, T-08).
 *
 * Era una lista de cliente: la consulta traía las 200 reservas más recientes (`take: 200`, sin avisar) y la búsqueda y el botón de
 * archivadas filtraban EN EL NAVEGADOR esas 200. La reserva 201 era inalcanzable, la búsqueda decía «Ninguna reserva coincide»
 * sin haber mirado el resto y un «sin resultados» podía ser mentira. Ahora la búsqueda, el estado y la página viajan en la URL y
 * los resuelve la base, sobre TODAS las reservas.
 *
 * Núcleo puro —sin base ni React—: cómo se leen los filtros de la URL y qué condición de estado producen (la mecánica común está
 * en `../lista-comun`).
 */

/** Lo que se muestra: las abiertas (por defecto), todas, o un estado concreto. */
export type VerReservas = 'abiertas' | 'todas' | EstadoReserva

export { LARGO_MAXIMO_BUSQUEDA } from '../lista-comun'

/** Los filtros de la URL, tolerantes a basura: un valor que no existe vuelve al por defecto, no rompe la pantalla. */
export function leerFiltrosReservas(sp: Record<string, string | string[] | undefined>): { q: string; ver: VerReservas } {
  return { q: leerBusqueda(sp.q), ver: leerVer(sp.ver, ESTADOS_RESERVA, 'abiertas') }
}

/** Las opciones del selector «Mostrar». «Abiertas» es el valor por defecto y no va en la URL. */
export const OPCIONES_VER_RESERVAS = opcionesDeVer(ESTADOS_RESERVA, ESTADO_RESERVA_LABEL, 'Todas (con las cerradas)')

/** La condición de estado para la consulta. */
export function condicionDeEstado(ver: VerReservas): { estado?: string | { notIn: EstadoReserva[] } } {
  return condicionDeVer(ver, 'abiertas', ESTADOS_CERRADOS)
}

/** El tono del chip de estado, en el vocabulario del sistema de diseño. */
export function tonoDeReserva(estado: string): TonoEstado {
  return tonoDeChip(TONO_RESERVA[estado as EstadoReserva])
}
