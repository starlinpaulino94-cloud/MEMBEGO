import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx, resolverAcuerdoComisionDeItemEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { cerrarOfertaEnTx, crearOfertaComisionEnTx, crearOfertaEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, cancelarOrdenClienteEnTx, confirmarPagoEnTx, expirarOrdenEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, expirarDerechoEnTx, reversarRedencionEnTx, type EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'
import { confirmarPagoProveedorEnTx, crearPagoEnTx } from '../../src/modules/supply-v2/finance/payments'
import { aplicarEnTx, reversarAplicacionEnTx } from '../../src/modules/supply-v2/finance/applications'
import { reconocerObligacionPorRedencionEnTx } from '../../src/modules/supply-v2/finance/obligations'
import { aprobarLiquidacionEnTx, cancelarLiquidacionEnTx, generarLiquidacionEnTx, obligacionesLiquidablesEnTx } from '../../src/modules/supply-v2/finance/settlements'
import { resolverIncidenciaFinancieraEnTx } from '../../src/modules/supply-v2/finance/incidents'
import { crearConciliacionComisionEnTx, registrarCifrasDelProveedorEnTx, resolverConciliacionEnTx } from '../../src/modules/supply-v2/finance/reconciliation'
import { reconocerVentaEnTx } from '../../src/modules/supply-v2/economics/service'
import { calcularEconomia } from '../../src/modules/supply-v2/economics/queries'
import { ofertaPublicaPorSlug } from '../../src/modules/supply-v2/marketplace/read-model'
import { barridoSupplyV2 } from '../../src/modules/supply-v2/commerce/barrido'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 contra PostgreSQL de verdad (§83).
 *
 *   A  Comisión de punta a punta: acuerdo 10 % → oferta sin lote → compra 1 000 →
 *      derecho sin lote (100 / 900) → entrega → obligación 900 → liquidación →
 *      aprobación (otra persona) → pago → PAID. Ni PO, ni lote, ni asiento.
 *   B  Precedencia ITEM > CATEGORY > CATALOG y validación del acuerdo a comisión
 *   C  Capacidad: la última unidad bajo concurrencia; cancelar / expirar libera; SOLD_OUT
 *   D  Límite por cliente bajo concurrencia; sin tope (UNLIMITED)
 *   E  Doble confirmación de pago → un solo juego de derechos y un solo evento
 *   F  Doble redención → una sola entrega, una sola obligación (también llamando dos veces al reconocimiento)
 *   G  Dos liquidaciones a la vez sobre las mismas obligaciones → una sola las toma; el prepago nunca entra
 *   H  Dos pagos sobre el mismo saldo → nunca se sobrepaga; reversa de aplicación
 *   I  Reversa de entrega: sin pagar cancela la obligación (y sale de la liquidación); pagada abre incidencia
 *   J  Redondeo (33.33 %), conciliación de comisión, economía separada, DTO público sin comisión, vencimiento sin lote
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
  cliente3: '',
  empresaId: '',
  sucursal: '',
  empleado: null as unknown as EmpleadoProveedor,
  tours: { supplierId: '', itemId: '', itemCat: '', itemOtro: '', agItem: '', agCat: '', agCatalog: '', offerId: '', derecho: '', orderId: '', redencion: '', obligacion: '', settlementId: '' },
  pizza: { supplierId: '', itemId: '', agreementId: '', lotId: '', offerId: '' },
}

async function crearYPublicarComision(itemId: string, d: { availabilityMode: 'UNLIMITED' | 'FIXED_QUANTITY' | 'CAPACITY'; availabilityQuantity?: number; perCustomerLimit?: number; salePrice?: number; publicPrice?: number; titulo?: string; endsAt?: Date | null }) {
  return sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaComisionEnTx(tx, { catalogItemId: itemId, title: `${d.titulo ?? 'Excursión'} ${sufijo}`, publicPrice: d.publicPrice ?? 1200, salePrice: d.salePrice ?? 1000, availabilityMode: d.availabilityMode, availabilityQuantity: d.availabilityQuantity ?? null, perCustomerLimit: d.perCustomerLimit ?? 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: d.endsAt === undefined ? new Date(ahora.getTime() + 30 * DIA) : d.endsAt }, como(ctx.compras))
    const p = await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return { ...o, status: p.status }
  })
}
async function comprar(offerId: string, customerId: string, quantity = 1, confirmador = ctx.finanzas) {
  const o = await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity }, como(customerId)))
  const p = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: o.total }, como(confirmador)))
  return { orderId: o.id, entitlements: p.entitlements.map((e) => e.id), total: o.total }
}
async function redimir(entitlementId: string, customerId: string): Promise<string> {
  const s = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId, branchId: ctx.sucursal }, como(customerId)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: s.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId)))
  return r.id
}
const obligacionDe = (redemptionId: string) => prisma.supplyV2SupplierObligation.findUnique({ where: { redemptionId } })
const periodo = { periodStart: new Date(ahora.getTime() - 7 * DIA), periodEnd: new Date(ahora.getTime() + 7 * DIA) }

