import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import {
  calcularTotalesFactura,
  creaObligacion,
  diferenciaConciliacion,
  estadoDepositoSegunSaldo,
  estadoFacturaSegunSaldo,
  estadoObligacionSegunSaldo,
  politicaDeVersion,
  saldoDeMovimientos,
  TRANSICIONES_FACTURA,
  TRANSICIONES_PAGO_PROVEEDOR,
  validarAplicacion,
  validarLineasContraOrden,
  vencimientoDeObligacion,
} from '../src/modules/supply-v2/finance/domain'
import { esAutoaprobacion } from '../src/modules/supply-v2/core/segregacion'
import { agregarEconomia, rangoDeVentana, snapshotDeVenta } from '../src/modules/supply-v2/economics/domain'
import { puedeTransicionar } from '../src/modules/supply-v2/core/estados'
import { aplicarMovimiento, cubetasVacias, saldoDeAsientos } from '../src/modules/supply-v2/core/ledger'
import { snapshotDeAcuerdo, validarAcuerdo } from '../src/modules/supply-v2/agreements/domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · pruebas de DOMINIO (§70). Sin base de datos.
 */

const D = (n: number | string) => new Prisma.Decimal(n)

test('1 · totales de factura: impuesto por línea y suma con Decimal', () => {
  const t = calcularTotalesFactura([{ quantity: 1000, unitCost: 300 }], 0)
  assert.equal(t.subtotal.toFixed(2), '300000.00')
  assert.equal(t.total.toFixed(2), '300000.00')
  const con = calcularTotalesFactura([{ quantity: 3, unitCost: '33.33' }, { quantity: 1, unitCost: 0.1 }], 18)
  assert.equal(con.subtotal.toFixed(2), '100.09')
  assert.equal(con.taxes.toFixed(2), '18.02')
  assert.equal(con.total.toFixed(2), '118.11')
  assert.equal(con.lineas.reduce((s, l) => s.plus(l.total), D(0)).toFixed(2), con.total.toFixed(2), 'las líneas suman el total')
  assert.throws(() => calcularTotalesFactura([], 0), /sin líneas/)
  assert.throws(() => calcularTotalesFactura([{ quantity: 0, unitCost: 1 }]), /entero positivo/)
  assert.throws(() => calcularTotalesFactura([{ quantity: 1, unitCost: -1 }]), /negativo/)
  assert.throws(() => calcularTotalesFactura([{ quantity: 1, unitCost: 1 }], 101), /entre 0 y 100/)
})

test('2 · una factura no factura más de lo comprado (ni sumando facturas previas)', () => {
  const orden = [{ id: 'l1', quantity: 1000, invoicedQuantity: 600, descriptionSnapshot: 'Pizza' }]
  assert.equal(validarLineasContraOrden([{ purchaseOrderLineId: 'l1', quantity: 400, unitCost: 300 }], orden), null)
  assert.match(validarLineasContraOrden([{ purchaseOrderLineId: 'l1', quantity: 401, unitCost: 300 }], orden)!, /solo quedan 400/)
  assert.match(validarLineasContraOrden([{ purchaseOrderLineId: 'l1', quantity: 200, unitCost: 300 }, { purchaseOrderLineId: 'l1', quantity: 201, unitCost: 300 }], orden)!, /solo quedan 200/)
  assert.match(validarLineasContraOrden([{ purchaseOrderLineId: 'otra', quantity: 1, unitCost: 300 }], orden)!, /no pertenece/)
  assert.match(validarLineasContraOrden([{ quantity: 1, unitCost: 300 }], orden)!, /tiene que apuntar/)
})

test('3 · el saldo del depósito se reconstruye sumando sus movimientos', () => {
  const movs = [{ amount: D(100000) }, { amount: D(-15000) }, { amount: D(-5000) }, { amount: D(5000) }]
  assert.equal(saldoDeMovimientos(movs).toFixed(2), '85000.00')
  assert.equal(estadoDepositoSegunSaldo(D(85000), D(0), D(100000)), 'ACTIVE')
  assert.equal(estadoDepositoSegunSaldo(D(0), D(0), D(100000)), 'EXHAUSTED')
  assert.equal(estadoDepositoSegunSaldo(D(0), D(100000), D(100000)), 'REFUNDED')
})

