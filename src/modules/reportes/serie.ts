import { type Granularidad } from '@/modules/reportes/rango'

/**
 * Reportes · PLEGAR LA SERIE — de días a semanas o meses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE PLIEGA AQUÍ Y NO EN SQL
 *
 * Las ocho series del módulo ya salen de la base agrupadas por día Y cortadas
 * en la zona horaria del negocio (`AT TIME ZONE`), que es la parte difícil y la
 * que no se puede hacer en JavaScript sin equivocarse. Plegar esos días en
 * semanas o meses es una suma, y hacerla aquí tiene tres ventajas concretas:
 *
 *  · NO se toca ni una consulta. Ocho motores siguen igual, y la semana nunca
 *    puede discrepar del día porque sale exactamente de los mismos números.
 *  · El corte del día sigue siendo el del negocio. Si la agrupación se
 *    reescribiera con `date_trunc`, habría que volver a pasarle la zona a cada
 *    consulta y una que se olvidara cortaría en UTC sin avisar.
 *  · Se puede probar con un reloj fijo y sin base de datos.
 *
 * El coste es traer hasta ~370 filas por serie, que ya se traían.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO SIRVE PARA CIFRAS QUE SE SUMAN
 *
 * Plegar suma cada campo numérico del punto. Eso es correcto para conteos y
 * para dinero —los ocho casos de hoy—, y sería MENTIRA para un promedio, una
 * tasa o un porcentaje: la media de una semana no es la suma de las medias de
 * sus días.
 *
 * Por eso el tipo exige `Punto`, cuyos campos son todos números aditivos, y una
 * prueba comprueba que ninguna serie del módulo meta una tasa. Si algún día
 * hace falta una media por semana, hay que calcularla sobre los totales
 * plegados, nunca plegando la media diaria.
 */

/** Un punto de serie: el día y sus cifras, todas sumables. */
export interface Punto {
  dia: string
}

/** El lunes de la semana de `dia`, en formato `YYYY-MM-DD`. */
function lunes(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const fecha = new Date(Date.UTC(a, m - 1, d))
  // `getUTCDay()` da 0 para domingo; la semana del negocio empieza en lunes,
  // igual que el preset «Esta semana» de `rango.ts`.
  const desplazamiento = (fecha.getUTCDay() + 6) % 7
  fecha.setUTCDate(fecha.getUTCDate() - desplazamiento)
  return fecha.toISOString().slice(0, 10)
}

/** La clave del cubo al que pertenece un día. */
function cubo(dia: string, granularidad: Granularidad): string {
  if (granularidad === 'mes') return `${dia.slice(0, 7)}-01`
  if (granularidad === 'semana') return lunes(dia)
  return dia
}

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

/**
 * Cómo se lee un cubo en el eje de la gráfica y en la tabla.
 *
 * La semana dice «sem. 14/09» y no la fecha suelta, porque «14/09» en un eje
 * semanal se lee como un día y confunde. El mes lleva el año cuando el rango
 * cruza de uno a otro: «ene» detrás de «dic» sin año no dice cuál enero es.
 */
export function etiquetaCubo(
  clave: string,
  granularidad: Granularidad,
  opciones: { conAno?: boolean } = {}
): string {
  const [a, m, d] = clave.split('-')
  if (granularidad === 'mes') {
    const nombre = MESES[Number(m) - 1] ?? m
    return opciones.conAno ? `${nombre} ${a}` : nombre
  }
  if (granularidad === 'semana') return `sem. ${d}/${m}`
  return `${d}/${m}`
}

/**
 * Pliega una serie diaria en semanas o meses sumando cada campo.
 *
 * Devuelve los cubos en el mismo orden en que venían los días, así que un
 * rango que empieza a media semana da un primer cubo parcial — y eso es lo
 * correcto: enseña lo que pasó DENTRO del periodo elegido, no la semana
 * completa a la que ese tramo pertenece.
 */
export function plegarSerie<T extends Punto>(puntos: T[], granularidad: Granularidad): T[] {
  if (granularidad === 'dia' || puntos.length === 0) return puntos

  const cubos = new Map<string, T>()
  for (const punto of puntos) {
    const clave = cubo(punto.dia, granularidad)
    const acumulado = cubos.get(clave)
    if (!acumulado) {
      cubos.set(clave, { ...punto, dia: clave })
      continue
    }
    // El acceso indexado va por aquí porque `T` es genérico: `Punto` garantiza
    // que `dia` es lo único que no es número, y los demás campos se suman.
    const destino = acumulado as unknown as Record<string, unknown>
    for (const [campo, valor] of Object.entries(punto)) {
      if (campo === 'dia' || typeof valor !== 'number') continue
      const previo = destino[campo]
      destino[campo] = (typeof previo === 'number' ? previo : 0) + valor
    }
  }
  return [...cubos.values()]
}

/**
 * La serie lista para pintar: plegada y con su etiqueta ya puesta.
 *
 * `GraficoTendencia` acepta una etiqueta ya formateada en `dia` precisamente
 * para esto; si se le pasara la fecha cruda del cubo, un mes saldría rotulado
 * como «01/09», que se lee como el primer día de septiembre y no como
 * septiembre entero.
 */
export function serieParaGrafico<T extends Punto>(
  puntos: T[],
  granularidad: Granularidad
): (T & { clave: string })[] {
  const plegada = plegarSerie(puntos, granularidad)
  const anos = new Set(plegada.map((p) => p.dia.slice(0, 4)))
  return plegada.map((p) => ({
    ...p,
    clave: p.dia,
    dia: granularidad === 'dia' ? p.dia : etiquetaCubo(p.dia, granularidad, { conAno: anos.size > 1 }),
  }))
}
