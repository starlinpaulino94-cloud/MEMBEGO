import type { Prisma } from '@prisma/client'
import type { TonoEstado } from '@/components/ui/estado-chip'
import { OFFSET_PLATAFORMA_MIN } from '../metricas/nucleo'
import { finDelDia, inicioDelDia, leerBusqueda, leerFecha, leerId, leerOpcion, tonoDeChip } from '../lista-comun'
import { ESTADOS_COMISION, ESTADO_COMISION_LABEL, TONO_COMISION, type EstadoComision } from './nucleo'

/**
 * LAS COMISIONES COMO LISTADO DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05, T-08).
 *
 * Era una lista de cliente con ocho `useState`: la consulta traía las 300 comisiones más recientes (`take: 300`, sin avisar) y
 * el vendedor, el estado, la tasa, las fechas y la búsqueda filtraban EN EL NAVEGADOR esas 300. La comisión 301 era inalcanzable
 * y un «Ninguna comisión coincide» podía ser mentira. Es una pantalla de dinero: cuando alguien busca «todo lo que se le debe a
 * Luis», la respuesta tiene que salir de TODAS las comisiones.
 *
 * Núcleo puro —sin base ni React—: cómo se leen los filtros de la URL y qué condiciones producen.
 */

/** Qué comisiones se piden por la tasa con la que nacieron. */
export const TASAS_COMISION = ['CON_CONVERSION', 'REGLA_GENERAL'] as const
export type TasaComision = (typeof TASAS_COMISION)[number]

export const OPCIONES_TASA_COMISION: { valor: TasaComision; etiqueta: string }[] = [
  { valor: 'CON_CONVERSION', etiqueta: 'Con conversión de moneda' },
  { valor: 'REGLA_GENERAL', etiqueta: 'Regla general predeterminada' },
]

export const OPCIONES_ESTADO_COMISION = ESTADOS_COMISION.map((e) => ({ valor: e, etiqueta: ESTADO_COMISION_LABEL[e] }))

export interface FiltrosComisiones {
  q: string
  vendedor: string
  estado: EstadoComision | ''
  tasa: TasaComision | ''
  /** `AAAA-MM-DD` del día en que nació la comisión, inclusive. */
  desde: string
  hasta: string
}

/** Los filtros de la URL, tolerantes a basura: un valor que no existe es «sin filtro», no rompe la pantalla. */
export function leerFiltrosComisiones(sp: Record<string, string | string[] | undefined>): FiltrosComisiones {
  return {
    q: leerBusqueda(sp.q),
    vendedor: leerId(sp.vendedor),
    estado: leerOpcion(sp.estado, ESTADOS_COMISION),
    tasa: leerOpcion(sp.tasa, TASAS_COMISION),
    desde: leerFecha(sp.desde),
    hasta: leerFecha(sp.hasta),
  }
}

export function hayFiltrosComisiones(f: FiltrosComisiones): boolean {
  return Boolean(f.q || f.vendedor || f.estado || f.tasa || f.desde || f.hasta)
}

/**
 * Las condiciones de la consulta, SIN la búsqueda de texto (esa necesita buscar antes los vendedores que coinciden). Van en una
 * lista porque la tasa y la búsqueda usan `OR`: una lista de condiciones dentro de `AND` no se pisan.
 *
 * - «Con conversión» es la moneda de la comisión distinta de la de la empresa (sin distinguir mayúsculas, como hace la conversión).
 * - «Regla general» es la que nació de la regla predeterminada: así la marcaba el listado (`ambito` o `reglaId` del snapshot).
 * - Las fechas son días de la plataforma (UTC−4): una comisión de las 9 de la noche es del día de la venta.
 */
export function condicionesDeComisiones(f: FiltrosComisiones, monedaDefecto: string): Prisma.ComisionEntradaWhereInput[] {
  const condiciones: Prisma.ComisionEntradaWhereInput[] = []
  if (f.vendedor) condiciones.push({ vendedorId: f.vendedor })
  if (f.estado) condiciones.push({ estado: f.estado })
  if (f.tasa === 'CON_CONVERSION') {
    condiciones.push({ NOT: { moneda: { equals: monedaDefecto, mode: 'insensitive' } } })
  }
  if (f.tasa === 'REGLA_GENERAL') {
    condiciones.push({
      OR: [
        { reglaSnapshot: { path: ['ambito'], equals: 'GENERAL' } },
        { reglaSnapshot: { path: ['reglaId'], equals: 'default-general' } },
      ],
    })
  }
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

/** El tono del chip de estado, en el vocabulario del sistema de diseño. */
export function tonoDeComision(estado: string): TonoEstado {
  return tonoDeChip(TONO_COMISION[estado as EstadoComision])
}
