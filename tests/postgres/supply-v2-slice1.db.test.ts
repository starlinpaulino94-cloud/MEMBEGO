import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx, modificarCondicionesEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx, rechazarOrdenEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { cubetasDeLote, invarianteCumplido, saldoDeAsientos } from '../../src/modules/supply-v2/core/ledger'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 1 contra PostgreSQL de verdad (§49).
 *
 * El recorrido completo, encadenado a propósito:
 *
 *   Supplier → CatalogItem → Agreement → AgreementVersion → PO → Approval →
 *   Receipt 500 → Lot → Ledger → Receipt 300 → Lot → Receipt 200 → PO
 *   RECEIVED → total supply = 1.000
 *
 * Se ejecuta con `npm run test:db` sobre la base de `DATABASE_URL`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()

const ctx = {
  companyId: '',
  creadorId: '',
  aprobadorId: '',
  supplierId: '',
  supplierEmpresaId: '',
  itemId: '',
  agreementId: '',
  agreementVersionId: '',
  ordenId: '',
  lotes: [] as string[],
}

const como = (actorId: string) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

async function lote(id: string) {
  const l = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id } })
  assert.ok(invarianteCumplido(l.quantityReceived, cubetasDeLote(l)), `invariante del lote ${l.code}`)
  return l
}

async function orden(id: string) {
  return prisma.supplyV2PurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } })
}

before(async () => {
  const empresa = await prisma.company.create({
    data: { name: `Little Pizza ${sufijo}`, slug: `little-pizza-${sufijo}`, type: 'restaurante', ciudad: 'Santo Domingo' },
    select: { id: true },
  })
  ctx.companyId = empresa.id
  const [creador, aprobador] = await Promise.all([
    prisma.user.create({ data: { supabaseId: `sb-v2-creador-${sufijo}`, email: `v2-creador-${sufijo}@prueba.test`, name: 'Compras', role: 'SUPERADMIN' }, select: { id: true } }),
    prisma.user.create({ data: { supabaseId: `sb-v2-aprobador-${sufijo}`, email: `v2-aprobador-${sufijo}@prueba.test`, name: 'Finanzas', role: 'SUPERADMIN' }, select: { id: true } }),
  ])
  ctx.creadorId = creador.id
  ctx.aprobadorId = aprobador.id
})

// ── 1–2 · Proveedor ─────────────────────────────────────────────────────────

test('1 · crear proveedor externo (companyId nulo) deja bitácora', async () => {
  const p = await sinEmpresa('prueba', (tx) =>
    crearProveedorExternoEnTx(tx, { commercialName: `Externo ${sufijo}`, whatsapp: '809-555-0101', currency: 'dop' }, como(ctx.creadorId))
  )
  ctx.supplierId = p.id
  assert.equal(p.source, 'EXTERNAL')
  assert.equal(p.companyId, null)
  assert.equal(p.currency, 'DOP')
  const audit = await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_SUPPLIER_CREATED', entidadId: p.id } })
  assert.ok(audit, 'bitácora SUPPLY_V2_SUPPLIER_CREATED')
  assert.equal(audit.userId, ctx.creadorId)
})

test('2 · vincular una Company existente no crea otra empresa y es idempotente', async () => {
  const empresasAntes = await prisma.company.count()
  const p1 = await sinEmpresa('prueba', (tx) => vincularEmpresaComoProveedorEnTx(tx, ctx.companyId, {}, como(ctx.creadorId)))
  const p2 = await sinEmpresa('prueba', (tx) => vincularEmpresaComoProveedorEnTx(tx, ctx.companyId, {}, como(ctx.creadorId)))
  ctx.supplierEmpresaId = p1.id
  assert.equal(p1.source, 'REGISTERED_COMPANY')
  assert.equal(p1.companyId, ctx.companyId)
  assert.equal(p2.id, p1.id)
  assert.equal(p2.reutilizado, true)
  assert.equal(await prisma.company.count(), empresasAntes)
})

