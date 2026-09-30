import { validarPreciosOferta } from '../core/precios'

/**
 * MEMBEGO SUPPLY 2.0 · ofertas: reglas puras (§7–§15).
 */

export interface DatosOferta {
  catalogItemId: string
  title: string
  description?: string | null
  publicPrice: number | string
  salePrice: number | string
  quantity: number
  perCustomerLimit?: number | null
  startsAt: Date
  endsAt?: Date | null
  imagePath?: string | null
}

export function validarOferta(d: DatosOferta): string | null {
  if (!d.catalogItemId) return 'La oferta necesita un producto.'
  if (!d.title?.trim()) return 'La oferta necesita un título.'
  if (d.title.trim().length > 160) return 'El título es demasiado largo.'
  const precio = validarPreciosOferta(d.publicPrice, d.salePrice)
  if (precio) return precio
  if (!Number.isInteger(d.quantity) || d.quantity <= 0) return 'La cantidad a destinar tiene que ser un entero positivo.'
  const limite = d.perCustomerLimit ?? 1
  if (!Number.isInteger(limite) || limite <= 0) return 'El máximo por persona tiene que ser un entero positivo.'
  if (limite > d.quantity) return 'El máximo por persona no puede superar las unidades de la oferta.'
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de fin no es válida.'
    if (d.endsAt <= d.startsAt) return 'La fecha de fin tiene que ser posterior a la de inicio.'
  }
  return null
}

export function slugDeOferta(titulo: string, codigo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${base || 'oferta'}-${codigo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** Unidades que todavía se pueden vender dentro de la oferta (§18). */
export function unidadesLibres(a: { allocatedQuantity: number; reservedQuantity: number; issuedQuantity: number; releasedQuantity: number }): number {
  return Math.max(0, a.allocatedQuantity - a.reservedQuantity - a.issuedQuantity - a.releasedQuantity)
}