async function sinInventario(offerId: string) {
  const o = await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: offerId }, select: { sourceType: true, allocationId: true, agreementId: true, agreementVersionId: true, commissionPercentage: true } })
  assert.equal(o.sourceType, 'COMMISSION')
  assert.equal(o.allocationId, null, 'una oferta a comisión no tiene asignación')
  assert.ok(o.agreementId && o.agreementVersionId && o.commissionPercentage, 'acuerdo, versión y porcentaje congelados')
  const derechos = await prisma.supplyV2Entitlement.findMany({ where: { offerId }, select: { id: true, lotId: true, allocationId: true, sourceType: true } })
  for (const d of derechos) {
    assert.equal(d.lotId, null, `derecho ${d.id} sin lote`)
    assert.equal(d.allocationId, null)
    assert.equal(d.sourceType, 'COMMISSION')
  }
  const ids = derechos.map((d) => d.id)
  const red = await prisma.supplyV2Redemption.findMany({ where: { entitlementId: { in: ids } }, select: { id: true, lotId: true } })
  assert.ok(red.every((r) => r.lotId === null), 'redenciones sin lote')
  const asientos = await prisma.supplyV2LedgerEntry.count({ where: { OR: [{ referenceType: 'ENTITLEMENT', referenceId: { in: ids } }, { referenceType: 'REDEMPTION', referenceId: { in: red.map((r) => r.id) } }] } })
  assert.equal(asientos, 0, 'ningún asiento del ledger por una venta a comisión')
  const po = await prisma.supplyV2PurchaseOrder.count({ where: { lines: { some: { catalogItem: { offers: { some: { id: offerId } } } } } } })
  return { derechos: ids, po }
}

before(async () => {
  const [compras, finanzas, c1, c2, c3, pedro] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['c1', 'CLIENTE'],
        ['c2', 'CLIENTE'],
        ['c3', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s5-${k}-${sufijo}`, email: `s5-${k}-${sufijo}@prueba.test`, name: k, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = c1.id
  ctx.cliente2 = c2.id
  ctx.cliente3 = c3.id
  const empresa = await prisma.company.create({ data: { name: `Tours Caribe S5 ${sufijo}`, slug: `tours-caribe-s5-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.empresaId = empresa.id
  ctx.sucursal = (await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Punta Cana' }, select: { id: true } })).id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.tours.supplierId = p.id
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    ctx.tours.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: 'Excursión Isla Saona', category: 'Tours', publicPrice: 1200 }, como(ctx.compras))).id
    ctx.tours.itemCat = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: 'Excursión Hoyo Azul', category: 'tours', publicPrice: 900 }, como(ctx.compras))).id
    ctx.tours.itemOtro = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: 'Gorra', category: 'Merch', publicPrice: 300 }, como(ctx.compras))).id

    // Proveedor prepago (Slice 1–4) para demostrar que su mundo no cambia.
    const b = await crearProveedorExternoEnTx(tx, { commercialName: `Little Pizza S5 ${sufijo}` }, como(ctx.compras))
    ctx.pizza.supplierId = b.id
    ctx.pizza.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: b.id, type: 'PRODUCT', name: 'Pizza', publicPrice: 600 }, como(ctx.compras))).id
    const ab = await crearAcuerdoEnTx(tx, { supplierId: b.id, type: 'PREPAID_PURCHASE', catalogItemId: ctx.pizza.itemId, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, ab.id, como(ctx.finanzas))
    ctx.pizza.agreementId = ab.id
  })
})

// ── B · acuerdos a comisión: validación y precedencia ────────────────────────

test('B · un acuerdo a comisión exige porcentaje, no lleva costo y su deuda nace al entregar', async () => {
  const s = ctx.tours
  await assert.rejects(sinEmpresa('prueba', (tx) => crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATALOG', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))), /porcentaje/)
  await assert.rejects(sinEmpresa('prueba', (tx) => crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 101, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))), /entre 0 y 100/)
  await assert.rejects(sinEmpresa('prueba', (tx) => crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 5, payableRecognition: 'ON_INVOICE', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))), /ON_REDEMPTION/)
  await assert.rejects(sinEmpresa('prueba', (tx) => crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 5, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))), /no tiene costo negociado/)

  // Sin acuerdo no hay oferta a comisión.
  await assert.rejects(sinEmpresa('prueba', (tx) => crearOfertaComisionEnTx(tx, { catalogItemId: s.itemId, title: 'x', publicPrice: 1200, salePrice: 1000, availabilityMode: 'UNLIMITED', startsAt: ahora }, como(ctx.compras))), /no tiene un acuerdo a comisión vigente/)

  await sinEmpresa('prueba', async (tx) => {
    const cat = await crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 5, paymentTermsDays: 7, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, cat.id, como(ctx.finanzas))
    s.agCatalog = cat.id
    const c = await crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'CATEGORY', category: 'Tours', commissionPercentage: 8, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, c.id, como(ctx.finanzas))
    s.agCat = c.id
    const i = await crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'ITEM', catalogItemId: s.itemId, commissionPercentage: 10, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, i.id, como(ctx.finanzas))
    s.agItem = i.id
  })
  const a = await prisma.supplyV2Agreement.findUniqueOrThrow({ where: { id: s.agItem }, select: { payableRecognition: true, versions: { select: { snapshot: true } } } })
  assert.equal(a.payableRecognition, 'ON_REDEMPTION')
  assert.equal((a.versions[0]!.snapshot as { payableRecognition: string }).payableRecognition, 'ON_REDEMPTION', 'la política viaja en la foto de la versión')
})

test('B · precedencia ITEM > CATEGORY > CATALOG, resuelta en el servidor', async () => {
  const s = ctx.tours
  const [porItem, porCategoria, porCatalogo] = await sinEmpresa('prueba', (tx) => Promise.all([resolverAcuerdoComisionDeItemEnTx(tx, s.itemId), resolverAcuerdoComisionDeItemEnTx(tx, s.itemCat), resolverAcuerdoComisionDeItemEnTx(tx, s.itemOtro)]))
  assert.deepEqual([porItem?.agreementId, porItem?.scope, porItem?.commissionPercentage.toFixed(2)], [s.agItem, 'ITEM', '10.00'])
  assert.deepEqual([porCategoria?.agreementId, porCategoria?.scope, porCategoria?.commissionPercentage.toFixed(2)], [s.agCat, 'CATEGORY', '8.00'], 'la categoría se compara sin distinguir mayúsculas')
  assert.deepEqual([porCatalogo?.agreementId, porCatalogo?.scope, porCatalogo?.commissionPercentage.toFixed(2)], [s.agCatalog, 'CATALOG', '5.00'])
})

