import type { TonoEstado } from '@/components/ui/estado-chip'

/**
 * LO QUE COMPARTEN LOS LISTADOS DE SERVIDOR DE PARQUES Y TOURS (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05, T-08).
 *
 * Reservas, catálogo y vendedores eran listas de cliente con la búsqueda y las «archivadas» en estado local: lo que se veía no se
 * podía compartir, no sobrevivía a recargar y solo miraba las filas que la consulta había traído. Ahora la búsqueda, el estado y la
 * página viajan en la URL y los resuelve la base. Este módulo es la parte pura y común: cómo se leen y qué condición producen.
 *
 * «Abiertas / activas / activos» es el valor POR DEFECTO de cada lista (esconde lo terminado) y no va en la URL; «todas» y cada
 * estado concreto sí. Un valor de la URL que no existe vuelve al por defecto en vez de romper la pantalla.
 */

/** Tope de la búsqueda: lo que un humano escribe; el resto es ruido o abuso. */
export const LARGO_MAXIMO_BUSQUEDA = 80

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** El texto de búsqueda de la URL, recortado y acotado. */
export function leerBusqueda(valor: string | string[] | undefined): string {
  return (primero(valor) ?? '').trim().slice(0, LARGO_MAXIMO_BUSQUEDA)
}

/**
 * Un parámetro que es un valor de una lista cerrada (un estado, un tipo): el valor si existe, si no vacío («sin filtro»).
 * Para los filtros que NO esconden nada por defecto; los que sí, usan `leerVer`.
 */
export function leerOpcion<E extends string>(valor: string | string[] | undefined, validas: readonly E[]): E | '' {
  const pedido = (primero(valor) ?? '').trim()
  return (validas as readonly string[]).includes(pedido) ? (pedido as E) : ''
}

/** Un id de la URL (el vendedor elegido): solo la forma de un id, sin comprobar que exista. Lo demás es «sin filtro». */
export function leerId(valor: string | string[] | undefined): string {
  const pedido = (primero(valor) ?? '').trim()
  return /^[A-Za-z0-9_-]{1,40}$/.test(pedido) ? pedido : ''
}

/** Una fecha `AAAA-MM-DD` de la URL, y que exista en el calendario (`2026-02-31` no). Si no, vacío («sin filtro»). */
export function leerFecha(valor: string | string[] | undefined): string {
  const pedido = (primero(valor) ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido)) return ''
  const fecha = new Date(`${pedido}T00:00:00.000Z`)
  return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== pedido ? '' : pedido
}

/**
 * El primer instante del día `AAAA-MM-DD` visto desde una zona con ese desfase respecto a UTC, en minutos (−240 = UTC−4). Con
 * desfase 0 es la medianoche UTC. Lo que se guardó como «fecha» a medianoche UTC (el período de una liquidación) se compara con
 * desfase 0; lo que es un instante real (cuándo nació una comisión) con el de la plataforma (`OFFSET_PLATAFORMA_MIN`).
 */
export function inicioDelDia(dia: string, desfaseMin = 0): Date {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) - desfaseMin * 60_000)
}

/** El último instante (al milisegundo) de ese mismo día. */
export function finDelDia(dia: string, desfaseMin = 0): Date {
  return new Date(Date.parse(`${dia}T23:59:59.999Z`) - desfaseMin * 60_000)
}

/**
 * Qué se muestra: el valor por defecto, `todas` o un estado concreto de la lista. Cualquier otra cosa es el valor por defecto.
 * El tipo devuelto es el de esa lista (`'abiertas' | 'todas' | EstadoReserva`…), para que no se mezclen.
 */
export function leerVer<E extends string, D extends string>(
  valor: string | string[] | undefined,
  estados: readonly E[],
  defecto: D
): D | 'todas' | E {
  const pedido = (primero(valor) ?? '').trim()
  if (pedido === 'todas') return 'todas'
  return (estados as readonly string[]).includes(pedido) ? (pedido as E) : defecto
}

/**
 * La condición de estado: por defecto deja fuera los `ocultos` (los cerrados, archivados o inactivos); `todas` no filtra; un estado
 * concreto filtra por él.
 */
export function condicionDeVer<E extends string, D extends string>(
  ver: D | 'todas' | E,
  defecto: D,
  ocultos: readonly E[]
): { estado?: E | { notIn: E[] } } {
  if (ver === 'todas') return {}
  if (ver === defecto) return { estado: { notIn: [...ocultos] } }
  return { estado: ver as E }
}

/** Las opciones del selector «Mostrar»: «todas» y cada estado con su texto. El valor por defecto no va (es «sin filtro»). */
export function opcionesDeVer<E extends string>(
  estados: readonly E[],
  etiquetas: Record<E, string>,
  textoTodas = 'Todas'
): { valor: string; etiqueta: string }[] {
  return [{ valor: 'todas', etiqueta: textoTodas }, ...estados.map((e) => ({ valor: e, etiqueta: etiquetas[e] }))]
}

/** El tono de un `StatusChip` (success, warning…) en el vocabulario del chip de estado del sistema de diseño. */
export function tonoDeChip(tono: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | undefined): TonoEstado {
  switch (tono) {
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
