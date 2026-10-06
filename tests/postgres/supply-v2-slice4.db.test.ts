import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { crearOfertaEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, confirmarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, expirarDerechosEnTx, reversarRedencionEnTx, type EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'
import { barridoSupplyV2 } from '../../src/modules/supply-v2/commerce/barrido'
import { aprobarFacturaEnTx, cancelarFacturaEnTx, crearFacturaEnTx } from '../../src/modules/supply-v2/finance/invoices'
import { cancelarPagoProveedorEnTx, confirmarPagoProveedorEnTx, crearPagoEnTx } from '../../src/modules/supply-v2/finance/payments'
import { crearDepositoDesdePagoEnTx } from '../../src/modules/supply-v2/finance/deposits'
import { aplicarEnTx, reversarAplicacionEnTx } from '../../src/modules/supply-v2/finance/applications'
import { crearConciliacionEnTx, registrarMontoDelProveedorEnTx, resolverConciliacionEnTx } from '../../src/modules/supply-v2/finance/reconciliation'
import { reconocerVentaEnTx } from '../../src/modules/supply-v2/economics/service'
import { expirarLoteEnTx } from '../../src/modules/supply-v2/pool/vencimientos'
import { saldoDeMovimientos } from '../../src/modules/supply-v2/finance/domain'
import { cubetasDeLote, invarianteCumplido, saldoDeAsientos } from '../../src/modules/supply-v2/core/ledger'
import { calcularEconomia } from '../../src/modules/supply-v2/economics/queries'
import { perfilFinancieroProveedor, resumenFinanzas } from '../../src/modules/supply-v2/finance/queries'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 contra PostgreSQL de verdad (§71).
 *
 *   E  PREPAID: PO → factura → pago → recepción → venta → redención → sin CxP nueva; 399 / 300 / 99
 *   A  Depósito 100k → factura 20k → depósito 15k → transferencia 5k → PAID y 85k
 *   K  Reversas: la factura vuelve a deber, el depósito recupera; se vuelve a aplicar
 *   B  Pago directo 20k → el depósito sigue en 85k
 *   C  Dos aplicaciones de 8k sobre un depósito de 10k → una sola pasa, nunca negativo
 *   D  Dos pagos de 8k sobre una factura de 10k → no se sobrepaga; el excedente se hace depósito EXPLÍCITO
 *   F  PAY_LATER ON_RECEIPT: recepción → obligación 30k → factura se enlaza (no duplica) → pago 10k → 20k pendiente
 *   F2 PAY_LATER ON_REDEMPTION: la deuda nace al entregar; la reversa la cancela; la nueva entrega la crea otra vez
 *   G  Vencimiento del derecho: EXPIRED, ISSUED → CLOSED, breakage +1, ingreso se conserva, costo no se duplica
 *   H  Reversa económica: redimir, reversar, redimir → un solo costo
 *   I  Conciliación con discrepancia, sin inventar MATCHED
 *   J  Lote vencido: AVAILABLE/ALLOCATED → CLOSED; RESERVED/ISSUED intactos; costo perdido
 *   L  Cancelar factura: bloqueada con aplicaciones vivas; sin ellas cancela su obligación
 *   M  Segregación en el servidor; auditoría
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const D = (n: number | string) => new Prisma.Decimal(n)

const ctx = {
  compras: '',
  finanzas: '',
  cliente: '',
  cliente2: '',
  empresaId: '',
  sucursal: '',
  empleado: null as unknown as EmpleadoProveedor,
  empresaDId: '',
  sucursalD: '',
  empleadoD: null as unknown as EmpleadoProveedor,
  pizza: { supplierId: '', itemId: '', agreementId: '', poId: '', lotId: '', offerId: '', invoiceId: '', derecho: '', redencion: '' },
  b: { supplierId: '', itemId: '', depositId: '', invoiceA: '', appDeposito: '', appPago: '', agreementId: '' },
  d: { supplierId: '', itemId: '', agreementId: '', offerId: '', derecho: '' },
}

async function lote(id: string) {
  const l = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id } })
  assert.ok(invarianteCumplido(l.quantityReceived, cubetasDeLote(l)), `invariante del lote ${l.code}`)
  const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: id } })
  assert.deepEqual(saldoDeAsientos(asientos), cubetasDeLote(l), `Σ asientos = cubetas del lote ${l.code}`)
  return l
}
const factura = (id: string) => prisma.supplyV2SupplierInvoice.findUniqueOrThrow({ where: { id } })
const deposito = (id: string) => prisma.supplyV2SupplierDeposit.findUniqueOrThrow({ where: { id }, include: { movements: true } })
const pago = (id: string) => prisma.supplyV2SupplierPayment.findUniqueOrThrow({ where: { id } })
const obligacionesDe = (supplierId: string) => prisma.supplyV2SupplierObligation.findMany({ where: { supplierId }, orderBy: { recognizedAt: 'asc' } })
async function pendienteProveedor(supplierId: string) {
  const r = await prisma.supplyV2SupplierObligation.aggregate({ where: { supplierId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } }, _sum: { outstandingAmount: true } })
  return (r._sum.outstandingAmount ?? D(0)).toFixed(2)
}
const eventosDe = (entitlementId: string) => prisma.supplyV2EconomicEvent.findMany({ where: { entitlementId }, orderBy: { createdAt: 'asc' } })

