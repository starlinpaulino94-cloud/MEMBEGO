import type { TonoEstado } from '@/components/ui/estado-chip'
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
 * Esto es el núcleo puro —sin base ni React—: cómo se leen los filtros de la URL y qué condición de estado producen.
 */

/** Lo que se muestra: las abiertas (por defecto), todas, o un estado concreto. */
export type VerReservas = 'abiertas' | 'todas' | EstadoReserva

/** Tope de la búsqueda: lo que un humano escribe; el resto es ruido o abuso. */
export const LARGO_MAXIMO_BUSQUEDA = 80

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Los filtros de la URL, tolerantes a basura: un valor que no existe vuelve al por defecto, no rompe la pantalla. */
export function leerFiltrosReservas(sp: Record<string, string | string[] | undefined>): { q: string; ver: VerReservas } {
  const q = (primero(sp.q) ?? '').trim().slice(0, LARGO_MAXIMO_BUSQUEDA)
  const pedido = (primero(sp.ver) ?? '').trim()
  const ver: VerReservas =
    pedido === 'todas' ? 'todas' : (ESTADOS_RESERVA as readonly string[]).includes(pedido) ? (pedido as EstadoReserva) : 'abiertas'
  return { q, ver }
}

/** Las opciones del selector «Mostrar». «Abiertas» es el valor por defecto y no va en la URL. */
export const OPCIONES_VER_RESERVAS = [
  { valor: 'todas', etiqueta: 'Todas (con las cerradas)' },
  ...ESTADOS_RESERVA.map((e) => ({ valor: e, etiqueta: ESTADO_RESERVA_LABEL[e] })),
] as const

/** La condición de estado para la consulta. */
export function condicionDeEstado(ver: VerReservas): { estado?: string | { notIn: EstadoReserva[] } } {
  if (ver === 'todas') return {}
  if (ver === 'abiertas') return { estado: { notIn: [...ESTADOS_CERRADOS] } }
  return { estado: ver }
}

/** El tono del chip de estado, en el vocabulario del sistema de diseño. */
export function tonoDeReserva(estado: string): TonoEstado {
  switch (TONO_RESERVA[estado as EstadoReserva]) {
    case 'success':
      return 'exito'
    case 'warning':
      return 'aviso'
    case 'danger':
      return 'peligro'
    case 'info':
      return 'info'
    default:
      return 'neutro'
  }
}