test('4 · aplicar depósito: cabe si no supera ni lo disponible ni lo pendiente', () => {
  assert.equal(validarAplicacion({ monto: 15000, disponibleOrigen: D(100000), pendienteDestino: D(20000), origen: 'El depósito', destino: 'La factura' }), null)
  assert.match(validarAplicacion({ monto: 20001, disponibleOrigen: D(100000), pendienteDestino: D(20000), origen: 'El depósito', destino: 'La factura' })!, /No se permite sobrepagar/)
  assert.match(validarAplicacion({ monto: 8000, disponibleOrigen: D(2000), pendienteDestino: D(10000), origen: 'El depósito', destino: 'La factura' })!, /solo tiene 2000.00 disponible/)
  assert.match(validarAplicacion({ monto: 0, disponibleOrigen: D(1), pendienteDestino: D(1), origen: 'x', destino: 'y' })!, /mayor que cero/)
  assert.match(validarAplicacion({ monto: '1.005', disponibleOrigen: D(10), pendienteDestino: D(10), origen: 'x', destino: 'y' })!, /dos decimales/)
  assert.match(validarAplicacion({ monto: 'abc', disponibleOrigen: D(10), pendienteDestino: D(10), origen: 'x', destino: 'y' })!, /no es un número/)
})

test('5 · el pago directo no es una aplicación de depósito: los orígenes son excluyentes', () => {
  // La regla vive en el motor (un origen por aplicación); aquí se fija el
  // estado de la factura, que no depende de por dónde se pagó.
  assert.equal(estadoFacturaSegunSaldo(D(20000), D(20000), D(0)), 'PAID')
  assert.equal(estadoFacturaSegunSaldo(D(20000), D(0), D(20000)), 'PAID')
  assert.equal(estadoFacturaSegunSaldo(D(20000), D(5000), D(15000)), 'PAID')
})

test('6 · pago parcial de factura', () => {
  assert.equal(estadoFacturaSegunSaldo(D(10000), D(8000), D(0)), 'PARTIALLY_PAID')
  assert.equal(estadoFacturaSegunSaldo(D(10000), D(0), D(0.01)), 'PARTIALLY_PAID')
})

test('7 · pago completo de factura y máquina de estados', () => {
  assert.equal(estadoFacturaSegunSaldo(D(10000), D(10000), D(0)), 'PAID')
  assert.equal(estadoFacturaSegunSaldo(D(10000), D(0), D(0)), 'APPROVED')
  assert.ok(puedeTransicionar(TRANSICIONES_FACTURA, 'PENDING_APPROVAL', 'APPROVED'))
  assert.ok(puedeTransicionar(TRANSICIONES_FACTURA, 'APPROVED', 'CANCELLED'))
  assert.ok(!puedeTransicionar(TRANSICIONES_FACTURA, 'PAID', 'CANCELLED'), 'una factura pagada no se cancela en silencio')
  assert.ok(!puedeTransicionar(TRANSICIONES_FACTURA, 'CANCELLED', 'APPROVED'))
  assert.ok(puedeTransicionar(TRANSICIONES_PAGO_PROVEEDOR, 'PENDING', 'CONFIRMED'))
  assert.ok(!puedeTransicionar(TRANSICIONES_PAGO_PROVEEDOR, 'CANCELLED', 'CONFIRMED'))
})

test('8 · sobrepago bloqueado: nunca más que el pendiente', () => {
  assert.match(validarAplicacion({ monto: 8000, disponibleOrigen: D(8000), pendienteDestino: D(2000), origen: 'El pago', destino: 'La factura' })!, /solo tiene 2000.00 pendiente/)
  assert.equal(validarAplicacion({ monto: 2000, disponibleOrigen: D(8000), pendienteDestino: D(2000), origen: 'El pago', destino: 'La factura' }), null)
})

test('9 · PREPAID (ON_INVOICE): ni la recepción ni la redención crean deuda; solo la factura', () => {
  const p = politicaDeVersion({ type: 'PREPAID_PURCHASE', payableRecognition: 'ON_INVOICE', paymentTermsDays: 0 })
  assert.equal(creaObligacion(p, 'RECEIPT'), false)
  assert.equal(creaObligacion(p, 'REDEMPTION'), false)
  assert.equal(creaObligacion(p, 'INVOICE'), true)
})

