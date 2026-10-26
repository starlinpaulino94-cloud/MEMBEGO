import type { Prisma } from '@prisma/client'
import type { TonoEstado } from '@/components/ui/estado-chip'
import { finDelDia, inicioDelDia, leerBusqueda, leerFecha, leerId, leerOpcion, tonoDeChip } from '../lista-comun'
import { ESTADOS_LIQUIDACION, ESTADO_LIQUIDACION_LABEL, TONO_LIQUIDACION, type EstadoLiquidacion } from './nucleo'

/**
 * LAS LIQUIDACIONES COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05, T-08).
 *
 * Era una lista de cliente: la consulta traía las 200 liquidaciones más recientes (`take: 200`, sin avisar) y el navegador filtraba
 * esas 200. Una liquidación es un pago hecho: «¿ya le pagamos a Luis en marzo?» tiene que mirar TODAS, no las últimas 200.
 *
 * Núcleo puro —sin base ni React—: cómo se leen los filtros de la URL y qué condiciones producen.
 */

export const OPCIONES_ESTADO_LIQUIDACION = ESTADOS_LIQUIDACION.map((e) => ({ valor: e, etiqueta: ESTADO_LIQUIDACION_LABEL[e] }))

export interface FiltrosLiquidaciones {
  q: string
  vendedor: string
  estado: EstadoLiquidacion | ''
  /** `AAAA-MM-DD`. El período de la liquidación tiene que EMPEZAR desde este día (inclusive). */
  desde: string
  /** `AAAA-MM-DD`. El período tiene que TERMINAR a más tardar este día (inclusive). */
  hasta: string
}

/** Los filtros de la URL, tolerantes a basura: un valor que no existe es «sin filtro», no rompe la pantalla. */
export function leerFiltrosLiquidaciones(sp: Record<string, string | string[] | undefined>): FiltrosLiquidaciones {
  return {
    q: leerBusqueda(sp.q),
    vendedor: leerId(sp.vendedor),
    estado: leerOpcion(sp.estado, ESTADOS_LIQUIDACION),
    desde: leerFecha(sp.desde),
    hasta: leerFecha(sp.hasta),
  }
}

export function hayFiltrosLiquidaciones(f: FiltrosLiquidaciones): boolean {
  return Boolean(f.q || f.vendedor || f.estado || f.desde || f.hasta)
}

/**
 * Las condiciones de la consulta, SIN la búsqueda de texto (esa necesita buscar antes los vendedores que coinciden).
 *
 * El período se guarda como medianoche UTC del primer día y el último milisegundo UTC del último (`validarPeriodo` en el núcleo), así
 * que se compara con ESE mismo borde —desfase 0—, no con la hora de la plataforma: «desde el 1 de octubre» incluye el período que
 * empieza el 1 de octubre. (El filtro de antes usaba la hora local del navegador y lo dejaba fuera.) Se mantiene lo que significaba:
 * el período entero cae dentro del rango.
 */
export function condicionesDeLiquidaciones(f: FiltrosLiquidaciones): Prisma.LiquidacionWhereInput[] {
  const condiciones: Prisma.LiquidacionWhereInput[] = []
  if (f.vendedor) condiciones.push({ vendedorId: f.vendedor })
  if (f.estado) condiciones.push({ estado: f.estado })
  if (f.desde) condiciones.push({ periodoDesde: { gte: inicioDelDia(f.desde) } })
  if (f.hasta) condiciones.push({ periodoHasta: { lte: finDelDia(f.hasta) } })
  return condiciones
}

/** El tono del chip de estado, en el vocabulario del sistema de diseño. */
export function tonoDeLiquidacion(estado: string): TonoEstado {
  return tonoDeChip(TONO_LIQUIDACION[estado as EstadoLiquidacion])
}