// ── A · comisión de punta a punta ────────────────────────────────────────────

test('A · oferta a comisión: sin PO, sin lote, sin asignación; el acuerdo queda congelado', async () => {
  const s = ctx.tours
  const o = await crearYPublicarComision(s.itemId, { availabilityMode: 'FIXED_QUANTITY', availabilityQuantity: 100, titulo: 'Saona' })
  s.offerId = o.id
  assert.equal(o.status, 'ACTIVE')
  assert.deepEqual([o.commissionPercentage, o.commissionScope], ['10.00', 'ITEM'])
  const { po } = await sinInventario(o.id)
  assert.equal(po, 0, 'ninguna orden de compra')
  assert.equal(await prisma.supplyV2Lot.count({ where: { catalogItemId: s.itemId } }), 0, 'ningún lote del producto')
  assert.equal(await prisma.supplyV2Allocation.count({ where: { catalogItemId: s.itemId } }), 0, 'ninguna asignación')

  // El DTO público no expone comisión, neto ni acuerdo.
  const pub = await ofertaPublicaPorSlug(o.slug)
  assert.ok(pub && pub.available)
  assert.equal(pub.remaining, 100)
  assert.equal(pub.unlimited, false)
  const claves = Object.keys(pub).join(',')
  assert.doesNotMatch(claves, /commission|supplierNet|agreement|cost/i, 'el DTO público no lleva comisión, neto, acuerdo ni costo')
})

test('A · cliente paga 1 000 → derecho sin lote con comisión 100 y neto 900; GMV 1 000, ingreso 100, costo 0; sin deuda todavía', async () => {
  const s = ctx.tours
  const compra = await comprar(s.offerId, ctx.cliente)
  s.orderId = compra.orderId
  s.derecho = compra.entitlements[0]!
  assert.equal(compra.total, '1000.00')
  const orden = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.orderId }, include: { lines: true, commissionReservations: true } })
  assert.deepEqual([orden.sourceType, orden.agreementId, orden.commissionPercentage?.toFixed(2), orden.commissionAmount.toFixed(2), orden.supplierNet.toFixed(2)], ['COMMISSION', s.agItem, '10.00', '100.00', '900.00'])
  assert.deepEqual([orden.lines[0]!.commissionAmount.toFixed(2), orden.lines[0]!.supplierNet.toFixed(2)], ['100.00', '900.00'])
  assert.deepEqual(orden.commissionReservations.map((r) => r.status), ['CONSUMED'], 'la reserva comercial se consume al pagar')
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: s.derecho } })
  assert.deepEqual([d.sourceType, d.lotId, d.allocationId, d.actualUnitCost.toFixed(2), d.customerUnitPrice.toFixed(2), d.commissionAmount?.toFixed(2), d.supplierNet?.toFixed(2), d.agreementVersionId != null], ['COMMISSION', null, null, '0.00', '1000.00', '100.00', '900.00', true])
  const ev = await prisma.supplyV2EconomicEvent.findMany({ where: { entitlementId: s.derecho } })
  assert.equal(ev.length, 1)
  assert.deepEqual([ev[0]!.type, ev[0]!.gmvAmount.toFixed(2), ev[0]!.revenueAmount.toFixed(2), ev[0]!.costAmount.toFixed(2), ev[0]!.grossMarginAmount.toFixed(2), ev[0]!.lotId], ['COMMISSION_REVENUE', '1000.00', '100.00', '0.00', '100.00', null])
  assert.equal((ev[0]!.metadata as { supplierNet: string }).supplierNet, '900.00')
  assert.equal(await prisma.supplyV2SupplierObligation.count({ where: { supplierId: s.supplierId } }), 0, 'pagar NO crea deuda con el proveedor: todavía no entregó')
  await sinInventario(s.offerId)
  const pub = await ofertaPublicaPorSlug((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: s.offerId } })).slug)
  assert.equal(pub?.remaining, 99)
})

test('A · la entrega es el cumplimiento: nace la obligación por el NETO (900), idempotente, sin asiento', async () => {
  const s = ctx.tours
  s.redencion = await redimir(s.derecho, ctx.cliente)
  const r = await prisma.supplyV2Redemption.findUniqueOrThrow({ where: { id: s.redencion } })
  assert.deepEqual([r.sourceType, r.lotId, r.commissionPercentageSnapshot?.toFixed(2), r.commissionAmountSnapshot?.toFixed(2), r.supplierNetSnapshot?.toFixed(2)], ['COMMISSION', null, '10.00', '100.00', '900.00'])
  const o = await obligacionDe(s.redencion)
  assert.ok(o)
  s.obligacion = o.id
  assert.deepEqual([o.sourceType, o.recognitionBasis, o.grossAmount.toFixed(2), o.outstandingAmount.toFixed(2), o.status, o.agreementId], ['REDEMPTION', 'REDEMPTION', '900.00', '900.00', 'OPEN', s.agItem])
  assert.match(o.number, /^MBG-OB-\d{4}-\d{6}$/)
  // Reconocer otra vez no duplica (F2 del §76).
  const otra = await sinEmpresa('prueba', (tx) => reconocerObligacionPorRedencionEnTx(tx, s.redencion, como(ctx.finanzas)))
  assert.ok(otra?.repetida)
  assert.equal(await prisma.supplyV2SupplierObligation.count({ where: { redemptionId: s.redencion } }), 1)
  await sinInventario(s.offerId)
  // La redención NO toca la economía (ingreso ya reconocido al vender; sin costo).
  assert.equal(await prisma.supplyV2EconomicEvent.count({ where: { entitlementId: s.derecho } }), 1)
  const bit = await prisma.auditLog.findMany({ where: { entidadId: o.id, accion: 'SUPPLY_V2_COMMISSION_OBLIGATION_CREATED' } })
  assert.equal(bit.length, 1)
})