test('10 · PAY_LATER: ON_RECEIPT crea deuda al recibir (y la factura se enlaza); ON_REDEMPTION solo al entregar', () => {
  const r = politicaDeVersion({ type: 'PAY_LATER', payableRecognition: 'ON_RECEIPT', paymentTermsDays: 30 })
  assert.equal(creaObligacion(r, 'RECEIPT'), true)
  assert.equal(creaObligacion(r, 'INVOICE'), false, 'la factura no duplica lo reconocido al recibir')
  assert.equal(creaObligacion(r, 'REDEMPTION'), false)
  const d = politicaDeVersion({ type: 'PAY_LATER', payableRecognition: 'ON_REDEMPTION' })
  assert.equal(creaObligacion(d, 'RECEIPT'), false)
  assert.equal(creaObligacion(d, 'REDEMPTION'), true)
  assert.equal(creaObligacion(d, 'INVOICE'), false)
})

test('11 · la política sale de la FOTO de la versión; las versiones viejas se leen con los valores por defecto', () => {
  const vieja = politicaDeVersion({ type: 'PAY_LATER', paymentTermsDays: 15 })
  assert.equal(vieja.payableRecognition, 'ON_INVOICE')
  assert.equal(vieja.allowDepositApplication, true)
  assert.equal(vieja.paymentTermsDays, 15)
  const nula = politicaDeVersion(null)
  assert.equal(nula.payableRecognition, 'ON_INVOICE')
  const basura = politicaDeVersion({ payableRecognition: 'ON_MOON', allowDepositApplication: 'sí', paymentTermsDays: -3 })
  assert.equal(basura.payableRecognition, 'ON_INVOICE')
  assert.equal(basura.allowDepositApplication, true)
  assert.equal(basura.paymentTermsDays, null)
  // El snapshot del acuerdo lleva la política.
  const snap = snapshotDeAcuerdo({ code: 'MBG-AG-1', supplierId: 's', type: 'PAY_LATER', scope: 'ITEM', catalogItemId: 'i', category: null, currency: 'DOP', negotiatedUnitCost: D(300), discountPercentage: null, commissionPercentage: null, paymentTermsDays: 30, payableRecognition: 'ON_RECEIPT', allowDepositApplication: false, settlementFrequency: 'mensual', startsAt: new Date('2026-01-01'), endsAt: null, notes: null })
  assert.equal(politicaDeVersion(snap).payableRecognition, 'ON_RECEIPT')
  assert.equal(politicaDeVersion(snap).allowDepositApplication, false)
  assert.equal(snap.settlementFrequency, 'mensual')
  // Un acuerdo prepago no puede decir «la deuda nace al redimir».
  assert.match(validarAcuerdo({ supplierId: 's', type: 'PREPAID_PURCHASE', catalogItemId: 'i', negotiatedUnitCost: 300, startsAt: new Date(), payableRecognition: 'ON_REDEMPTION' })!, /no puede nacer al redimir/)
  assert.equal(validarAcuerdo({ supplierId: 's', type: 'PAY_LATER', catalogItemId: 'i', negotiatedUnitCost: 300, startsAt: new Date(), payableRecognition: 'ON_REDEMPTION' }), null)
  assert.equal(vencimientoDeObligacion(new Date('2026-01-01T00:00:00Z'), 30)!.toISOString(), '2026-01-31T00:00:00.000Z')
  assert.equal(vencimientoDeObligacion(new Date(), null), null)
})

test('12 · la foto económica de una venta se reconstruye sin precios actuales', () => {
  const s = snapshotDeVenta({ customerUnitPrice: 399, publicUnitPrice: 600, actualUnitCost: 300 })
  assert.equal(s.customerPaid.toFixed(2), '399.00')
  assert.equal(s.publicPrice.toFixed(2), '600.00')
  assert.equal(s.discount.toFixed(2), '201.00')
  assert.equal(s.actualUnitCost.toFixed(2), '300.00')
  assert.equal(s.grossMargin.toFixed(2), '99.00')
})

