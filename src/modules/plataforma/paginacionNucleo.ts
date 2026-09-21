/**
 * PAGINACIÓN POR CURSOR de la API pública — núcleo puro (hallazgo B-6).
 *
 * Sin Prisma, sin red, sin `server-only`: el tamaño de página, el formato del
 * cursor y el corte de la página se prueban aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * Los listados tenían un tope FIJO Y SILENCIOSO: las citas traían 500 filas y
 * nada decía que hubiera más. Un satélite con 501 citas en el mes se llevaba
 * 500, no recibía ningún error, y perdía la 501 sin enterarse — hasta que un
 * informe no cuadraba y no había forma de saber por qué.
 *
 * Un cursor arregla las dos mitades: acota lo que viaja en cada respuesta Y
 * dice, con `nextCursor`, que queda más. «No hay más» y «no cabe más» dejan de
 * confundirse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ CURSOR Y NO `offset`/`page=2`
 *
 * Un `offset` se desplaza sobre una lista que cambia entre página y página: si
 * llega una cita nueva mientras se pagina, la fila del borde se lee dos veces o
 * se salta. El cursor ancla en una fila concreta y sigue DESPUÉS de ella, así
 * que las inserciones no descolocan lo ya leído. Es también más barato para la
 * base: no cuenta ni descarta las `offset` filas de antes.
 *
 * La condición para que un cursor no salte ni duplique es que el orden sea
 * DETERMINISTA — que no haya empates. Por eso cada listado que pagina termina su
 * `orderBy` en `id`: dos citas a la misma hora se ordenan igual siempre, y el
 * cursor cae entre dos filas concretas y no en medio de un empate.
 */

/** Filas por página cuando no se pide otra cosa. */
export const LIMITE_DEFECTO = 50

/** Techo: por mucho que se pida, no se sirven más de una vez. */
export const LIMITE_MAXIMO = 200

/**
 * Marca de versión DENTRO del cursor, antes de codificar.
 *
 * El cursor es OPACO a propósito: quien integra no debe construirlo a mano —hoy
 * lleva un id, mañana podría llevar una clave compuesta— y este prefijo permite
 * cambiar el formato sin que un cursor viejo se lea como uno nuevo. Un cursor
 * sin la marca es de otra época (o inventado) y se rechaza.
 */
const MARCA = 'mbc1:'

export type LimitePedido = { ok: true; limite: number } | { ok: false }

/**
 * Interpreta `?limit=`. Ausente = el defecto; presente pero absurdo = error, no
 * un defecto silencioso: quien manda `limit=0` se equivocó y prefiere saberlo a
 * recibir una página que no pidió.
 */
export function parsearLimite(raw: string | null | undefined): LimitePedido {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { ok: true, limite: LIMITE_DEFECTO }
  }
  if (!/^\d+$/.test(raw.trim())) return { ok: false }
  const n = Number(raw.trim())
  if (n < 1) return { ok: false }
  return { ok: true, limite: Math.min(n, LIMITE_MAXIMO) }
}

export type CursorLeido =
  | { presente: false }
  | { presente: true; ok: true; id: string }
  | { presente: true; ok: false }

/**
 * Interpreta `?cursor=`. Distingue tres cosas que la ruta trata distinto:
 * ausente (primera página), válido (seguir desde su id), y presente pero
 * ilegible (error). Un cursor roto NO se trata como ausente: empezar de cero en
 * silencio dejaría a un cliente paginando el mismo principio para siempre, sin
 * una sola señal de que algo va mal.
 */
export function decodificarCursor(raw: string | null | undefined): CursorLeido {
  if (raw === null || raw === undefined || raw.trim() === '') return { presente: false }
  try {
    const texto = Buffer.from(raw.trim(), 'base64url').toString('utf8')
    if (!texto.startsWith(MARCA)) return { presente: true, ok: false }
    const id = texto.slice(MARCA.length)
    if (!id) return { presente: true, ok: false }
    return { presente: true, ok: true, id }
  } catch {
    return { presente: true, ok: false }
  }
}

/** El cursor opaco que apunta a una fila. Lo lee `decodificarCursor`, nadie más. */
export function codificarCursor(id: string): string {
  return Buffer.from(`${MARCA}${id}`, 'utf8').toString('base64url')
}

export interface Pagina<T> {
  items: T[]
  /** Cursor para la siguiente página, o `null` cuando ya no queda más. */
  nextCursor: string | null
}

/**
 * Corta la página a partir de las filas traídas con `take: limite + 1`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL «+1» ES CÓMO SE SABE SI HAY MÁS SIN CONTAR
 *
 * Se pide una fila de más de las que caben. Si vuelve esa fila extra, hay al
 * menos una página más y `nextCursor` apunta a la ÚLTIMA que SÍ se devuelve —no
 * a la extra, que no se enseña—. Si no vuelve, esta era la última página y
 * `nextCursor` es null. Así «hay más» se resuelve con la misma consulta, sin un
 * `count()` aparte que además mentiría en cuanto entrara una fila nueva.
 */
export function construirPagina<T extends { id: string }>(filas: T[], limite: number): Pagina<T> {
  const hayMas = filas.length > limite
  const items = hayMas ? filas.slice(0, limite) : filas
  const ultima = items[items.length - 1]
  return {
    items,
    nextCursor: hayMas && ultima ? codificarCursor(ultima.id) : null,
  }
}
