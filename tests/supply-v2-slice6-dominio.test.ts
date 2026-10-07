import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { calcularRepartoLinea, fotoDeReparto, validarBeneficioParaCalculo, type BeneficioParaCalculo } from '../src/modules/supply-v2/core/financiacion'
import {
  cubreOferta,
  estadoAsignacionSegunUsos,
  motivoNoElegible,
  presupuestoDisponible,
  saldoDeMovimientosBeneficio,
  TRANSICIONES_BENEFICIO,
  validarBeneficio,
  type BeneficioParaElegibilidad,
  type DatosBeneficio,
  type OfertaParaElegibilidad,
} from '../src/modules/supply-v2/benefits/domain'
import { agregarEconomia, snapshotDeVenta, type EventoEconomico } from '../src/modules/supply-v2/economics/domain'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'
import { esAutoaprobacion } from '../src/modules/supply-v2/core/segregacion'
import { politicaDeVersion } from '../src/modules/supply-v2/finance/domain'
import { SUPPLY_V2_PERMISSIONS } from '../src/modules/supply-v2/contracts/gateways'

/**
 * MEMBEGO SUPPLY · SLICE 6 · pruebas de DOMINIO (§35). Sin base de datos.
 *
 * Las cifras del enunciado se prueban tal cual: 1 000 con bono de 500 deja 500
 * a pagar, comisión 80 sobre el valor contractual, neto 920 y contribución
 * tras el subsidio −420. Lo que la base garantiza (candados, CHECK, unicidad)
 * se prueba en `tests/postgres/supply-v2-slice6.db.test.ts`.
 */

const D = (n: string | number) => new Prisma.Decimal(n)
const AHORA = new Date('2026-06-15T12:00:00.000Z')

const BONO_500: BeneficioParaCalculo = { funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: D(500), supplierValue: D(0) }

function beneficio(p: Partial<BeneficioParaElegibilidad> = {}): BeneficioParaElegibilidad {
  return {
    id: 'b1',
    status: 'ACTIVE',
    funding: 'MEMBEGO',
    scope: 'SPECIFIC_OFFER',
    offerId: 'of1',
    catalogItemId: null,
    supplierId: null,
    currency: 'DOP',
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    endsAt: new Date('2026-07-01T00:00:00.000Z'),
    requiresAssignment: true,
    requiresCoupon: false,
    perCustomerLimit: 1,
    budgetTotal: D(10_000),
    budgetReserved: D(0),
    budgetConsumed: D(0),
    ...p,
  }
}
function oferta(p: Partial<OfertaParaElegibilidad> = {}): OfertaParaElegibilidad {
  return { id: 'of1', catalogItemId: 'ci1', supplierId: 'sp1', sourceType: 'COMMISSION', currency: 'DOP', ...p }
}
const asignacion = (p: Partial<{ customerId: string; status: 'AVAILABLE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED'; usesAllowed: number; usesConsumed: number; expiresAt: Date | null }> = {}) => ({
  customerId: 'c1',
  status: 'AVAILABLE' as const,
  usesAllowed: 1,
  usesConsumed: 0,
  expiresAt: null,
  ...p,
})

const datosBeneficio = (p: Partial<DatosBeneficio> = {}): DatosBeneficio => ({
  name: 'Bono de bienvenida',
  funding: 'MEMBEGO',
  valueType: 'FIXED_AMOUNT',
  membegoValue: 500,
  scope: 'SPECIFIC_OFFER',
  offerId: 'of1',
  startsAt: new Date('2026-06-01T00:00:00.000Z'),
  ...p,
})

// ── 1–8 · MOTOR DE FINANCIACIÓN (§4, §13, §19, §22) ─────────────────────────