test('13 · el costo se reconoce exactamente una vez: en la venta', () => {
  const e = agregarEconomia([{ type: 'SALE_REVENUE', units: 1, gmvAmount: 399, revenueAmount: 399, costAmount: 300, grossMarginAmount: 99 }], 1)
  assert.equal(e.revenue.toFixed(2), '399.00')
  assert.equal(e.cost.toFixed(2), '300.00')
  assert.equal(e.grossMargin.toFixed(2), '99.00')
  assert.equal(e.unitsSold, 1)
  assert.equal(e.unitsRedeemed, 1)
})

test('14 · redimir, reversar y volver a redimir no duplica el costo; vencer tampoco', () => {
  // En el modelo elegido la redención y su reversa no escriben dinero; el
  // breakage tampoco. Solo la venta lleva costo.
  const eventos = [
    { type: 'SALE_REVENUE' as const, units: 1, gmvAmount: 399, revenueAmount: 399, costAmount: 300, grossMarginAmount: 99 },
    { type: 'BREAKAGE' as const, units: 1, gmvAmount: 0, revenueAmount: 0, costAmount: 0, grossMarginAmount: 0 },
  ]
  const e = agregarEconomia(eventos, 0)
  assert.equal(e.cost.toFixed(2), '300.00', 'un solo costo')
  assert.equal(e.revenue.toFixed(2), '399.00', 'el ingreso no desaparece al vencer')
  assert.equal(e.grossMargin.toFixed(2), '99.00')
  assert.equal(e.unitsExpired, 1)
})

test('15 · vencimiento del derecho: ISSUED → CLOSED en el ledger, nunca a AVAILABLE', () => {
  const antes = { ...cubetasVacias(), ISSUED: 1, AVAILABLE: 900, ALLOCATED: 99 }
  const despues = aplicarMovimiento(antes, { type: 'EXPIRATION', sourceBucket: 'ISSUED', destinationBucket: 'CLOSED', quantity: 1 })
  assert.equal(despues.ISSUED, 0)
  assert.equal(despues.CLOSED, 1)
  assert.equal(despues.AVAILABLE, 900)
  assert.throws(() => aplicarMovimiento(antes, { type: 'EXPIRATION', sourceBucket: 'ISSUED', destinationBucket: 'AVAILABLE', quantity: 1 }), /no puede ir/)
  assert.throws(() => aplicarMovimiento(antes, { type: 'EXPIRATION', sourceBucket: 'REDEEMED', destinationBucket: 'CLOSED', quantity: 1 }), /no puede ir/)
  // Un lote vencido cierra AVAILABLE y ALLOCATED; RESERVED/ISSUED se quedan.
  const lote = { ...cubetasVacias(), AVAILABLE: 10, ALLOCATED: 5, RESERVED: 1, ISSUED: 2 }
  const c1 = aplicarMovimiento(lote, { type: 'EXPIRATION', sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 10 })
  const c2 = aplicarMovimiento(c1, { type: 'EXPIRATION', sourceBucket: 'ALLOCATED', destinationBucket: 'CLOSED', quantity: 5 })
  assert.deepEqual(c2, { AVAILABLE: 0, ALLOCATED: 0, RESERVED: 1, ISSUED: 2, REDEEMED: 0, CLOSED: 15 })
  assert.deepEqual(saldoDeAsientos([{ sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: 18 }, { sourceBucket: 'AVAILABLE', destinationBucket: 'CLOSED', quantity: 10 }]), { ...cubetasVacias(), AVAILABLE: 8, CLOSED: 10 })
})

test('16 · breakage: derechos vendidos que vencieron sin redimir, y su tasa', () => {
  const eventos = [
    ...Array.from({ length: 4 }, () => ({ type: 'SALE_REVENUE' as const, units: 1, gmvAmount: 399, revenueAmount: 399, costAmount: 300, grossMarginAmount: 99 })),
    { type: 'BREAKAGE' as const, units: 1, gmvAmount: 0, revenueAmount: 0, costAmount: 0, grossMarginAmount: 0 },
  ]
  const e = agregarEconomia(eventos, 2)
  assert.equal(e.unitsSold, 4)
  assert.equal(e.unitsRedeemed, 2)
  assert.equal(e.unitsExpired, 1)
  assert.equal(e.breakageRate, 25)
  assert.equal(agregarEconomia([], 0).breakageRate, null)
  // Supply vencido sin vender es otra cosa: costo real perdido, aparte.
  const v = agregarEconomia([{ type: 'EXPIRATION_COST', units: 10, gmvAmount: 0, revenueAmount: 0, costAmount: 3000, grossMarginAmount: -3000 }], 0)
  assert.equal(v.expiredSupplyUnits, 10)
  assert.equal(v.expiredSupplyCost.toFixed(2), '3000.00')
  assert.equal(v.cost.toFixed(2), '0.00', 'no se mezcla con el costo de lo vendido')
})