// ── 3–4 · Catálogo ──────────────────────────────────────────────────────────

test('3 · crear producto en el catálogo del proveedor', async () => {
  const i = await sinEmpresa('prueba', (tx) =>
    crearItemCatalogoEnTx(
      tx,
      { supplierId: ctx.supplierEmpresaId, type: 'PRODUCT', name: 'Pizza Grande Pepperoni', sku: 'piz-pep-g', publicPrice: 600, category: 'Pizzas' },
      como(ctx.creadorId)
    )
  )
  ctx.itemId = i.id
  assert.equal(i.slug, 'pizza-grande-pepperoni')
  assert.equal(i.sku, 'PIZ-PEP-G')
  assert.equal(i.publicPrice, '600.00')
})

test('4 · un SKU repetido en el mismo proveedor falla; el mismo nombre recibe otro slug', async () => {
  await assert.rejects(
    sinEmpresa('prueba', (tx) =>
      crearItemCatalogoEnTx(tx, { supplierId: ctx.supplierEmpresaId, type: 'PRODUCT', name: 'Otra', sku: 'PIZ-PEP-G' }, como(ctx.creadorId))
    ),
    /ya existe en este proveedor/
  )
  const repetido = await sinEmpresa('prueba', (tx) =>
    crearItemCatalogoEnTx(tx, { supplierId: ctx.supplierEmpresaId, type: 'PRODUCT', name: 'Pizza Grande Pepperoni' }, como(ctx.creadorId))
  )
  assert.equal(repetido.slug, 'pizza-grande-pepperoni-2')
})

// ── 5–6 · Acuerdo y versión ─────────────────────────────────────────────────

test('5 · crear acuerdo de compra anticipada a RD$300 nace en DRAFT con código MBG-AG', async () => {
  const a = await sinEmpresa('prueba', (tx) =>
    crearAcuerdoEnTx(
      tx,
      { supplierId: ctx.supplierEmpresaId, type: 'PREPAID_PURCHASE', catalogItemId: ctx.itemId, negotiatedUnitCost: 300, paymentTermsDays: 15, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) },
      como(ctx.creadorId)
    )
  )
  ctx.agreementId = a.id
  assert.equal(a.status, 'DRAFT')
  assert.equal(a.version, 0)
  assert.match(a.code, /^MBG-AG-\d{4}-\d{6}$/)
})

test('6 · activar el acuerdo genera la versión 1 con snapshot; activar de nuevo no duplica', async () => {
  const r1 = await sinEmpresa('prueba', (tx) => activarAcuerdoEnTx(tx, ctx.agreementId, como(ctx.creadorId)))
  const r2 = await sinEmpresa('prueba', (tx) => activarAcuerdoEnTx(tx, ctx.agreementId, como(ctx.creadorId)))
  ctx.agreementVersionId = r1.versionId
  assert.equal(r1.version, 1)
  assert.equal(r2.versionId, r1.versionId)
  const versiones = await prisma.supplyV2AgreementVersion.findMany({ where: { agreementId: ctx.agreementId } })
  assert.equal(versiones.length, 1)
  const snap = versiones[0]!.snapshot as { negotiatedUnitCost: string }
  assert.equal(snap.negotiatedUnitCost, '300')
})

// ── 7–9 · Orden y aprobación ────────────────────────────────────────────────

test('7 · crear PO de 1.000 × RD$300 = RD$300.000 con número MBG-PO-AAAA-NNNNNN', async () => {
  const o = await sinEmpresa('prueba', (tx) =>
    crearOrdenEnTx(
      tx,
      { supplierId: ctx.supplierEmpresaId, agreementId: ctx.agreementId, lines: [{ catalogItemId: ctx.itemId, quantity: 1000, unitCost: 300 }], paymentMode: 'PREPAID' },
      como(ctx.creadorId)
    )
  )
  ctx.ordenId = o.id
  assert.match(o.number, /^MBG-PO-\d{4}-\d{6}$/)
  assert.equal(o.total, '300000.00')
  const db = await orden(o.id)
  assert.equal(db.status, 'DRAFT')
  assert.equal(db.agreementVersionId, ctx.agreementVersionId)
  assert.equal(db.lines[0]!.descriptionSnapshot, 'Pizza Grande Pepperoni')
  assert.equal(db.lines[0]!.receivedQuantity, 0)
})