/** Compra pagada de UNA unidad de una oferta: devuelve el derecho. */
async function comprar(offerId: string, customerId: string): Promise<string> {
  const o = await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity: 1 }, como(customerId)))
  const p = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: o.total }, como(ctx.finanzas)))
  return p.entitlements[0]!.id
}
async function redimir(entitlementId: string, customerId: string, empleado: EmpleadoProveedor, branchId: string): Promise<string> {
  const s = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId, branchId }, como(customerId)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: s.nonce, empleado, branchId }, como(empleado.userId)))
  return r.id
}
async function supplyDe(supplierId: string, agreementId: string, itemId: string, cantidad: number, opciones: { paymentMode?: 'PREPAID' | 'PAY_LATER'; expiresAt?: Date } = {}) {
  return sinEmpresa('prueba', async (tx) => {
    const po = await crearOrdenEnTx(tx, { supplierId, agreementId, lines: [{ catalogItemId: itemId, quantity: cantidad, unitCost: 300 }], paymentMode: opciones.paymentMode ?? 'PREPAID' }, como(ctx.compras))
    await enviarAprobacionEnTx(tx, po.id, como(ctx.compras))
    await aprobarOrdenEnTx(tx, po.id, como(ctx.finanzas))
    const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
    const r = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: cantidad, expiresAt: opciones.expiresAt ?? new Date(ahora.getTime() + 60 * DIA) }] }, como(ctx.finanzas))
    return { poId: po.id, lineaId: linea.id, lotId: r.lots[0]!.id, receiptId: r.id }
  })
}
async function oferta(itemId: string, cantidad: number, titulo: string) {
  return sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaEnTx(tx, { catalogItemId: itemId, title: `${titulo} ${sufijo}`, publicPrice: 600, salePrice: 399, quantity: cantidad, perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) }, como(ctx.compras))
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return o.id
  })
}

