/**
 * EL COLOR DE UNA CATEGORÍA SALE DE SU IDENTIDAD, NO DE SU POSICIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * Las fichas ciclaban los colores con `COLORES[(i + 1) % COLORES.length]`,
 * donde `i` es el sitio que ocupa la categoría en la lista. Con eso, «Lavados»
 * salía ámbar o cian según dónde cayera, y CAMBIABA el día que se añadiera una
 * categoría antes o se reordenara el catálogo. Un color que cambia solo no
 * enseña a reconocer nada: la única razón de pintar las fichas es que el ojo
 * encuentre la suya sin leer, y para eso tiene que ser siempre la misma.
 *
 * Aquí el color se deriva del `slug`, que es lo que identifica a la categoría.
 * Reordenar el catálogo, añadir una categoría o quitarla ya no mueve el color
 * de ninguna otra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y EL VIOLETA DE MARCA DEJA DE SER UNA CATEGORÍA
 *
 * `grad-vibe` no está en esta lista, a propósito. Es el héroe, los botones, los
 * sellos y la ficha «Todos». Con el ciclo anterior —seis colores y un `% 6`
 * arrancando en 1— la sexta categoría se lo llevaba, y quedaba pintada igual
 * que el «Todos» de al lado, que es el único activo honesto de la fila.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO SÍ CUESTA
 *
 * Dos categorías pueden coincidir en color, porque hay cinco colores y el
 * catálogo no tiene tope. El ciclo tampoco lo evitaba —a partir de la sexta
 * repetía igual—; lo único que garantizaba era que las cinco primeras salieran
 * distintas, y lo pagaba con que ninguna tuviera color propio. Entre «siempre
 * el mismo color» y «los primeros cinco distintos», manda el primero: el color
 * es decorativo (el texto va en blanco sobre el degradado y se lee igual con
 * cualquiera), así que repetir no rompe nada y moverse sí.
 *
 * Si algún día el negocio quiere parejas fijas —«Lavados SIEMPRE cian»—, el
 * sitio es un mapa `slug → color` consultado antes del reparto, igual que
 * `ICONOS` hace con los iconos. No se añade hoy porque no hay ninguna decidida,
 * y media lista inventada aquí sería una decisión de diseño tomada de paso.
 */

/**
 * Los colores que puede llevar una categoría, como clases de `globals.css`.
 * Sin `grad-vibe`: ese es el de la marca.
 */
export const COLORES_CATEGORIA = [
  'grad-categoria-1',
  'grad-categoria-2',
  'grad-categoria-3',
  'grad-categoria-4',
  'grad-categoria-5',
] as const

export type ColorCategoria = (typeof COLORES_CATEGORIA)[number]

/**
 * Reparto estable a partir del texto del slug.
 *
 * Es un hash sencillo y a propósito: no hace falta que sea bueno repartiendo,
 * hace falta que dé SIEMPRE lo mismo para la misma entrada y que no dependa de
 * nada de fuera. `>>> 0` mantiene el acumulador en entero sin signo, que es lo
 * que evita que un slug largo lo desborde a negativo y el módulo salga fuera
 * de rango.
 */
export function colorDeCategoria(slug: string): ColorCategoria {
  const limpio = slug.trim().toLowerCase()
  // Sin slug no hay identidad de la que derivar nada; se devuelve el primero
  // en vez de reventar: una ficha mal pintada es mejor que una portada rota.
  if (!limpio) return COLORES_CATEGORIA[0]

  let acumulado = 0
  for (let i = 0; i < limpio.length; i++) {
    acumulado = (acumulado * 31 + limpio.charCodeAt(i)) >>> 0
  }
  return COLORES_CATEGORIA[acumulado % COLORES_CATEGORIA.length]
}
