/**
 * Plurales, de una vez y en un solo sitio.
 *
 * El síntoma que lo motiva es pequeño y está por todas partes: «1 clientes»,
 * «los 1 registro(s)». Lo del paréntesis es peor que el plural mal: es el
 * sistema diciéndole a quien lee «no me molesté». En una pantalla que por lo
 * demás está cuidada, ese detalle es justo lo que hace dudar del resto.
 *
 * Módulo PURO: sin `server-only`, así se prueba sin base de datos y sirve igual
 * en cliente y en servidor.
 */

/**
 * «1 cliente» / «2 clientes».
 *
 * El plural se pasa entero y no como sufijo. En español la mayoría son `+s`,
 * pero «mes → meses» y «vez → veces» no, y una función que solo sepa añadir `s`
 * obliga a escribir el caso raro a mano justo donde nadie se acuerda.
 */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Igual, pero sin repetir el número: para cuando ya está escrito al lado.
 *
 *     `Borra ${n} ${soloPlural(n, 'registro', 'registros')}`
 */
export function soloPlural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/**
 * «hace 2 h» / «hace 23 días» / «hace 3 meses», a partir de milisegundos.
 *
 * Recibe la distancia ya medida y no una fecha A PROPÓSITO: el «ahora» lo fija
 * quien consulta los datos, una sola vez. Leer el reloj dentro del render es
 * impuro —el linter de React lo rechaza— y además daría un instante distinto por
 * cada fila de una lista.
 *
 * Vive aquí y no en un módulo de dominio porque ya lo quieren tres pantallas:
 * el Centro de control, el CRM de empresas y las de demostración.
 */
export function desdeHace(ms: number | null): string {
  if (ms === null) return 'sin actividad'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return 'hace un momento'
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias < 31) return `hace ${plural(dias, 'día', 'días')}`
  const meses = Math.floor(dias / 30)
  return `hace ${plural(meses, 'mes', 'meses')}`
}
