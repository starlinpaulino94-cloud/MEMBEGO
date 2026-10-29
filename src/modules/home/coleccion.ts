/**
 * LA COLECCIÓN DE UN BANNER: los productos y servicios que el negocio le
 * enganchó. Puro (sin Prisma ni Next): lo usan el esquema, la ruta y la página.
 *
 * Al tocar un banner con destino «Productos y servicios» se abre un catálogo
 * con ESOS ítems como principales y, debajo, lo que venden empresas
 * relacionadas (misma categoría de negocio). Los ids viajan en la URL
 * (`?i=a,b,c`): la página solo enseña los que sean públicos y de esa empresa,
 * así que una URL retocada a mano no puede mostrar nada que no fuera público.
 */

/** Cuántos productos o servicios puede enganchar un banner. */
export const MAX_ITEMS_BANNER = 12

/** Un id de la base (cuid): letras y dígitos, sin separadores. */
const ID_VALIDO = /^[a-z0-9]{10,40}$/i

/** De `?i=a,b,c` a una lista limpia: sin vacíos, sin repetidos, sin ids raros y con tope. */
export function parsearIdsDeColeccion(crudo: string | string[] | null | undefined): string[] {
  const texto = Array.isArray(crudo) ? crudo.join(',') : (crudo ?? '')
  const salida: string[] = []
  for (const parte of texto.split(',')) {
    const id = parte.trim()
    if (!ID_VALIDO.test(id) || salida.includes(id)) continue
    salida.push(id)
    if (salida.length >= MAX_ITEMS_BANNER) break
  }
  return salida
}

/** El título de la colección que llega por la URL: texto corto, sin saltos. */
export function limpiarTituloDeColeccion(crudo: string | string[] | null | undefined): string | null {
  const texto = (Array.isArray(crudo) ? crudo[0] : crudo)?.replace(/\s+/g, ' ').trim() ?? ''
  return texto ? texto.slice(0, 80) : null
}
