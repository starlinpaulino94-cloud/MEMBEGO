import type { SupplyV2BenefitFunding, SupplyV2BenefitValueType, SupplyV2CommissionBase, SupplyV2OfferSource } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { decimal, redondear2, type Decimal } from './dinero'
import { repartirEnUnidades, validarPorcentajeComision } from './comision'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · MOTOR DE FINANCIACIÓN (§13–§15, §19, §22).
 *
 * Extiende el `SupplyV2PricingEngine` del Slice 5 para una línea con
 * BENEFICIO. PURO y con Decimal. Cada cifra tiene UN significado (§3):
 *
 *   gmv                   precio Membego × unidades (lo que vale la venta antes de beneficios)
 *   supplierDiscount      lo que el proveedor rebaja de su precio (no es dinero de Membego)
 *   contractualSaleValue  gmv − supplierDiscount: lo que se vende contractualmente
 *   membegoSubsidy        lo que Membego financia (sale de un presupuesto; costo promocional)
 *   customerPayable       contractualSaleValue − membegoSubsidy: lo que paga el cliente (nunca < 0)
 *   benefitApplied        supplierDiscount + membegoSubsidy
 *   commissionBase        CONTRACTUAL_SALE_VALUE o CUSTOMER_PAID_AMOUNT, según la versión del acuerdo (§14)
 *   commissionAmount      round2(base × % / 100); 0 en precompra
 *   supplierNet           contractualSaleValue − commissionAmount (lo que recibe el proveedor a comisión)
 *
 * Los importes fijos y los topes son POR APLICACIÓN (la línea), no por unidad
 * (§8). El reparto por unidad es determinista: el centavo sobrante va a las
 * primeras unidades (`repartirEnUnidades`) y cada unidad cuadra consigo misma.
 */

export interface BeneficioParaCalculo {
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  membegoValue: Decimal | string | number
  supplierValue: Decimal | string | number
  maxMembegoAmount?: Decimal | string | number | null
  maxSupplierAmount?: Decimal | string | number | null
}

export interface EntradaReparto {
  saleUnitPrice: Decimal | string | number
  quantity: number
  beneficio?: BeneficioParaCalculo | null
  sourceType: SupplyV2OfferSource
  /** Solo COMMISSION. */
  commissionPercentage?: Decimal | string | number | null
  commissionBase?: SupplyV2CommissionBase | null
}

export interface UnidadFinanciada {
  contractualValue: Decimal
  supplierDiscount: Decimal
  membegoSubsidy: Decimal
  customerPaid: Decimal
  commissionAmount: Decimal
  supplierNet: Decimal
}

export interface RepartoFinanciado {
  quantity: number
  saleUnitPrice: Decimal
  gmv: Decimal
  supplierDiscount: Decimal
  contractualSaleValue: Decimal
  membegoSubsidy: Decimal
  customerPayable: Decimal
  benefitApplied: Decimal
  commissionBase: SupplyV2CommissionBase | null
  commissionPercentage: Decimal | null
  commissionAmount: Decimal
  supplierNet: Decimal
  porUnidad: UnidadFinanciada[]
}

const CERO = new Prisma.Decimal(0)
const min = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b)

function parte(valueType: SupplyV2BenefitValueType, valor: Decimal, base: Decimal, tope: Decimal | null, techo: Decimal): Decimal {
  if (valor.lessThanOrEqualTo(0)) return CERO
  let v = valueType === 'FIXED_AMOUNT' ? redondear2(valor) : redondear2(base.times(valor).dividedBy(100))
  if (tope && tope.greaterThan(0)) v = min(v, redondear2(tope))
  v = min(v, techo)
  return v.isNegative() ? CERO : v
}

export function validarBeneficioParaCalculo(b: BeneficioParaCalculo): string | null {
  const m = decimal(b.membegoValue)
  const s = decimal(b.supplierValue)
  if (!m.isFinite() || m.isNegative() || !s.isFinite() || s.isNegative()) return 'Los valores del beneficio no pueden ser negativos.'
  if (b.valueType === 'PERCENTAGE' && (m.greaterThan(100) || s.greaterThan(100))) return 'Un porcentaje no puede superar 100.'
  if (b.funding === 'MEMBEGO' && (m.lessThanOrEqualTo(0) || !s.isZero())) return 'Un bono financiado por Membego lleva solo la parte de Membego.'
  if (b.funding === 'SUPPLIER' && (s.lessThanOrEqualTo(0) || !m.isZero())) return 'Un descuento del proveedor lleva solo la parte del proveedor.'
  if (b.funding === 'SHARED' && (s.lessThanOrEqualTo(0) || m.lessThanOrEqualTo(0))) return 'Una financiación compartida necesita las dos partes.'
  for (const t of [b.maxMembegoAmount, b.maxSupplierAmount]) {
    if (t != null && t !== '' && (!decimal(t).isFinite() || decimal(t).lessThanOrEqualTo(0))) return 'Un tope tiene que ser mayor que cero.'
  }
  return null
}

