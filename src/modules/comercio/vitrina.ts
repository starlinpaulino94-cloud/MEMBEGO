import type { ItemPublicoResumen } from '@/modules/catalog/publico-nucleo'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'

/**
 * COMERCIO · lo que la VITRINA compone a partir de dos proyecciones públicas que
 * ya existen: los ítems del catálogo y las ofertas sobre ellos. Puro, sin
 * Prisma. Vive aquí (y no en catálogo) porque el catálogo no sabe de ofertas:
 * la oferta REFERENCIA al producto, nunca al revés.
 *
 * Así una tarjeta de producto puede enseñar «Antes / Ahora / 20 % OFF» sin que
 * exista un «producto promoción» duplicado: la oferta es una regla económica
 * sobre el mismo ítem.
 */

/** La mejor oferta viva sobre un ítem (la de menor precio final), o null. */
export function ofertaDelItem(item: Pick<ItemPublicoResumen, 'slug' | 'company'>, ofertas: readonly OfertaPublica[]): OfertaPublica | null {
  let mejor: OfertaPublica | null = null
  for (const o of ofertas) {
    if (o.itemSlug !== item.slug || o.empresa.slug !== item.company.slug) continue
    if (!mejor || Number(o.precioAhora) < Number(mejor.precioAhora)) mejor = o
  }
  return mejor
}

/** Índice slug-de-empresa/slug-de-ítem → mejor oferta, para pintar muchas tarjetas de una vez. */
export function indiceDeOfertas(ofertas: readonly OfertaPublica[]): Map<string, OfertaPublica> {
  const m = new Map<string, OfertaPublica>()
  for (const o of ofertas) {
    const k = `${o.empresa.slug}/${o.itemSlug}`
    const actual = m.get(k)
    if (!actual || Number(o.precioAhora) < Number(actual.precioAhora)) m.set(k, o)
  }
  return m
}

export const claveDeItem = (item: Pick<ItemPublicoResumen, 'slug' | 'company'>): string => `${item.company.slug}/${item.slug}`

/** «% OFF» legible a partir de los precios públicos, o null si no es un porcentaje redondo útil. */
export function porcentajeDeAhorro(o: Pick<OfertaPublica, 'precioAntes' | 'precioAhora'>): number | null {
  const antes = Number(o.precioAntes)
  const ahora = Number(o.precioAhora)
  if (!Number.isFinite(antes) || antes <= 0 || !Number.isFinite(ahora)) return null
  const pct = Math.round(((antes - ahora) / antes) * 100)
  return pct > 0 ? pct : null
}

/**
 * Qué es un «servicio» a ojos del consumidor: lo que se presta, no lo que se
 * entrega. Las membresías tienen su propia sección (planes) y los vouchers y
 * tarjetas de regalo se compran como productos.
 */
export const esServicio = (item: Pick<ItemPublicoResumen, 'type'>): boolean => item.type === 'SERVICE'

export function separarCatalogo<T extends Pick<ItemPublicoResumen, 'type'>>(items: readonly T[]): { productos: T[]; servicios: T[] } {
  return { productos: items.filter((i) => !esServicio(i)), servicios: items.filter((i) => esServicio(i)) }
}

/** Texto del botón principal según lo que se compra: no se usa el mismo CTA para todo. */
export function ctaDelItem(item: Pick<ItemPublicoResumen, 'type' | 'origen' | 'disponibilidad'>, conOferta: boolean): string {
  if (item.origen === 'SUPPLY') return 'Ver oferta Membego'
  if (item.disponibilidad === 'AGOTADO') return 'Ver detalle'
  if (conOferta) return 'Obtener oferta'
  return esServicio(item) ? 'Reservar' : 'Ver producto'
}