test('1 · bono parcial: 1 000 − 500 = 500 a pagar; el valor contractual sigue siendo 1 000', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  assert.equal(r.gmv.toFixed(2), '1000.00')
  assert.equal(r.supplierDiscount.toFixed(2), '0.00')
  assert.equal(r.contractualSaleValue.toFixed(2), '1000.00')
  assert.equal(r.membegoSubsidy.toFixed(2), '500.00')
  assert.equal(r.customerPayable.toFixed(2), '500.00')
  assert.equal(r.benefitApplied.toFixed(2), '500.00')
})

test('2 · comisión del 8 % sobre el valor contractual: 80 de comisión y 920 de neto, aunque el cliente pagara 500', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(8), commissionBase: 'CONTRACTUAL_SALE_VALUE' })
  assert.equal(r.commissionBase, 'CONTRACTUAL_SALE_VALUE')
  assert.equal(r.commissionAmount.toFixed(2), '80.00')
  assert.equal(r.supplierNet.toFixed(2), '920.00')
  // El neto del proveedor NO baja por el bono: el subsidio es costo de Membego.
  assert.equal(r.contractualSaleValue.minus(r.commissionAmount).toFixed(2), r.supplierNet.toFixed(2))
})

test('3 · base CUSTOMER_PAID_AMOUNT: la comisión cae a 40 porque se calcula sobre lo que pagó el cliente', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(8), commissionBase: 'CUSTOMER_PAID_AMOUNT' })
  assert.equal(r.commissionAmount.toFixed(2), '40.00')
  assert.equal(r.supplierNet.toFixed(2), '960.00')
})

test('4 · financiación compartida: 1 000 − 100 (proveedor) − 300 (Membego) = 600; contractual 900', () => {
  const compartido: BeneficioParaCalculo = { funding: 'SHARED', valueType: 'FIXED_AMOUNT', membegoValue: D(300), supplierValue: D(100) }
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: compartido, sourceType: 'COMMISSION', commissionPercentage: D(10) })
  assert.equal(r.supplierDiscount.toFixed(2), '100.00')
  assert.equal(r.contractualSaleValue.toFixed(2), '900.00')
  assert.equal(r.membegoSubsidy.toFixed(2), '300.00')
  assert.equal(r.customerPayable.toFixed(2), '600.00')
  assert.equal(r.commissionAmount.toFixed(2), '90.00')
  assert.equal(r.supplierNet.toFixed(2), '810.00')
})

test('5 · cobertura total: un bono mayor que la compra nunca deja el total por debajo de cero', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(400), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(10) })
  assert.equal(r.membegoSubsidy.toFixed(2), '400.00')
  assert.equal(r.customerPayable.toFixed(2), '0.00')
  // El proveedor cobra igual: la comisión y el neto salen del valor contractual.
  assert.equal(r.commissionAmount.toFixed(2), '40.00')
  assert.equal(r.supplierNet.toFixed(2), '360.00')
})

test('6 · porcentaje con tope: 15 % de 3 000 son 450, pero el tope de 300 manda', () => {
  const b: BeneficioParaCalculo = { funding: 'MEMBEGO', valueType: 'PERCENTAGE', membegoValue: D(15), supplierValue: D(0), maxMembegoAmount: D(300) }
  const r = calcularRepartoLinea({ saleUnitPrice: D(3000), quantity: 1, beneficio: b, sourceType: 'PREPURCHASED_SUPPLY' })
  assert.equal(r.membegoSubsidy.toFixed(2), '300.00')
  assert.equal(r.customerPayable.toFixed(2), '2700.00')
  assert.equal(r.commissionAmount.toFixed(2), '0.00')
  assert.equal(r.supplierNet.toFixed(2), '0.00')
})

test('7 · el importe fijo es POR APLICACIÓN, no por unidad: 3 × 1 000 con bono de 500 deja 2 500', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 3, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(10) })
  assert.equal(r.gmv.toFixed(2), '3000.00')
  assert.equal(r.membegoSubsidy.toFixed(2), '500.00')
  assert.equal(r.customerPayable.toFixed(2), '2500.00')
})

