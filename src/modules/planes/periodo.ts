import { plural } from '@/lib/plural'

/**
 * CADA CUÁNTO SE PAGA UN PLAN. Módulo PURO: se prueba sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * Las dos pantallas de planes —la del superadmin y la de la empresa— escribían
 * `/mes` A MANO, siempre, junto al precio. Pero `vigenciaDias` es un campo del
 * plan y el formulario lo pide explícitamente: puede ser 7, 90 o 365.
 *
 * Es decir: un plan anual de RD$1,600 salía en pantalla como
 * **«RD$1,600/mes»**. No es un detalle de redacción — es un precio falso, en la
 * pantalla donde se decide cuánto cobrar, y en la única cifra que alguien mira
 * de verdad.
 *
 * Y lo que lo hacía indetectable: la vigencia real no se enseñaba en ningún
 * sitio de la pantalla del superadmin. No había forma de notar la
 * contradicción.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ VIVE AQUÍ Y NO EN CADA PANTALLA
 *
 * Porque son dos pantallas con el mismo defecto. Arreglar una y dejar la otra
 * deja al dueño de la empresa leyendo el precio falso mientras el superadmin lo
 * lee bien — que es peor que el error original, porque ahora además se
 * contradicen. Una definición, dos pantallas.
 */

/**
 * El sufijo que acompaña al precio: `/mes`, `/año`, `/90 días`…
 *
 * LOS RANGOS NO SON CAPRICHO. Un mes son 28, 29, 30 o 31 días según cuál, y un
 * año 365 o 366. Quien configure «31 días» quiere decir un mes, y exigirle el
 * número exacto para que la pantalla lo entienda sería hacerle aprender la
 * regla interna. Lo que no encaje en ningún tramo se dice tal cual —«/45
 * días»—, que es feo pero exacto; inventarle un nombre sería volver al
 * problema.
 */
export function sufijoPeriodo(vigenciaDias: number): string {
  const d = Math.round(vigenciaDias)
  if (!Number.isFinite(d) || d < 1) return ''
  if (d === 1) return '/día'
  if (d === 7) return '/semana'
  if (d >= 14 && d <= 16) return '/quincena'
  if (d >= 28 && d <= 31) return '/mes'
  if (d >= 89 && d <= 92) return '/trimestre'
  if (d >= 180 && d <= 184) return '/semestre'
  if (d >= 364 && d <= 366) return '/año'
  return `/${plural(d, 'día', 'días')}`
}

/**
 * La vigencia dicha entera, para ponerla al lado del precio.
 *
 * Se enseña SIEMPRE, también cuando el sufijo ya dice «/mes». Parece
 * redundante y no lo es: el sufijo es una interpretación —30 y 31 días dicen
 * los dos «/mes»— y este es el dato tal como está guardado. Cuando alguien
 * revisa por qué una membresía venció «un día antes de tiempo», es este número
 * el que responde.
 */
export function textoVigencia(vigenciaDias: number): string {
  const d = Math.round(vigenciaDias)
  if (!Number.isFinite(d) || d < 1) return 'Sin vigencia definida'
  return `Vigencia ${plural(d, 'día', 'días')}`
}
