import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { cerrarOfertaEnTx, crearOfertaEnTx, pausarOfertaEnTx, publicarOfertaEnTx, reanudarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, avisarPagoEnTx, cancelarOrdenClienteEnTx, confirmarPagoEnTx, expirarOrdenEnTx, rechazarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { barridoSupplyV2 } from '../../src/modules/supply-v2/commerce/barrido'
import { ofertaPublicaPorSlug, ofertasPublicas } from '../../src/modules/supply-v2/marketplace/read-model'
import { cubetasDeLote, invarianteCumplido, saldoDeAsientos } from '../../src/modules/supply-v2/core/ledger'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 2 contra PostgreSQL de verdad (§56).
 *
 *   Supply 1.000 (LOT-A 600 @300 vence antes · LOT-B 400 @280 vence después)
 *   → oferta 100 (A) → checkout → cancelar → checkout → pago → derecho
 *   → última unidad entre dos clientes → expiración por el barrido
 *   → oferta multi-lote (FEFO) → costo real por lote → cancelar oferta sin
 *   tocar lo emitido → límite por cliente en concurrencia → idempotencias.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()

const ctx = {
  admin: '',
  cliente1: '',
  cliente2: '',
  supplierId: '',
  itemId: '',
  agreementId: '',
  lotA: '',
  lotB: '',
  oferta1: '',
  oferta1Alloc: '',
  ordenD: '',
}
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

async function lote(id: string) {
  const l = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id } })
  assert.ok(invarianteCumplido(l.quantityReceived, cubetasDeLote(l)), `invariante del lote ${l.code}`)
  const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: id } })
  assert.deepEqual(saldoDeAsientos(asientos), cubetasDeLote(l), `Σ asientos = cubetas del lote ${l.code}`)
  return l
}
async function cubetasProducto() {
  const lotes = await prisma.supplyV2Lot.findMany({ where: { catalogItemId: ctx.itemId } })
  const s = { AVAILABLE: 0, ALLOCATED: 0, RESERVED: 0, ISSUED: 0 }
  for (const l of lotes) {
    await lote(l.id)
    s.AVAILABLE += l.quantityAvailable
    s.ALLOCATED += l.quantityAllocated
    s.RESERVED += l.quantityReserved
    s.ISSUED += l.quantityIssued
  }
  return s
}
async function ofertaPublicada(cantidad: number, opciones: { perCustomerLimit?: number; startsAt?: Date; endsAt?: Date | null } = {}) {
  return sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaEnTx(
      tx,
      { catalogItemId: ctx.itemId, title: `Pizza Grande Pepperoni ${cantidad}`, publicPrice: 600, salePrice: 399, quantity: cantidad, perCustomerLimit: opciones.perCustomerLimit ?? 2, startsAt: opciones.startsAt ?? new Date(ahora.getTime() - 60_000), endsAt: opciones.endsAt === undefined ? new Date(ahora.getTime() + 30 * DIA) : opciones.endsAt },
      como(ctx.admin)
    )
    const p = await publicarOfertaEnTx(tx, o.id, como(ctx.admin))
    return { id: o.id, allocationId: p.allocationId!, status: p.status }
  })
}
const comprar = (customerId: string, offerId: string, quantity = 1, idempotencyKey?: string) =>
  sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity, idempotencyKey }, como(customerId)))
const asignacion = (id: string) => prisma.supplyV2Allocation.findUniqueOrThrow({ where: { id } })