test('8 · reparto por unidad determinista: el centavo sobrante va a las primeras unidades y cada unidad cuadra', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 3, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(10) })
  assert.deepEqual(r.porUnidad.map((u) => u.membegoSubsidy.toFixed(2)), ['166.67', '166.67', '166.66'])
  const suma = r.porUnidad.reduce((t, u) => t.plus(u.membegoSubsidy), D(0))
  assert.equal(suma.toFixed(2), r.membegoSubsidy.toFixed(2))
  for (const u of r.porUnidad) {
    assert.equal(u.customerPaid.toFixed(2), u.contractualValue.minus(u.membegoSubsidy).toFixed(2))
    assert.equal(u.supplierNet.toFixed(2), u.contractualValue.minus(u.commissionAmount).toFixed(2))
  }
  assert.equal(r.porUnidad.reduce((t, u) => t.plus(u.customerPaid), D(0)).toFixed(2), r.customerPayable.toFixed(2))
})

test('9 · sin beneficio el reparto es plano: contractual = GMV y el cliente paga todo', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(750), quantity: 2, sourceType: 'COMMISSION', commissionPercentage: D(12) })
  assert.equal(r.contractualSaleValue.toFixed(2), '1500.00')
  assert.equal(r.customerPayable.toFixed(2), '1500.00')
  assert.equal(r.benefitApplied.toFixed(2), '0.00')
  assert.equal(r.commissionAmount.toFixed(2), '180.00')
})

test('10 · la foto del reparto guarda cada cifra con su nombre (§15)', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  const foto = fotoDeReparto(r, { id: 'b1', code: 'MBG-BN-2026-000001', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: '500.00', supplierValue: '0.00' }) as Record<string, unknown>
  assert.equal(foto.contractualSaleValue, '1000.00')
  assert.equal(foto.membegoSubsidy, '500.00')
  assert.equal(foto.customerPayable, '500.00')
  assert.equal(foto.commissionAmount, '80.00')
  assert.equal(foto.supplierNet, '920.00')
  assert.equal(foto.commissionBase, 'CONTRACTUAL_SALE_VALUE')
})

// ── 11–14 · VALIDACIÓN DEL BENEFICIO (§7, §8) ───────────────────────────────

