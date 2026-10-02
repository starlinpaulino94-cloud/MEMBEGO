import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { calcularLineaComision, repartirComision, repartirEnUnidades, SupplyV2PricingEngine, validarPorcentajeComision } from '../src/modules/supply-v2/core/comision'
import { resolverAcuerdoComision, snapshotDeAcuerdo, validarAcuerdo, type AcuerdoComisionCandidato } from '../src/modules/supply-v2/agreements/domain'
import { unidadesLibresComision, validarOfertaComision } from '../src/modules/supply-v2/offers/domain'
import { motivoNoCanjeable, type CanjeParaValidar } from '../src/modules/supply-v2/redemption/domain'
import {
  elegibles,
  estadoLiquidacionSegunPago,
  motivoNoLiquidable,
  periodoDeFrecuencia,
  repartirPagoMasAntiguoPrimero,
  totalesDeLiquidacion,
  TRANSICIONES_LIQUIDACION,
  validarPeriodo,
} from '../src/modules/supply-v2/finance/settlements-domain'
import { esAutoaprobacion } from '../src/modules/supply-v2/core/segregacion'
import { creaObligacion, politicaDeVersion } from '../src/modules/supply-v2/finance/domain'
import { agregarEconomia } from '../src/modules/supply-v2/economics/domain'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'
import { SUPPLY_V2_PERMISSIONS } from '../src/modules/supply-v2/contracts/gateways'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 · pruebas de DOMINIO (§82). Sin base de datos.
 */

const D = (n: number | string) => new Prisma.Decimal(n)
const ahora = new Date('2026-10-01T12:00:00Z')
const DIA = 86_400_000

// ── Motor de precios ─────────────────────────────────────────────────────────

test('1 · 1 000 al 10 %: GMV 1 000, ingreso de Membego 100, neto del proveedor 900 (ni ingreso 1 000 ni costo 900)', () => {
  const r = repartirComision(1000, 10)
  assert.deepEqual([r.gmv.toFixed(2), r.membegoRevenue.toFixed(2), r.supplierGross.toFixed(2), r.commissionAmount.toFixed(2), r.netSupplierAmount.toFixed(2)], ['1000.00', '100.00', '1000.00', '100.00', '900.00'])
  assert.equal(SupplyV2PricingEngine.repartirComision, repartirComision)
})

test('2 · redondeo a 2 decimales ROUND_HALF_UP: 33.33 % de 10 → 3.33 / 6.67; 12.5 % de 0.10 → 0.01 / 0.09', () => {
  assert.deepEqual([repartirComision(10, '33.33').commissionAmount.toFixed(2), repartirComision(10, '33.33').netSupplierAmount.toFixed(2)], ['3.33', '6.67'])
  assert.deepEqual([repartirComision('0.10', '12.5').commissionAmount.toFixed(2), repartirComision('0.10', '12.5').netSupplierAmount.toFixed(2)], ['0.01', '0.09'])
  // 0.125 → 0.13 (half up), no banker's rounding.
  assert.equal(repartirComision('1.25', 10).commissionAmount.toFixed(2), '0.13')
})

test('3 · comisión + neto = GMV exacto para cualquier combinación', () => {
  for (const [monto, pct] of [['999.99', '7.77'], ['0.01', '50'], ['123456.78', '0.01'], ['10', '0'], ['10', '100']] as const) {
    const r = repartirComision(monto, pct)
    assert.equal(r.commissionAmount.plus(r.netSupplierAmount).toFixed(2), D(monto).toFixed(2), `${monto} @ ${pct}`)
  }
})

test('4 · repartirEnUnidades: n partes de 2 decimales que suman el total; difieren a lo sumo un centavo', () => {
  const partes = repartirEnUnidades(D('10.00'), 3)
  assert.deepEqual(partes.map((p) => p.toFixed(2)), ['3.34', '3.33', '3.33'])
  assert.equal(partes.reduce((t, p) => t.plus(p), D(0)).toFixed(2), '10.00')
  assert.deepEqual(repartirEnUnidades(D('0.02'), 3).map((p) => p.toFixed(2)), ['0.01', '0.01', '0.00'])
  assert.throws(() => repartirEnUnidades(D(1), 0))
})