before(async () => {
  const [compras, finanzas, c1, c2, pedro, dora] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['c1', 'CLIENTE'],
        ['c2', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
        ['dora', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s4-${k}-${sufijo}`, email: `s4-${k}-${sufijo}@prueba.test`, name: k, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = c1.id
  ctx.cliente2 = c2.id
  const empresa = await prisma.company.create({ data: { name: `Little Pizza S4 ${sufijo}`, slug: `little-pizza-s4-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  const empresaD = await prisma.company.create({ data: { name: `Colmado S4 ${sufijo}`, slug: `colmado-s4-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.empresaId = empresa.id
  ctx.empresaDId = empresaD.id
  ctx.sucursal = (await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Bávaro' }, select: { id: true } })).id
  ctx.sucursalD = (await prisma.sucursal.create({ data: { companyId: empresaD.id, nombre: 'Centro' }, select: { id: true } })).id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })
  await prisma.user.update({ where: { id: dora.id }, data: { companyId: empresaD.id } })

  await sinEmpresa('prueba', async (tx) => {
    // Little Pizza: PREPAID (la deuda nace al aprobar la factura; recibir y redimir no crean CxP).
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.pizza.supplierId = p.id
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: 'Pizza Grande', publicPrice: 600 }, como(ctx.compras))
    ctx.pizza.itemId = item.id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 300, payableRecognition: 'ON_INVOICE', paymentTermsDays: 0, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    ctx.pizza.agreementId = a.id

    // Proveedor B (externo): depósitos y PAY_LATER ON_RECEIPT.
    const b = await crearProveedorExternoEnTx(tx, { commercialName: `Proveedor B ${sufijo}` }, como(ctx.compras))
    ctx.b.supplierId = b.id
    const itemB = await crearItemCatalogoEnTx(tx, { supplierId: b.id, type: 'PRODUCT', name: 'Caja de jugos', publicPrice: 500 }, como(ctx.compras))
    ctx.b.itemId = itemB.id
    const ab = await crearAcuerdoEnTx(tx, { supplierId: b.id, type: 'PAY_LATER', catalogItemId: itemB.id, negotiatedUnitCost: 300, payableRecognition: 'ON_RECEIPT', paymentTermsDays: 30, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, ab.id, como(ctx.finanzas))
    ctx.b.agreementId = ab.id

    // Proveedor D (empresa registrada): PAY_LATER ON_REDEMPTION.
    const d = await vincularEmpresaComoProveedorEnTx(tx, empresaD.id, {}, como(ctx.compras))
    ctx.d.supplierId = d.id
    ctx.empleadoD = { userId: dora.id, companyId: empresaD.id, supplierId: d.id }
    const itemD = await crearItemCatalogoEnTx(tx, { supplierId: d.id, type: 'PRODUCT', name: 'Combo colmado', publicPrice: 600 }, como(ctx.compras))
    ctx.d.itemId = itemD.id
    const ad = await crearAcuerdoEnTx(tx, { supplierId: d.id, type: 'PAY_LATER', catalogItemId: itemD.id, negotiatedUnitCost: 300, payableRecognition: 'ON_REDEMPTION', paymentTermsDays: 15, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, ad.id, como(ctx.finanzas))
    ctx.d.agreementId = ad.id
  })
})

// ── E · PREPAID de punta a punta (§63) ───────────────────────────────────────

test('E · PREPAID: PO 1.000 × 300 → factura 300.000 → pago → PAID, PO pagada, sin CxP pendiente', async () => {
  const s = ctx.pizza
  const po = await sinEmpresa('prueba', async (tx) => {
    const po = await crearOrdenEnTx(tx, { supplierId: s.supplierId, agreementId: s.agreementId, lines: [{ catalogItemId: s.itemId, quantity: 1000, unitCost: 300 }], paymentMode: 'PREPAID' }, como(ctx.compras))
    await enviarAprobacionEnTx(tx, po.id, como(ctx.compras))
    await aprobarOrdenEnTx(tx, po.id, como(ctx.finanzas))
    return po
  })
  s.poId = po.id
  const linea = await prisma.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })

  // Factura del proveedor contra la PO (compras la registra, finanzas la aprueba).
  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: s.supplierId, purchaseOrderId: po.id, supplierInvoiceNumber: `LP-${sufijo}-001`, documentDate: ahora, lines: [{ purchaseOrderLineId: linea.id, quantity: 1000, unitCost: 300 }], idempotencyKey: `fac-${sufijo}-1` }, como(ctx.compras)))
  s.invoiceId = f.id
  assert.equal(f.total, '300000.00')
  const repetida = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: s.supplierId, purchaseOrderId: po.id, documentDate: ahora, lines: [{ purchaseOrderLineId: linea.id, quantity: 1000, unitCost: 300 }], idempotencyKey: `fac-${sufijo}-1` }, como(ctx.compras)))
  assert.equal(repetida.id, f.id, 'idempotencia de la factura')
  assert.ok(repetida.repetida)

  // Duplicado por número del proveedor (§10) y sobrefacturación (§9).
  await assert.rejects(sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: s.supplierId, purchaseOrderId: po.id, supplierInvoiceNumber: `LP-${sufijo}-001`, documentDate: ahora, lines: [{ purchaseOrderLineId: linea.id, quantity: 1, unitCost: 300 }] }, como(ctx.compras))), /ya está registrada/)
  await assert.rejects(sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: s.supplierId, purchaseOrderId: po.id, documentDate: ahora, lines: [{ purchaseOrderLineId: linea.id, quantity: 1, unitCost: 300 }] }, como(ctx.compras))), /solo quedan 0 unidades por facturar/)

  // Antes de aprobar no hay deuda ni se puede pagar.
  assert.equal((await obligacionesDe(s.supplierId)).length, 0)
  const ap = await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  assert.equal(ap.obligaciones, 1)
  const ob = await obligacionesDe(s.supplierId)
  assert.equal(ob.length, 1)
  assert.equal(ob[0]!.recognitionBasis, 'INVOICE')
  assert.equal(ob[0]!.grossAmount.toFixed(2), '300000.00')
  assert.equal(ob[0]!.invoiceId, f.id)
  assert.equal(await pendienteProveedor(s.supplierId), '300000.00')
  const ap2 = await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  assert.ok(ap2.repetida, 'aprobar dos veces no crea dos obligaciones')
  assert.equal((await obligacionesDe(s.supplierId)).length, 1)

  // Pago de 300.000 por transferencia: compras lo registra, finanzas lo confirma; al confirmarse se aplica a la factura.
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 300000, reference: `TRX-${sufijo}`, invoiceId: f.id, idempotencyKey: `pago-${sufijo}-1` }, como(ctx.compras)))
  const pRep = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 300000, invoiceId: f.id, idempotencyKey: `pago-${sufijo}-1` }, como(ctx.compras)))
  assert.equal(pRep.id, p.id)
  assert.equal((await factura(f.id)).amountDue.toFixed(2), '300000.00', 'un pago PENDING no cubre nada todavía')
  const c = await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  assert.equal(c.aplicado, '300000.00')
  assert.equal(c.sinAplicar, '0.00')
  const c2 = await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  assert.ok(c2.repetido)
  const ff = await factura(f.id)
  assert.equal(ff.status, 'PAID')
  assert.equal(ff.amountPaid.toFixed(2), '300000.00')
  assert.equal(ff.amountApplied.toFixed(2), '0.00')
  assert.equal(ff.amountDue.toFixed(2), '0.00')
  assert.equal((await obligacionesDe(s.supplierId))[0]!.status, 'PAID')
  assert.equal(await pendienteProveedor(s.supplierId), '0.00')
  assert.equal((await prisma.supplyV2PurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status, 'PAID', 'la PO refleja el pago')
  assert.equal((await prisma.supplyV2PaymentApplication.count({ where: { invoiceId: f.id, type: 'PAYMENT_TO_INVOICE', reversedAt: null } })), 1, 'una sola aplicación, sin duplicados')
})

test('E2 · PREPAID: la recepción no crea deuda; la venta reconoce 399 / 300 / 99 una sola vez; la redención no crea CxP', async () => {
  const s = ctx.pizza
  const linea = await prisma.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: s.poId }, select: { id: true } })
  const r = await sinEmpresa('prueba', (tx) => confirmarRecepcionEnTx(tx, { purchaseOrderId: s.poId, lines: [{ purchaseOrderLineId: linea.id, quantity: 1000, expiresAt: new Date(ahora.getTime() + 60 * DIA) }] }, como(ctx.finanzas)))
  s.lotId = r.lots[0]!.id
  assert.equal((await obligacionesDe(s.supplierId)).length, 1, 'recibir una compra prepagada no crea obligación')
  assert.equal(await pendienteProveedor(s.supplierId), '0.00')

  s.offerId = await oferta(s.itemId, 100, 'Pizza Membego')
  s.derecho = await comprar(s.offerId, ctx.cliente)
  const ev = await eventosDe(s.derecho)
  assert.equal(ev.length, 1)
  assert.equal(ev[0]!.type, 'SALE_REVENUE')
  assert.equal(ev[0]!.revenueAmount.toFixed(2), '399.00')
  assert.equal(ev[0]!.costAmount.toFixed(2), '300.00')
  assert.equal(ev[0]!.grossMarginAmount.toFixed(2), '99.00')
  assert.equal(ev[0]!.gmvAmount.toFixed(2), '399.00')
  const meta = ev[0]!.metadata as Record<string, string>
  assert.equal(meta.publicPrice, '600.00')
  assert.equal(meta.discount, '201.00')
  assert.equal(meta.actualUnitCost, '300.00')
  const otra = await sinEmpresa('prueba', (tx) => reconocerVentaEnTx(tx, s.derecho, como(ctx.finanzas)))
  assert.ok(otra.repetido, 'reconocer la venta otra vez no crea otro evento')
  assert.equal((await eventosDe(s.derecho)).length, 1)

  s.redencion = await redimir(s.derecho, ctx.cliente, ctx.empleado, ctx.sucursal)
  assert.equal((await obligacionesDe(s.supplierId)).length, 1, 'redimir una compra prepagada NO crea CxP')
  assert.equal(await pendienteProveedor(s.supplierId), '0.00')
  assert.equal((await eventosDe(s.derecho)).length, 1, 'redimir no escribe costo: ya se reconoció al vender')
  const econ = await calcularEconomia({ supplierId: s.supplierId, ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA) })
  assert.equal(econ.revenue.toFixed(2), '399.00')
  assert.equal(econ.cost.toFixed(2), '300.00')
  assert.equal(econ.grossMargin.toFixed(2), '99.00')
  assert.equal(econ.unitsSold, 1)
  assert.equal(econ.unitsRedeemed, 1)
  const perfil = await perfilFinancieroProveedor(s.supplierId)
  assert.equal(perfil!.saldoAPagar, '0.00')
  assert.equal(perfil!.pagadoHistorico, '300000.00')
  assert.equal(perfil!.facturasPendientes, 0)
  const l = await lote(s.lotId)
  assert.equal(l.quantityRedeemed, 1)
})

// ── A · Depósito + transferencia (§15, §65) ──────────────────────────────────

test('A · depósito 100k → factura 20k → depósito 15k → transferencia 5k → factura PAID, depósito 85k, pendiente 0', async () => {
  const b = ctx.b
  const anticipo = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 100000, reference: `ANT-${sufijo}`, asDeposit: true }, como(ctx.compras)))
  const conf = await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, anticipo.id, como(ctx.finanzas)))
  assert.ok(conf.depositId)
  b.depositId = conf.depositId!
  let dep = await deposito(b.depositId)
  assert.equal(dep.status, 'ACTIVE')
  assert.equal(dep.availableAmount.toFixed(2), '100000.00')
  assert.equal(dep.movements.length, 1)
  assert.equal(dep.movements[0]!.type, 'DEPOSIT_CREATED')

  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-1`, documentDate: ahora, lines: [{ description: 'Cajas de jugo', quantity: 40, unitCost: 500 }] }, como(ctx.compras)))
  assert.equal(f.total, '20000.00')
  b.invoiceA = f.id
  await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))

  const a1 = await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: f.id, amount: 15000, idempotencyKey: `dep-${sufijo}-a1` }, como(ctx.finanzas)))
  const a1r = await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: f.id, amount: 15000, idempotencyKey: `dep-${sufijo}-a1` }, como(ctx.finanzas)))
  assert.ok(a1r.repetida, 'aplicar el depósito con la misma clave no duplica')
  assert.deepEqual(a1r.applicationIds, a1.applicationIds)
  b.appDeposito = a1.applicationIds[0]!
  let ff = await factura(f.id)
  assert.equal(ff.status, 'PARTIALLY_PAID')
  assert.equal(ff.amountApplied.toFixed(2), '15000.00')
  assert.equal(ff.amountDue.toFixed(2), '5000.00')
  dep = await deposito(b.depositId)
  assert.equal(dep.availableAmount.toFixed(2), '85000.00')

  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 5000, invoiceId: f.id }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  b.appPago = (await prisma.supplyV2PaymentApplication.findFirstOrThrow({ where: { paymentId: p.id, type: 'PAYMENT_TO_INVOICE' }, select: { id: true } })).id
  ff = await factura(f.id)
  assert.equal(ff.status, 'PAID')
  assert.equal(ff.amountPaid.toFixed(2), '5000.00')
  assert.equal(ff.amountApplied.toFixed(2), '15000.00')
  assert.equal(ff.amountDue.toFixed(2), '0.00')
  dep = await deposito(b.depositId)
  assert.equal(dep.availableAmount.toFixed(2), '85000.00', 'la transferencia no toca el depósito')
  assert.equal(saldoDeMovimientos(dep.movements).toFixed(2), dep.availableAmount.toFixed(2), 'los movimientos reconstruyen el saldo')
  assert.equal(dep.movements.length, 2)
  assert.equal(await pendienteProveedor(b.supplierId), '0.00')
  assert.equal((await prisma.supplyV2PaymentApplication.count({ where: { invoiceId: f.id, reversedAt: null, type: { not: 'REVERSAL' } } })), 2, 'dos aplicaciones vivas, ninguna duplicada')
})