test('11 · un bono de Membego no lleva parte del proveedor y al contrario', () => {
  assert.ok(validarBeneficioParaCalculo({ funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: D(500), supplierValue: D(100) }))
  assert.ok(validarBeneficioParaCalculo({ funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', membegoValue: D(100), supplierValue: D(500) }))
  assert.ok(validarBeneficioParaCalculo({ funding: 'SHARED', valueType: 'FIXED_AMOUNT', membegoValue: D(0), supplierValue: D(500) }))
  assert.equal(validarBeneficioParaCalculo({ funding: 'SHARED', valueType: 'FIXED_AMOUNT', membegoValue: D(300), supplierValue: D(100) }), null)
})

test('12 · valores negativos, porcentajes sobre 100 y topes en cero se rechazan', () => {
  assert.ok(validarBeneficioParaCalculo({ funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: D(-1), supplierValue: D(0) }))
  assert.ok(validarBeneficioParaCalculo({ funding: 'MEMBEGO', valueType: 'PERCENTAGE', membegoValue: D(120), supplierValue: D(0) }))
  assert.ok(validarBeneficioParaCalculo({ funding: 'MEMBEGO', valueType: 'PERCENTAGE', membegoValue: D(10), supplierValue: D(0), maxMembegoAmount: D(0) }))
})

test('13 · el alta exige nombre, alcance coherente y vigencia creciente', () => {
  assert.equal(validarBeneficio(datosBeneficio()), null)
  assert.ok(validarBeneficio(datosBeneficio({ name: '  ' })))
  assert.ok(validarBeneficio(datosBeneficio({ scope: 'CATALOG_ITEM', offerId: 'of1', catalogItemId: null })))
  assert.ok(validarBeneficio(datosBeneficio({ scope: 'SUPPLIER', offerId: null })))
  assert.ok(validarBeneficio(datosBeneficio({ endsAt: new Date('2026-05-01T00:00:00.000Z') })))
  assert.ok(validarBeneficio(datosBeneficio({ perCustomerLimit: 0 })))
})

test('14 · un descuento del proveedor exige proveedor y no consume presupuesto de Membego', () => {
  assert.ok(validarBeneficio(datosBeneficio({ funding: 'SUPPLIER', membegoValue: null, supplierValue: 100, supplierId: null })))
  assert.equal(validarBeneficio(datosBeneficio({ funding: 'SUPPLIER', membegoValue: null, supplierValue: 100, supplierId: 'sp1' })), null)
  assert.ok(validarBeneficio(datosBeneficio({ funding: 'SUPPLIER', membegoValue: null, supplierValue: 100, supplierId: 'sp1', budgetTotal: 5000 })))
})

// ── 15–20 · ELEGIBILIDAD (§9, §16, §18, §25, §33) ───────────────────────────

test('15 · el alcance decide: oferta, producto o proveedor, sin asociaciones ambiguas', () => {
  assert.ok(cubreOferta({ scope: 'SPECIFIC_OFFER', offerId: 'of1', catalogItemId: null, supplierId: null }, oferta()))
  assert.ok(!cubreOferta({ scope: 'SPECIFIC_OFFER', offerId: 'otra', catalogItemId: null, supplierId: null }, oferta()))
  assert.ok(cubreOferta({ scope: 'CATALOG_ITEM', offerId: null, catalogItemId: 'ci1', supplierId: null }, oferta()))
  assert.ok(cubreOferta({ scope: 'SUPPLIER', offerId: null, catalogItemId: null, supplierId: 'sp1' }, oferta()))
  assert.ok(!cubreOferta({ scope: 'SUPPLIER', offerId: null, catalogItemId: null, supplierId: 'sp9' }, oferta()))
})

test('16 · beneficio pausado, no vigente, vencido o de otra moneda no aplica', () => {
  assert.equal(motivoNoElegible(beneficio({ status: 'PAUSED' }), oferta(), 'c1', asignacion(), 0, D(500), AHORA), 'BENEFICIO_INACTIVO')
  assert.equal(motivoNoElegible(beneficio({ status: 'EXPIRED' }), oferta(), 'c1', asignacion(), 0, D(500), AHORA), 'BENEFICIO_VENCIDO')
  assert.equal(motivoNoElegible(beneficio({ startsAt: new Date('2026-07-01T00:00:00.000Z') }), oferta(), 'c1', asignacion(), 0, D(500), AHORA), 'BENEFICIO_NO_VIGENTE')
  assert.equal(motivoNoElegible(beneficio({ endsAt: new Date('2026-06-01T00:00:00.000Z') }), oferta(), 'c1', asignacion(), 0, D(500), AHORA), 'BENEFICIO_VENCIDO')
  assert.equal(motivoNoElegible(beneficio({ currency: 'USD' }), oferta(), 'c1', asignacion(), 0, D(500), AHORA), 'MONEDA_DISTINTA')
})

test('17 · un descuento del proveedor solo cabe en ofertas a comisión y solo del proveedor que lo asume (§25)', () => {
  const b = beneficio({ funding: 'SUPPLIER', supplierId: 'sp1' })
  assert.equal(motivoNoElegible(b, oferta({ sourceType: 'PREPURCHASED_SUPPLY' }), 'c1', asignacion(), 0, D(0), AHORA), 'DESCUENTO_SOLO_COMISION')
  assert.equal(motivoNoElegible(beneficio({ funding: 'SHARED', supplierId: 'sp9' }), oferta(), 'c1', asignacion(), 0, D(0), AHORA), 'PROVEEDOR_NO_FINANCIA')
  assert.equal(motivoNoElegible(b, oferta(), 'c1', asignacion(), 0, D(0), AHORA), null)
})

test('18 · sin asignación no hay beneficio; la asignación ajena, cancelada o vencida tampoco vale', () => {
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', null, 0, D(500), AHORA), 'SIN_ASIGNACION')
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', asignacion({ customerId: 'c2' }), 0, D(500), AHORA), 'ASIGNACION_AJENA')
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', asignacion({ status: 'CANCELLED' }), 0, D(500), AHORA), 'ASIGNACION_INACTIVA')
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', asignacion({ expiresAt: new Date('2026-06-01T00:00:00.000Z') }), 0, D(500), AHORA), 'ASIGNACION_VENCIDA')
})

test('19 · los usos cuentan reservas vivas: dos checkouts a la vez con el mismo bono no pasan (§33)', () => {
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', asignacion({ usesAllowed: 1, usesConsumed: 0 }), 1, D(500), AHORA), 'SIN_USOS')
  assert.equal(motivoNoElegible(beneficio(), oferta(), 'c1', asignacion({ usesAllowed: 2 }), 1, D(500), AHORA), null)
  // Sin asignación obligatoria, el límite por cliente hace el mismo trabajo.
  assert.equal(motivoNoElegible(beneficio({ requiresAssignment: false, perCustomerLimit: 2 }), oferta(), 'c1', null, 2, D(500), AHORA), 'LIMITE_POR_CLIENTE')
})

test('20 · el presupuesto disponible resta reservado y consumido, y un subsidio mayor no pasa', () => {
  const b = beneficio({ budgetTotal: D(1000), budgetReserved: D(400), budgetConsumed: D(300) })
  assert.equal(presupuestoDisponible(b)!.toFixed(2), '300.00')
  assert.equal(motivoNoElegible(b, oferta(), 'c1', asignacion(), 0, D(301), AHORA), 'PRESUPUESTO_INSUFICIENTE')
  assert.equal(motivoNoElegible(b, oferta(), 'c1', asignacion(), 0, D(300), AHORA), null)
  // Sin presupuesto declarado no hay tope que validar.
  assert.equal(presupuestoDisponible(beneficio({ budgetTotal: null })), null)
  assert.equal(motivoNoElegible(beneficio({ budgetTotal: null }), oferta(), 'c1', asignacion(), 0, D(999_999), AHORA), null)
})

// ── 21–24 · CICLO DE VIDA, LEDGER Y SEGREGACIÓN (§7, §12, §34) ───────────────

test('21 · estados del beneficio: DRAFT → ACTIVE → PAUSED/EXHAUSTED → ACTIVE; vencido y cancelado son finales', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_BENEFICIO, 'DRAFT', 'ACTIVE'))
  assert.ok(puedeTransicionar(TRANSICIONES_BENEFICIO, 'ACTIVE', 'PAUSED'))
  assert.ok(puedeTransicionar(TRANSICIONES_BENEFICIO, 'EXHAUSTED', 'ACTIVE'))
  assert.ok(!puedeTransicionar(TRANSICIONES_BENEFICIO, 'EXPIRED', 'ACTIVE'))
  assert.ok(!puedeTransicionar(TRANSICIONES_BENEFICIO, 'CANCELLED', 'ACTIVE'))
  assert.ok(!puedeTransicionar(TRANSICIONES_BENEFICIO, 'DRAFT', 'PAUSED'))
})

