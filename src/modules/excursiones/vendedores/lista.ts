import type { Prisma } from '@prisma/client'
import type { TonoEstado } from '@/components/ui/estado-chip'
import { OFFSET_PLATAFORMA_MIN } from '../metricas/nucleo'
import { CANALES_ATRIBUCION, CANAL_ATRIBUCION_LABEL, ETAPAS_ATRIBUCION, ETAPA_ATRIBUCION_LABEL, type EtapaAtribucion } from '../atribucion/nucleo'
import { condicionDeVer, finDelDia, inicioDelDia, leerBusqueda, leerFecha, leerOpcion, leerVer, opcionesDeVer, tonoDeChip } from '../lista-comun'
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

// ── Los clientes que captó un vendedor (su ficha) ────────────────────────────────────────────────────────────────────

/**
 * Antes un formulario de cliente con cinco `useState` y `router.push`; ahora los mismos filtros viajan en la URL con los
 * nombres de siempre (`q`, `etapa`, `canal`, `desde`, `hasta`), así que los enlaces viejos siguen funcionando.
 */
export const OPCIONES_ETAPA_CAPTADO = ETAPAS_ATRIBUCION.map((e) => ({ valor: e, etiqueta: ETAPA_ATRIBUCION_LABEL[e] }))
export const OPCIONES_CANAL_CAPTADO = CANALES_ATRIBUCION.map((c) => ({ valor: c, etiqueta: CANAL_ATRIBUCION_LABEL[c] }))

export interface FiltrosCaptados {
  q: string
  etapa: EtapaAtribucion | ''
  canal: (typeof CANALES_ATRIBUCION)[number] | ''
  /** `AAAA-MM-DD` del día en que entró, inclusive (día de la plataforma). */
  desde: string
  hasta: string
}

export function leerFiltrosCaptados(sp: Record<string, string | string[] | undefined>): FiltrosCaptados {
  return {
    q: leerBusqueda(sp.q),
    etapa: leerOpcion(sp.etapa, ETAPAS_ATRIBUCION),
    canal: leerOpcion(sp.canal, CANALES_ATRIBUCION),
    desde: leerFecha(sp.desde),
    hasta: leerFecha(sp.hasta),
  }
}

export function hayFiltrosCaptados(f: FiltrosCaptados): boolean {
  return Boolean(f.q || f.etapa || f.canal || f.desde || f.hasta)
}

/** Las condiciones de la consulta, SIN la búsqueda de texto (esa necesita buscar antes a los clientes que coinciden). */
export function condicionesDeCaptados(f: FiltrosCaptados): Prisma.VendedorAtribucionWhereInput[] {
  const condiciones: Prisma.VendedorAtribucionWhereInput[] = []
  if (f.etapa) condiciones.push({ etapa: f.etapa })
  if (f.canal) condiciones.push({ canal: f.canal })
  if (f.desde || f.hasta) {
    condiciones.push({
      createdAt: {
        ...(f.desde ? { gte: inicioDelDia(f.desde, OFFSET_PLATAFORMA_MIN) } : {}),
        ...(f.hasta ? { lte: finDelDia(f.hasta, OFFSET_PLATAFORMA_MIN) } : {}),
      },
    })
  }
  return condiciones
}
