import { Prisma } from '@prisma/client'
import { decimal, redondear2, type Decimal } from './dinero'

/**
 * COMMERCE PRIMITIVES · motor de reparto de comisión.
 *
 * El ÚNICO sitio donde se reparte lo que paga el cliente entre Membego
 * (comisión) y la contraparte (neto). PURO y con Decimal; redondeo a 2
 * decimales ROUND_HALF_UP. La regla de oro:
 *
 *   cliente paga 1 000 · comisión 10 %
 *   → GMV 1 000 · ingreso de Membego 100 · neto de la contraparte 900
 *
 * El neto de la contraparte NO es ingreso ni costo de Membego: es dinero que
 * Membego cobra por su cuenta y le debe al entregar.
 *
 * Extraído de supply-v2/core/comision.ts (Fase 0). Usado por Supply V2
 * (liquidación a proveedor) y por Merchant Billing (comisión PERCENTAGE).
 */

export interface RepartoComision {
  /** Lo que paga el cliente (= GMV). */
  customerPays: Decimal
  gmv: Decimal
  /** Lo que Membego reconoce como ingreso: la comisión. */
  membegoRevenue: Decimal
  /** Bruto de la contraparte: lo que vendió (= GMV). */
  supplierGross: Decimal
  commissionPercentage: Decimal
  commissionAmount: Decimal
  /** Lo que Membego le debe a la contraparte al entregar. */
  netSupplierAmount: Decimal
}

export function validarPorcentajeComision(pct: number | string | Decimal | null | undefined): string | null {
  if (pct == null || pct === '') return 'La comisión necesita un porcentaje.'
  let p: Decimal
  try {
    p = decimal(pct)
  } catch {
    return 'El porcentaje de comisión no es un número.'
  }
  if (!p.isFinite() || p.isNegative() || p.greaterThan(100)) return 'La comisión tiene que estar entre 0 y 100.'
  if (!p.equals(p.toDecimalPlaces(2))) return 'La comisión no puede tener más de dos decimales.'
  return null
}

/**
 * Reparte un monto (lo que paga el cliente por 1 o N unidades) con el
 * porcentaje de comisión. `commission = round2(gmv × pct / 100)`,
 * `net = gmv − commission`: siempre suman exactamente el GMV.
 */
export function repartirComision(customerPays: number | string | Decimal, commissionPercentage: number | string | Decimal): RepartoComision {
  const errorPct = validarPorcentajeComision(commissionPercentage)
  if (errorPct) throw new Error(errorPct)
  const gmv = redondear2(decimal(customerPays))
  if (!gmv.isFinite() || gmv.isNegative()) throw new Error('El monto no puede ser negativo.')
  const pct = decimal(commissionPercentage)
  const commissionAmount = redondear2(gmv.times(pct).dividedBy(100))
  const netSupplierAmount = gmv.minus(commissionAmount)
  return {
    customerPays: gmv,
    gmv,
    membegoRevenue: commissionAmount,
    supplierGross: gmv,
    commissionPercentage: pct,
    commissionAmount,
    netSupplierAmount,
  }
}

export interface LineaComision extends RepartoComision {
  quantity: number
  saleUnitPrice: Decimal
  /** Comisión y neto por unidad, informativos (la verdad es el total de la línea). */
  commissionUnitAmount: Decimal
  supplierUnitNet: Decimal
  /** Reparto por unidad que SUMA exactamente el total de la línea (para los derechos). */
  porUnidad: { commissionAmount: Decimal; supplierNet: Decimal }[]
}

/** Una línea de orden a comisión: precio unitario × cantidad, repartido. */
export function calcularLineaComision(saleUnitPrice: number | string | Decimal, quantity: number, commissionPercentage: number | string | Decimal): LineaComision {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  const unit = redondear2(decimal(saleUnitPrice))
  const total = repartirComision(unit.times(quantity), commissionPercentage)
  const unitario = repartirComision(unit, commissionPercentage)
  // Por unidad: la comisión reparte el centavo sobrante y el neto es precio − comisión,
  // así cada unidad cuadra con su precio y la suma de las unidades cuadra con la línea.
  const comisiones = repartirEnUnidades(total.commissionAmount, quantity)
  return {
    ...total,
    quantity,
    saleUnitPrice: unit,
    commissionUnitAmount: unitario.commissionAmount,
    supplierUnitNet: unitario.netSupplierAmount,
    porUnidad: comisiones.map((c) => ({ commissionAmount: c, supplierNet: unit.minus(c) })),
  }
}

/**
 * Reparte `total` en `n` partes de 2 decimales que SUMAN exactamente `total`:
 * las primeras llevan el centavo sobrante. Sin esto, n × round(total/n) no
 * cuadra y una liquidación cerraría con un centavo de diferencia.
 */
export function repartirEnUnidades(total: Decimal, n: number): Decimal[] {
  if (!Number.isInteger(n) || n <= 0) throw new Error('n tiene que ser un entero positivo.')
  const t = redondear2(total)
  const base = t.dividedBy(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)
  let resto = t.minus(base.times(n))
  const centavo = new Prisma.Decimal('0.01')
  const partes: Decimal[] = []
  for (let i = 0; i < n; i++) {
    if (resto.greaterThanOrEqualTo(centavo)) {
      partes.push(base.plus(centavo))
      resto = resto.minus(centavo)
    } else {
      partes.push(base)
    }
  }
  return partes
}

/** Atajo para los agregados: suma de repartos. */
export function sumarRepartos(repartos: readonly { gmv: Decimal; commissionAmount: Decimal; netSupplierAmount: Decimal }[]): { gmv: Decimal; commissionAmount: Decimal; netSupplierAmount: Decimal } {
  return repartos.reduce(
    (t, r) => ({ gmv: t.gmv.plus(r.gmv), commissionAmount: t.commissionAmount.plus(r.commissionAmount), netSupplierAmount: t.netSupplierAmount.plus(r.netSupplierAmount) }),
    { gmv: new Prisma.Decimal(0), commissionAmount: new Prisma.Decimal(0), netSupplierAmount: new Prisma.Decimal(0) }
  )
}

/** Nombre canónico del motor: lo que importan checkout, redención y liquidación. */
export const SupplyV2PricingEngine = { repartirComision, calcularLineaComision, repartirEnUnidades, validarPorcentajeComision } as const

/** Mismo motor, nombre neutral para consumidores fuera de Supply (Merchant Billing). */
export const CommissionEngine = SupplyV2PricingEngine