test('17 · margen bruto y porcentaje', () => {
  const e = agregarEconomia(Array.from({ length: 3 }, () => ({ type: 'SALE_REVENUE' as const, units: 1, gmvAmount: 399, revenueAmount: 399, costAmount: 300, grossMarginAmount: 99 })), 0)
  assert.equal(e.gmv.toFixed(2), '1197.00')
  assert.equal(e.grossMargin.toFixed(2), '297.00')
  assert.equal(e.marginPct, 24.81)
  assert.equal(agregarEconomia([], 0).marginPct, null)
})

test('18 · reversa de depósito: el movimiento contrario restaura el saldo y el estado', () => {
  const movs = [{ amount: D(10000) }, { amount: D(-10000) }]
  assert.equal(saldoDeMovimientos(movs).toFixed(2), '0.00')
  assert.equal(estadoDepositoSegunSaldo(saldoDeMovimientos(movs), D(0), D(10000)), 'EXHAUSTED')
  movs.push({ amount: D(10000) })
  assert.equal(saldoDeMovimientos(movs).toFixed(2), '10000.00')
  assert.equal(estadoDepositoSegunSaldo(saldoDeMovimientos(movs), D(0), D(10000)), 'ACTIVE')
})

test('19 · reversa de aplicación de pago: la factura vuelve a deber y la obligación también', () => {
  assert.equal(estadoFacturaSegunSaldo(D(20000), D(5000), D(15000)), 'PAID')
  assert.equal(estadoFacturaSegunSaldo(D(20000), D(0), D(15000)), 'PARTIALLY_PAID')
  assert.equal(estadoObligacionSegunSaldo(D(20000), D(20000)), 'PAID')
  assert.equal(estadoObligacionSegunSaldo(D(20000), D(15000)), 'PARTIALLY_PAID')
  assert.equal(estadoObligacionSegunSaldo(D(20000), D(0)), 'OPEN')
})

test('20 · conciliación: sin monto del proveedor queda OPEN; con monto, MATCHED o DISCREPANCY', () => {
  assert.deepEqual(diferenciaConciliacion(D(20000), null), { difference: null, status: 'OPEN' })
  const igual = diferenciaConciliacion(D(20000), D(20000))
  assert.equal(igual.status, 'MATCHED')
  assert.equal(igual.difference!.toFixed(2), '0.00')
  const distinta = diferenciaConciliacion(D(20000), D(18500))
  assert.equal(distinta.status, 'DISCREPANCY')
  assert.equal(distinta.difference!.toFixed(2), '1500.00')
})

test('21 · quien registra un pago o una factura TAMBIÉN los aprueba, y queda marcado', () => {
  assert.equal(esAutoaprobacion('ana', 'ana'), true)
  assert.equal(esAutoaprobacion('ana', 'luis'), false)
})

test('22 · ventanas del reporte económico', () => {
  const ahora = new Date('2026-09-30T15:00:00')
  const hoy = rangoDeVentana('HOY', ahora)
  assert.equal(hoy.desde.getHours(), 0)
  assert.ok(hoy.hasta > ahora)
  const semana = rangoDeVentana('7D', ahora)
  assert.equal(Math.round((hoy.desde.getTime() - semana.desde.getTime()) / 86_400_000), 6)
  const mes = rangoDeVentana('MES', ahora)
  assert.equal(mes.desde.getDate(), 1)
  assert.equal(mes.desde.getMonth(), 8)
  const rango = rangoDeVentana('RANGO', ahora, new Date('2026-09-01'), new Date('2026-09-15'))
  assert.equal(rango.desde.toISOString().slice(0, 10), '2026-09-01')
  assert.equal(rango.hasta.toISOString().slice(0, 10), '2026-09-15')
})
