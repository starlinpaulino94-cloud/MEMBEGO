import type { TonoEstado } from '@/components/ui/estado-chip'
import { condicionDeVer, leerBusqueda, leerVer, opcionesDeVer, tonoDeChip } from '../lista-comun'
import { ESTADOS_VENDEDOR, ESTADO_VENDEDOR_LABEL, TONO_VENDEDOR, type EstadoVendedor } from './nucleo'

/**
 * LOS VENDEDORES COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Era una lista de cliente: la consulta traía todos los vendedores y la búsqueda y el botón de inactivos filtraban en el
 * navegador. Ahora la búsqueda, el estado y la página viajan en la URL y los resuelve la base. Por defecto se ven los que no están
 * inactivos (los suspendidos SÍ se ven: siguen en el equipo, solo pausados).
 */

/** Lo que se muestra: los activos y suspendidos (por defecto), todos, o un estado concreto. */
export type VerVendedores = 'activos' | 'todas' | EstadoVendedor

const OCULTOS_POR_DEFECTO: readonly EstadoVendedor[] = ['INACTIVO']

export function leerFiltrosVendedores(sp: Record<string, string | string[] | undefined>): { q: string; ver: VerVendedores } {
  return { q: leerBusqueda(sp.q), ver: leerVer(sp.ver, ESTADOS_VENDEDOR, 'activos') }
}

export const OPCIONES_VER_VENDEDORES = opcionesDeVer(ESTADOS_VENDEDOR, ESTADO_VENDEDOR_LABEL, 'Todos (con los inactivos)')

export function condicionDeEstadoVendedores(ver: VerVendedores): { estado?: string | { notIn: EstadoVendedor[] } } {
  return condicionDeVer(ver, 'activos', OCULTOS_POR_DEFECTO)
}

export function tonoDeVendedor(estado: string): TonoEstado {
  return tonoDeChip(TONO_VENDEDOR[estado as EstadoVendedor])
}
