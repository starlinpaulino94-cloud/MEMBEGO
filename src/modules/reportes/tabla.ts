import { normalizarBusqueda } from '@/modules/busqueda/normalizar'

/**
 * EL NÚCLEO DE LAS TABLAS DE REPORTES · ordenar y buscar (rediseño · Fase 7).
 *
 * Las tablas de los ocho reportes eran OCHO COPIAS IDÉNTICAS de la misma
 * función `Tabla` —byte a byte— pegadas al final de cada vista. Veintiséis
 * usos, cero controles: lo que la consulta devolvía era lo único que se podía
 * mirar. Para saber qué método de cobro movió más dinero había que leer la
 * columna entera con el dedo.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ESTÁ AQUÍ Y NO DENTRO DEL COMPONENTE
 *
 * Igual que `serie.ts`: el componente es `'use client'` y no se puede importar
 * desde una prueba. Lo que decide el ORDEN de una tabla de dinero no puede
 * quedar sin guardia, así que vive aparte, en funciones puras, y el componente
 * solo las llama.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LA TRAMPA QUE OBLIGA A QUE UNA CELDA PUEDA LLEVAR `orden`
 *
 * Las filas llegaban ya formateadas: `dinero(142300)` → «RD$142.300,00». Si se
 * ordena ESO como texto, «RD$9,00» queda por encima de «RD$1.200,00», porque
 * el carácter «9» va después del «1». Una tabla de finanzas ordenada al revés
 * no es un defecto estético: es una cifra equivocada en una reunión.
 *
 * Por eso una celda puede ser dos cosas:
 *
 *   · `string` — lo que se ve, y también por lo que se ordena. Columnas de
 *     texto: método, plan, sucursal, motivo.
 *   · `{ texto, orden }` — lo que se ve Y el número crudo del que salió. El
 *     orden usa `orden`; la pantalla, `texto`.
 *
 * Y de ahí sale la regla dura: **a partir de la segunda columna, solo se puede
 * ordenar lo que traiga `orden`**. Una columna de números formateados sin su
 * valor crudo NO se vuelve ordenable —el encabezado no se puede pulsar— en vez
 * de ofrecer un orden que mentiría. Un control que da un resultado falso es
 * peor que no tener control.
 */

/** Una celda: texto suelto, o texto con el número crudo del que salió. */
export type CeldaReporte = string | { texto: string; orden: number | null }

export type Direccion = 'asc' | 'desc'

export interface OrdenTabla {
  columna: number
  direccion: Direccion
}

/**
 * A partir de cuántas filas aparecen el buscador y la densidad.
 *
 * Debajo de esto los controles estorban más de lo que ayudan: buscar en una
 * tabla de cuatro filas es más trabajo que leerla. Los reportes agrupan hasta
 * `TOPE_GRUPOS` filas (30 o 50 según el reporte), así que la misma tabla puede
 * tener tres filas un martes y cuarenta el mes siguiente; el umbral decide en
 * cada render, no al escribir la pantalla.
 */
export const UMBRAL_CONTROLES = 8

/** Helper de llamada: `num(1200, dinero(1200))` en vez de dos campos a mano. */
export function num(orden: number | null, texto: string): CeldaReporte {
  return { texto, orden }
}

export function textoDe(c: CeldaReporte): string {
  return typeof c === 'string' ? c : c.texto
}

/** `undefined` = la celda no trae número; distinto de `null` = no hay valor. */
export function ordenDe(c: CeldaReporte): number | null | undefined {
  return typeof c === 'string' ? undefined : c.orden
}

/**
 * Qué columnas se pueden ordenar.
 *
 * La primera siempre: es la de texto —así alinea la tabla desde siempre, y un
 * nombre ordenado alfabéticamente significa exactamente lo que parece.
 *
 * El resto, solo si TODAS sus celdas traen `orden`. Basta una formateada a
 * pelo para que la columna entera deje de ser ordenable, porque el orden de
 * esa fila sería inventado.
 */
export function columnasOrdenables(filas: CeldaReporte[][], columnas: number): boolean[] {
  return Array.from({ length: columnas }, (_, i) => {
    if (i === 0) return filas.length > 1
    if (filas.length < 2) return false
    return filas.every((f) => typeof f[i] === 'object' && f[i] !== null)
  })
}