test('5 · el porcentaje de comisión: obligatorio, entre 0 y 100, dos decimales', () => {
  assert.match(validarPorcentajeComision(null)!, /necesita/)
  assert.match(validarPorcentajeComision('abc')!, /no es un número/)
  assert.match(validarPorcentajeComision(-1)!, /entre 0 y 100/)
  assert.match(validarPorcentajeComision(100.01)!, /entre 0 y 100/)
  assert.match(validarPorcentajeComision('10.555')!, /dos decimales/)
  assert.equal(validarPorcentajeComision('10.55'), null)
  assert.equal(validarPorcentajeComision(0), null)
  assert.throws(() => repartirComision(-5, 10), /negativo/)
})

test('6 · una línea de 3 × 10.00 al 33.33 %: total 10.00 / 20.00 y el reparto por unidad cuadra con la línea', () => {
  const l = calcularLineaComision(10, 3, '33.33')
  assert.deepEqual([l.gmv.toFixed(2), l.commissionAmount.toFixed(2), l.netSupplierAmount.toFixed(2)], ['30.00', '10.00', '20.00'])
  assert.deepEqual([l.commissionUnitAmount.toFixed(2), l.supplierUnitNet.toFixed(2)], ['3.33', '6.67'])
  assert.equal(l.porUnidad.length, 3)
  assert.equal(l.porUnidad.reduce((t, u) => t.plus(u.commissionAmount), D(0)).toFixed(2), '10.00')
  assert.equal(l.porUnidad.reduce((t, u) => t.plus(u.supplierNet), D(0)).toFixed(2), '20.00')
  assert.ok(l.porUnidad.every((u) => u.commissionAmount.plus(u.supplierNet).toFixed(2) === '10.00'), 'cada unidad: comisión + neto = precio')
  assert.throws(() => calcularLineaComision(10, 0, 10))
})

// ── Acuerdo a comisión ───────────────────────────────────────────────────────

const base = { supplierId: 'p', startsAt: ahora }

test('7 · un acuerdo COMMISSION exige porcentaje y no admite costo negociado', () => {
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG' })!, /porcentaje/)
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10, negotiatedUnitCost: 300 })!, /costo negociado/)
  assert.equal(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10 }), null)
})

test('8 · en COMMISSION la deuda nace al entregar: ON_INVOICE / ON_RECEIPT se rechazan; la foto lo congela', () => {
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10, payableRecognition: 'ON_INVOICE' })!, /ON_REDEMPTION/)
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10, payableRecognition: 'ON_RECEIPT' })!, /ON_REDEMPTION/)
  assert.equal(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10, payableRecognition: 'ON_REDEMPTION' }), null)
  const foto = snapshotDeAcuerdo({ code: 'MBG-AG-2026-000001', supplierId: 'p', type: 'COMMISSION', scope: 'CATALOG', catalogItemId: null, category: null, currency: 'DOP', negotiatedUnitCost: null, discountPercentage: null, commissionPercentage: D('10.00'), paymentTermsDays: 7, payableRecognition: 'ON_REDEMPTION', startsAt: ahora, endsAt: null, notes: null })
  assert.deepEqual([foto.type, foto.commissionPercentage, foto.payableRecognition], ['COMMISSION', '10', 'ON_REDEMPTION'])
  const politica = politicaDeVersion(foto)
  assert.ok(creaObligacion(politica, 'REDEMPTION'))
  assert.ok(!creaObligacion(politica, 'INVOICE'))
  assert.ok(!creaObligacion(politica, 'RECEIPT'))
})