test('K · reversas: la aplicación de pago y la de depósito se deshacen (sin borrar) y se pueden volver a aplicar', async () => {
  const b = ctx.b
  await sinEmpresa('prueba', (tx) => reversarAplicacionEnTx(tx, b.appPago, 'Se aplicó a la factura equivocada.', como(ctx.finanzas)))
  let ff = await factura(b.invoiceA)
  assert.equal(ff.status, 'PARTIALLY_PAID')
  assert.equal(ff.amountPaid.toFixed(2), '0.00')
  assert.equal(ff.amountDue.toFixed(2), '5000.00')
  const pagoId = (await prisma.supplyV2PaymentApplication.findUniqueOrThrow({ where: { id: b.appPago } })).paymentId!
  assert.equal((await pago(pagoId)).appliedAmount.toFixed(2), '0.00', 'el pago recupera su saldo sin aplicar')
  await assert.rejects(sinEmpresa('prueba', (tx) => reversarAplicacionEnTx(tx, b.appPago, 'otra vez', como(ctx.finanzas))), /ya fue reversada/)

  await sinEmpresa('prueba', (tx) => reversarAplicacionEnTx(tx, b.appDeposito, 'Error administrativo.', como(ctx.finanzas)))
  ff = await factura(b.invoiceA)
  assert.equal(ff.status, 'APPROVED')
  assert.equal(ff.amountApplied.toFixed(2), '0.00')
  assert.equal(ff.amountDue.toFixed(2), '20000.00')
  let dep = await deposito(b.depositId)
  assert.equal(dep.availableAmount.toFixed(2), '100000.00')
  assert.equal(saldoDeMovimientos(dep.movements).toFixed(2), '100000.00')
  assert.equal(dep.movements.filter((m) => m.type === 'DEPOSIT_RELEASED').length, 1)
  assert.equal((await prisma.supplyV2PaymentApplication.count({ where: { invoiceId: b.invoiceA } })), 4, 'nada se borra: 2 originales + 2 reversas')
  const ob = await prisma.supplyV2SupplierObligation.findFirstOrThrow({ where: { invoiceId: b.invoiceA } })
  assert.equal(ob.status, 'OPEN')
  assert.equal(ob.outstandingAmount.toFixed(2), '20000.00')

  // Se vuelve a aplicar, esta vez con el pago ya confirmado.
  await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: b.invoiceA, amount: 15000 }, como(ctx.finanzas)))
  await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { paymentId: pagoId, invoiceId: b.invoiceA, amount: 5000 }, como(ctx.finanzas)))
  ff = await factura(b.invoiceA)
  assert.equal(ff.status, 'PAID')
  dep = await deposito(b.depositId)
  assert.equal(dep.availableAmount.toFixed(2), '85000.00')
  assert.equal(saldoDeMovimientos(dep.movements).toFixed(2), '85000.00')
})