test('22 · quien crea un beneficio TAMBIÉN lo aprueba, y queda marcado (§34)', () => {
  assert.equal(esAutoaprobacion('u1', 'u1'), true)
  assert.equal(esAutoaprobacion('u1', 'u2'), false)
})

test('23 · el ledger es la verdad del presupuesto: reservar, aplicar, liberar y reversar cuadran', () => {
  const movs = [
    { type: 'GRANTED' as const, reservedDelta: 0, consumedDelta: 0 },
    { type: 'RESERVED' as const, reservedDelta: 500, consumedDelta: 0 },
    { type: 'RESERVED' as const, reservedDelta: 500, consumedDelta: 0 },
    { type: 'APPLIED' as const, reservedDelta: -500, consumedDelta: 500 },
    { type: 'RELEASED' as const, reservedDelta: -500, consumedDelta: 0 },
    { type: 'REVERSED' as const, reservedDelta: 0, consumedDelta: -500 },
  ]
  const s = saldoDeMovimientosBeneficio(movs)
  assert.equal(s.reserved.toFixed(2), '0.00')
  assert.equal(s.consumed.toFixed(2), '0.00')
  const parcial = saldoDeMovimientosBeneficio(movs.slice(0, 4))
  assert.equal(parcial.reserved.toFixed(2), '500.00')
  assert.equal(parcial.consumed.toFixed(2), '500.00')
})