test('7b · dos órdenes creadas a la vez no comparten número', async () => {
  const [a, b] = await Promise.all([
    sinEmpresa('prueba', (tx) => crearOrdenEnTx(tx, { supplierId: ctx.supplierEmpresaId, agreementId: ctx.agreementId, lines: [{ catalogItemId: ctx.itemId, quantity: 1, unitCost: 300 }] }, como(ctx.creadorId))),
    sinEmpresa('prueba', (tx) => crearOrdenEnTx(tx, { supplierId: ctx.supplierEmpresaId, agreementId: ctx.agreementId, lines: [{ catalogItemId: ctx.itemId, quantity: 1, unitCost: 300 }] }, como(ctx.creadorId))),
  ])
  assert.notEqual(a.number, b.number)
})

test('7c · una orden histórica no cambia cuando el acuerdo cambia de versión', async () => {
  const r = await sinEmpresa('prueba', (tx) => modificarCondicionesEnTx(tx, ctx.agreementId, { negotiatedUnitCost: 280 }, como(ctx.creadorId)))
  assert.equal(r.version, 2)
  const db = await orden(ctx.ordenId)
  assert.equal(db.agreementVersionId, ctx.agreementVersionId)
  assert.equal(db.lines[0]!.unitCost.toFixed(2), '300.00')
})

