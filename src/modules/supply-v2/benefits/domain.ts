import type { SupplyV2BenefitFunding, SupplyV2BenefitScope, SupplyV2BenefitStatus, SupplyV2BenefitValueType, SupplyV2CustomerBenefitStatus, SupplyV2OfferSource } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'
import { validarBeneficioParaCalculo } from '../core/financiacion'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · BENEFICIOS: reglas PURAS (§7–§12, §16, §18).
 */

export interface DatosBeneficio {
  name: string
  description?: string | null
  objective?: string | null
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  membegoValue?: number | string | null
  supplierValue?: number | string | null
  maxMembegoAmount?: number | string | null
  maxSupplierAmount?: number | string | null
  scope: SupplyV2BenefitScope
  offerId?: string | null
  catalogItemId?: string | null
  supplierId?: string | null
  budgetTotal?: number | string | null
  perCustomerLimit?: number | null
  requiresAssignment?: boolean | null
  combinable?: boolean | null
  startsAt: Date
  endsAt?: Date | null
}

export const FUNDINGS: readonly SupplyV2BenefitFunding[] = ['MEMBEGO', 'SUPPLIER', 'SHARED']
export const VALUE_TYPES: readonly SupplyV2BenefitValueType[] = ['FIXED_AMOUNT', 'PERCENTAGE']
export const SCOPES: readonly SupplyV2BenefitScope[] = ['SPECIFIC_OFFER', 'CATALOG_ITEM', 'SUPPLIER']

const n = (v: number | string | null | undefined) => (v == null || v === '' ? new Prisma.Decimal(0) : decimal(v))

export function validarBeneficio(d: DatosBeneficio): string | null {
  if (!d.name?.trim()) return 'El beneficio necesita un nombre.'
  if (d.name.trim().length > 120) return 'El nombre es demasiado largo.'
  if (!FUNDINGS.includes(d.funding)) return 'Indica quién financia el beneficio.'
  if (!VALUE_TYPES.includes(d.valueType)) return 'Indica si es un importe fijo o un porcentaje.'
  if (!SCOPES.includes(d.scope)) return 'Indica a qué aplica el beneficio.'
  let m: Decimal
  let s: Decimal
  try {
    m = n(d.membegoValue)
    s = n(d.supplierValue)
  } catch {
    return 'Los valores tienen que ser números.'
  }
  const e = validarBeneficioParaCalculo({ funding: d.funding, valueType: d.valueType, membegoValue: m, supplierValue: s, maxMembegoAmount: d.maxMembegoAmount, maxSupplierAmount: d.maxSupplierAmount })
  if (e) return e
  if (d.funding !== 'MEMBEGO' && !d.supplierId) return 'Un descuento del proveedor necesita el proveedor que lo asume.'
  if (d.scope === 'SPECIFIC_OFFER' && !d.offerId) return 'Elige la oferta a la que aplica.'
  if (d.scope === 'CATALOG_ITEM' && !d.catalogItemId) return 'Elige el producto al que aplica.'
  if (d.scope === 'SUPPLIER' && !d.supplierId) return 'Elige el proveedor cuyas ofertas son elegibles.'
  if (d.budgetTotal != null && d.budgetTotal !== '') {
    const b = decimal(d.budgetTotal)
    if (!b.isFinite() || b.lessThanOrEqualTo(0)) return 'El presupuesto tiene que ser mayor que cero (o dejarse vacío: sin tope).'
    if (d.funding === 'SUPPLIER') return 'Un descuento del proveedor no consume presupuesto de Membego.'
  }
  const limite = d.perCustomerLimit ?? 1
  if (!Number.isInteger(limite) || limite <= 0) return 'El límite por cliente tiene que ser un entero positivo.'
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de vencimiento no es válida.'
    if (d.endsAt <= d.startsAt) return 'El vencimiento tiene que ser posterior al inicio.'
  }
  return null
}

export const TRANSICIONES_BENEFICIO: Transiciones<SupplyV2BenefitStatus> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  EXHAUSTED: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
}

