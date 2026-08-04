/**
 * Promociones · SLUG PÚBLICO — núcleo puro.
 *
 * Para qué: hoy una promoción se comparte como
 * `membego.com/promocion/cmd7k2p9x0001qz3f8b2h4t1a`. Ese enlace no dice nada,
 * se corta feo en WhatsApp y nadie lo reconoce. Con slug queda
 * `membego.com/promocion/lavado-premium-gratis`.
 *
 * REGLA DE ORO: el slug de una promoción NO cambia cuando se le edita el
 * título. Un enlace ya compartido por WhatsApp seguiría circulando meses; si el
 * slug cambiara, ese enlace moriría. Los slugs se asignan una vez y se quedan.
 *
 * Sin Prisma ni React: se puede probar entero.
 */

/** Tope de longitud: un slug largo se corta en las vistas previas al compartir. */
export const MAX_SLUG = 60

/**
 * Palabras que no aportan nada al identificar la promoción y solo alargan la
 * URL. Se quitan únicamente si queda algo después.
 */
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'con', 'por', 'para', 'un', 'una'])

/**
 * Identificadores generados por la base (cuid): 25 caracteres que empiezan con
 * `c`. Sirve para saber si lo que viene en la URL es un id viejo o un slug.
 */
const ES_ID = /^c[a-z0-9]{20,30}$/i

/** Convierte un texto en un slug: sin acentos, sin símbolos, con guiones. */
export function slugificar(texto: string): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // acentos
    .replace(/ñ/gi, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!limpio) return ''

  const partes = limpio.split('-').filter(Boolean)
  // Quitar palabras vacías solo si sobrevive algo: «El y la» debe seguir dando
  // un slug, aunque sea feo, en vez de una URL vacía.
  const utiles = partes.filter((p) => !VACIAS.has(p))
  const base = (utiles.length > 0 ? utiles : partes).join('-')

  if (base.length <= MAX_SLUG) return base
  // Cortar por palabra completa: «lavado-premium-con-cera-y-aspir» se lee peor
  // que «lavado-premium-con-cera».
  const cortado = base.slice(0, MAX_SLUG)
  const ultimoGuion = cortado.lastIndexOf('-')
  return ultimoGuion > 20 ? cortado.slice(0, ultimoGuion) : cortado.replace(/-+$/, '')
}

/**
 * ¿Lo que viene en la URL es un id de la base o un slug?
 *
 * Importa porque los enlaces viejos (con id) deben seguir funcionando para
 * siempre: se resuelve por slug o por id según lo que llegue.
 */
export function pareceId(valor: string): boolean {
  return ES_ID.test(valor.trim())
}

/**
 * Slug libre dentro de la empresa. `ocupados` son los slugs que ya existen ahí.
 *
 * Los sufijos empiezan en `-2` porque «promo-1» sugiere que hay una serie, y
 * casi siempre es solo la segunda vez que se repite un título.
 */
export function slugDisponible(
  titulo: string,
  ocupados: Iterable<string>,
  reserva = 'promocion'
): string {
  const base = slugificar(titulo) || reserva
  const tomados = new Set([...ocupados].map((s) => s.toLowerCase()))
  if (!tomados.has(base)) return base

  for (let n = 2; n < 1000; n++) {
    const sufijo = `-${n}`
    // El sufijo cuenta para el tope: si no, el slug crecería sin control.
    const recortado = base.slice(0, MAX_SLUG - sufijo.length).replace(/-+$/, '')
    const candidato = `${recortado}${sufijo}`
    if (!tomados.has(candidato)) return candidato
  }
  // Salida de emergencia: con 1000 títulos idénticos, algo más raro pasa.
  return `${base.slice(0, MAX_SLUG - 14)}-${Date.now().toString(36)}`
}

/** La ruta pública de una promoción: slug si lo tiene, id si es de las viejas. */
export function rutaPublicaPromo(promo: { id: string; slug?: string | null }): string {
  return `/promocion/${promo.slug || promo.id}`
}
