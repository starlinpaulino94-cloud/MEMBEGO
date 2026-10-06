import type { SupplyV2AgreementScope, SupplyV2AgreementType, SupplyV2CommissionBase, SupplyV2PayableRecognition } from '@prisma/client'
import { AGREEMENT_TYPES_SLICE1, AGREEMENT_TYPES_SLICE5 } from '../core/catalogo'
import { validarPorcentajeComision } from '../core/comision'

/**
 * MEMBEGO SUPPLY 2.0 · acuerdos: reglas puras (§9–§11).
 *
 * El acuerdo define CÓMO se compra (tipo, alcance, costo negociado, plazo,
 * vigencia). NO lleva cantidad: la cantidad es de la orden de compra.
 */

export interface DatosAcuerdo {
  supplierId: string
  type: SupplyV2AgreementType
  scope?: SupplyV2AgreementScope | null
  catalogItemId?: string | null
  category?: string | null
  currency?: string | null
  negotiatedUnitCost?: number | string | null
  discountPercentage?: number | string | null
  commissionPercentage?: number | string | null
  paymentTermsDays?: number | null
  // Slice 4 · política financiera (§20)
  payableRecognition?: SupplyV2PayableRecognition | null
  allowDepositApplication?: boolean | null
  settlementFrequency?: string | null
  /** Slice 6 (§14): base de la comisión cuando interviene un beneficio. */
  commissionBase?: SupplyV2CommissionBase | null
  startsAt: Date
  endsAt?: Date | null
  notes?: string | null
}

export const PAYABLE_RECOGNITIONS: readonly SupplyV2PayableRecognition[] = ['ON_INVOICE', 'ON_RECEIPT', 'ON_REDEMPTION']

function pct(v: number | string | null | undefined, nombre: string): string | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) return `${nombre} tiene que estar entre 0 y 100.`
  return null
}

export function validarAcuerdo(d: DatosAcuerdo): string | null {
  if (!d.supplierId) return 'El acuerdo necesita un proveedor.'
  if (!AGREEMENT_TYPES_SLICE5.includes(d.type)) {
    return 'En esta versión solo se pueden crear acuerdos de compra anticipada, de pagar después o a comisión.'
  }
  const scope = d.scope ?? 'ITEM'
  if (scope === 'ITEM' && !d.catalogItemId) return 'Un acuerdo por producto necesita el producto.'
  if (scope === 'CATEGORY' && !d.category?.trim()) return 'Un acuerdo por categoría necesita la categoría.'
  if (d.type === 'COMMISSION') return validarAcuerdoComision(d)
  if (!(d.startsAt instanceof Date) || Number.isNaN(d.startsAt.getTime())) return 'La fecha de inicio no es válida.'
  if (d.endsAt) {
    if (Number.isNaN(d.endsAt.getTime())) return 'La fecha de fin no es válida.'
    if (d.endsAt <= d.startsAt) return 'La fecha de fin tiene que ser posterior a la de inicio.'
  }
  if (d.negotiatedUnitCost != null && d.negotiatedUnitCost !== '') {
    const n = Number(d.negotiatedUnitCost)
    if (!Number.isFinite(n) || n < 0) return 'El costo negociado no puede ser negativo.'
  } else if (scope === 'ITEM') {
    return 'Un acuerdo por producto necesita el costo negociado por unidad.'
  }
  const e1 = pct(d.discountPercentage, 'El descuento')
  if (e1) return e1
  const e2 = pct(d.commissionPercentage, 'La comisión')
  if (e2) return e2
  if (d.paymentTermsDays != null && (!Number.isInteger(d.paymentTermsDays) || d.paymentTermsDays < 0)) {
    return 'Los días de pago tienen que ser un entero no negativo.'
  }
  if (d.payableRecognition && !PAYABLE_RECOGNITIONS.includes(d.payableRecognition)) {
    return 'La política de reconocimiento de la deuda no es válida.'
  }
  if (d.type === 'PREPAID_PURCHASE' && d.payableRecognition === 'ON_REDEMPTION') {
    return 'Una compra anticipada se paga antes de entregar: la deuda no puede nacer al redimir.'
  }
  return null
}

/**
 * Slice 5 (§7–§9): un acuerdo a COMISIÓN no compra nada. No lleva costo
 * negociado, exige el porcentaje y su deuda nace SIEMPRE al entregar
 * (ON_REDEMPTION): Membego no debe nada antes de que el proveedor cumpla.
 */
function validarAcuerdoComision(d: DatosAcuerdo): string | null {
  const e = validarPorcentajeComision(d.commissionPercentage)
  if (e) return e
  if (d.payableRecognition && d.payableRecognition !== 'ON_REDEMPTION') {
    return 'En un acuerdo a comisión la deuda con el proveedor nace al entregar (ON_REDEMPTION).'
  }
  if (d.paymentTermsDays != null && (!Number.isInteger(d.paymentTermsDays) || d.paymentTermsDays < 0)) {
    return 'Los días de pago tienen que ser un entero no negativo.'
  }
  if (d.negotiatedUnitCost != null && d.negotiatedUnitCost !== '' && Number(d.negotiatedUnitCost) !== 0) {
    return 'Un acuerdo a comisión no tiene costo negociado: Membego no compra las unidades.'
  }
  return null
}