test('9 · alcances: ITEM exige producto, CATEGORY exige categoría, CATALOG no exige nada', () => {
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'ITEM', commissionPercentage: 10 })!, /producto/)
  assert.match(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATEGORY', commissionPercentage: 10 })!, /categoría/)
  assert.equal(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'ITEM', catalogItemId: 'i', commissionPercentage: 10 }), null)
  assert.equal(validarAcuerdo({ ...base, type: 'COMMISSION', scope: 'CATEGORY', category: 'Tours', commissionPercentage: 10 }), null)
  // Un acuerdo PREPAID por producto sigue exigiendo costo (Slice 1 intacto).
  assert.match(validarAcuerdo({ ...base, type: 'PREPAID_PURCHASE', scope: 'ITEM', catalogItemId: 'i' })!, /costo negociado/)
})

const cand = (p: Partial<AcuerdoComisionCandidato> & { id: string; scope: AcuerdoComisionCandidato['scope'] }): AcuerdoComisionCandidato => ({
  code: `MBG-AG-2026-${p.id.padStart(6, '0')}`,
  status: 'ACTIVE',
  type: 'COMMISSION',
  catalogItemId: null,
  category: null,
  startsAt: new Date(ahora.getTime() - 10 * DIA),
  endsAt: null,
  version: 1,
  ...p,
})
const item = { id: 'saona', category: 'Tours' }

test('10 · precedencia ITEM > CATEGORY > CATALOG', () => {
  const todos = [cand({ id: '1', scope: 'CATALOG' }), cand({ id: '2', scope: 'CATEGORY', category: 'tours' }), cand({ id: '3', scope: 'ITEM', catalogItemId: 'saona' })]
  assert.equal(resolverAcuerdoComision(todos, item, ahora)?.id, '3')
  assert.equal(resolverAcuerdoComision(todos.slice(0, 2), item, ahora)?.id, '2', 'la categoría se compara sin distinguir mayúsculas')
  assert.equal(resolverAcuerdoComision(todos.slice(0, 1), item, ahora)?.id, '1')
  assert.equal(resolverAcuerdoComision(todos, { id: 'gorra', category: 'Merch' }, ahora)?.id, '1', 'otro producto: solo el catálogo lo cubre')
  assert.equal(resolverAcuerdoComision([], item, ahora), null)
})

test('11 · solo acuerdos ACTIVE, vigentes y de tipo COMMISSION cuentan; entre iguales gana el más reciente', () => {
  assert.equal(resolverAcuerdoComision([cand({ id: '1', scope: 'ITEM', catalogItemId: 'saona', status: 'SUSPENDED' })], item, ahora), null)
  assert.equal(resolverAcuerdoComision([cand({ id: '1', scope: 'ITEM', catalogItemId: 'saona', startsAt: new Date(ahora.getTime() + DIA) })], item, ahora), null, 'todavía no empieza')
  assert.equal(resolverAcuerdoComision([cand({ id: '1', scope: 'ITEM', catalogItemId: 'saona', endsAt: new Date(ahora.getTime() - DIA) })], item, ahora), null, 'ya terminó')
  assert.equal(resolverAcuerdoComision([cand({ id: '1', scope: 'ITEM', catalogItemId: 'saona', type: 'PREPAID_PURCHASE' })], item, ahora), null, 'un acuerdo de compra no vende a comisión')
  assert.equal(resolverAcuerdoComision([cand({ id: '1', scope: 'CATALOG', startsAt: new Date(ahora.getTime() - 5 * DIA) }), cand({ id: '2', scope: 'CATALOG', startsAt: new Date(ahora.getTime() - DIA) })], item, ahora)?.id, '2')
})

// ── Oferta a comisión y disponibilidad ───────────────────────────────────────

const oferta = { catalogItemId: 'i', title: 'Excursión', publicPrice: 1200, salePrice: 1000, startsAt: ahora }