before(async () => {
  const [admin, aprobador, c1, c2] = await Promise.all([
    prisma.user.create({ data: { supabaseId: `sb-s2-admin-${sufijo}`, email: `s2-admin-${sufijo}@prueba.test`, name: 'Admin', role: 'SUPERADMIN' }, select: { id: true } }),
    prisma.user.create({ data: { supabaseId: `sb-s2-aprob-${sufijo}`, email: `s2-aprob-${sufijo}@prueba.test`, name: 'Aprobador', role: 'SUPERADMIN' }, select: { id: true } }),
    prisma.user.create({ data: { supabaseId: `sb-s2-c1-${sufijo}`, email: `s2-c1-${sufijo}@prueba.test`, name: 'Ana', role: 'CLIENTE' }, select: { id: true } }),
    prisma.user.create({ data: { supabaseId: `sb-s2-c2-${sufijo}`, email: `s2-c2-${sufijo}@prueba.test`, name: 'Luis', role: 'CLIENTE' }, select: { id: true } }),
  ])
  ctx.admin = admin.id
  ctx.cliente1 = c1.id
  ctx.cliente2 = c2.id

  // Supply del Slice 1: dos órdenes → dos lotes con costo y vencimiento distintos.
  await sinEmpresa('prueba', async (tx) => {
    const p = await crearProveedorExternoEnTx(tx, { commercialName: `Little Pizza S2 ${sufijo}` }, como(admin.id))
    ctx.supplierId = p.id
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: 'Pizza Grande Pepperoni', publicPrice: 600 }, como(admin.id))
    ctx.itemId = item.id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) }, como(admin.id))
    await activarAcuerdoEnTx(tx, a.id, como(admin.id))
    ctx.agreementId = a.id
    for (const [cantidad, costo, dias] of [
      [600, 300, 30],
      [400, 280, 60],
    ] as const) {
      const po = await crearOrdenEnTx(tx, { supplierId: p.id, agreementId: a.id, lines: [{ catalogItemId: item.id, quantity: cantidad, unitCost: costo }] }, como(admin.id))
      await enviarAprobacionEnTx(tx, po.id, como(admin.id))
      await aprobarOrdenEnTx(tx, po.id, como(aprobador.id))
      const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
      const r = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: cantidad, expiresAt: new Date(ahora.getTime() + dias * DIA) }] }, como(aprobador.id))
      if (cantidad === 600) ctx.lotA = r.lots[0]!.id
      else ctx.lotB = r.lots[0]!.id
    }
  })
  const s = await cubetasProducto()
  assert.deepEqual(s, { AVAILABLE: 1000, ALLOCATED: 0, RESERVED: 0, ISSUED: 0 })
})

// ── A · Publicar oferta de 100 ──────────────────────────────────────────────

test('A · crear oferta deja borrador sin tocar supply; publicar asigna 100 por FEFO (LOT-A): 900 AVAILABLE / 100 ALLOCATED', async () => {
  const borrador = await sinEmpresa('prueba', (tx) =>
    crearOfertaEnTx(tx, { catalogItemId: ctx.itemId, title: 'Pizza Grande Pepperoni', publicPrice: 600, salePrice: 399, quantity: 100, perCustomerLimit: 2, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) }, como(ctx.admin))
  )
  assert.equal(borrador.status, 'DRAFT')
  assert.match(borrador.code, /^MBG-OF-\d{4}-\d{6}$/)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 1000, ALLOCATED: 0, RESERVED: 0, ISSUED: 0 })

  const pub = await sinEmpresa('prueba', (tx) => publicarOfertaEnTx(tx, borrador.id, como(ctx.admin)))
  ctx.oferta1 = borrador.id
  ctx.oferta1Alloc = pub.allocationId!
  assert.equal(pub.status, 'ACTIVE')
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 100, RESERVED: 0, ISSUED: 0 })
  const lineas = await prisma.supplyV2AllocationLine.findMany({ where: { allocationId: pub.allocationId! } })
  assert.equal(lineas.length, 1)
  assert.equal(lineas[0]!.lotId, ctx.lotA)
  assert.equal((await lote(ctx.lotA)).quantityAllocated, 100)
  // Publicar de nuevo no asigna dos veces.
  const otra = await sinEmpresa('prueba', (tx) => publicarOfertaEnTx(tx, borrador.id, como(ctx.admin)))
  assert.equal(otra.allocationId, pub.allocationId)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 100, RESERVED: 0, ISSUED: 0 })
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_OFFER_PUBLISHED', entidadId: borrador.id } }))
})