test('8 · enviar a aprobación; rechazar exige motivo y devuelve a DRAFT con historial', async () => {
  await sinEmpresa('prueba', (tx) => enviarAprobacionEnTx(tx, ctx.ordenId, como(ctx.creadorId)))
  assert.equal((await orden(ctx.ordenId)).status, 'PENDING_APPROVAL')
  await assert.rejects(sinEmpresa('prueba', (tx) => rechazarOrdenEnTx(tx, ctx.ordenId, '  ', como(ctx.aprobadorId))), /motivo/)
  await sinEmpresa('prueba', (tx) => rechazarOrdenEnTx(tx, ctx.ordenId, 'Falta cotización firmada', como(ctx.aprobadorId)))
  assert.equal((await orden(ctx.ordenId)).status, 'DRAFT')
  const eventos = await prisma.supplyV2PurchaseOrderEvent.findMany({ where: { purchaseOrderId: ctx.ordenId }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(eventos.map((e) => e.type), ['CREATED', 'SUBMITTED', 'REJECTED'])
  assert.equal(eventos[2]!.reason, 'Falta cotización firmada')
  await sinEmpresa('prueba', (tx) => enviarAprobacionEnTx(tx, ctx.ordenId, como(ctx.creadorId)))
})

test('9 · el creador NO puede aprobar su propia orden; otro usuario sí', async () => {
  await assert.rejects(sinEmpresa('prueba', (tx) => aprobarOrdenEnTx(tx, ctx.ordenId, como(ctx.creadorId))), /no la puede aprobar quien la creó/)
  assert.equal((await orden(ctx.ordenId)).status, 'PENDING_APPROVAL')
  await sinEmpresa('prueba', (tx) => aprobarOrdenEnTx(tx, ctx.ordenId, como(ctx.aprobadorId)))
  const db = await orden(ctx.ordenId)
  assert.equal(db.status, 'APPROVED')
  assert.equal(db.approvedById, ctx.aprobadorId)
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_PO_APPROVED', entidadId: ctx.ordenId } }))
})

test('9b · no se recibe contra una orden que no está aprobada', async () => {
  const borrador = await sinEmpresa('prueba', (tx) => crearOrdenEnTx(tx, { supplierId: ctx.supplierEmpresaId, agreementId: ctx.agreementId, lines: [{ catalogItemId: ctx.itemId, quantity: 5, unitCost: 300 }] }, como(ctx.creadorId)))
  const lineaId = (await orden(borrador.id)).lines[0]!.id
  await assert.rejects(
    sinEmpresa('prueba', (tx) => confirmarRecepcionEnTx(tx, { purchaseOrderId: borrador.id, lines: [{ purchaseOrderLineId: lineaId, quantity: 1 }] }, como(ctx.creadorId))),
    /aprobada/
  )
})

// ── 10–16 · Recepciones ─────────────────────────────────────────────────────

async function recibir(cantidad: number, clave?: string) {
  const lineaId = (await orden(ctx.ordenId)).lines[0]!.id
  return sinEmpresa('prueba', (tx) =>
    confirmarRecepcionEnTx(
      tx,
      { purchaseOrderId: ctx.ordenId, lines: [{ purchaseOrderLineId: lineaId, quantity: cantidad, expiresAt: new Date(ahora.getTime() + 60 * DIA) }], reference: `Guía ${cantidad}`, idempotencyKey: clave },
      como(ctx.aprobadorId)
    )
  )
}

test('10 · recibir 500 de 1.000: lote de 500, asiento RECEIPT y PO PARTIALLY_RECEIVED', async () => {
  const r = await recibir(500, `k1-${sufijo}`)
  assert.equal(r.repetida, false)
  assert.match(r.number, /^MBG-RC-\d{4}-\d{6}$/)
  assert.equal(r.purchaseOrderStatus, 'PARTIALLY_RECEIVED')
  assert.equal(r.lots.length, 1)
  ctx.lotes.push(r.lots[0]!.id)
  const l = await lote(r.lots[0]!.id)
  assert.match(l.code, /^LOT-\d{4}-\d{6}$/)
  assert.equal(l.quantityReceived, 500)
  assert.equal(l.quantityAvailable, 500)
  assert.equal(l.unitCost.toFixed(2), '300.00')
  const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: l.id } })
  assert.equal(asientos.length, 1)
  assert.equal(asientos[0]!.type, 'RECEIPT')
  assert.equal(asientos[0]!.balanceBefore, 0)
  assert.equal(asientos[0]!.balanceAfter, 500)
  assert.equal(asientos[0]!.referenceId, r.id)
  const db = await orden(ctx.ordenId)
  assert.equal(db.status, 'PARTIALLY_RECEIVED')
  assert.equal(db.lines[0]!.receivedQuantity, 500)
})

test('11 · recibir 300 → 800 / 1.000, segundo lote', async () => {
  const r = await recibir(300, `k2-${sufijo}`)
  ctx.lotes.push(r.lots[0]!.id)
  assert.equal(r.purchaseOrderStatus, 'PARTIALLY_RECEIVED')
  assert.equal((await orden(ctx.ordenId)).lines[0]!.receivedQuantity, 800)
  assert.equal((await lote(r.lots[0]!.id)).quantityAvailable, 300)
})

test('13 · recibir 201 cuando quedan 200 falla y no deja rastro', async () => {
  const recepcionesAntes = await prisma.supplyV2PurchaseReceipt.count({ where: { purchaseOrderId: ctx.ordenId } })
  const lotesAntes = await prisma.supplyV2Lot.count({ where: { purchaseOrderId: ctx.ordenId } })
  await assert.rejects(recibir(201), /Solo quedan 200/)
  assert.equal(await prisma.supplyV2PurchaseReceipt.count({ where: { purchaseOrderId: ctx.ordenId } }), recepcionesAntes)
  assert.equal(await prisma.supplyV2Lot.count({ where: { purchaseOrderId: ctx.ordenId } }), lotesAntes)
  assert.equal((await orden(ctx.ordenId)).lines[0]!.receivedQuantity, 800)
})