/** Reparte UNA línea. Sin beneficio: contractual = gmv y el cliente paga todo. */
export function calcularRepartoLinea(e: EntradaReparto): RepartoFinanciado {
  if (!Number.isInteger(e.quantity) || e.quantity <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  const unit = redondear2(decimal(e.saleUnitPrice))
  if (!unit.isFinite() || unit.isNegative()) throw new Error('El precio no puede ser negativo.')
  const gmv = unit.times(e.quantity)

  let supplierDiscount = CERO
  let membegoSubsidy = CERO
  if (e.beneficio) {
    const error = validarBeneficioParaCalculo(e.beneficio)
    if (error) throw new Error(error)
    const b = e.beneficio
    const topeS = b.maxSupplierAmount != null && b.maxSupplierAmount !== '' ? decimal(b.maxSupplierAmount) : null
    const topeM = b.maxMembegoAmount != null && b.maxMembegoAmount !== '' ? decimal(b.maxMembegoAmount) : null
    supplierDiscount = parte(b.valueType, decimal(b.supplierValue), gmv, topeS, gmv)
    // El subsidio nunca deja el total por debajo de cero (§8): techo = lo que queda tras el descuento.
    membegoSubsidy = parte(b.valueType, decimal(b.membegoValue), gmv, topeM, gmv.minus(supplierDiscount))
  }
  const contractualSaleValue = gmv.minus(supplierDiscount)
  const customerPayable = contractualSaleValue.minus(membegoSubsidy)
  if (customerPayable.isNegative()) throw new Error('El beneficio no puede dejar el total por debajo de cero.')

  let commissionBase: SupplyV2CommissionBase | null = null
  let commissionPercentage: Decimal | null = null
  let commissionAmount = CERO
  if (e.sourceType === 'COMMISSION') {
    const errorPct = validarPorcentajeComision(e.commissionPercentage ?? null)
    if (errorPct) throw new Error(errorPct)
    commissionPercentage = decimal(e.commissionPercentage!)
    commissionBase = e.commissionBase ?? 'CONTRACTUAL_SALE_VALUE'
    const base = commissionBase === 'CUSTOMER_PAID_AMOUNT' ? customerPayable : contractualSaleValue
    commissionAmount = redondear2(base.times(commissionPercentage).dividedBy(100))
  }
  const supplierNet = e.sourceType === 'COMMISSION' ? contractualSaleValue.minus(commissionAmount) : CERO

  // Por unidad (§22): descuento, subsidio y comisión repartidos; el resto se deriva por unidad.
  const dU = repartirEnUnidades(supplierDiscount, e.quantity)
  const mU = repartirEnUnidades(membegoSubsidy, e.quantity)
  const cU = repartirEnUnidades(commissionAmount, e.quantity)
  const porUnidad: UnidadFinanciada[] = []
  for (let i = 0; i < e.quantity; i++) {
    const contractual = unit.minus(dU[i]!)
    const comision = e.sourceType === 'COMMISSION' ? cU[i]! : CERO
    porUnidad.push({
      contractualValue: contractual,
      supplierDiscount: dU[i]!,
      membegoSubsidy: mU[i]!,
      customerPaid: contractual.minus(mU[i]!),
      commissionAmount: comision,
      supplierNet: e.sourceType === 'COMMISSION' ? contractual.minus(comision) : CERO,
    })
  }
  return {
    quantity: e.quantity,
    saleUnitPrice: unit,
    gmv,
    supplierDiscount,
    contractualSaleValue,
    membegoSubsidy,
    customerPayable,
    benefitApplied: supplierDiscount.plus(membegoSubsidy),
    commissionBase,
    commissionPercentage,
    commissionAmount,
    supplierNet,
    porUnidad,
  }
}

/** Foto serializable del reparto (va en `benefitFundingSnapshot`, §15). */
export function fotoDeReparto(r: RepartoFinanciado, beneficio: { id: string; code: string; funding: string; valueType: string; membegoValue: string; supplierValue: string } | null): Prisma.InputJsonValue {
  return {
    benefit: beneficio,
    gmv: r.gmv.toFixed(2),
    supplierDiscount: r.supplierDiscount.toFixed(2),
    contractualSaleValue: r.contractualSaleValue.toFixed(2),
    membegoSubsidy: r.membegoSubsidy.toFixed(2),
    customerPayable: r.customerPayable.toFixed(2),
    benefitApplied: r.benefitApplied.toFixed(2),
    commissionBase: r.commissionBase,
    commissionPercentage: r.commissionPercentage?.toFixed(2) ?? null,
    commissionAmount: r.commissionAmount.toFixed(2),
    supplierNet: r.supplierNet.toFixed(2),
  }
}