test('12 · FIXED_QUANTITY y CAPACITY exigen unidades; UNLIMITED no; el máximo por persona cabe en ellas', () => {
  assert.match(validarOfertaComision({ ...oferta, availabilityMode: 'FIXED_QUANTITY' })!, /cuántas unidades/)
  assert.match(validarOfertaComision({ ...oferta, availabilityMode: 'CAPACITY', availabilityQuantity: 0 })!, /cuántas unidades/)
  assert.match(validarOfertaComision({ ...oferta, availabilityMode: 'FIXED_QUANTITY', availabilityQuantity: 2, perCustomerLimit: 3 })!, /máximo por persona/)
  assert.equal(validarOfertaComision({ ...oferta, availabilityMode: 'FIXED_QUANTITY', availabilityQuantity: 100, perCustomerLimit: 5 }), null)
  assert.equal(validarOfertaComision({ ...oferta, availabilityMode: 'UNLIMITED', perCustomerLimit: 50 }), null)
  assert.match(validarOfertaComision({ ...oferta, availabilityMode: 'UNLIMITED', salePrice: 1300 })!, /no puede ser mayor/)
  assert.match(validarOfertaComision({ ...oferta, availabilityMode: 'OTRO' as never })!, /disponibilidad/)
})

test('13 · unidades libres: tope − (reservadas + consumidas); nunca negativo; sin tope → null', () => {
  assert.equal(unidadesLibresComision({ availabilityMode: 'FIXED_QUANTITY', availabilityQuantity: 100 }, 37), 63)
  assert.equal(unidadesLibresComision({ availabilityMode: 'CAPACITY', availabilityQuantity: 10 }, 12), 0)
  assert.equal(unidadesLibresComision({ availabilityMode: 'UNLIMITED', availabilityQuantity: null }, 9999), null)
  assert.equal(unidadesLibresComision({ availabilityMode: null, availabilityQuantity: null }, 0), null)
})

// ── Canje sin lote ───────────────────────────────────────────────────────────

const canje: CanjeParaValidar = {
  sesion: { expiresAt: new Date(ahora.getTime() + 60_000), consumedAt: null, branchId: null },
  voucher: { status: 'ACTIVE', validUntil: null },
  derecho: { status: 'ACTIVE', expiresAt: null, supplierId: 's', customerId: 'c' },
  proveedor: { status: 'ACTIVE', companyId: 'e' },
  empleado: { supplierId: 's', companyId: 'e' },
  sucursal: null,
  proveedorTieneSucursales: false,
  lotIssued: null,
}

test('14 · el canje a comisión no consulta el ledger (lotIssued = null); con lote sigue exigiendo ISSUED ≥ 1', () => {
  assert.equal(motivoNoCanjeable(canje, ahora), null)
  assert.equal(motivoNoCanjeable({ ...canje, lotIssued: 0 }, ahora), 'LEDGER_INCONSISTENT')
  assert.equal(motivoNoCanjeable({ ...canje, lotIssued: 1 }, ahora), null)
  assert.equal(motivoNoCanjeable({ ...canje, derecho: { ...canje.derecho, status: 'REDEEMED' } }, ahora), 'ALREADY_REDEEMED')
})

// ── Liquidaciones ────────────────────────────────────────────────────────────

const periodo = { start: new Date(ahora.getTime() - 7 * DIA), end: ahora }
const ob = (p: { id: string; status?: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'; settlementId?: string | null; recognizedAt?: Date; currency?: string; outstanding?: string }) => ({
  id: p.id,
  status: p.status ?? ('OPEN' as const),
  settlementId: p.settlementId ?? null,
  recognizedAt: p.recognizedAt ?? new Date(ahora.getTime() - DIA),
  currency: p.currency ?? 'DOP',
  outstandingAmount: D(p.outstanding ?? '900'),
})