/** Segregación (§34): quien crea el beneficio no lo aprueba si hay más de una persona autorizada. */
export function puedeAprobarBeneficio(b: { createdById: string }, actorId: string, personasAutorizadas: number): string | null {
  if (personasAutorizadas > 1 && b.createdById === actorId) {
    return 'Un beneficio no lo aprueba la misma persona que lo creó: pídele a otra persona autorizada que lo apruebe.'
  }
  return null
}

// ── Elegibilidad (§9, §16, §18) ──────────────────────────────────────────────

export interface BeneficioParaElegibilidad {
  id: string
  status: SupplyV2BenefitStatus
  funding: SupplyV2BenefitFunding
  scope: SupplyV2BenefitScope
  offerId: string | null
  catalogItemId: string | null
  supplierId: string | null
  currency: string
  startsAt: Date
  endsAt: Date | null
  requiresAssignment: boolean
  perCustomerLimit: number
  budgetTotal: Decimal | null
  budgetReserved: Decimal
  budgetConsumed: Decimal
}

export interface OfertaParaElegibilidad {
  id: string
  catalogItemId: string
  supplierId: string
  sourceType: SupplyV2OfferSource
  currency: string
}

export interface AsignacionParaElegibilidad {
  customerId: string
  status: SupplyV2CustomerBenefitStatus
  usesAllowed: number
  usesConsumed: number
  expiresAt: Date | null
}

export type MotivoNoElegible =
  | 'BENEFICIO_INACTIVO'
  | 'BENEFICIO_NO_VIGENTE'
  | 'BENEFICIO_VENCIDO'
  | 'MONEDA_DISTINTA'
  | 'PRODUCTO_NO_ELEGIBLE'
  | 'PROVEEDOR_NO_FINANCIA'
  | 'DESCUENTO_SOLO_COMISION'
  | 'SIN_ASIGNACION'
  | 'ASIGNACION_AJENA'
  | 'ASIGNACION_INACTIVA'
  | 'ASIGNACION_VENCIDA'
  | 'SIN_USOS'
  | 'LIMITE_POR_CLIENTE'
  | 'PRESUPUESTO_INSUFICIENTE'

export const MENSAJES_NO_ELEGIBLE: Record<MotivoNoElegible, string> = {
  BENEFICIO_INACTIVO: 'Este beneficio no está activo.',
  BENEFICIO_NO_VIGENTE: 'Este beneficio todavía no empieza.',
  BENEFICIO_VENCIDO: 'Este beneficio ya venció.',
  MONEDA_DISTINTA: 'Este beneficio es de otra moneda.',
  PRODUCTO_NO_ELEGIBLE: 'Este beneficio no aplica a este producto.',
  PROVEEDOR_NO_FINANCIA: 'Este descuento lo asume otro proveedor.',
  DESCUENTO_SOLO_COMISION: 'Un descuento del proveedor solo aplica a ofertas vendidas a comisión.',
  SIN_ASIGNACION: 'Este beneficio no está en tu cuenta.',
  ASIGNACION_AJENA: 'Este beneficio no es tuyo.',
  ASIGNACION_INACTIVA: 'Este beneficio ya no está disponible.',
  ASIGNACION_VENCIDA: 'Este beneficio ya venció.',
  SIN_USOS: 'Ya usaste este beneficio.',
  LIMITE_POR_CLIENTE: 'Ya alcanzaste el máximo de usos de este beneficio.',
  PRESUPUESTO_INSUFICIENTE: 'Este beneficio ya no tiene presupuesto disponible.',
}

/** ¿Cubre el beneficio esta oferta? Alcance exacto, sin asociaciones ambiguas (§9). */
export function cubreOferta(b: Pick<BeneficioParaElegibilidad, 'scope' | 'offerId' | 'catalogItemId' | 'supplierId'>, o: Pick<OfertaParaElegibilidad, 'id' | 'catalogItemId' | 'supplierId'>): boolean {
  switch (b.scope) {
    case 'SPECIFIC_OFFER':
      return b.offerId === o.id
    case 'CATALOG_ITEM':
      return b.catalogItemId === o.catalogItemId
    case 'SUPPLIER':
      return b.supplierId === o.supplierId
  }
}