test('A2 · asignar 1.001 con 900 disponibles falla y no deja asignación', async () => {
  // Se cuentan las asignaciones DE ESTE PRODUCTO, no todas.
  //
  // `prisma.supplyV2Allocation.count()` a secas cuenta las de toda la base, y
  // `node --test` corre los archivos de prueba en PARALELO: otro archivo
  // publicando su propia oferta hacía crecer el contador entre la foto y la
  // comprobación, y esta prueba fallaba por 826 !== 825 sin que nada de lo que
  // comprueba estuviera mal. Es la misma familia de fallo que se arregló en
  // `b4f6526e`; esta instancia se quedó atrás.
  const mias = { catalogItemId: ctx.itemId }
  const antes = await prisma.supplyV2Allocation.count({ where: mias })
  await assert.rejects(ofertaPublicada(1001), /Solo hay 900/)
  assert.equal(await prisma.supplyV2Allocation.count({ where: mias }), antes)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 100, RESERVED: 0, ISSUED: 0 })
})

// ── B · Checkout reserva ────────────────────────────────────────────────────

test('B · el cliente inicia checkout de 1: 99 ALLOCATED / 1 RESERVED, orden PENDING con precios congelados', async () => {
  const o = await comprar(ctx.cliente1, ctx.oferta1, 1, `b-${sufijo}`)
  assert.match(o.number, /^MBG-SO-\d{4}-\d{6}$/)
  assert.equal(o.total, '399.00')
  assert.ok(o.expiresAt > ahora)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 1, ISSUED: 0 })
  const db = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: { include: { reservations: true } } } })
  assert.equal(db.status, 'PENDING')
  assert.equal(db.subtotal.toFixed(2), '600.00')
  assert.equal(db.discount.toFixed(2), '201.00')
  assert.equal(db.lines[0]!.reservations[0]!.lotId, ctx.lotA)
  assert.equal((await asignacion(ctx.oferta1Alloc)).reservedQuantity, 1)
  ctx.ordenD = o.id
})

test('B2 · doble clic con la misma clave devuelve la misma orden y no reserva dos veces', async () => {
  const repetida = await comprar(ctx.cliente1, ctx.oferta1, 1, `b-${sufijo}`)
  assert.equal(repetida.id, ctx.ordenD)
  assert.equal(repetida.repetida, true)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 1, ISSUED: 0 })
})

// ── C · Cancelar ────────────────────────────────────────────────────────────

test('C · cancelar devuelve la unidad a ALLOCATED (nunca a AVAILABLE) y solo el dueño puede', async () => {
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, ctx.ordenD, ctx.cliente2, como(ctx.cliente2))), /no es tuya/)
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, ctx.ordenD, ctx.cliente1, como(ctx.cliente1)))
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 100, RESERVED: 0, ISSUED: 0 })
  assert.equal((await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: ctx.ordenD } })).status, 'CANCELLED')
  assert.equal((await asignacion(ctx.oferta1Alloc)).reservedQuantity, 0)
  // Cancelar dos veces no mueve nada más.
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, ctx.ordenD, ctx.cliente1, como(ctx.cliente1))), /no se puede pasar/)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 100, RESERVED: 0, ISSUED: 0 })
})

// ── D · Pago → derecho ──────────────────────────────────────────────────────