test('15 · elegibles: OPEN o PARTIALLY_PAID, sin liquidación viva, misma moneda, dentro del periodo', () => {
  assert.equal(motivoNoLiquidable(ob({ id: 'a' }), periodo.start, periodo.end, 'DOP'), null)
  assert.equal(motivoNoLiquidable(ob({ id: 'a', status: 'PARTIALLY_PAID' }), periodo.start, periodo.end, 'DOP'), null)
  assert.match(motivoNoLiquidable(ob({ id: 'a', status: 'PAID' }), periodo.start, periodo.end, 'DOP')!, /PAID/)
  assert.match(motivoNoLiquidable(ob({ id: 'a', status: 'CANCELLED' }), periodo.start, periodo.end, 'DOP')!, /CANCELLED/)
  assert.match(motivoNoLiquidable(ob({ id: 'a', settlementId: 'L1' }), periodo.start, periodo.end, 'DOP')!, /ya está en una liquidación/)
  assert.match(motivoNoLiquidable(ob({ id: 'a', currency: 'USD' }), periodo.start, periodo.end, 'DOP')!, /moneda/)
  assert.match(motivoNoLiquidable(ob({ id: 'a', recognizedAt: ahora }), periodo.start, periodo.end, 'DOP')!, /fuera del periodo/, 'el fin es exclusivo')
  assert.deepEqual(elegibles([ob({ id: 'a' }), ob({ id: 'b', status: 'PAID' }), ob({ id: 'c', settlementId: 'x' })], periodo.start, periodo.end, 'DOP').map((o) => o.id), ['a'])
})

test('16 · totales y estado derivado del pago', () => {
  const t = totalesDeLiquidacion([{ grossAmount: 1000, commissionAmount: 100, supplierNet: 900 }, { grossAmount: '10', commissionAmount: '3.33', supplierNet: '6.67' }])
  assert.deepEqual([t.grossSales.toFixed(2), t.commissionAmount.toFixed(2), t.supplierNet.toFixed(2)], ['1010.00', '103.33', '906.67'])
  assert.equal(estadoLiquidacionSegunPago(D(900), D(0)), 'APPROVED')
  assert.equal(estadoLiquidacionSegunPago(D(900), D(1)), 'PARTIALLY_PAID')
  assert.equal(estadoLiquidacionSegunPago(D(900), D(900)), 'PAID')
})

test('17 · quien genera la liquidación TAMBIÉN la aprueba, y queda marcado', () => {
  assert.equal(esAutoaprobacion('ana', 'ana'), true)
  assert.equal(esAutoaprobacion('ana', 'luis'), false)
})

test('18 · repartir un pago: la más antigua primero, nunca más que lo pendiente; el resto queda sin aplicar', () => {
  const obs = [
    { id: 'nueva', outstandingAmount: D(900), recognizedAt: new Date(ahora.getTime() - DIA) },
    { id: 'vieja', outstandingAmount: D(900), recognizedAt: new Date(ahora.getTime() - 3 * DIA) },
    { id: 'pagada', outstandingAmount: D(0), recognizedAt: new Date(ahora.getTime() - 5 * DIA) },
  ]
  const r = repartirPagoMasAntiguoPrimero(1000, obs)
  assert.deepEqual(r.aplicaciones.map((a) => [a.obligacion.id, a.amount.toFixed(2)]), [['vieja', '900.00'], ['nueva', '100.00']])
  assert.equal(r.sinAplicar.toFixed(2), '0.00')
  const r2 = repartirPagoMasAntiguoPrimero(2000, obs)
  assert.equal(r2.aplicaciones.reduce((t, a) => t.plus(a.amount), D(0)).toFixed(2), '1800.00')
  assert.equal(r2.sinAplicar.toFixed(2), '200.00', 'nunca se sobrepaga')
  assert.deepEqual(repartirPagoMasAntiguoPrimero(0, obs).aplicaciones, [])
})

test('19 · periodos por frecuencia; MANUAL exige fechas; el periodo tiene que terminar después de empezar', () => {
  const ref = new Date(2026, 9, 14, 15, 0, 0) // miércoles 14 de octubre de 2026, hora local
  const sem = periodoDeFrecuencia('WEEKLY', ref)!
  assert.deepEqual([sem.periodStart.getDay(), sem.periodStart.getDate(), sem.periodEnd.getDate()], [1, 12, 19], 'lunes a lunes')
  const dia = periodoDeFrecuencia('DAILY', ref)!
  assert.equal(dia.periodEnd.getTime() - dia.periodStart.getTime(), DIA)
  const quin = periodoDeFrecuencia('BIWEEKLY', ref)!
  assert.deepEqual([quin.periodStart.getDate(), quin.periodEnd.getDate()], [1, 16])
  assert.deepEqual([periodoDeFrecuencia('BIWEEKLY', new Date(2026, 9, 20))!.periodStart.getDate(), periodoDeFrecuencia('BIWEEKLY', new Date(2026, 9, 20))!.periodEnd.getMonth()], [16, 10])
  const mes = periodoDeFrecuencia('MONTHLY', ref)!
  assert.deepEqual([mes.periodStart.getDate(), mes.periodEnd.getMonth()], [1, 10])
  assert.equal(periodoDeFrecuencia('MANUAL', ref), null)
  assert.match(validarPeriodo(ahora, ahora)!, /después de empezar/)
  assert.match(validarPeriodo(new Date('x'), ahora)!, /inicio/)
  assert.equal(validarPeriodo(periodo.start, periodo.end), null)
})