test('24 · el estado de la asignación se deriva de usos y vencimiento, no se escribe a mano', () => {
  assert.equal(estadoAsignacionSegunUsos({ usesAllowed: 2, usesConsumed: 1, expiresAt: null, status: 'AVAILABLE' }, AHORA), 'AVAILABLE')
  assert.equal(estadoAsignacionSegunUsos({ usesAllowed: 2, usesConsumed: 2, expiresAt: null, status: 'AVAILABLE' }, AHORA), 'EXHAUSTED')
  assert.equal(estadoAsignacionSegunUsos({ usesAllowed: 2, usesConsumed: 0, expiresAt: new Date('2026-06-01T00:00:00.000Z'), status: 'AVAILABLE' }, AHORA), 'EXPIRED')
  assert.equal(estadoAsignacionSegunUsos({ usesAllowed: 2, usesConsumed: 0, expiresAt: null, status: 'CANCELLED' }, AHORA), 'CANCELLED')
})

// ── 25–28 · ECONOMÍA Y CONTRATOS (§14, §26, §28, §34) ───────────────────────

test('25 · la base de la comisión sale de la versión del acuerdo, con el valor contractual por defecto (§14)', () => {
  assert.equal(politicaDeVersion(null).commissionBase, 'CONTRACTUAL_SALE_VALUE')
  assert.equal(politicaDeVersion({ commissionBase: 'CUSTOMER_PAID_AMOUNT' }).commissionBase, 'CUSTOMER_PAID_AMOUNT')
  assert.equal(politicaDeVersion({ commissionBase: 'LO_QUE_SEA' }).commissionBase, 'CONTRACTUAL_SALE_VALUE')
})

test('26 · la foto de la venta usa el valor contractual: el margen no se infla con el subsidio', () => {
  const s = snapshotDeVenta({ publicUnitPrice: D(1500), customerUnitPrice: D(500), actualUnitCost: D(620), contractualUnitValue: D(1000) })
  assert.equal(s.contractualValue.toFixed(2), '1000.00')
  assert.equal(s.grossMargin.toFixed(2), '380.00')
  // El descuento se mide contra el valor contractual, no contra lo que el cliente pagó.
  assert.equal(s.discount.toFixed(2), '500.00')
  assert.equal(s.customerPaid.toFixed(2), '500.00')
})

