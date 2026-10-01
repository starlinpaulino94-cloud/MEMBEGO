import type { SupplyV2ObligationStatus, SupplyV2SettlementFrequency, SupplyV2SettlementStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import type { Transiciones } from '../core/estados'
import { CERO, OBLIGACION_VIVA } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 · LIQUIDACIONES: reglas PURAS (§35–§47).
 *
 * Una liquidación agrupa obligaciones de comisión de un proveedor en un
 * periodo. Elegibles: OPEN o PARTIALLY_PAID, sin liquidación viva. Se
 * aprueba con segregación (quien la genera no la aprueba) y se paga con el
 * motor del Slice 4: el pago se reparte entre sus obligaciones, la más
 * antigua primero. El estado deriva de lo pagado.
 */

export const TRANSICIONES_LIQUIDACION: Transiciones<SupplyV2SettlementStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'APPROVED'],
  PAID: ['PARTIALLY_PAID', 'APPROVED'],
  CANCELLED: [],
}

/** Estados en los que la liquidación «existe» para el proveedor y bloquea sus obligaciones. */
export const LIQUIDACION_VIVA: readonly SupplyV2SettlementStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID']
/** Estados en los que se le puede aplicar dinero. */
export const LIQUIDACION_PAGABLE: readonly SupplyV2SettlementStatus[] = ['APPROVED', 'PARTIALLY_PAID']
/** Estados desde los que se puede cancelar (nunca con dinero aplicado). */
export const LIQUIDACION_CANCELABLE: readonly SupplyV2SettlementStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED']

export const FRECUENCIAS_LIQUIDACION: readonly SupplyV2SettlementFrequency[] = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'MANUAL']

export interface ObligacionElegible {
  id: string
  status: SupplyV2ObligationStatus
  settlementId: string | null
  recognizedAt: Date
  currency: string
}

/** ¿Puede entrar esta obligación en una liquidación nueva? (§37) */
export function motivoNoLiquidable(o: ObligacionElegible, periodStart: Date, periodEnd: Date, currency: string): string | null {
  if (!OBLIGACION_VIVA.includes(o.status)) return `está ${o.status}`
  if (o.settlementId) return 'ya está en una liquidación viva'
  if (o.currency !== currency) return 'está en otra moneda'
  if (o.recognizedAt < periodStart || o.recognizedAt >= periodEnd) return 'está fuera del periodo'
  return null
}

export function elegibles<O extends ObligacionElegible>(obligaciones: readonly O[], periodStart: Date, periodEnd: Date, currency: string): O[] {
  return obligaciones.filter((o) => motivoNoLiquidable(o, periodStart, periodEnd, currency) === null)
}

export interface LineaLiquidacionEntrada {
  grossAmount: Decimal | string | number
  commissionAmount: Decimal | string | number
  supplierNet: Decimal | string | number
}

export interface TotalesLiquidacion {
  grossSales: Decimal
  commissionAmount: Decimal
  supplierNet: Decimal
}

export function totalesDeLiquidacion(lineas: readonly LineaLiquidacionEntrada[]): TotalesLiquidacion {
  const t = lineas.reduce(
    (acc, l) => ({
      grossSales: acc.grossSales.plus(decimal(l.grossAmount)),
      commissionAmount: acc.commissionAmount.plus(decimal(l.commissionAmount)),
      supplierNet: acc.supplierNet.plus(decimal(l.supplierNet)),
    }),
    { grossSales: CERO, commissionAmount: CERO, supplierNet: CERO }
  )
  return { grossSales: redondear2(t.grossSales), commissionAmount: redondear2(t.commissionAmount), supplierNet: redondear2(t.supplierNet) }
}

/** Estado derivado de una liquidación aprobada según lo pagado en sus obligaciones (§42). */
export function estadoLiquidacionSegunPago(supplierNet: Decimal, paid: Decimal): 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' {
  if (paid.lessThanOrEqualTo(0)) return 'APPROVED'
  if (paid.greaterThanOrEqualTo(supplierNet)) return 'PAID'
  return 'PARTIALLY_PAID'
}

export interface ObligacionParaRepartir {
  id: string
  outstandingAmount: Decimal | string | number
  recognizedAt: Date
}

/**
 * Reparte un monto entre obligaciones, la más antigua primero (§41). Nunca
 * sobrepaga: lo que no quepa queda sin aplicar (y visible en el pago).
 */
export function repartirPagoMasAntiguoPrimero<O extends ObligacionParaRepartir>(monto: Decimal | string | number, obligaciones: readonly O[]): { aplicaciones: { obligacion: O; amount: Decimal }[]; sinAplicar: Decimal } {
  let resto = redondear2(decimal(monto))
  const orden = [...obligaciones].sort((a, b) => a.recognizedAt.getTime() - b.recognizedAt.getTime() || a.id.localeCompare(b.id))
  const aplicaciones: { obligacion: O; amount: Decimal }[] = []
  for (const o of orden) {
    if (resto.lessThanOrEqualTo(0)) break
    const pendiente = decimal(o.outstandingAmount)
    if (pendiente.lessThanOrEqualTo(0)) continue
    const amount = resto.lessThan(pendiente) ? resto : pendiente
    aplicaciones.push({ obligacion: o, amount })
    resto = resto.minus(amount)
  }
  return { aplicaciones, sinAplicar: resto }
}

/** Periodo [inicio, fin) que una frecuencia cubre en la fecha de referencia (§36); MANUAL exige fechas. */
export function periodoDeFrecuencia(frequency: SupplyV2SettlementFrequency, referencia: Date): { periodStart: Date; periodEnd: Date } | null {
  const d = new Date(referencia)
  d.setHours(0, 0, 0, 0)
  switch (frequency) {
    case 'DAILY':
      return { periodStart: d, periodEnd: new Date(d.getTime() + 86_400_000) }
    case 'WEEKLY': {
      const dow = (d.getDay() + 6) % 7 // lunes = 0
      const start = new Date(d.getTime() - dow * 86_400_000)
      return { periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86_400_000) }
    }
    case 'BIWEEKLY': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() <= 15 ? 1 : 16)
      const end = d.getDate() <= 15 ? new Date(d.getFullYear(), d.getMonth(), 16) : new Date(d.getFullYear(), d.getMonth() + 1, 1)
      return { periodStart: start, periodEnd: end }
    }
    case 'MONTHLY':
      return { periodStart: new Date(d.getFullYear(), d.getMonth(), 1), periodEnd: new Date(d.getFullYear(), d.getMonth() + 1, 1) }
    case 'MANUAL':
      return null
  }
}

export function validarPeriodo(periodStart: Date, periodEnd: Date): string | null {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) return 'La fecha de inicio del periodo no es válida.'
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) return 'La fecha de fin del periodo no es válida.'
  if (periodEnd <= periodStart) return 'El periodo tiene que terminar después de empezar.'
  return null
}

export const ES_DECIMAL = (v: unknown): v is Decimal => v instanceof Prisma.Decimal