test('D · nuevo checkout, aviso de pago y confirmación: 99 ALLOCATED / 0 RESERVED / 1 ISSUED, orden PAID y 1 derecho del lote real', async () => {
  const o = await comprar(ctx.cliente1, ctx.oferta1, 1, `d-${sufijo}`)
  ctx.ordenD = o.id
  await sinEmpresa('prueba', (tx) => avisarPagoEnTx(tx, { orderId: o.id, customerId: ctx.cliente1, method: 'TRANSFER', reference: 'REF-123' }, como(ctx.cliente1)))
  assert.equal((await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: o.id } })).status, 'AWAITING_PAYMENT')
  // Monto que no cuadra: no se emite nada.
  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: 300 }, como(ctx.admin))), /no coincide/)
  assert.equal(await prisma.supplyV2Entitlement.count({ where: { orderId: o.id } }), 0)

  const pago = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: '399.00' }, como(ctx.admin)))
  assert.equal(pago.repetido, false)
  assert.equal(pago.entitlements.length, 1)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 0, ISSUED: 1 })
  const db = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: o.id } })
  assert.equal(db.status, 'PAID')
  assert.equal(db.paymentStatus, 'CONFIRMED')
  assert.ok(db.paidAt)
  const e = await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { orderId: o.id } })
  assert.equal(e.status, 'ACTIVE')
  assert.equal(e.customerId, ctx.cliente1)
  assert.equal(e.lotId, ctx.lotA)
  assert.equal(e.actualUnitCost.toFixed(2), '300.00')
  assert.equal(e.customerUnitPrice.toFixed(2), '399.00')
  assert.equal(e.quantity, 1)
  const a = await asignacion(ctx.oferta1Alloc)
  assert.deepEqual([a.reservedQuantity, a.issuedQuantity], [0, 1])
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_ENTITLEMENT_ISSUED', entidadId: e.id } }))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_ORDER_PAID', entidadId: o.id } }))
})

test('D2 · confirmar el pago dos veces (incluso a la vez) no emite dos derechos', async () => {
  const confirmar = () => sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: ctx.ordenD, amountSeen: 399 }, como(ctx.admin)))
  const [a, b] = await Promise.all([confirmar(), confirmar()])
  assert.equal(a.entitlements.length, 1)
  assert.equal(b.entitlements.length, 1)
  assert.equal(await prisma.supplyV2Entitlement.count({ where: { orderId: ctx.ordenD } }), 1)
  assert.deepEqual(await cubetasProducto(), { AVAILABLE: 900, ALLOCATED: 99, RESERVED: 0, ISSUED: 1 })
})

test('D3 · cambiar el precio de la oferta después no reescribe la compra ni el derecho', async () => {
  await prisma.supplyV2Offer.update({ where: { id: ctx.oferta1 }, data: { salePrice: 450 } })
  const db = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: ctx.ordenD }, include: { lines: true } })
  assert.equal(db.total.toFixed(2), '399.00')
  assert.equal(db.lines[0]!.saleUnitPrice.toFixed(2), '399.00')
  const e = await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { orderId: ctx.ordenD } })
  assert.equal(e.customerUnitPrice.toFixed(2), '399.00')
  await prisma.supplyV2Offer.update({ where: { id: ctx.oferta1 }, data: { salePrice: 399 } })
})

// ── E · Última unidad ───────────────────────────────────────────────────────

test('E · dos clientes por la última unidad: solo uno reserva', async () => {
  const o = await ofertaPublicada(1, { perCustomerLimit: 1 })
  const resultados = await Promise.allSettled([comprar(ctx.cliente1, o.id, 1), comprar(ctx.cliente2, o.id, 1)])
  const ganadores = resultados.filter((r) => r.status === 'fulfilled')
  const perdedores = resultados.filter((r) => r.status === 'rejected')
  assert.equal(ganadores.length, 1)
  assert.equal(perdedores.length, 1)
  assert.match(String((perdedores[0] as PromiseRejectedResult).reason?.message), /queda|agotó/)
  const a = await asignacion(o.allocationId)
  assert.deepEqual([a.allocatedQuantity, a.reservedQuantity], [1, 1])
  await lote(ctx.lotA)
})

test('E2 · límite 1 por persona: dos checkouts concurrentes del mismo cliente, solo uno pasa', async () => {
  const o = await ofertaPublicada(5, { perCustomerLimit: 1 })
  const resultados = await Promise.allSettled([comprar(ctx.cliente2, o.id, 1), comprar(ctx.cliente2, o.id, 1)])
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
  const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(rechazo.reason?.message), /máximo de 1 por persona/)
  assert.equal((await asignacion(o.allocationId)).reservedQuantity, 1)
  // Con 1 pagada, tampoco puede otra: cuentan pagadas y reservas vivas.
  const viva = await prisma.supplyV2CustomerOrder.findFirstOrThrow({ where: { customerId: ctx.cliente2, lines: { some: { offerId: o.id } }, status: 'PENDING' } })
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: viva.id, amountSeen: 399 }, como(ctx.admin)))
  await assert.rejects(comprar(ctx.cliente2, o.id, 1), /alcanzaste el máximo/)
})