// ── B · Pago directo no altera el depósito (§16) ─────────────────────────────

test('B · depósito 85k · factura 20k · pago completo 20k → el depósito sigue en 85k', async () => {
  const b = ctx.b
  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-2`, documentDate: ahora, lines: [{ description: 'Cajas de jugo', quantity: 40, unitCost: 500 }] }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 20000, invoiceId: f.id }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  const ff = await factura(f.id)
  assert.equal(ff.status, 'PAID')
  assert.equal(ff.amountApplied.toFixed(2), '0.00')
  const dep = await deposito(b.depositId)
  assert.equal(dep.availableAmount.toFixed(2), '85000.00')
  assert.equal(dep.movements.length, 4, 'ningún movimiento nuevo en el depósito')
})

// ── C · Concurrencia en depósitos (§54) ──────────────────────────────────────

test('C · depósito 10k, dos aplicaciones simultáneas de 8k → una pasa, la otra falla, nunca negativo', async () => {
  const b = ctx.b
  const ant = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 10000, asDeposit: true }, como(ctx.compras)))
  const depId = (await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, ant.id, como(ctx.finanzas)))).depositId!
  const [f1, f2] = await Promise.all([1, 2].map((i) => sinEmpresa('prueba', async (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-C${i}`, documentDate: ahora, lines: [{ description: 'x', quantity: 8, unitCost: 1000 }] }, como(ctx.compras)))))
  for (const f of [f1!, f2!]) await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  const resultados = await Promise.allSettled([f1!, f2!].map((f) => sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: depId, invoiceId: f.id, amount: 8000 }, como(ctx.finanzas)))))
  const ok = resultados.filter((r) => r.status === 'fulfilled')
  const ko = resultados.filter((r) => r.status === 'rejected')
  assert.equal(ok.length, 1, 'solo una aplicación pasa')
  assert.equal(ko.length, 1)
  assert.match(String((ko[0] as PromiseRejectedResult).reason?.message), /solo tiene 2000.00 disponible/)
  const dep = await deposito(depId)
  assert.equal(dep.availableAmount.toFixed(2), '2000.00')
  assert.ok(!dep.availableAmount.isNegative())
  assert.equal(saldoDeMovimientos(dep.movements).toFixed(2), '2000.00')
  // Y aunque el código fallara, la base rechaza un saldo negativo.
  await assert.rejects(prisma.supplyV2SupplierDeposit.update({ where: { id: depId }, data: { availableAmount: -6000 } }), /supply_v2_supplier_deposits_money|check constraint/i)
})

// ── D · Concurrencia en facturas y excedente (§55–§56) ───────────────────────