test('A · liquidación: agrupa el neto pendiente, la aprueba OTRA persona, se paga con el motor del Slice 4 y queda PAID', async () => {
  const s = ctx.tours
  const pendientes = await sinEmpresa('prueba', (tx) => obligacionesLiquidablesEnTx(tx, s.supplierId, periodo.periodStart, periodo.periodEnd, 'DOP'))
  assert.deepEqual(pendientes.map((p) => p.id), [s.obligacion])
  const l = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo, idempotencyKey: `liq-${sufijo}-A` }, como(ctx.compras)))
  s.settlementId = l.id
  assert.match(l.number, /^MBG-ST-\d{4}-\d{6}$/)
  assert.deepEqual([l.status, l.lineas, l.grossSales, l.commissionAmount, l.supplierNet], ['PENDING_APPROVAL', 1, '1000.00', '100.00', '900.00'])
  const rep = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo, idempotencyKey: `liq-${sufijo}-A` }, como(ctx.compras)))
  assert.ok(rep.repetida && rep.id === l.id, 'idempotencia de la liquidación')
  await assert.rejects(sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras))), /No hay entregas a comisión pendientes/, 'la obligación ya está en una liquidación viva')
  assert.equal((await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: s.obligacion } })).settlementId, l.id)

  // Nadie paga una liquidación sin aprobar; quien la generó no la aprueba.
  await assert.rejects(sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 900, settlementId: l.id }, como(ctx.compras))), /solo se paga una liquidación aprobada/)
  await assert.rejects(sinEmpresa('prueba', (tx) => aprobarLiquidacionEnTx(tx, l.id, como(ctx.compras))), /misma persona que la generó/)
  const ap = await sinEmpresa('prueba', (tx) => aprobarLiquidacionEnTx(tx, l.id, como(ctx.finanzas)))
  assert.equal(ap.status, 'APPROVED')
  assert.ok((await sinEmpresa('prueba', (tx) => aprobarLiquidacionEnTx(tx, l.id, como(ctx.finanzas)))).repetida)

  // Sobrepago prohibido; pago exacto: registra uno, confirma otro.
  await assert.rejects(sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 901, settlementId: l.id }, como(ctx.compras))), /No se permite sobrepagar/)
  const p = await sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 900, settlementId: l.id, reference: `TRX-${sufijo}-A`, idempotencyKey: `pago-${sufijo}-A` }, como(ctx.compras)))
  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.compras))), /misma persona que lo registró/)
  const c = await sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p.id, como(ctx.finanzas)))
  assert.deepEqual([c.aplicado, c.sinAplicar], ['900.00', '0.00'])
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id } })
  assert.deepEqual([liq.status, liq.paidAmount.toFixed(2), liq.paidAt != null], ['PAID', '900.00', true])
  const ob = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: s.obligacion } })
  assert.deepEqual([ob.status, ob.paidAmount.toFixed(2), ob.outstandingAmount.toFixed(2)], ['PAID', '900.00', '0.00'], 'la obligación refleja el pago')
  const apps = await prisma.supplyV2PaymentApplication.findMany({ where: { paymentId: p.id } })
  assert.deepEqual(apps.map((a) => [a.type, a.obligationId, a.amount.toFixed(2)]), [['PAYMENT_TO_OBLIGATION', s.obligacion, '900.00']])
  // Con todo pagado, no se puede cancelar.
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarLiquidacionEnTx(tx, l.id, 'error', como(ctx.finanzas))), /ya tiene dinero aplicado/)
  const acciones = (await prisma.auditLog.findMany({ where: { entidadId: l.id }, select: { accion: true } })).map((a) => a.accion).sort()
  assert.deepEqual(acciones, ['SUPPLY_V2_SETTLEMENT_APPROVED', 'SUPPLY_V2_SETTLEMENT_CREATED', 'SUPPLY_V2_SETTLEMENT_PAID', 'SUPPLY_V2_SETTLEMENT_PAYMENT_APPLIED'])
  await sinInventario(s.offerId)
})

// ── C · capacidad ─────────────────────────────────────────────────────────────

