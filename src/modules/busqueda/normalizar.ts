/**
 * BUSCAR SIN ACENTOS · el lado de la aplicación.
 *
 * `ILIKE` de PostgreSQL ignora mayúsculas pero NO acentos: para él «José» y
 * «Jose» son palabras distintas. Quien escribe rápido, o desde un teclado sin
 * tildes, no encontraba a nadie — y no tenía forma de saber por qué.
 *
 * Tampoco se puede resolver solo aquí: expandir «jose» a todas sus variantes
 * acentuadas son dos posibilidades por vocal, y con paginación no se puede
 * filtrar en memoria. Así que la base guarda una copia del nombre ya
 * normalizada (`nombreBusqueda`, mantenida por un disparador) y esta función
 * normaliza lo que el usuario escribe. Los dos lados tienen que producir
 * EXACTAMENTE lo mismo o la búsqueda falla en silencio.
 *
 * La equivalencia con `unaccent` de PostgreSQL, comprobada carácter a carácter
 * en las pruebas: á→a, é→e, í→i, ó→o, ú→u, ü→u, ñ→n, ç→c.
 *
 * Sobre la eñe: `unaccent` la convierte en «n», y esta función también. En
 * español es una letra propia, no una «n» con virgulilla, así que podría
 * discutirse — pero para BUSCAR es lo que conviene: quien escribe «nino»
 * encuentra «Niño», y quien escribe «Niño» lo encuentra igual. Lo que no se
 * puede es que los dos lados discrepen.
 */

/**
 * Deja el texto como lo guarda la columna de búsqueda: sin acentos, en
 * minúsculas y sin espacios de sobra.
 *
 * `NFD` separa cada letra de su acento y el rango `̀-ͯ` borra los
 * acentos sueltos que quedan.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Lo que se le pasa a Prisma para buscar por nombre.
 *
 * Devuelve `null` cuando no queda nada que buscar, para que quien llama pueda
 * omitir la condición en vez de filtrar por la cadena vacía —que casaría con
 * todo y parecería que el filtro no hace nada.
 *
 * No lleva `mode: 'insensitive'` a propósito: la columna ya está en
 * minúsculas, así que sería trabajo de más y desaprovecharía el índice.
 */
export function filtroNombre(texto: string | null | undefined): { contains: string } | null {
  const q = normalizarBusqueda(texto ?? '')
  return q ? { contains: q } : null
}