test('20 · máquina de estados de la liquidación: sin saltos; CANCELLED es terminal', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_LIQUIDACION, 'PENDING_APPROVAL', 'APPROVED'))
  assert.ok(puedeTransicionar(TRANSICIONES_LIQUIDACION, 'APPROVED', 'PARTIALLY_PAID'))
  assert.ok(puedeTransicionar(TRANSICIONES_LIQUIDACION, 'PARTIALLY_PAID', 'PAID'))
  assert.ok(puedeTransicionar(TRANSICIONES_LIQUIDACION, 'PAID', 'PARTIALLY_PAID'), 'una reversa de aplicación devuelve el saldo')
  assert.ok(!puedeTransicionar(TRANSICIONES_LIQUIDACION, 'PENDING_APPROVAL', 'PAID'))
  assert.ok(!puedeTransicionar(TRANSICIONES_LIQUIDACION, 'PAID', 'CANCELLED'))
  assert.deepEqual(TRANSICIONES_LIQUIDACION.CANCELLED, [])
})

// ── Economía ─────────────────────────────────────────────────────────────────

test('21 · la economía separa comisión de prepago: ingreso = comisión, costo 0, el neto no es ingreso ni costo', () => {
  const e = agregarEconomia(
    [
      { type: 'COMMISSION_REVENUE', units: 1, gmvAmount: 1000, revenueAmount: 100, costAmount: 0, grossMarginAmount: 100 },
      { type: 'SALE_REVENUE', units: 1, gmvAmount: 399, revenueAmount: 399, costAmount: 300, grossMarginAmount: 99 },
      { type: 'BREAKAGE', units: 1, gmvAmount: 0, revenueAmount: 0, costAmount: 0, grossMarginAmount: 0 },
    ],
    1
  )
  assert.deepEqual([e.gmv.toFixed(2), e.revenue.toFixed(2), e.cost.toFixed(2), e.grossMargin.toFixed(2), e.unitsSold], ['1399.00', '499.00', '300.00', '199.00', 2])
  assert.deepEqual([e.commission.gmv.toFixed(2), e.commission.revenue.toFixed(2), e.commission.supplierNet.toFixed(2), e.commission.unitsSold], ['1000.00', '100.00', '900.00', 1])
  assert.deepEqual([e.prepurchase.gmv.toFixed(2), e.prepurchase.revenue.toFixed(2), e.prepurchase.cost.toFixed(2), e.prepurchase.unitsSold], ['399.00', '399.00', '300.00', 1])
  assert.equal(e.unitsExpired, 1)
})

test('22 · los seis permisos nuevos existen y son distintos de los del Slice 4', () => {
  for (const p of ['SUPPLY_V2_COMMISSION_OFFER_MANAGE', 'SUPPLY_V2_SETTLEMENT_VIEW', 'SUPPLY_V2_SETTLEMENT_CREATE', 'SUPPLY_V2_SETTLEMENT_APPROVE', 'SUPPLY_V2_SETTLEMENT_PAY', 'SUPPLY_V2_COMMISSION_RECONCILE'] as const) {
    assert.ok(SUPPLY_V2_PERMISSIONS.includes(p), p)
  }
  assert.equal(new Set(SUPPLY_V2_PERMISSIONS).size, SUPPLY_V2_PERMISSIONS.length)
})