test('C · la última unidad bajo concurrencia: solo una compra pasa; cancelar y expirar la devuelven; SOLD_OUT se deriva', async () => {
  const s = ctx.tours
  const o = await crearYPublicarComision(s.itemCat, { availabilityMode: 'CAPACITY', availabilityQuantity: 1, perCustomerLimit: 1, titulo: 'Hoyo Azul' })
  assert.equal(o.commissionPercentage, '8.00')
  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: o.id, quantity: 1 }, como(ctx.cliente))),
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente2, offerId: o.id, quantity: 1 }, como(ctx.cliente2))),
  ])
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>[]
  const ko = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1)
  assert.equal(ko.length, 1)
  assert.match(String(ko[0]!.reason?.message), /queda|agotó/)
  assert.equal(await prisma.supplyV2CommissionReservation.count({ where: { offerId: o.id, status: 'ACTIVE' } }), 1)
  const pub1 = await ofertaPublicaPorSlug(o.slug)
  assert.equal(pub1?.remaining, 0)

  // La orden viva se cancela: la capacidad vuelve.
  const viva = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: ok[0]!.value.id } })
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, viva.id, viva.customerId, como(viva.customerId)))
  assert.deepEqual((await prisma.supplyV2CommissionReservation.findMany({ where: { orderId: viva.id } })).map((r) => r.status), ['RELEASED'])
  assert.equal((await ofertaPublicaPorSlug(o.slug))?.remaining, 1)

  // Compra, expira sin pagar: EXPIRED y vuelve a haber cupo.
  const otra = await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente3, offerId: o.id, quantity: 1 }, como(ctx.cliente3)))
  await prisma.supplyV2CustomerOrder.update({ where: { id: otra.id }, data: { expiresAt: new Date(ahora.getTime() - 1000) } })
  assert.ok(await sinEmpresa('prueba', (tx) => expirarOrdenEnTx(tx, otra.id, como(null))))
  assert.deepEqual((await prisma.supplyV2CommissionReservation.findMany({ where: { orderId: otra.id } })).map((r) => r.status), ['EXPIRED'])
  assert.equal((await ofertaPublicaPorSlug(o.slug))?.remaining, 1)

  // Pagada: CONSUMED y la oferta queda SOLD_OUT (derivado); nadie más compra.
  await comprar(o.id, ctx.cliente2)
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: o.id } })).status, 'SOLD_OUT')
  await assert.rejects(sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente3, offerId: o.id, quantity: 1 }, como(ctx.cliente3))), /agotó/)
  await sinInventario(o.id)
})

test('D · límite por cliente bajo concurrencia y oferta SIN tope', async () => {
  const s = ctx.tours
  const o = await crearYPublicarComision(s.itemOtro, { availabilityMode: 'UNLIMITED', perCustomerLimit: 1, salePrice: 250, publicPrice: 300, titulo: 'Gorra' })
  assert.equal(o.commissionPercentage, '5.00', 'cae al acuerdo de catálogo')
  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: o.id, quantity: 1 }, como(ctx.cliente))),
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: o.id, quantity: 1 }, como(ctx.cliente))),
  ])
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason?.message), /máximo de 1 por persona/)
  // Sin tope: otros clientes compran sin límite global y el DTO lo dice.
  for (const c of [ctx.cliente2, ctx.cliente3]) await comprar(o.id, c)
  const pub = await ofertaPublicaPorSlug(o.slug)
  assert.deepEqual([pub?.available, pub?.unlimited], [true, true])
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: o.id } })).status, 'ACTIVE')
  const d = await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { offerId: o.id, customerId: ctx.cliente2 } })
  assert.deepEqual([d.commissionAmount?.toFixed(2), d.supplierNet?.toFixed(2)], ['12.50', '237.50'])
})

// ── E · F · idempotencias ─────────────────────────────────────────────────────

test('E · dos confirmaciones del mismo pago → un solo juego de derechos y un solo evento económico', async () => {
  const s = ctx.tours
  const orden = await sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente2, offerId: s.offerId, quantity: 2 }, como(ctx.cliente2)))
  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: orden.total }, como(ctx.finanzas))),
    sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: orden.total }, como(ctx.finanzas))),
  ])
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 2, 'ambas devuelven; una es repetida')
  assert.equal(await prisma.supplyV2Entitlement.count({ where: { orderId: orden.id } }), 2)
  assert.equal(await prisma.supplyV2EconomicEvent.count({ where: { customerOrderId: orden.id, type: 'COMMISSION_REVENUE' } }), 2)
  const o = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id } })
  assert.deepEqual([o.total.toFixed(2), o.commissionAmount.toFixed(2), o.supplierNet.toFixed(2)], ['2000.00', '200.00', '1800.00'])
  const derechos = await prisma.supplyV2Entitlement.findMany({ where: { orderId: orden.id } })
  assert.equal(derechos.reduce((t, d) => t.plus(d.supplierNet ?? 0), D(0)).toFixed(2), '1800.00', 'el reparto por unidad suma el de la línea')
  // Reconocer la venta otra vez tampoco duplica.
  assert.ok((await sinEmpresa('prueba', (tx) => reconocerVentaEnTx(tx, derechos[0]!.id, como(ctx.finanzas)))).repetido)
})

test('F · dos redenciones del mismo derecho → una entrega y una obligación', async () => {
  const s = ctx.tours
  const derecho = (await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { offerId: s.offerId, customerId: ctx.cliente2, status: 'ACTIVE' } })).id
  const ses = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId: derecho, customerId: ctx.cliente2, branchId: ctx.sucursal }, como(ctx.cliente2)))
  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: ses.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId))),
    sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: ses.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId))),
  ])
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason?.message), /ya se usó|ya fue utilizado/)
  assert.equal(await prisma.supplyV2Redemption.count({ where: { entitlementId: derecho, reversedAt: null } }), 1)
  assert.equal(await prisma.supplyV2SupplierObligation.count({ where: { redemption: { entitlementId: derecho } } }), 1)
})

// ── G · H · liquidaciones y pagos bajo concurrencia ──────────────────────────