export interface AcuerdoComisionCandidato {
  id: string
  code: string
  status: string
  type: SupplyV2AgreementType
  scope: SupplyV2AgreementScope
  catalogItemId: string | null
  category: string | null
  startsAt: Date
  endsAt: Date | null
  version: number
}

const PRECEDENCIA: Record<SupplyV2AgreementScope, number> = { ITEM: 0, CATEGORY: 1, CATALOG: 2 }

/**
 * Resuelve QUÉ acuerdo a comisión rige un producto (§9): ITEM > CATEGORY >
 * CATALOG. Entre varios del mismo alcance gana el que empezó más tarde (el
 * más reciente); a igualdad, el código mayor. Devuelve null si ninguno vigente
 * cubre el producto. PURO: quien llama trae los candidatos del proveedor.
 */
export function resolverAcuerdoComision<A extends AcuerdoComisionCandidato>(
  candidatos: readonly A[],
  item: { id: string; category: string | null },
  ahora = new Date()
): A | null {
  const cubre = (a: A): boolean => {
    if (a.status !== 'ACTIVE' || a.type !== 'COMMISSION') return false
    if (a.startsAt > ahora) return false
    if (a.endsAt && a.endsAt < ahora) return false
    switch (a.scope) {
      case 'ITEM':
        return a.catalogItemId === item.id
      case 'CATEGORY':
        return Boolean(a.category && item.category && a.category.trim().toLowerCase() === item.category.trim().toLowerCase())
      case 'CATALOG':
        return true
    }
  }
  const vivos = candidatos.filter(cubre)
  if (vivos.length === 0) return null
  vivos.sort((x, y) => {
    const p = PRECEDENCIA[x.scope] - PRECEDENCIA[y.scope]
    if (p !== 0) return p
    const t = y.startsAt.getTime() - x.startsAt.getTime()
    if (t !== 0) return t
    return y.code.localeCompare(x.code)
  })
  return vivos[0]!
}

export interface AcuerdoParaCompatibilidad {
  status: string
  type: SupplyV2AgreementType
  scope: SupplyV2AgreementScope
  catalogItemId: string | null
  category: string | null
  startsAt: Date
  endsAt: Date | null
}

/**
 * ¿Sirve este acuerdo para comprar este ítem hoy? Vigente, de un tipo que el
 * Slice 1 construye, y con alcance que cubre el ítem.
 */
export function acuerdoCompatible(
  a: AcuerdoParaCompatibilidad,
  item: { id: string; category: string | null },
  ahora = new Date()
): boolean {
  if (a.status !== 'ACTIVE') return false
  if (!AGREEMENT_TYPES_SLICE1.includes(a.type)) return false
  if (a.startsAt > ahora) return false
  if (a.endsAt && a.endsAt < ahora) return false
  switch (a.scope) {
    case 'ITEM':
      return a.catalogItemId === item.id
    case 'CATEGORY':
      return Boolean(a.category && item.category && a.category.trim().toLowerCase() === item.category.trim().toLowerCase())
    case 'CATALOG':
      return true
  }
}

/** La foto completa que se guarda en cada versión del acuerdo. */
export function snapshotDeAcuerdo(a: {
  code: string
  supplierId: string
  type: string
  scope: string
  catalogItemId: string | null
  category: string | null
  currency: string
  negotiatedUnitCost: { toString(): string } | null
  discountPercentage: { toString(): string } | null
  commissionPercentage: { toString(): string } | null
  paymentTermsDays: number | null
  payableRecognition?: SupplyV2PayableRecognition | null
  allowDepositApplication?: boolean | null
  settlementFrequency?: string | null
  commissionBase?: SupplyV2CommissionBase | null
  startsAt: Date
  endsAt: Date | null
  notes: string | null
}) {
  return {
    code: a.code,
    supplierId: a.supplierId,
    type: a.type,
    scope: a.scope,
    catalogItemId: a.catalogItemId,
    category: a.category,
    currency: a.currency,
    negotiatedUnitCost: a.negotiatedUnitCost?.toString() ?? null,
    discountPercentage: a.discountPercentage?.toString() ?? null,
    commissionPercentage: a.commissionPercentage?.toString() ?? null,
    paymentTermsDays: a.paymentTermsDays,
    // Slice 4: la política se congela en la versión; las obligaciones la leen de aquí (§21).
    payableRecognition: a.payableRecognition ?? 'ON_INVOICE',
    allowDepositApplication: a.allowDepositApplication ?? true,
    settlementFrequency: a.settlementFrequency ?? null,
    // Slice 6 (§14): la base de comisión también se congela en la versión.
    commissionBase: a.commissionBase ?? 'CONTRACTUAL_SALE_VALUE',
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt?.toISOString() ?? null,
    notes: a.notes,
  }
}