export function presupuestoDisponible(b: Pick<BeneficioParaElegibilidad, 'budgetTotal' | 'budgetReserved' | 'budgetConsumed'>): Decimal | null {
  if (b.budgetTotal == null) return null
  return decimal(b.budgetTotal).minus(b.budgetReserved).minus(b.budgetConsumed)
}

/**
 * Elegibilidad completa, en orden (§16): beneficio → oferta → asignación →
 * usos → presupuesto. `usosVivos` = aplicaciones + reservas vivas de este
 * cliente con este beneficio (cuando no hay asignación, limitan igual).
 */
export function motivoNoElegible(
  b: BeneficioParaElegibilidad,
  o: OfertaParaElegibilidad,
  customerId: string,
  asignacion: AsignacionParaElegibilidad | null,
  usosVivos: number,
  subsidioNecesario: Decimal,
  ahora = new Date()
): MotivoNoElegible | null {
  if (b.status !== 'ACTIVE') return b.status === 'EXPIRED' ? 'BENEFICIO_VENCIDO' : 'BENEFICIO_INACTIVO'
  if (b.startsAt > ahora) return 'BENEFICIO_NO_VIGENTE'
  if (b.endsAt && b.endsAt <= ahora) return 'BENEFICIO_VENCIDO'
  if (b.currency !== o.currency) return 'MONEDA_DISTINTA'
  if (!cubreOferta(b, o)) return 'PRODUCTO_NO_ELEGIBLE'
  if (b.funding !== 'MEMBEGO') {
    if (b.supplierId !== o.supplierId) return 'PROVEEDOR_NO_FINANCIA'
    // En precompra Membego ya compró y pagó la unidad: el proveedor no tiene precio que rebajar (§25).
    if (o.sourceType !== 'COMMISSION') return 'DESCUENTO_SOLO_COMISION'
  }
  if (b.requiresAssignment) {
    if (!asignacion) return 'SIN_ASIGNACION'
    if (asignacion.customerId !== customerId) return 'ASIGNACION_AJENA'
    if (asignacion.status !== 'AVAILABLE') return asignacion.status === 'EXPIRED' ? 'ASIGNACION_VENCIDA' : 'ASIGNACION_INACTIVA'
    if (asignacion.expiresAt && asignacion.expiresAt <= ahora) return 'ASIGNACION_VENCIDA'
    if (usosVivos >= asignacion.usesAllowed) return 'SIN_USOS'
  } else if (usosVivos >= b.perCustomerLimit) {
    return 'LIMITE_POR_CLIENTE'
  }
  const disponible = presupuestoDisponible(b)
  if (disponible !== null && subsidioNecesario.greaterThan(disponible)) return 'PRESUPUESTO_INSUFICIENTE'
  return null
}

// ── Ledger del beneficio (§12) ───────────────────────────────────────────────

export interface MovimientoBeneficio {
  type: 'GRANTED' | 'RESERVED' | 'APPLIED' | 'RELEASED' | 'EXPIRED' | 'REVERSED'
  reservedDelta: Decimal | string | number
  consumedDelta: Decimal | string | number
}

/** Reconstruye reservado y consumido desde los movimientos: la caché del beneficio debe coincidir. */
export function saldoDeMovimientosBeneficio(movs: readonly MovimientoBeneficio[]): { reserved: Decimal; consumed: Decimal } {
  return movs.reduce(
    (t, m) => ({ reserved: t.reserved.plus(decimal(m.reservedDelta)), consumed: t.consumed.plus(decimal(m.consumedDelta)) }),
    { reserved: new Prisma.Decimal(0), consumed: new Prisma.Decimal(0) }
  )
}

/** Estado derivado de una asignación según usos y vencimiento. */
export function estadoAsignacionSegunUsos(a: { usesAllowed: number; usesConsumed: number; expiresAt: Date | null; status: SupplyV2CustomerBenefitStatus }, ahora = new Date()): SupplyV2CustomerBenefitStatus {
  if (a.status === 'CANCELLED') return 'CANCELLED'
  if (a.expiresAt && a.expiresAt <= ahora) return 'EXPIRED'
  if (a.usesConsumed >= a.usesAllowed) return 'EXHAUSTED'
  return 'AVAILABLE'
}