test('G · dos liquidaciones a la vez: una sola toma las obligaciones; las de prepago NUNCA entran', async () => {
  const s = ctx.tours
  // Un derecho más entregado (del E) para tener 2 obligaciones vivas de 900.
  const otro = (await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { offerId: s.offerId, customerId: ctx.cliente2, status: 'ACTIVE' } })).id
  await redimir(otro, ctx.cliente2)
  const vivas = await prisma.supplyV2SupplierObligation.findMany({ where: { supplierId: s.supplierId, status: 'OPEN', settlementId: null } })
  assert.equal(vivas.length, 2)

  // Prepago (Slice 1–4): deuda ON_REDEMPTION de un lote real NO es liquidable.
  const pizza = ctx.pizza
  await sinEmpresa('prueba', async (tx) => {
    const po = await crearOrdenEnTx(tx, { supplierId: pizza.supplierId, agreementId: pizza.agreementId, lines: [{ catalogItemId: pizza.itemId, quantity: 10, unitCost: 300 }], paymentMode: 'PREPAID' }, como(ctx.compras))
    await enviarAprobacionEnTx(tx, po.id, como(ctx.compras))
    await aprobarOrdenEnTx(tx, po.id, como(ctx.finanzas))
    const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
    const r = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: 10, expiresAt: new Date(ahora.getTime() + 60 * DIA) }] }, como(ctx.finanzas))
    pizza.lotId = r.lots[0]!.id
    const o = await crearOfertaEnTx(tx, { catalogItemId: pizza.itemId, title: `Pizza ${sufijo}`, publicPrice: 600, salePrice: 399, quantity: 5, perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000) }, como(ctx.compras))
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    pizza.offerId = o.id
  })
  const compraPizza = await comprar(pizza.offerId, ctx.cliente)
  const dp = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: compraPizza.entitlements[0]! } })
  assert.deepEqual([dp.sourceType, dp.lotId, dp.actualUnitCost.toFixed(2)], ['PREPURCHASED_SUPPLY', pizza.lotId, '300.00'], 'el prepago sigue igual que en el Slice 4')
  assert.equal((await prisma.supplyV2EconomicEvent.findFirstOrThrow({ where: { entitlementId: dp.id } })).type, 'SALE_REVENUE')
  assert.equal(await sinEmpresa('prueba', async (tx) => (await obligacionesLiquidablesEnTx(tx, pizza.supplierId, periodo.periodStart, periodo.periodEnd, 'DOP')).length), 0)
  await assert.rejects(sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: pizza.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras))), /No hay entregas a comisión/)

  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras))),
    sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras))),
  ])
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string; lineas: number; supplierNet: string }>[]
  assert.equal(ok.length, 1, 'solo una liquidación toma las obligaciones')
  assert.deepEqual([ok[0]!.value.lineas, ok[0]!.value.supplierNet], [2, '1800.00'])
  s.settlementId = ok[0]!.value.id
  assert.equal(await prisma.supplyV2SettlementLine.count({ where: { obligationId: { in: vivas.map((v) => v.id) }, settlement: { status: { not: 'CANCELLED' } } } }), 2, 'cada obligación en UNA sola liquidación viva')
  await sinEmpresa('prueba', (tx) => aprobarLiquidacionEnTx(tx, s.settlementId, como(ctx.finanzas)))
})

test('H · dos pagos sobre el mismo saldo: nunca se sobrepaga; la más antigua se paga primero; reversar devuelve el saldo', async () => {
  const s = ctx.tours
  const [p1, p2] = await Promise.all([
    sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 1000, settlementId: s.settlementId }, como(ctx.compras))),
    sinEmpresa('prueba', (tx) => crearPagoEnTx(tx, { supplierId: s.supplierId, method: 'BANK_TRANSFER', amount: 1000, settlementId: s.settlementId }, como(ctx.compras))),
  ])
  await Promise.allSettled([
    sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p1.id, como(ctx.finanzas))),
    sinEmpresa('prueba', (tx) => confirmarPagoProveedorEnTx(tx, p2.id, como(ctx.finanzas))),
  ])
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: s.settlementId }, include: { obligations: { orderBy: { recognizedAt: 'asc' } } } })
  assert.equal(liq.paidAmount.toFixed(2), '1800.00', 'de 2 000 solo entran 1 800: lo demás queda sin aplicar')
  assert.equal(liq.status, 'PAID')
  assert.ok(liq.obligations.every((o) => o.paidAmount.lessThanOrEqualTo(o.grossAmount)), 'ninguna obligación sobrepagada')
  const pagos = await prisma.supplyV2SupplierPayment.findMany({ where: { id: { in: [p1.id, p2.id] } } })
  assert.equal(pagos.reduce((t, p) => t.plus(p.appliedAmount), D(0)).toFixed(2), '1800.00')
  // El primero cubrió la más antigua completa (900) y 100 de la segunda.
  const primero = pagos.find((p) => p.appliedAmount.equals(1000))
  assert.ok(primero, 'un pago aplicó 1 000 y el otro 800')
  const apps = await prisma.supplyV2PaymentApplication.findMany({ where: { paymentId: primero.id }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(apps.map((a) => a.amount.toFixed(2)), ['900.00', '100.00'])
  assert.equal(apps[0]!.obligationId, liq.obligations[0]!.id, 'la más antigua primero')

  // Reversar una aplicación: la liquidación vuelve a PARTIALLY_PAID y la obligación a deber.
  const rev = await sinEmpresa('prueba', (tx) => reversarAplicacionEnTx(tx, apps[1]!.id, 'error de caja', como(ctx.finanzas)))
  assert.equal(rev.amount, '100.00')
  const liq2 = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: s.settlementId } })
  assert.deepEqual([liq2.status, liq2.paidAmount.toFixed(2)], ['PARTIALLY_PAID', '1700.00'])
  // Y se vuelve a aplicar desde el saldo sin aplicar del mismo pago.
  await sinEmpresa('prueba', (tx) => aplicarEnTx(tx, { paymentId: primero.id, obligationId: liq.obligations[1]!.id, amount: 100 }, como(ctx.finanzas)))
  assert.equal((await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: s.settlementId } })).status, 'PAID')
})

// ── I · reversas de entrega ──────────────────────────────────────────────────