// ── F · Expiración ──────────────────────────────────────────────────────────

test('F · el barrido expira la reserva caducada: RESERVED → ALLOCATED, orden EXPIRED; una segunda pasada no repite', async () => {
  const o = await ofertaPublicada(3)
  const compra = await comprar(ctx.cliente1, o.id, 2)
  assert.equal((await asignacion(o.allocationId)).reservedQuantity, 2)
  // Sin caducar, el barrido no la toca.
  await barridoSupplyV2()
  assert.equal((await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id } })).status, 'PENDING')
  // El arnés adelanta el reloj: la reserva venció hace un minuto.
  await prisma.supplyV2CustomerOrder.update({ where: { id: compra.id }, data: { expiresAt: new Date(Date.now() - 60_000) } })
  await barridoSupplyV2()
  // El barrido es GLOBAL y varios archivos de prueba lo llaman en paralelo: sus
  // contadores suman lo de todos, así que no son una afirmación segura. Lo que
  // se comprueba es el EFECTO sobre lo que esta prueba posee.
  const db = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id }, include: { lines: { include: { reservations: true } } } })
  assert.equal(db.status, 'EXPIRED')
  assert.ok(db.lines[0]!.reservations.every((r) => r.status === 'RELEASED'))
  const a = await asignacion(o.allocationId)
  assert.deepEqual([a.allocatedQuantity, a.reservedQuantity, a.issuedQuantity], [3, 0, 0])
  // «Una segunda pasada no repite» se comprueba sobre ESTA orden —el estado y
  // los números de la asignación no se mueven, y expirarla otra vez devuelve
  // false, dos líneas más abajo—, no sobre el contador global.
  await barridoSupplyV2()
  const trasSegunda = await asignacion(o.allocationId)
  assert.deepEqual([trasSegunda.allocatedQuantity, trasSegunda.reservedQuantity, trasSegunda.issuedQuantity], [3, 0, 0])
  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: compra.id, amountSeen: 798 }, como(ctx.admin))), /no se puede pasar/)
  // El barrido directo sobre una orden ya expirada tampoco duplica movimientos.
  assert.equal(await sinEmpresa('prueba', (tx) => expirarOrdenEnTx(tx, compra.id, como(null))), false)
  await lote(ctx.lotA)
})

test('F2 · un pago avisado NO expira: la reserva aguanta hasta que Membego revise; rechazarlo la suelta', async () => {
  const o = await ofertaPublicada(2)
  const compra = await comprar(ctx.cliente1, o.id, 1)
  await sinEmpresa('prueba', (tx) => avisarPagoEnTx(tx, { orderId: compra.id, customerId: ctx.cliente1, method: 'DEPOSIT', reference: 'DEP-1' }, como(ctx.cliente1)))
  await prisma.supplyV2CustomerOrder.update({ where: { id: compra.id }, data: { expiresAt: new Date(Date.now() - 60_000) } })
  await barridoSupplyV2()
  assert.equal((await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id } })).status, 'AWAITING_PAYMENT')
  await sinEmpresa('prueba', (tx) => rechazarPagoEnTx(tx, compra.id, 'No aparece la transferencia.', como(ctx.admin)))
  const db = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: compra.id } })
  assert.equal(db.status, 'CANCELLED')
  assert.equal(db.paymentStatus, 'REJECTED')
  assert.equal((await asignacion(o.allocationId)).reservedQuantity, 0)
})

// ── FEFO entre lotes y costo real ───────────────────────────────────────────