/**
 * Ordena sin perder el orden del motor.
 *
 * El `sort` de JavaScript es estable desde ES2019, pero el desempate importa
 * lo suficiente como para no dejarlo implícito: cuando dos filas empatan en la
 * columna elegida, se quedan como las devolvió la consulta —que ya venía
 * ordenada por lo que el reporte considera principal—. Sin eso, dos empates
 * podrían intercambiarse entre dos pulsaciones y parecería que la tabla se
 * mueve sola.
 *
 * **Los huecos van SIEMPRE al final**, suba o baje el orden. Un `null` es «no
 * hay dato», no «cero»: ponerlo primero al ordenar ascendente diría que esa
 * fila es la más pequeña, y no lo es — no se sabe.
 */
export function ordenarFilas(
  filas: CeldaReporte[][],
  orden: OrdenTabla | null
): CeldaReporte[][] {
  if (!orden) return filas
  const { columna, direccion } = orden
  const signo = direccion === 'asc' ? 1 : -1

  return filas
    .map((fila, i) => ({ fila, i }))
    .sort((a, b) => {
      const ca = a.fila[columna]
      const cb = b.fila[columna]
      const na = ordenDe(ca)
      const nb = ordenDe(cb)

      if (na !== undefined || nb !== undefined) {
        // Huecos al final, en las dos direcciones.
        if (na == null && nb == null) return a.i - b.i
        if (na == null) return 1
        if (nb == null) return -1
        if (na !== nb) return (na - nb) * signo
        return a.i - b.i
      }

      const cmp = textoDe(ca).localeCompare(textoDe(cb), 'es', {
        numeric: true,
        sensitivity: 'base',
      })
      return cmp !== 0 ? cmp * signo : a.i - b.i
    })
    .map((x) => x.fila)
}

/**
 * Filtra por lo que se VE, no por el valor crudo.
 *
 * Quien escribe «tarjeta» busca la palabra que tiene delante. Y sin acentos ni
 * mayúsculas, con la misma función que usa la búsqueda de la base, para que
 * «citas de josé» y «cita de jose» encuentren lo mismo aquí y allá.
 */
export function filtrarFilas(filas: CeldaReporte[][], q: string): CeldaReporte[][] {
  const aguja = normalizarBusqueda(q)
  if (!aguja) return filas
  return filas.filter((f) => f.some((c) => normalizarBusqueda(textoDe(c)).includes(aguja)))
}

/** El siguiente estado al pulsar un encabezado. Tres pasos, y vuelta a empezar. */
export function siguienteOrden(actual: OrdenTabla | null, columna: number): OrdenTabla | null {
  if (!actual || actual.columna !== columna) {
    // La primera pulsación baja: en un reporte casi siempre se busca el mayor.
    return { columna, direccion: 'desc' }
  }
  if (actual.direccion === 'desc') return { columna, direccion: 'asc' }
  // Tercera pulsación: se quita el orden y vuelve el del motor.
  return null
}

/**
 * Una celda de porcentaje que se puede ordenar — y que no finge un cero.
 *
 * Sin base no hay porcentaje. Las tablas ya escribían «—» o «Sin dato» en ese
 * caso, y tenían razón: en «% de las altas» sobre cero altas, un «0 %» diría
 * que esa fila aportó nada cuando lo cierto es que no hay de qué calcularlo.
 * Aquí eso se conserva y además se le pone `orden: null`, para que al ordenar
 * la columna esas filas caigan al final en vez de encabezar el ascendente.
 *
 * `orden` lleva el valor SIN redondear: dos filas que se enseñan como «33 %»
 * se ordenan entre sí por lo que de verdad valen, no por el texto que
 * comparten.
 */
export function porcentaje(parte: number, base: number | null, vacio = '—'): CeldaReporte {
  if (base == null || base === 0) return { texto: vacio, orden: null }
  const v = (parte / base) * 100
  return { texto: `${Math.round(v)} %`, orden: v }
}

/** Lo mismo para una razón que no es porcentaje: clics por compartido, etc. */
export function razon(
  parte: number,
  base: number | null,
  decimales = 1,
  vacio = '—'
): CeldaReporte {
  if (base == null || base === 0) return { texto: vacio, orden: null }
  const v = parte / base
  return { texto: v.toFixed(decimales), orden: v }
}