test('I · reversar una entrega sin pagar cancela la obligación y la saca de su liquidación; pagada abre una incidencia', async () => {
  const s = ctx.tours
  // Sin pagar: compra, entrega, liquida (PENDING), reversa.
  const c = await comprar(s.offerId, ctx.cliente3)
  const r = await redimir(c.entitlements[0]!, ctx.cliente3)
  const l = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: s.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras)))
  assert.equal(l.supplierNet, '900.00')
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, r, 'no se presentó', como(ctx.finanzas)))
  const o = await obligacionDe(r)
  assert.deepEqual([o?.status, o?.outstandingAmount.toFixed(2), o?.settlementId], ['CANCELLED', '0.00', null])
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: l.id }, include: { lines: true } })
  assert.deepEqual([liq.lines.length, liq.supplierNet.toFixed(2), liq.grossSales.toFixed(2)], [0, '0.00', '0.00'])
  await sinEmpresa('prueba', (tx) => cancelarLiquidacionEnTx(tx, l.id, 'quedó vacía', como(ctx.finanzas)))
  assert.equal(await prisma.supplyV2FinanceIncident.count({ where: { redemptionId: r } }), 0)
  // El derecho vuelve a ACTIVE y se puede entregar otra vez: nueva obligación (otra redención), la vieja sigue cancelada.
  const r2 = await redimir(c.entitlements[0]!, ctx.cliente3)
  assert.equal((await obligacionDe(r2))?.status, 'OPEN')
  assert.equal(await prisma.supplyV2LedgerEntry.count({ where: { referenceType: 'REDEMPTION', referenceId: { in: [r, r2] } } }), 0)

  // Pagada: la del viaje A (900 pagados). Reversar NO deshace el pago: incidencia abierta.
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, s.redencion, 'cliente reclamó', como(ctx.finanzas)))
  const ob = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { id: s.obligacion } })
  assert.deepEqual([ob.status, ob.paidAmount.toFixed(2)], ['PAID', '900.00'], 'la obligación pagada se conserva')
  const inc = await prisma.supplyV2FinanceIncident.findFirstOrThrow({ where: { redemptionId: s.redencion } })
  assert.deepEqual([inc.type, inc.status, inc.amount.toFixed(2), inc.obligationId], ['REDEMPTION_REVERSED_AFTER_PAYMENT', 'OPEN', '900.00', s.obligacion])
  await assert.rejects(sinEmpresa('prueba', (tx) => resolverIncidenciaFinancieraEnTx(tx, inc.id, '', como(ctx.finanzas))), /explicar/)
  await sinEmpresa('prueba', (tx) => resolverIncidenciaFinancieraEnTx(tx, inc.id, 'Se descuenta de la próxima liquidación (nota de crédito NC-1).', como(ctx.finanzas)))
  assert.equal((await prisma.supplyV2FinanceIncident.findUniqueOrThrow({ where: { id: inc.id } })).status, 'RESOLVED')
  assert.equal(await prisma.auditLog.count({ where: { entidadId: inc.id, accion: { in: ['SUPPLY_V2_FINANCE_INCIDENT_CREATED', 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED'] } } }), 2)
})

// ── J · redondeo, conciliación, economía, vencimiento ────────────────────────

test('J · redondeo a 2 decimales ROUND_HALF_UP: 33.33 % de 10.00 → 3.33 / 6.67; comisión + neto = GMV exacto', async () => {
  const s = ctx.tours
  const ag = await sinEmpresa('prueba', async (tx) => {
    const a = await crearAcuerdoEnTx(tx, { supplierId: s.supplierId, type: 'COMMISSION', scope: 'ITEM', catalogItemId: s.itemOtro, commissionPercentage: '33.33', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    return a
  })
  const o = await crearYPublicarComision(s.itemOtro, { availabilityMode: 'UNLIMITED', perCustomerLimit: 3, salePrice: 10, publicPrice: 12, titulo: 'Gorra 33' })
  assert.equal(o.commissionPercentage, '33.33', 'el acuerdo por producto gana al de catálogo')
  const c = await comprar(o.id, ctx.cliente, 3)
  const orden = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: c.orderId } })
  assert.deepEqual([orden.total.toFixed(2), orden.commissionAmount.toFixed(2), orden.supplierNet.toFixed(2)], ['30.00', '10.00', '20.00'])
  const derechos = await prisma.supplyV2Entitlement.findMany({ where: { orderId: c.orderId }, orderBy: { id: 'asc' } })
  assert.deepEqual(derechos.map((d) => d.commissionAmount?.toFixed(2)).sort(), ['3.33', '3.33', '3.34'], 'el centavo sobrante va a una unidad; la suma cuadra')
  assert.equal(derechos.reduce((t, d) => t.plus(d.commissionAmount ?? 0), D(0)).toFixed(2), '10.00')
  assert.equal(derechos.reduce((t, d) => t.plus(d.supplierNet ?? 0), D(0)).toFixed(2), '20.00')
  assert.equal(derechos.reduce((t, d) => t.plus(d.supplierNet ?? 0).plus(d.commissionAmount ?? 0), D(0)).toFixed(2), '30.00')
  void ag
})

test('J · conciliación de comisión: bruto / comisión / neto / pagos internos frente a lo reclamado; sin cifra no hay MATCHED; resolver exige el tipo', async () => {
  const s = ctx.tours
  const r = await sinEmpresa('prueba', (tx) => crearConciliacionComisionEnTx(tx, { supplierId: s.supplierId, ...periodo }, como(ctx.finanzas)))
  assert.equal(r.status, 'OPEN')
  assert.equal(r.supplierAmount, null)
  // Interno: obligaciones vivas o pagadas de comisión del periodo (A 900 pagada, G 900 pagada + 900 pagada, I 900 nueva), no las canceladas.
  const internas = await prisma.supplyV2SupplierObligation.findMany({ where: { supplierId: s.supplierId, status: { not: 'CANCELLED' }, redemption: { sourceType: 'COMMISSION' } } })
  assert.equal(r.netInternal, internas.reduce((t, o) => t.plus(o.grossAmount), D(0)).toFixed(2))
  assert.equal(r.grossSalesInternal, internas.reduce((t) => t.plus(1000), D(0)).toFixed(2))
  assert.equal(r.commissionInternal, internas.reduce((t) => t.plus(100), D(0)).toFixed(2))
  assert.equal(r.paymentsInternal, internas.reduce((t, o) => t.plus(o.paidAmount), D(0)).toFixed(2))
  assert.ok(r.lineas >= internas.length + 2, 'líneas por entrega, por pago aplicado y por liquidación')
  const rep = await sinEmpresa('prueba', (tx) => crearConciliacionComisionEnTx(tx, { supplierId: s.supplierId, ...periodo }, como(ctx.finanzas)))
  assert.ok(rep.repetida && rep.id === r.id)
  await assert.rejects(sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, r.id, 'ok', como(ctx.finanzas), 'ACCEPT_INTERNAL')), /sin lo que el proveedor reclama/)
  const d = await sinEmpresa('prueba', (tx) => registrarCifrasDelProveedorEnTx(tx, r.id, { grossClaimed: 5000, commissionClaimed: 500, netClaimed: D(r.netInternal).plus(50).toFixed(2) }, como(ctx.finanzas)))
  assert.deepEqual([d.status, d.differenceAmount], ['DISCREPANCY', '-50.00'])
  await assert.rejects(sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, r.id, 'el proveedor contó una entrega reversada', como(ctx.finanzas))), /CÓMO/)
  await sinEmpresa('prueba', (tx) => resolverConciliacionEnTx(tx, r.id, 'el proveedor contó una entrega reversada', como(ctx.finanzas), 'ACCEPT_INTERNAL'))
  const fin = await prisma.supplyV2Reconciliation.findUniqueOrThrow({ where: { id: r.id } })
  assert.deepEqual([fin.kind, fin.status, fin.resolutionType, fin.grossClaimed?.toFixed(2)], ['COMMISSION', 'RESOLVED', 'ACCEPT_INTERNAL', '5000.00'])
})

