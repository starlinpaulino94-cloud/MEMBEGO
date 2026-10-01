import type { SupplyV2AvailabilityMode } from '@prisma/client'
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

// ── Slice 5 · ofertas a COMISIÓN (§10–§15) ───────────────────────────────────

export const AVAILABILITY_MODES: readonly SupplyV2AvailabilityMode[] = ['UNLIMITED', 'FIXED_QUANTITY', 'CAPACITY']

export interface DatosOfertaComision {
  catalogItemId: string
  title: string
  description?: string | null
  publicPrice: number | string
  salePrice: number | string
  availabilityMode: SupplyV2AvailabilityMode
  /** Obligatoria en FIXED_QUANTITY y CAPACITY; ignorada en UNLIMITED. */
  availabilityQuantity?: number | null
  perCustomerLimit?: number | null
  startsAt: Date
  endsAt?: Date | null
  imagePath?: string | null
}

export function validarOfertaComision(d: DatosOfertaComision): string | null {
  if (!d.catalogItemId) return 'La oferta necesita un producto.'
  if (!d.title?.trim()) return 'La oferta necesita un título.'
  if (d.title.trim().length > 160) return 'El título es demasiado largo.'
  const precio = validarPreciosOferta(d.publicPrice, d.salePrice)
  if (precio) return precio
  if (!AVAILABILITY_MODES.includes(d.availabilityMode)) return 'El modo de disponibilidad no es válido.'
  const limite = d.perCustomerLimit ?? 1
  if (!Number.isInteger(limite) || limite <= 0) return 'El máximo por persona tiene que ser un entero positivo.'
  if (d.availabilityMode !== 'UNLIMITED') {
    const q = d.availabilityQuantity
    if (q == null || !Number.isInteger(q) || q <= 0) return 'Indica cuántas unidades (o cupos) puede entregar el proveedor.'
    if (limite > q) return 'El máximo por persona no puede superar las unidades disponibles.'
  }
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de fin no es válida.'
    if (d.endsAt <= d.startsAt) return 'La fecha de fin tiene que ser posterior a la de inicio.'
  }
  return null
}

export interface DisponibilidadComision {
  availabilityMode: SupplyV2AvailabilityMode | null
  availabilityQuantity: number | null
}

/**
 * Unidades que todavía se pueden vender en una oferta a comisión (§14):
 * `null` = sin tope. En FIXED_QUANTITY / CAPACITY: tope − (reservas ACTIVE +
 * CONSUMED). RELEASED y EXPIRED no cuentan.
 */
export function unidadesLibresComision(o: DisponibilidadComision, reservadasOConsumidas: number): number | null {
  if (!o.availabilityMode || o.availabilityMode === 'UNLIMITED') return null
  return Math.max(0, (o.availabilityQuantity ?? 0) - reservadasOConsumidas)
}

/** Lo que el motor de compra necesita: un número grande cuando no hay tope. */
export const SIN_TOPE = Number.MAX_SAFE_INTEGER