test('D · factura 10k, dos pagos de 8k a la vez → no se sobrepaga; el excedente se hace depósito explícito', async () => {
  const b = ctx.b
  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-D`, documentDate: ahora, lines: [{ description: 'x', quantity: 10, unitCost: 1000 }] }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  const pagos: string[] = []
  for (let i = 0; i < 2; i++) {
    const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 8000, reference: `D${i}-${sufijo}` }, como(ctx.compras)))
    await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
    pagos.push(p.id)
  }
  const resultados = await Promise.allSettled(pagos.map((paymentId) => sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { paymentId, invoiceId: f.id, amount: 8000 }, como(ctx.finanzas)))))
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
  const ko = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(ko.reason?.message), /No se permite sobrepagar/)
  let ff = await factura(f.id)
  assert.equal(ff.amountPaid.toFixed(2), '8000.00')
  assert.equal(ff.amountDue.toFixed(2), '2000.00')
  assert.equal(ff.status, 'PARTIALLY_PAID')
  await assert.rejects(prisma.supplyV2SupplierInvoice.update({ where: { id: f.id }, data: { amountPaid: 16000, amountDue: -6000 } }), /supply_v2_supplier_invoices_money|check constraint/i)

  // El pago que no entró cubre los 2.000 y su excedente (6.000) se convierte en depósito, a la vista.
  const perdedor = pagos.find((id) => (resultados[pagos.indexOf(id)] as PromiseSettledResult<unknown>).status === 'rejected')!
  await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { paymentId: perdedor, invoiceId: f.id, amount: 2000 }, como(ctx.finanzas)))
  ff = await factura(f.id)
  assert.equal(ff.status, 'PAID')
  const dep = await sinEmpresa('prueba', (tx) => crearDepositoDesdePagoEnTx(tx, { paymentId: perdedor }, como(ctx.finanzas)))
  assert.equal(dep.originalAmount, '6000.00')
  const p = await pago(perdedor)
  assert.equal(p.appliedAmount.toFixed(2), '8000.00')
  const dep2 = await sinEmpresa('prueba', (tx) => crearDepositoDesdePagoEnTx(tx, { paymentId: perdedor }, como(ctx.finanzas)))
  assert.ok(dep2.repetido, 'un pago financia a lo sumo un depósito')
})

// ── F · PAY_LATER ON_RECEIPT (§19, §64) ──────────────────────────────────────

test('F · PAY_LATER ON_RECEIPT: recepción 100 → obligación 30.000; la factura se enlaza sin duplicar; pago 10.000 → 20.000 pendiente', async () => {
  const b = ctx.b
  const antes = await pendienteProveedor(b.supplierId)
  const s = await supplyDe(b.supplierId, b.agreementId, b.itemId, 100, { paymentMode: 'PAY_LATER' })
  const ob = await prisma.supplyV2SupplierObligation.findMany({ where: { purchaseOrderId: s.poId } })
  assert.equal(ob.length, 1)
  assert.equal(ob[0]!.recognitionBasis, 'RECEIPT')
  assert.equal(ob[0]!.sourceType, 'PURCHASE_RECEIPT')
  assert.equal(ob[0]!.grossAmount.toFixed(2), '30000.00')
  assert.equal(ob[0]!.invoiceId, null)
  assert.ok(ob[0]!.dueAt && ob[0]!.dueAt.getTime() > ahora.getTime() + 29 * DIA, 'vence a los 30 días del acuerdo')
  assert.ok(ob[0]!.agreementVersionId)
  assert.equal(D(await pendienteProveedor(b.supplierId)).minus(D(antes)).toFixed(2), '30000.00')

  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, purchaseOrderId: s.poId, supplierInvoiceNumber: `B-${sufijo}-F`, documentDate: ahora, lines: [{ purchaseOrderLineId: s.lineaId, quantity: 100, unitCost: 300 }] }, como(ctx.compras)))
  const ap = await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  assert.equal(ap.obligaciones, 1)
  const ob2 = await prisma.supplyV2SupplierObligation.findMany({ where: { purchaseOrderId: s.poId } })
  assert.equal(ob2.length, 1, 'la factura NO duplica la deuda de la recepción')
  assert.equal(ob2[0]!.invoiceId, f.id, 'la factura se enlaza a la obligación de la recepción')
  assert.equal(D(await pendienteProveedor(b.supplierId)).minus(D(antes)).toFixed(2), '30000.00')

  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 10000, invoiceId: f.id }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  const o = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: ob[0]!.id } })
  assert.equal(o.status, 'PARTIALLY_PAID')
  assert.equal(o.paidAmount.toFixed(2), '10000.00')
  assert.equal(o.outstandingAmount.toFixed(2), '20000.00')
  const ff = await factura(f.id)
  assert.equal(ff.status, 'PARTIALLY_PAID')
  assert.equal(ff.amountDue.toFixed(2), '20000.00')
  assert.equal(D(await pendienteProveedor(b.supplierId)).minus(D(antes)).toFixed(2), '20000.00')
  // Aplicar depósito a esta factura respeta la política (permitido) y el pendiente real.
  await assert.rejects(sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: f.id, amount: 20001 }, como(ctx.finanzas))), /No se permite sobrepagar/)
})

test('F2 · PAY_LATER ON_REDEMPTION: recibir no debe nada; entregar crea la deuda; la reversa la cancela; entregar de nuevo la crea otra vez', async () => {
  const d = ctx.d
  const s = await supplyDe(d.supplierId, d.agreementId, d.itemId, 10, { paymentMode: 'PAY_LATER' })
  assert.equal((await obligacionesDe(d.supplierId)).length, 0, 'ON_REDEMPTION: recibir no crea deuda')
  d.offerId = await oferta(d.itemId, 5, 'Combo colmado Membego')
  d.derecho = await comprar(d.offerId, ctx.cliente2)
  assert.equal((await obligacionesDe(d.supplierId)).length, 0, 'vender tampoco')
  const r1 = await redimir(d.derecho, ctx.cliente2, ctx.empleadoD, ctx.sucursalD)
  let ob = await obligacionesDe(d.supplierId)
  assert.equal(ob.length, 1)
  assert.equal(ob[0]!.recognitionBasis, 'REDEMPTION')
  assert.equal(ob[0]!.redemptionId, r1)
  assert.equal(ob[0]!.grossAmount.toFixed(2), '300.00')
  assert.equal(await pendienteProveedor(d.supplierId), '300.00')
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, r1, 'Marcada por error.', como(ctx.finanzas)))
  ob = await obligacionesDe(d.supplierId)
  assert.equal(ob[0]!.status, 'CANCELLED')
  assert.equal(await pendienteProveedor(d.supplierId), '0.00')
  const r2 = await redimir(d.derecho, ctx.cliente2, ctx.empleadoD, ctx.sucursalD)
  ob = await obligacionesDe(d.supplierId)
  assert.equal(ob.length, 2)
  assert.equal(ob[1]!.redemptionId, r2)
  assert.equal(ob[1]!.status, 'OPEN')
  assert.equal(await pendienteProveedor(d.supplierId), '300.00')
  // Economía: un solo costo pese a redimir, reversar y redimir (§67).
  const ev = await eventosDe(d.derecho)
  assert.equal(ev.filter((e) => e.type === 'SALE_REVENUE').length, 1)
  assert.equal(ev.reduce((t, e) => t.plus(e.costAmount), D(0)).toFixed(2), '300.00')
  await lote(s.lotId)
})

// ── G · Vencimiento del derecho (§27, §66) ───────────────────────────────────

test('G · el derecho vence: EXPIRED, ISSUED → CLOSED, breakage +1, la compra sigue PAID, el ingreso queda, el costo no se duplica', async () => {
  const s = ctx.pizza
  const derecho = await comprar(s.offerId, ctx.cliente2)
  const antes = await lote(s.lotId)
  await prisma.supplyV2Entitlement.update({ where: { id: derecho }, data: { expiresAt: new Date(ahora.getTime() - 60_000) } })
  const n = await sinEmpresa('prueba', (tx) => expirarDerechosEnTx(tx, como(null), new Date()))
  assert.ok(n >= 1)
  const e = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: derecho }, include: { order: true } })
  assert.equal(e.status, 'EXPIRED')
  assert.equal(e.order.status, 'PAID', 'la compra del cliente sigue pagada')
  const despues = await lote(s.lotId)
  assert.equal(despues.quantityIssued, antes.quantityIssued - 1)
  assert.equal(despues.quantityClosed, antes.quantityClosed + 1)
  assert.equal(despues.quantityAvailable, antes.quantityAvailable, 'nunca vuelve a AVAILABLE')
  const asiento = await prisma.supplyV2LedgerEntry.findFirst({ where: { referenceType: 'ENTITLEMENT', referenceId: derecho, type: 'EXPIRATION' } })
  assert.ok(asiento && asiento.sourceBucket === 'ISSUED' && asiento.destinationBucket === 'CLOSED')
  const ev = await eventosDe(derecho)
  assert.deepEqual(ev.map((x) => x.type).sort(), ['BREAKAGE', 'SALE_REVENUE'])
  assert.equal(ev.reduce((t, x) => t.plus(x.revenueAmount), D(0)).toFixed(2), '399.00', 'el ingreso no desaparece')
  assert.equal(ev.reduce((t, x) => t.plus(x.costAmount), D(0)).toFixed(2), '300.00', 'un solo costo')
  const n2 = await sinEmpresa('prueba', (tx) => expirarDerechosEnTx(tx, como(null), new Date()))
  assert.equal((await eventosDe(derecho)).length, 2, `segunda pasada (${n2}) no repite`)
  assert.equal((await prisma.supplyV2LedgerEntry.count({ where: { referenceType: 'ENTITLEMENT', referenceId: derecho } })), 1)
  const econ = await calcularEconomia({ supplierId: s.supplierId, ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA) })
  assert.equal(econ.unitsExpired, 1)
  assert.equal(econ.unitsSold, 2)
  assert.equal(econ.breakageRate, 50)
  assert.equal(econ.cost.toFixed(2), '600.00')
  assert.equal(econ.revenue.toFixed(2), '798.00')
})

// ── H · Reversa económica (§26, §67) ─────────────────────────────────────────

test('H · redimir, reversar, redimir: un solo evento de costo, neto 300', async () => {
  const s = ctx.pizza
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, s.redencion, 'Error en mostrador.', como(ctx.finanzas)))
  const r2 = await redimir(s.derecho, ctx.cliente, ctx.empleado, ctx.sucursal)
  assert.notEqual(r2, s.redencion)
  const ev = await eventosDe(s.derecho)
  assert.equal(ev.length, 1)
  assert.equal(ev[0]!.type, 'SALE_REVENUE')
  assert.equal(ev[0]!.costAmount.toFixed(2), '300.00')
  assert.equal((await obligacionesDe(s.supplierId)).length, 1, 'PREPAID: ni la reversa ni la nueva entrega crean CxP')
  const l = await lote(s.lotId)
  assert.equal(l.quantityRedeemed, 1)
})

// ── I · Conciliación (§43–§46) ───────────────────────────────────────────────

test('I · conciliación: sin estado del proveedor queda OPEN; con monto distinto, DISCREPANCY; resolver exige el monto y notas', async () => {
  const b = ctx.b
  const periodStart = new Date(ahora.getTime() - DIA)
  const periodEnd = new Date(ahora.getTime() + DIA)
  const c = await sinEmpresa('prueba', (tx) => crearConciliacionEnTx(tx, { supplierId: b.supplierId, periodStart, periodEnd }, como(ctx.finanzas)))
  assert.equal(c.status, 'OPEN')
  assert.equal(c.supplierAmount, null)
  assert.ok(c.lineas >= 6, `hay líneas internas (${c.lineas})`)
  const c2 = await sinEmpresa('prueba', (tx) => crearConciliacionEnTx(tx, { supplierId: b.supplierId, periodStart, periodEnd }, como(ctx.finanzas)))
  assert.ok(c2.repetida)
  assert.equal(c2.id, c.id)
  await assert.rejects(sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, c.id, 'ok', como(ctx.finanzas))), /sin el estado de cuenta del proveedor/)
  const interno = D(c.internalAmount)
  const r = await sinEmpresa('prueba', (tx) => registrarMontoDelProveedorEnTx(tx, c.id, interno.plus(1500).toFixed(2), como(ctx.finanzas)))
  assert.equal(r.status, 'DISCREPANCY')
  assert.equal(r.differenceAmount, '-1500.00')
  const r2 = await sinEmpresa('prueba', (tx) => registrarMontoDelProveedorEnTx(tx, c.id, interno.toFixed(2), como(ctx.finanzas)))
  assert.equal(r2.status, 'MATCHED')
  await assert.rejects(sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, c.id, '', como(ctx.finanzas))), /exige explicar/)
  await sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, c.id, 'Cuadrado con el estado de cuenta de septiembre.', como(ctx.finanzas)))
  const fila = await prisma.supplyV2Reconciliation.findUniqueOrThrow({ where: { id: c.id }, include: { lines: true } })
  assert.equal(fila.status, 'RESOLVED')
  assert.ok(fila.lines.every((l) => l.status === 'RESOLVED'))
  const otra = await sinEmpresa('prueba', (tx) => crearConciliacionEnTx(tx, { supplierId: b.supplierId, periodStart: new Date(ahora.getTime() - 10 * DIA), periodEnd: new Date(ahora.getTime() - 9 * DIA) }, como(ctx.finanzas)))
  assert.equal(otra.status, 'OPEN', 'un periodo vacío no se marca MATCHED solo')
  assert.equal(otra.lineas, 0)
})

// ── J · Lote vencido (§49–§50) ───────────────────────────────────────────────

test('J · lote vencido: AVAILABLE y ALLOCATED → CLOSED; RESERVED e ISSUED intactos; costo perdido = unidades × costo', async () => {
  const s = ctx.pizza
  const sup = await supplyDe(s.supplierId, s.agreementId, s.itemId, 10, { expiresAt: new Date(ahora.getTime() + DIA) })
  const offerId = await oferta(s.itemId, 5, 'Pizza corta')
  // Una reserva viva (checkout abierto) y una unidad vendida.
  await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId, quantity: 1 }, como(ctx.cliente)))
  await comprar(offerId, ctx.cliente2)
  let l = await lote(sup.lotId)
  assert.deepEqual([l.quantityAvailable, l.quantityAllocated, l.quantityReserved, l.quantityIssued], [5, 3, 1, 1])
  await prisma.supplyV2Lot.update({ where: { id: sup.lotId }, data: { expiresAt: new Date(ahora.getTime() - 60_000) } })
  const v = await sinEmpresa('prueba', (tx) => expirarLoteEnTx(tx, sup.lotId, como(null), new Date()))
  assert.deepEqual([v!.cerradasDisponibles, v!.cerradasAsignadas], [5, 3])
  l = await lote(sup.lotId)
  assert.deepEqual([l.quantityAvailable, l.quantityAllocated, l.quantityReserved, l.quantityIssued, l.quantityClosed], [0, 0, 1, 1, 8])
  assert.equal(l.status, 'ACTIVE', 'con reserva y derecho vivos el lote no se cierra del todo')
  const linea = await prisma.supplyV2AllocationLine.findFirstOrThrow({ where: { lotId: sup.lotId } })
  assert.equal(linea.releasedQuantity, 3, 'la oferta ya no puede vender lo vencido')
  const ev = await prisma.supplyV2EconomicEvent.findMany({ where: { lotId: sup.lotId, type: 'EXPIRATION_COST' } })
  assert.equal(ev.length, 1)
  assert.equal(ev[0]!.units, 8)
  assert.equal(ev[0]!.costAmount.toFixed(2), '2400.00')
  const otra = await sinEmpresa('prueba', (tx) => expirarLoteEnTx(tx, sup.lotId, como(null), new Date()))
  assert.equal(otra, null, 'segunda pasada: nada que cerrar')
  const r = await barridoSupplyV2(new Date())
  assert.equal(typeof r.lotesVencidos, 'number')
  const econ = await calcularEconomia({ supplierId: s.supplierId, ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA) })
  assert.equal(econ.expiredSupplyUnits, 8)
  assert.equal(econ.expiredSupplyCost.toFixed(2), '2400.00')
  const resumen = await resumenFinanzas()
  assert.ok(D(resumen.supplyVencidoCosto).greaterThanOrEqualTo(2400))
})

// ── L · Cancelar factura (§58) ───────────────────────────────────────────────

test('L · una factura con aplicaciones vivas no se cancela; sin ellas, se cancela con su obligación', async () => {
  const b = ctx.b
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarFacturaEnTx(tx, b.invoiceA, 'no', como(ctx.finanzas))), /aplicación\(es\) viva\(s\)/)
  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-L`, documentDate: ahora, lines: [{ description: 'x', quantity: 1, unitCost: 100 }] }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarFacturaEnTx(tx, f.id, como(ctx.finanzas)))
  const antes = await pendienteProveedor(b.supplierId)
  await sinEmpresa('prueba', (tx) => cancelarFacturaEnTx(tx, f.id, 'Duplicada en papel.', como(ctx.finanzas)))
  const ff = await factura(f.id)
  assert.equal(ff.status, 'CANCELLED')
  assert.equal((await prisma.supplyV2SupplierObligation.findFirstOrThrow({ where: { invoiceId: f.id } })).status, 'CANCELLED')
  assert.equal(D(antes).minus(D(await pendienteProveedor(b.supplierId))).toFixed(2), '100.00')
  // El número del proveedor queda libre para registrarla bien.
  const f2 = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, supplierInvoiceNumber: `B-${sufijo}-L`, documentDate: ahora, lines: [{ description: 'x', quantity: 1, unitCost: 100 }] }, como(ctx.compras)))
  assert.notEqual(f2.id, f.id)
  // Un pago sin aplicaciones se cancela; uno aplicado, no.
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'CASH', amount: 50 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => cancelarPagoProveedorEnTx(tx, p.id, 'Registrado por error.', como(ctx.finanzas)))
  assert.equal((await pago(p.id)).status, 'CANCELLED')
})