test('G · una oferta de 650 se financia con LOT-A (lo que queda) y LOT-B; comprar 3 toma primero el lote que vence antes', async () => {
  const disponiblesA = (await lote(ctx.lotA)).quantityAvailable
  const o = await ofertaPublicada(disponiblesA + 150, { perCustomerLimit: 10 })
  const lineas = await prisma.supplyV2AllocationLine.findMany({ where: { allocationId: o.allocationId }, orderBy: { quantity: 'desc' } })
  assert.equal(lineas.length, 2)
  assert.equal(lineas.find((l) => l.lotId === ctx.lotA)!.quantity, disponiblesA)
  assert.equal(lineas.find((l) => l.lotId === ctx.lotB)!.quantity, 150)
  assert.equal((await lote(ctx.lotA)).quantityAvailable, 0)
  assert.equal((await lote(ctx.lotB)).quantityAvailable, 250)

  const compra = await comprar(ctx.cliente2, o.id, 3)
  const reservas = await prisma.supplyV2OrderReservation.findMany({ where: { orderLine: { orderId: compra.id } } })
  assert.equal(reservas.length, 1)
  assert.equal(reservas[0]!.lotId, ctx.lotA)
  assert.equal(reservas[0]!.quantity, 3)
  const pago = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: compra.id, amountSeen: 1197 }, como(ctx.admin)))
  assert.equal(pago.entitlements.length, 3)
  assert.ok(pago.entitlements.every((e) => e.lotId === ctx.lotA && e.actualUnitCost === '300.00'))
})

test('G2 · cuando el lote que vence antes se agota, la compra se financia con el siguiente y el derecho congela SU costo (280)', async () => {
  // Oferta financiada solo con LOT-B (LOT-A ya no tiene disponibles).
  const o = await ofertaPublicada(5, { perCustomerLimit: 5 })
  const lineas = await prisma.supplyV2AllocationLine.findMany({ where: { allocationId: o.allocationId } })
  assert.equal(lineas.length, 1)
  assert.equal(lineas[0]!.lotId, ctx.lotB)
  const compra = await comprar(ctx.cliente1, o.id, 2)
  const pago = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: compra.id, amountSeen: 798 }, como(ctx.admin)))
  assert.equal(pago.entitlements.length, 2)
  assert.ok(pago.entitlements.every((e) => e.lotId === ctx.lotB && e.actualUnitCost === '280.00'))
  const e = await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { orderId: compra.id } })
  assert.equal(e.customerUnitPrice.toFixed(2), '399.00')
  await lote(ctx.lotB)
})

// ── Pausar / finalizar / cancelar oferta ────────────────────────────────────

test('H · pausada no vende y no libera; reanudar vuelve a vender', async () => {
  await sinEmpresa('prueba', (tx) => pausarOfertaEnTx(tx, ctx.oferta1, como(ctx.admin)))
  await assert.rejects(comprar(ctx.cliente2, ctx.oferta1, 1), /pausada/)
  assert.deepEqual([(await asignacion(ctx.oferta1Alloc)).allocatedQuantity, (await asignacion(ctx.oferta1Alloc)).releasedQuantity], [100, 0])
  await sinEmpresa('prueba', (tx) => reanudarOfertaEnTx(tx, ctx.oferta1, como(ctx.admin)))
  const c = await comprar(ctx.cliente2, ctx.oferta1, 1)
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, c.id, ctx.cliente2, como(ctx.cliente2)))
})