test('12 · recibir 200 → 1.000 / 1.000 y la PO termina en RECEIVED', async () => {
  const r = await recibir(200, `k3-${sufijo}`)
  ctx.lotes.push(r.lots[0]!.id)
  assert.equal(r.purchaseOrderStatus, 'RECEIVED')
  const db = await orden(ctx.ordenId)
  assert.equal(db.status, 'RECEIVED')
  assert.equal(db.lines[0]!.receivedQuantity, 1000)
})

test('13b · una unidad más sobre una orden RECEIVED falla', async () => {
  await assert.rejects(recibir(1), /aprobada y todavía no completa|ya se recibió/)
})

test('14 · el ledger cuadra: Σ asientos = cubetas de cada lote y total supply = 1.000', async () => {
  let total = 0
  for (const id of ctx.lotes) {
    const l = await lote(id)
    const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: id } })
    const saldo = saldoDeAsientos(asientos)
    assert.deepEqual(saldo, cubetasDeLote(l))
    total += l.quantityAvailable
  }
  assert.equal(total, 1000)
  const lotes = await prisma.supplyV2Lot.findMany({ where: { purchaseOrderId: ctx.ordenId } })
  assert.equal(lotes.length, 3)
  assert.equal(lotes.reduce((t, l) => t + l.quantityReceived * Number(l.unitCost), 0), 300_000)
})

test('15 · la base no acepta cubetas negativas ni un lote descuadrado', async () => {
  await assert.rejects(
    prisma.supplyV2Lot.update({ where: { id: ctx.lotes[0]! }, data: { quantityAvailable: -1 } }),
    /supply_v2_lots_buckets|check/i
  )
  await assert.rejects(
    prisma.supplyV2Lot.update({ where: { id: ctx.lotes[0]! }, data: { quantityAvailable: 499 } }),
    /supply_v2_lots_buckets_balance|check/i
  )
  await assert.rejects(
    prisma.supplyV2PurchaseOrderLine.updateMany({ where: { purchaseOrderId: ctx.ordenId }, data: { receivedQuantity: 1001 } }),
    /supply_v2_po_lines_quantities|check/i
  )
})

test('16 · doble confirmación con la misma clave devuelve la misma recepción y no crea dos lotes', async () => {
  // Orden nueva y aprobada solo para este caso.
  const o = await sinEmpresa('prueba', (tx) => crearOrdenEnTx(tx, { supplierId: ctx.supplierEmpresaId, agreementId: ctx.agreementId, lines: [{ catalogItemId: ctx.itemId, quantity: 100, unitCost: 300 }] }, como(ctx.creadorId)))
  await sinEmpresa('prueba', (tx) => enviarAprobacionEnTx(tx, o.id, como(ctx.creadorId)))
  await sinEmpresa('prueba', (tx) => aprobarOrdenEnTx(tx, o.id, como(ctx.aprobadorId)))
  const lineaId = (await orden(o.id)).lines[0]!.id
  const clave = `doble-${sufijo}`
  const confirmar = () =>
    sinEmpresa('prueba', (tx) =>
      confirmarRecepcionEnTx(tx, { purchaseOrderId: o.id, lines: [{ purchaseOrderLineId: lineaId, quantity: 40 }], idempotencyKey: clave }, como(ctx.aprobadorId))
    )
  const [a, b] = await Promise.all([confirmar(), confirmar()])
  assert.equal(a.id, b.id)
  assert.equal([a.repetida, b.repetida].filter(Boolean).length, 1)
  assert.equal(await prisma.supplyV2PurchaseReceipt.count({ where: { purchaseOrderId: o.id } }), 1)
  assert.equal(await prisma.supplyV2Lot.count({ where: { purchaseOrderId: o.id } }), 1)
  assert.equal((await orden(o.id)).lines[0]!.receivedQuantity, 40)
})

test('17 · una línea con cantidad 0 o negativa no se recibe', async () => {
  await assert.rejects(recibir(0), /entero positivo/)
  await assert.rejects(recibir(-5), /entero positivo/)
})