// ── M · Segregación y auditoría (§41, §59) ───────────────────────────────────

test('M · el pago sin confirmar no se aplica; la factura sin aprobar tampoco; la bitácora tiene las acciones', async () => {
  const b = ctx.b
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: b.supplierId, method: 'BANK_TRANSFER', amount: 10 }, como(ctx.compras)))
  await assert.rejects(sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { paymentId: p.id, invoiceId: b.invoiceA, amount: 10 }, como(ctx.finanzas))), /todavía no está confirmado/)
  const f = await sinEmpresa('prueba', (tx) => crearFacturaEnTx(tx, { supplierId: b.supplierId, documentDate: ahora, lines: [{ description: 'x', quantity: 1, unitCost: 10 }] }, como(ctx.compras)))
  await assert.rejects(sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: f.id, amount: 10 }, como(ctx.finanzas))), /solo se paga una factura aprobada/)
  // Dinero y deuda de proveedores distintos no se cruzan.
  await assert.rejects(sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { depositId: b.depositId, invoiceId: ctx.pizza.invoiceId, amount: 1 }, como(ctx.finanzas))), /proveedores distintos|solo se paga/)

  const acciones = ['SUPPLY_V2_INVOICE_CREATED', 'SUPPLY_V2_INVOICE_APPROVED', 'SUPPLY_V2_INVOICE_CANCELLED', 'SUPPLY_V2_DEPOSIT_CREATED', 'SUPPLY_V2_DEPOSIT_APPLIED', 'SUPPLY_V2_DEPOSIT_REVERSED', 'SUPPLY_V2_PAYMENT_CREATED', 'SUPPLY_V2_PAYMENT_CONFIRMED', 'SUPPLY_V2_PAYMENT_APPLIED', 'SUPPLY_V2_PAYMENT_REVERSED', 'SUPPLY_V2_PAYMENT_CANCELLED', 'SUPPLY_V2_OBLIGATION_RECOGNIZED', 'SUPPLY_V2_OBLIGATION_PAID', 'SUPPLY_V2_OBLIGATION_CANCELLED', 'SUPPLY_V2_ECONOMIC_EVENT_CREATED', 'SUPPLY_V2_RECONCILIATION_CREATED', 'SUPPLY_V2_RECONCILIATION_RESOLVED', 'SUPPLY_V2_ENTITLEMENT_EXPIRED', 'SUPPLY_V2_LOT_EXPIRED'] as const
  const desde = new Date(ahora.getTime() - 60_000)
  for (const a of acciones) {
    const n = await prisma.auditLog.count({ where: { accion: a, createdAt: { gte: desde } } })
    assert.ok(n > 0, `bitácora sin ${a}`)
  }
})

test('Z · el ledger de cada lote de la prueba cuadra al final', async () => {
  const lotes = await prisma.supplyV2Lot.findMany({ where: { supplierId: { in: [ctx.pizza.supplierId, ctx.b.supplierId, ctx.d.supplierId] } }, select: { id: true } })
  for (const l of lotes) await lote(l.id)
})