test('27 · la economía separa subsidio, descuento y cobros; la contribución tras el subsidio puede ser negativa (§28)', () => {
  const eventos: EventoEconomico[] = [
    { type: 'SALE_REVENUE', units: 1, gmvAmount: D(1000), revenueAmount: D(1000), costAmount: D(620), grossMarginAmount: D(380), contractualAmount: D(1000), supplierDiscountAmount: D(0), subsidyAmount: D(0), customerPaidAmount: D(500) },
    { type: 'MEMBEGO_SUBSIDY', units: 1, gmvAmount: D(0), revenueAmount: D(0), costAmount: D(0), grossMarginAmount: D(0), contractualAmount: D(1000), supplierDiscountAmount: D(0), subsidyAmount: D(500), customerPaidAmount: D(500) },
  ]
  const e = agregarEconomia(eventos, 0)
  assert.equal(e.membegoSubsidy.toFixed(2), '500.00')
  assert.equal(e.promotionalCost.toFixed(2), '500.00')
  assert.equal(e.customerCollections.toFixed(2), '500.00')
  assert.equal(e.grossMargin.toFixed(2), '380.00')
  assert.equal(e.contributionAfterSubsidy.toFixed(2), '-120.00')
  // El subsidio NO es ingreso ni GMV: solo costo promocional.
  assert.equal(e.revenue.toFixed(2), '1000.00')
  assert.equal(e.unitsSold, 1)
})

test('28 · el ejemplo del enunciado a comisión: GMV 1 000, comisión 80, neto 920, subsidio 500, contribución −420', () => {
  const r = calcularRepartoLinea({ saleUnitPrice: D(1000), quantity: 1, beneficio: BONO_500, sourceType: 'COMMISSION', commissionPercentage: D(8) })
  const eventos: EventoEconomico[] = [
    { type: 'COMMISSION_REVENUE', units: 1, gmvAmount: r.gmv, revenueAmount: r.commissionAmount, costAmount: D(0), grossMarginAmount: r.commissionAmount, contractualAmount: r.contractualSaleValue, supplierDiscountAmount: r.supplierDiscount, subsidyAmount: D(0), customerPaidAmount: r.customerPayable },
    { type: 'MEMBEGO_SUBSIDY', units: 1, gmvAmount: D(0), revenueAmount: D(0), costAmount: D(0), grossMarginAmount: D(0), contractualAmount: r.contractualSaleValue, supplierDiscountAmount: D(0), subsidyAmount: r.membegoSubsidy, customerPaidAmount: r.customerPayable },
  ]
  const e = agregarEconomia(eventos, 0)
  assert.equal(e.commission.revenue.toFixed(2), '80.00')
  assert.equal(e.commission.supplierNet.toFixed(2), '920.00')
  assert.equal(e.supplierObligations.toFixed(2), '920.00')
  assert.equal(e.membegoSubsidy.toFixed(2), '500.00')
  assert.equal(e.contributionAfterSubsidy.toFixed(2), '-420.00')
  assert.equal(e.customerCollections.toFixed(2), '500.00')
})

test('29 · los seis permisos de beneficios existen y están separados (§34)', () => {
  for (const p of ['SUPPLY_V2_BENEFIT_VIEW', 'SUPPLY_V2_BENEFIT_CREATE', 'SUPPLY_V2_BENEFIT_APPROVE', 'SUPPLY_V2_BENEFIT_ASSIGN', 'SUPPLY_V2_BENEFIT_CANCEL', 'SUPPLY_V2_BENEFIT_FINANCE_VIEW'] as const) {
    assert.ok(SUPPLY_V2_PERMISSIONS.includes(p), `falta ${p}`)
  }
})

test('30 · una cantidad o un precio imposibles rompen el cálculo antes de tocar la base', () => {
  assert.throws(() => calcularRepartoLinea({ saleUnitPrice: D(100), quantity: 0, sourceType: 'COMMISSION', commissionPercentage: D(10) }))
  assert.throws(() => calcularRepartoLinea({ saleUnitPrice: D(100), quantity: 1.5, sourceType: 'COMMISSION', commissionPercentage: D(10) }))
  assert.throws(() => calcularRepartoLinea({ saleUnitPrice: D(-1), quantity: 1, sourceType: 'COMMISSION', commissionPercentage: D(10) }))
  // A comisión, sin porcentaje válido no hay reparto posible.
  assert.throws(() => calcularRepartoLinea({ saleUnitPrice: D(100), quantity: 1, sourceType: 'COMMISSION', commissionPercentage: null }))
})