test('I · finalizar la oferta libera lo no usado (ALLOCATED → AVAILABLE) sin tocar lo emitido', async () => {
  const antes = await cubetasProducto()
  const a0 = await asignacion(ctx.oferta1Alloc)
  const libres = a0.allocatedQuantity - a0.reservedQuantity - a0.issuedQuantity - a0.releasedQuantity
  assert.equal(libres, 99)
  const r = await sinEmpresa('prueba', (tx) => cerrarOfertaEnTx(tx, ctx.oferta1, 'ENDED', 'Fin de campaña.', como(ctx.admin)))
  assert.equal(r.liberadas, 99)
  const despues = await cubetasProducto()
  assert.equal(despues.AVAILABLE, antes.AVAILABLE + 99)
  assert.equal(despues.ALLOCATED, antes.ALLOCATED - 99)
  assert.equal(despues.ISSUED, antes.ISSUED)
  const a1 = await asignacion(ctx.oferta1Alloc)
  assert.deepEqual([a1.status, a1.releasedQuantity, a1.issuedQuantity], ['ENDED', 99, 1])
  assert.equal(await prisma.supplyV2Entitlement.count({ where: { offerId: ctx.oferta1, status: 'ACTIVE' } }), 1)
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: ctx.oferta1 } })).status, 'ENDED')
  // Finalizar de nuevo no libera nada más.
  const r2 = await sinEmpresa('prueba', (tx) => cerrarOfertaEnTx(tx, ctx.oferta1, 'ENDED', 'otra vez', como(ctx.admin)))
  assert.equal(r2.liberadas, 0)
  await assert.rejects(comprar(ctx.cliente2, ctx.oferta1, 1), /terminó|no está disponible/)
})

test('J · una oferta futura no se puede comprar y una vencida tampoco; el barrido activa la programada', async () => {
  const futura = await ofertaPublicada(1, { perCustomerLimit: 1, startsAt: new Date(Date.now() + DIA) })
  assert.equal(futura.status, 'SCHEDULED')
  await assert.rejects(comprar(ctx.cliente1, futura.id, 1), /todavía no/)
  await prisma.supplyV2Offer.update({ where: { id: futura.id }, data: { startsAt: new Date(Date.now() - 1000) } })
  await barridoSupplyV2()
  // El barrido es GLOBAL y varios archivos de prueba lo llaman en paralelo: sus
  // contadores suman lo de todos, así que no son una afirmación segura. Lo que
  // se comprueba es el EFECTO sobre lo que esta prueba posee.
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: futura.id } })).status, 'ACTIVE')
  await prisma.supplyV2Offer.update({ where: { id: futura.id }, data: { endsAt: new Date(Date.now() - 1000) } })
  await assert.rejects(comprar(ctx.cliente1, futura.id, 1), /terminó/)
  await barridoSupplyV2()
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: futura.id } })).status, 'ENDED')
  assert.equal((await asignacion(futura.allocationId)).releasedQuantity, 1)
})

test('L · vendida la última unidad la oferta queda SOLD_OUT: desaparece del marketplace y no acepta más compras', async () => {
  const agotable = await ofertaPublicada(2, { perCustomerLimit: 2 })
  const antes = await ofertasPublicas(100)
  assert.ok(antes.some((o) => o.id === agotable.id && o.available && o.remaining === 2))
  const o = await comprar(ctx.cliente2, agotable.id, 2)
  await sinEmpresa('prueba', (tx) => avisarPagoEnTx(tx, { orderId: o.id, customerId: ctx.cliente2, method: 'TRANSFER', reference: 'REF-L' }, como(ctx.cliente2)))
  const pago = await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: '798.00' }, como(ctx.admin)))
  assert.equal(pago.entitlements.length, 2)
  const oferta = await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: agotable.id } })
  assert.equal(oferta.status, 'SOLD_OUT')
  assert.equal((await asignacion(agotable.allocationId)).status, 'EXHAUSTED')
  assert.ok(!(await ofertasPublicas(100)).some((x) => x.id === agotable.id), 'una oferta agotada no se lista')
  const ficha = await ofertaPublicaPorSlug(oferta.slug)
  assert.ok(ficha === null || ficha.available === false)
  await assert.rejects(comprar(ctx.cliente1, agotable.id, 1), /agotó|no está disponible/)
})