test('J · economía: la comisión se reporta aparte del prepago; ingreso = comisión, nunca el neto del proveedor', async () => {
  const s = ctx.tours
  const e = await calcularEconomia({ ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA), supplierId: s.supplierId })
  const ventas = await prisma.supplyV2EconomicEvent.findMany({ where: { supplierId: s.supplierId, type: 'COMMISSION_REVENUE' } })
  const gmv = ventas.reduce((t, v) => t.plus(v.gmvAmount), D(0))
  const rev = ventas.reduce((t, v) => t.plus(v.revenueAmount), D(0))
  assert.equal(e.commission.gmv.toFixed(2), gmv.toFixed(2))
  assert.equal(e.commission.revenue.toFixed(2), rev.toFixed(2))
  assert.equal(e.commission.supplierNet.toFixed(2), gmv.minus(rev).toFixed(2))
  assert.equal(e.commission.unitsSold, ventas.length)
  assert.equal(e.prepurchase.unitsSold, 0, 'este proveedor no vende prepago')
  assert.equal(e.cost.toFixed(2), '0.00', 'Membego no reconoce costo en comisión')
  assert.equal(e.revenue.toFixed(2), rev.toFixed(2), 'el ingreso total es la comisión, no el GMV')
  const todo = await calcularEconomia({ ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA), supplierId: ctx.pizza.supplierId })
  assert.deepEqual([todo.prepurchase.unitsSold, todo.prepurchase.revenue.toFixed(2), todo.prepurchase.cost.toFixed(2), todo.commission.unitsSold], [1, '399.00', '300.00', 0])
})

test('J · un derecho a comisión vencido: EXPIRED, breakage, sin asiento y sin deuda con el proveedor; el barrido lo tolera', async () => {
  const s = ctx.tours
  const c = await comprar(s.offerId, ctx.cliente3)
  const id = c.entitlements[0]!
  await prisma.supplyV2Entitlement.update({ where: { id }, data: { expiresAt: new Date(ahora.getTime() - 1000) } })
  assert.ok(await sinEmpresa('prueba', (tx) => expirarDerechoEnTx(tx, id, como(null))))
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id } })
  assert.equal(d.status, 'EXPIRED')
  const tipos = (await prisma.supplyV2EconomicEvent.findMany({ where: { entitlementId: id } })).map((e) => e.type).sort()
  assert.deepEqual(tipos, ['BREAKAGE', 'COMMISSION_REVENUE'])
  assert.equal(await prisma.supplyV2LedgerEntry.count({ where: { referenceType: 'ENTITLEMENT', referenceId: id } }), 0)
  assert.equal(await prisma.supplyV2SupplierObligation.count({ where: { redemption: { entitlementId: id } } }), 0, 'no se entregó: nada que deber')
  const r = await barridoSupplyV2()
  assert.equal(r.derechosConError, 0)
  // Cerrar la oferta: sin asignación que liberar, sin reservas vivas.
  const cierre = await sinEmpresa('prueba', (tx) => cerrarOfertaEnTx(tx, s.offerId, 'ENDED', 'fin de temporada', como(ctx.compras)))
  assert.equal(cierre.liberadas, 0)
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: s.offerId } })).status, 'ENDED')
  await sinInventario(s.offerId)
})
