import type { Direccion } from '@/modules/reportes/tabla'

/**
 * ORDENAR LAS TABLAS LARGAS DE LOS DETALLES — en la base, no en el navegador.
 *
 * Las tablas del reporte son resúmenes de treinta o cincuenta filas y se
 * ordenan en el navegador: están enteras en la página, así que ordenarlas ahí
 * no puede perder nada.
 *
 * Las de `/detalle` no. Traen hasta `MAX` filas **ya recortadas por la
 * consulta**, y ese recorte lo decide el `orderBy`. Ordenarlas en el navegador
 * daría «las 300 más recientes, ordenadas por monto» — que NO son «las 300 de
 * mayor monto». El cobro más grande del trimestre podría no estar en la lista y
 * la tabla parecería estar respondiendo a la pregunta.
 *
 * Por eso el orden viaja a la consulta: se elige con un enlace, se lee de la
 * URL y entra en el `orderBy` de Prisma. Sin JavaScript, imprimible, y el
 * enlace se puede compartir tal cual.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Y POR ESO EL ENCABEZADO TIENE QUE DECIRLO
 *
 * Con el tope puesto, cambiar el orden **cambia qué filas se ven**, no solo en
 * qué fila aparecen. Un subtítulo que diga «se muestran las 300 más recientes»
 * mientras la tabla está ordenada por monto es falso, así que el texto se
 * construye desde el orden vigente (`resumenTope`) y nunca a mano.
 */
export interface MetaCampo {
  /** Lo que va en la URL. Corto: sale en un enlace que la gente comparte. */
  clave: string
  /** Cómo se llama en el encabezado. */
  label: string
  /**
   * Cómo se dice, en cada dirección, QUÉ filas deja fuera el tope: «las más
   * recientes», «las de mayor monto». Se escribe por campo porque «de mayor a
   * menor» sobre una fecha no significa nada para quien lo lee.
   */
  tope: (d: Direccion) => string
  /** La dirección que se elige la primera vez. Las fechas y el dinero, hacia abajo. */
  inicial: Direccion
}

/**
 * Un campo con su `orderBy` de Prisma.
 *
 * Va aparte de `MetaCampo` porque el detalle de finanzas son **tres tablas
 * distintas** —caja, membresías y pasarela— con tres tipos de `orderBy` que no
 * se pueden unir en uno: allí las claves se comparten y cada rama arma el suyo.
 * Las demás pantallas son una sola tabla y usan esto.
 */
export interface CampoOrden<O> extends MetaCampo {
  /** Lo que se le pasa a Prisma. Función, porque depende de la dirección. */
  orderBy: (d: Direccion) => O
}

export interface OrdenDetalle {
  clave: string
  direccion: Direccion
}

/**
 * Lee `?o=` y `?d=` contra la lista de campos que esa pestaña admite.
 *
 * Lo que no esté en la lista se ignora y se cae al primero: un `?o=` inventado
 * a mano en la barra de direcciones no puede llegar nunca a un `orderBy`.
 */
export function leerOrden(
  campos: readonly MetaCampo[],
  o: string | undefined,
  d: string | undefined
): OrdenDetalle {
  const campo = campos.find((c) => c.clave === o) ?? campos[0]
  const direccion: Direccion = d === 'asc' || d === 'desc' ? d : campo.inicial
  return { clave: campo.clave, direccion }
}

/** El `orderBy` que le toca a Prisma. Para las pantallas de una sola tabla. */
export function orderByDe<O>(campos: readonly CampoOrden<O>[], orden: OrdenDetalle): O {
  const campo = campos.find((c) => c.clave === orden.clave) ?? campos[0]
  return campo.orderBy(orden.direccion)
}

/** El siguiente estado del encabezado: cambia de columna, o se da la vuelta. */
export function siguienteDireccion(
  campos: readonly MetaCampo[],
  actual: OrdenDetalle,
  clave: string
): Direccion {
  if (actual.clave !== clave) {
    return campos.find((c) => c.clave === clave)?.inicial ?? 'desc'
  }
  return actual.direccion === 'desc' ? 'asc' : 'desc'
}

/**
 * El texto del tope, dicho desde el orden vigente.
 *
 * Devuelve `null` cuando no hay recorte: si caben todas, no hay nada que
 * advertir y añadir una frase solo hace ruido.
 */
export function resumenTope(
  campos: readonly MetaCampo[],
  orden: OrdenDetalle,
  total: number,
  max: number
): string | null {
  if (total <= max) return null
  const campo = campos.find((c) => c.clave === orden.clave) ?? campos[0]
  return `se muestran ${max} de ${total}: ${campo.tope(orden.direccion)}`
}