test('M · cancelar la oferta se rechaza con checkouts en curso; sin ellos libera lo no usado y conserva el derecho emitido', async () => {
  const cancelable = await ofertaPublicada(3, { perCustomerLimit: 3 })
  const pagada = await comprar(ctx.cliente1, cancelable.id, 1)
  await sinEmpresa('prueba', (tx) => avisarPagoEnTx(tx, { orderId: pagada.id, customerId: ctx.cliente1, method: 'TRANSFER', reference: 'REF-M' }, como(ctx.cliente1)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: pagada.id, amountSeen: 399 }, como(ctx.admin)))
  const enCurso = await comprar(ctx.cliente2, cancelable.id, 1)
  await assert.rejects(sinEmpresa('prueba', (tx) => cerrarOfertaEnTx(tx, cancelable.id, 'CANCELLED', 'Error de precio.', como(ctx.admin))), /checkouts en curso/)
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: cancelable.id } })).status, 'ACTIVE')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, enCurso.id, ctx.cliente2, como(ctx.cliente2)))

  const antes = await cubetasProducto()
  const r = await sinEmpresa('prueba', (tx) => cerrarOfertaEnTx(tx, cancelable.id, 'CANCELLED', 'Error de precio.', como(ctx.admin)))
  assert.equal(r.liberadas, 2)
  const despues = await cubetasProducto()
  assert.equal(despues.AVAILABLE, antes.AVAILABLE + 2)
  assert.equal(despues.ALLOCATED, antes.ALLOCATED - 2)
  assert.equal(despues.ISSUED, antes.ISSUED)
  const a = await asignacion(cancelable.allocationId)
  assert.deepEqual([a.status, a.releasedQuantity, a.issuedQuantity, a.reservedQuantity], ['CANCELLED', 2, 1, 0])
  assert.equal((await prisma.supplyV2Offer.findUniqueOrThrow({ where: { id: cancelable.id } })).status, 'CANCELLED')
  assert.equal((await prisma.supplyV2Entitlement.findFirstOrThrow({ where: { orderId: pagada.id } })).status, 'ACTIVE')
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_OFFER_CANCELLED', entidadId: cancelable.id } }))
  await assert.rejects(comprar(ctx.cliente1, cancelable.id, 1), /cancel|no está disponible/)
})

test('N · sin cron: el checkout de otro cliente expira por sí mismo la reserva caducada de la oferta y se queda la última unidad', async () => {
  const ultima = await ofertaPublicada(1, { perCustomerLimit: 1 })
  const abandonada = await comprar(ctx.cliente1, ultima.id, 1)
  await assert.rejects(comprar(ctx.cliente2, ultima.id, 1), /agotó|queda|unidades/)
  // El arnés adelanta el reloj: la reserva caducó y nadie ha corrido el barrido.
  await prisma.supplyV2CustomerOrder.update({ where: { id: abandonada.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  const ganadora = await comprar(ctx.cliente2, ultima.id, 1)
  assert.equal(ganadora.repetida, false)
  const [a, b] = await Promise.all([
    prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: abandonada.id } }),
    prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: ganadora.id } }),
  ])
  assert.equal(a.status, 'EXPIRED')
  assert.equal(b.status, 'PENDING')
  const al = await asignacion(ultima.allocationId)
  assert.deepEqual([al.allocatedQuantity, al.reservedQuantity, al.issuedQuantity], [1, 1, 0])
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_ORDER_EXPIRED', entidadId: abandonada.id } }))
  // El barrido después no vuelve a tocar nada de esta oferta.
  const r = await barridoSupplyV2()
  assert.equal((await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: ganadora.id } })).status, 'PENDING')
  assert.ok(r.ordenesExpiradas >= 0)
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, ganadora.id, ctx.cliente2, como(ctx.cliente2)))
})

test('K · el ledger de cada lote cuadra al final y la base no acepta contadores por encima de lo asignado', async () => {
  await lote(ctx.lotA)
  await lote(ctx.lotB)
  await assert.rejects(
    prisma.supplyV2Allocation.update({ where: { id: ctx.oferta1Alloc }, data: { issuedQuantity: 200 } }),
    /supply_v2_allocations_counters|check/i
  )
  await assert.rejects(
    prisma.supplyV2Offer.update({ where: { id: ctx.oferta1 }, data: { salePrice: 700 } }),
    /supply_v2_offers_prices|check/i
  )
})
