import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../../src/modules/supply-v2/procurement/orders'
import { confirmarRecepcionEnTx } from '../../src/modules/supply-v2/procurement/receipts'
import { crearOfertaEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { abrirOrdenClienteEnTx, avisarPagoEnTx, confirmarPagoEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { barridoSupplyV2 } from '../../src/modules/supply-v2/commerce/barrido'
import {
  abrirSesionQrEnTx,
  confirmarEntregaEnTx,
  emitirVoucherEnTx,
  previsualizarCanjeEnTx,
  reversarRedencionEnTx,
  type EmpleadoProveedor,
} from '../../src/modules/supply-v2/redemption/service'
import { cubetasDeLote, invarianteCumplido, saldoDeAsientos } from '../../src/modules/supply-v2/core/ledger'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 3 contra PostgreSQL de verdad (§68–§72).
 *
 *   Little Pizza (empresa registrada, 2 sucursales) vende 1.000 → oferta 100
 *   → Ana compra 2 y paga → 2 derechos ACTIVE.
 *   A  voucher → QR → preview → entrega → REDEEMED, lote issued −1 / redeemed +1
 *   B  el mismo QR otra vez → falla, sin efectos
 *   C  dos escáneres a la vez sobre el mismo QR → una sola redención
 *   D  QR expirado → falla sin efectos
 *   E  empleado de otro comercio → falla, y el preview no le enseña nada
 *   F  sucursal de otra empresa / distinta a la del QR → falla
 *   G  reversa → derecho ACTIVE, voucher utilizable, QR viejo muerto, nuevo QR entrega otra vez
 *   H  segunda reversa → falla; ledger cuadra al final
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = {
  admin: '',
  cliente: '',
  otroCliente: '',
  empresaId: '',
  otraEmpresaId: '',
  sucursalA: '',
  sucursalB: '',
  sucursalAjena: '',
  empleado: null as unknown as EmpleadoProveedor,
  empleadoAjeno: null as unknown as EmpleadoProveedor,
  supplierId: '',
  itemId: '',
  lotId: '',
  derecho1: '',
  derecho2: '',
  nonceA: '',
  redencionA: '',
}

async function lote(id: string) {
  const l = await prisma.supplyV2Lot.findUniqueOrThrow({ where: { id } })
  assert.ok(invarianteCumplido(l.quantityReceived, cubetasDeLote(l)), `invariante del lote ${l.code}`)
  const asientos = await prisma.supplyV2LedgerEntry.findMany({ where: { lotId: id } })
  assert.deepEqual(saldoDeAsientos(asientos), cubetasDeLote(l), `Σ asientos = cubetas del lote ${l.code}`)
  return l
}
const derecho = (id: string) => prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id } })
const abrirQr = (entitlementId: string, customerId = ctx.cliente, branchId: string | null = null) =>
  sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId, branchId, deviceInfo: 'test' }, como(customerId)))
const preview = (nonce: string, empleado = ctx.empleado, branchId: string | null = ctx.sucursalA) =>
  sinEmpresa('prueba', (tx) => previsualizarCanjeEnTx(tx, { nonce, empleado, branchId }, como(empleado.userId)))
const confirmar = (nonce: string, opciones: { empleado?: EmpleadoProveedor; branchId?: string | null; idempotencyKey?: string } = {}) => {
  const empleado = opciones.empleado ?? ctx.empleado
  return sinEmpresa('prueba', (tx) =>
    confirmarEntregaEnTx(tx, { nonce, empleado, branchId: opciones.branchId === undefined ? ctx.sucursalA : opciones.branchId, idempotencyKey: opciones.idempotencyKey ?? null, deviceInfo: 'scanner-test' }, como(empleado.userId))
  )
}

before(async () => {
  const [admin, aprobador, c1, c2, pedro, ajeno] = await Promise.all(
    (
      [
        ['admin', 'SUPERADMIN'],
        ['aprob', 'SUPERADMIN'],
        ['c1', 'CLIENTE'],
        ['c2', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
        ['ajeno', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s3-${k}-${sufijo}`, email: `s3-${k}-${sufijo}@prueba.test`, name: k === 'c1' ? 'Ana Cliente' : k === 'pedro' ? 'Pedro Encargado' : k, role }, select: { id: true } }))
  )
  ctx.admin = admin.id
  ctx.cliente = c1.id
  ctx.otroCliente = c2.id

  // Dos empresas registradas: Little Pizza (proveedora) y otra que también es proveedora, pero de otro producto.
  const empresa = await prisma.company.create({ data: { name: `Little Pizza S3 ${sufijo}`, slug: `little-pizza-s3-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  const otra = await prisma.company.create({ data: { name: `Otro Comercio S3 ${sufijo}`, slug: `otro-comercio-s3-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.empresaId = empresa.id
  ctx.otraEmpresaId = otra.id
  const [sa, sb, sx] = await Promise.all([
    prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Bávaro' }, select: { id: true } }),
    prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Punta Cana' }, select: { id: true } }),
    prisma.sucursal.create({ data: { companyId: otra.id, nombre: 'Ajena' }, select: { id: true } }),
  ])
  ctx.sucursalA = sa.id
  ctx.sucursalB = sb.id
  ctx.sucursalAjena = sx.id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })
  await prisma.user.update({ where: { id: ajeno.id }, data: { companyId: otra.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(admin.id))
    ctx.supplierId = p.id
    const ajenoProv = await vincularEmpresaComoProveedorEnTx(tx, otra.id, {}, como(admin.id))
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    ctx.empleadoAjeno = { userId: ajeno.id, companyId: otra.id, supplierId: ajenoProv.id }
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: 'Pizza Grande Pepperoni', publicPrice: 600 }, como(admin.id))
    ctx.itemId = item.id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) }, como(admin.id))
    await activarAcuerdoEnTx(tx, a.id, como(admin.id))
    const po = await crearOrdenEnTx(tx, { supplierId: p.id, agreementId: a.id, lines: [{ catalogItemId: item.id, quantity: 1000, unitCost: 300 }] }, como(admin.id))
    await enviarAprobacionEnTx(tx, po.id, como(admin.id))
    await aprobarOrdenEnTx(tx, po.id, como(aprobador.id))
    const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
    const r = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: 1000, expiresAt: new Date(ahora.getTime() + 60 * DIA) }] }, como(aprobador.id))
    ctx.lotId = r.lots[0]!.id
    // Un proveedor externo sin empresa también existe, para comprobar que no interfiere.
    await crearProveedorExternoEnTx(tx, { commercialName: `Externo S3 ${sufijo}` }, como(admin.id))
  })

  // Oferta de 100 y compra de 2 unidades, pagada.
  await sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaEnTx(tx, { catalogItemId: ctx.itemId, title: `Pizza Grande Pepperoni S3 ${sufijo}`, publicPrice: 600, salePrice: 399, quantity: 100, perCustomerLimit: 3, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) }, como(admin.id))
    await publicarOfertaEnTx(tx, o.id, como(admin.id))
    const orden = await abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: o.id, quantity: 2 }, como(ctx.cliente))
    await avisarPagoEnTx(tx, { orderId: orden.id, customerId: ctx.cliente, method: 'TRANSFER', reference: 'REF-S3' }, como(ctx.cliente))
    const pago = await confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: '798.00' }, como(admin.id))
    ctx.derecho1 = pago.entitlements[0]!.id
    ctx.derecho2 = pago.entitlements[1]!.id
  })
  const l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityAvailable, l.quantityAllocated, l.quantityIssued, l.quantityRedeemed], [900, 98, 2, 0])
})

// ── A ────────────────────────────────────────────────────────────────────────

test('A · voucher → QR → preview → entrega: derecho REDEEMED, lote issued −1 / redeemed +1, redención con quién, dónde y cuánto', async () => {
  const v = await sinEmpresa('prueba', (tx) => emitirVoucherEnTx(tx, ctx.derecho1, ctx.cliente, como(ctx.cliente)))
  assert.equal(v.reemitido, false)
  assert.ok(v.code.length >= 43)
  const v2 = await sinEmpresa('prueba', (tx) => emitirVoucherEnTx(tx, ctx.derecho1, ctx.cliente, como(ctx.cliente)))
  assert.equal(v2.id, v.id, 'un derecho tiene un solo voucher activo')

  const qr = await abrirQr(ctx.derecho1)
  ctx.nonceA = qr.nonce
  assert.equal(qr.voucherId, v.id)
  assert.ok(qr.expiresAt.getTime() > Date.now() + 4 * 60_000, 'TTL de 5 minutos')

  const p = await preview(qr.nonce)
  assert.equal(p.valid, true, p.message ?? 'preview')
  assert.equal(p.customerName, 'Ana Cliente')
  assert.equal(p.productName, 'Pizza Grande Pepperoni')
  assert.equal(p.branchName, 'Bávaro')
  assert.equal(p.customerPaysMerchant, '0.00')
  assert.ok(!('actualUnitCost' in p) && !('lotId' in p), 'el preview no lleva costos ni lotes')
  // El preview no cambia nada.
  assert.equal((await derecho(ctx.derecho1)).status, 'ACTIVE')
  assert.equal((await prisma.supplyV2QrSession.findUniqueOrThrow({ where: { nonce: qr.nonce } })).consumedAt, null)

  const r = await confirmar(qr.nonce, { idempotencyKey: `a-${sufijo}` })
  ctx.redencionA = r.id
  assert.equal(r.repetida, false)
  assert.match(r.number, /^MBG-RD-\d{4}-\d{6}$/)
  assert.equal((await derecho(ctx.derecho1)).status, 'REDEEMED')
  assert.equal((await prisma.supplyV2Voucher.findUniqueOrThrow({ where: { id: v.id } })).status, 'REDEEMED')
  const sesion = await prisma.supplyV2QrSession.findUniqueOrThrow({ where: { nonce: qr.nonce } })
  assert.ok(sesion.consumedAt)
  assert.equal(sesion.consumedByUserId, ctx.empleado.userId)
  const l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [1, 1])
  const red = await prisma.supplyV2Redemption.findUniqueOrThrow({ where: { id: r.id } })
  assert.deepEqual([red.customerId, red.supplierId, red.branchId, red.employeeId, red.lotId, red.quantity], [ctx.cliente, ctx.supplierId, ctx.sucursalA, ctx.empleado.userId, ctx.lotId, 1])
  assert.equal(red.unitCostSnapshot.toFixed(2), '300.00')
  assert.equal(red.customerUnitPriceSnapshot.toFixed(2), '399.00')
  assert.equal(red.customerPaysMerchant.toFixed(2), '0.00')
  assert.ok(await prisma.supplyV2LedgerEntry.findFirst({ where: { referenceType: 'REDEMPTION', referenceId: r.id, type: 'REDEMPTION' } }))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_REDEMPTION_CONFIRMED', entidadId: r.id } }))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_QR_SESSION_CONSUMED', entidadId: sesion.id } }))
})

test('A2 · reenviar la misma confirmación (timeout del escáner) devuelve la misma redención', async () => {
  const r = await confirmar(ctx.nonceA, { idempotencyKey: `a-${sufijo}` })
  assert.equal(r.repetida, true)
  assert.equal(r.id, ctx.redencionA)
  assert.equal(await prisma.supplyV2Redemption.count({ where: { entitlementId: ctx.derecho1 } }), 1)
  await assert.rejects(confirmar(ctx.nonceA, { empleado: ctx.empleadoAjeno, idempotencyKey: `a-${sufijo}` }), /no es tuya/)
})

// ── B ────────────────────────────────────────────────────────────────────────

test('B · el mismo QR una segunda vez falla como «ya utilizado» y no toca nada', async () => {
  const p = await preview(ctx.nonceA)
  assert.equal(p.valid, false)
  assert.equal(p.reason, 'ALREADY_REDEEMED')
  assert.equal(p.message, 'Este beneficio ya fue utilizado.')
  await assert.rejects(confirmar(ctx.nonceA, { idempotencyKey: `b-${sufijo}` }), /ya fue utilizado/)
  const l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [1, 1])
  assert.equal(await prisma.supplyV2Redemption.count({ where: { entitlementId: ctx.derecho1 } }), 1)
  // Tampoco se puede abrir otro QR de un derecho utilizado.
  await assert.rejects(abrirQr(ctx.derecho1), /ya fue utilizado/)
})

// ── C ────────────────────────────────────────────────────────────────────────

test('C · dos escáneres confirman el mismo QR a la vez: una redención, un asiento, un éxito y un «ya utilizado»', async () => {
  const qr = await abrirQr(ctx.derecho2)
  const resultados = await Promise.allSettled([confirmar(qr.nonce, { idempotencyKey: `c1-${sufijo}` }), confirmar(qr.nonce, { idempotencyKey: `c2-${sufijo}` })])
  const ok = resultados.filter((r) => r.status === 'fulfilled')
  const ko = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  assert.equal(ok.length, 1)
  assert.equal(ko.length, 1)
  assert.match(String(ko[0]!.reason?.message), /ya fue utilizado|ya se usó/)
  assert.equal(await prisma.supplyV2Redemption.count({ where: { entitlementId: ctx.derecho2, reversedAt: null } }), 1)
  assert.equal(await prisma.supplyV2LedgerEntry.count({ where: { lotId: ctx.lotId, type: 'REDEMPTION' } }), 2)
  const l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [0, 2])
  // Deshacer para los recorridos siguientes: reversa legítima.
  const red = await prisma.supplyV2Redemption.findFirstOrThrow({ where: { entitlementId: ctx.derecho2, reversedAt: null } })
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, red.id, 'Prueba de concurrencia: se deshace.', como(ctx.admin)))
  assert.equal((await derecho(ctx.derecho2)).status, 'ACTIVE')
})

test('C2 · dos escáneres con el mismo nonce en PREVIEW no consumen nada; el primero en confirmar gana', async () => {
  const qr = await abrirQr(ctx.derecho2)
  const [p1, p2] = await Promise.all([preview(qr.nonce), preview(qr.nonce)])
  assert.equal(p1.valid, true)
  assert.equal(p2.valid, true)
  assert.equal((await prisma.supplyV2QrSession.findUniqueOrThrow({ where: { nonce: qr.nonce } })).consumedAt, null)
  const r = await confirmar(qr.nonce)
  assert.equal(r.repetida, false)
  await assert.rejects(confirmar(qr.nonce), /ya fue utilizado/)
  await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, r.id, 'Prueba: se deshace.', como(ctx.admin)))
})

// ── D ────────────────────────────────────────────────────────────────────────

test('D · un QR expirado falla sin efectos: ni el voucher ni el derecho ni el ledger cambian', async () => {
  const qr = await abrirQr(ctx.derecho2)
  // El arnés adelanta el reloj: la sesión se abrió hace 6 minutos y venció hace 1.
  await prisma.supplyV2QrSession.update({ where: { id: qr.id }, data: { createdAt: new Date(Date.now() - 6 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
  const p = await preview(qr.nonce)
  assert.equal(p.reason, 'QR_EXPIRED')
  await assert.rejects(confirmar(qr.nonce), /expiró/)
  assert.equal((await derecho(ctx.derecho2)).status, 'ACTIVE')
  assert.equal((await prisma.supplyV2Voucher.findUniqueOrThrow({ where: { id: qr.voucherId } })).status, 'ACTIVE')
  const l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [1, 1])
  // «Generar nuevo QR»: mismo voucher, sesión nueva; la vieja sigue muerta.
  const qr2 = await abrirQr(ctx.derecho2)
  assert.equal(qr2.voucherId, qr.voucherId)
  assert.notEqual(qr2.nonce, qr.nonce)
  assert.equal((await preview(qr2.nonce)).valid, true)
  assert.equal((await preview(qr.nonce)).reason, 'QR_EXPIRED')
})

test('D2 · un nonce con formato válido pero desconocido, o un id de Prisma, es «código no válido»', async () => {
  const p = await preview('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  assert.equal(p.reason, 'INVALID_QR')
  assert.equal((await preview(ctx.derecho2)).reason, 'INVALID_QR')
  await assert.rejects(confirmar(ctx.derecho2), /no válido/)
})

// ── E ────────────────────────────────────────────────────────────────────────

test('E · el empleado de otro comercio no puede ni ver ni entregar', async () => {
  const qr = await abrirQr(ctx.derecho2)
  const p = await preview(qr.nonce, ctx.empleadoAjeno, ctx.sucursalAjena)
  assert.equal(p.valid, false)
  assert.equal(p.reason, 'WRONG_SUPPLIER')
  assert.equal(p.customerName, undefined, 'el preview rechazado no filtra al cliente')
  await assert.rejects(confirmar(qr.nonce, { empleado: ctx.empleadoAjeno, branchId: ctx.sucursalAjena }), /otro comercio/)
  assert.equal((await derecho(ctx.derecho2)).status, 'ACTIVE')
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_REDEMPTION_REJECTED', companyId: ctx.otraEmpresaId } }))
})

// ── F ────────────────────────────────────────────────────────────────────────

test('F · sucursal incorrecta: de otra empresa, ninguna, o distinta a la que el cliente eligió en su QR', async () => {
  const qr = await abrirQr(ctx.derecho2)
  assert.equal((await preview(qr.nonce, ctx.empleado, ctx.sucursalAjena)).reason, 'WRONG_BRANCH')
  await assert.rejects(confirmar(qr.nonce, { branchId: ctx.sucursalAjena }), /esta sucursal/)
  assert.equal((await preview(qr.nonce, ctx.empleado, null)).reason, 'BRANCH_REQUIRED')
  // QR abierto para Punta Cana: en Bávaro no vale, en Punta Cana sí.
  const qrB = await abrirQr(ctx.derecho2, ctx.cliente, ctx.sucursalB)
  assert.equal((await preview(qrB.nonce, ctx.empleado, ctx.sucursalA)).reason, 'WRONG_BRANCH')
  await assert.rejects(confirmar(qrB.nonce, { branchId: ctx.sucursalA }), /esta sucursal/)
  assert.equal((await preview(qrB.nonce, ctx.empleado, ctx.sucursalB)).valid, true)
  // El cliente no puede elegir una sucursal de otra empresa.
  await assert.rejects(abrirQr(ctx.derecho2, ctx.cliente, ctx.sucursalAjena), /sucursal/)
  assert.equal((await derecho(ctx.derecho2)).status, 'ACTIVE')
})

test('F2 · ownership: otro cliente no genera QR de un derecho ajeno', async () => {
  await assert.rejects(abrirQr(ctx.derecho2, ctx.otroCliente), /no es tuyo/)
  await assert.rejects(sinEmpresa('prueba', (tx) => emitirVoucherEnTx(tx, ctx.derecho2, ctx.otroCliente, como(ctx.otroCliente))), /no es tuyo/)
})

// ── G ────────────────────────────────────────────────────────────────────────

test('G · reversa: derecho ACTIVE, voucher utilizable, el QR viejo no revive, un QR nuevo entrega otra vez y el ledger vuelve y va', async () => {
  const qr = await abrirQr(ctx.derecho2, ctx.cliente, ctx.sucursalA)
  const r = await confirmar(qr.nonce)
  assert.equal((await derecho(ctx.derecho2)).status, 'REDEEMED')
  await assert.rejects(sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, r.id, '   ', como(ctx.admin))), /motivo/)

  const rev = await sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, r.id, 'Entrega marcada por error.', como(ctx.admin)))
  assert.equal(rev.voucherReactivado, true)
  const red = await prisma.supplyV2Redemption.findUniqueOrThrow({ where: { id: r.id } })
  assert.ok(red.reversedAt)
  assert.equal(red.reversedById, ctx.admin)
  assert.equal(red.reversalReason, 'Entrega marcada por error.')
  assert.equal((await derecho(ctx.derecho2)).status, 'ACTIVE')
  assert.equal((await prisma.supplyV2Voucher.findUniqueOrThrow({ where: { id: qr.voucherId } })).status, 'ACTIVE')
  let l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [1, 1])
  assert.ok(await prisma.supplyV2LedgerEntry.findFirst({ where: { referenceType: 'REDEMPTION', referenceId: r.id, type: 'REVERSAL' } }))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_REDEMPTION_REVERSED', entidadId: r.id } }))

  // El QR viejo sigue consumido: no revive.
  assert.equal((await preview(qr.nonce)).reason, 'QR_CONSUMED')
  await assert.rejects(confirmar(qr.nonce), /ya se usó|no válido/)

  // Nuevo QR obligatorio: mismo voucher, y la entrega vuelve a funcionar.
  const qr2 = await abrirQr(ctx.derecho2, ctx.cliente, ctx.sucursalA)
  assert.equal(qr2.voucherId, qr.voucherId)
  const r2 = await confirmar(qr2.nonce)
  assert.equal(r2.repetida, false)
  assert.notEqual(r2.id, r.id)
  assert.equal((await derecho(ctx.derecho2)).status, 'REDEEMED')
  l = await lote(ctx.lotId)
  assert.deepEqual([l.quantityIssued, l.quantityRedeemed], [0, 2])
  assert.equal(await prisma.supplyV2Redemption.count({ where: { entitlementId: ctx.derecho2, reversedAt: null } }), 1)
  ctx.redencionA = r2.id
})

// ── H ────────────────────────────────────────────────────────────────────────

test('H · la segunda reversa falla y no duplica ledger; la base rechaza una segunda redención viva del mismo derecho', async () => {
  const primera = await prisma.supplyV2Redemption.findFirstOrThrow({ where: { entitlementId: ctx.derecho2, reversedAt: { not: null } } })
  await assert.rejects(sinEmpresa('prueba', (tx) => reversarRedencionEnTx(tx, primera.id, 'otra vez', como(ctx.admin))), /ya fue reversada/)
  const asientos = await prisma.supplyV2LedgerEntry.count({ where: { referenceType: 'REDEMPTION', referenceId: primera.id } })
  assert.equal(asientos, 2, 'una redención y una reversa, nada más')
  // Índice único parcial: dos redenciones vivas del mismo derecho no caben.
  const viva = await prisma.supplyV2Redemption.findFirstOrThrow({ where: { id: ctx.redencionA } })
  await assert.rejects(
    prisma.supplyV2Redemption.create({
      data: {
        number: `MBG-RD-9999-${sufijo.slice(0, 6)}`,
        entitlementId: viva.entitlementId,
        voucherId: viva.voucherId,
        qrSessionId: viva.qrSessionId + 'x',
        customerId: viva.customerId,
        supplierId: viva.supplierId,
        catalogItemId: viva.catalogItemId,
        lotId: viva.lotId,
        employeeId: viva.employeeId,
        unitCostSnapshot: 300,
        customerUnitPriceSnapshot: 399,
      },
    }),
    /supply_v2_redemptions_entitlement_viva|Unique constraint|Foreign key/
  )
})

test('I · el barrido vence derechos y vouchers caducados, y una segunda pasada no repite', async () => {
  // Un derecho NUEVO, ACTIVE y con su unidad ISSUED en el ledger: el arnés solo
  // adelanta su reloj. Desde el Slice 4 vencer un derecho también cierra su
  // unidad (ISSUED → CLOSED), así que el estado tiene que ser coherente.
  const oferta = await prisma.supplyV2Offer.findFirstOrThrow({ where: { catalogItemId: ctx.itemId }, select: { id: true } })
  const derecho3 = await sinEmpresa('prueba', async (tx) => {
    const orden = await abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: oferta.id, quantity: 1 }, como(ctx.cliente))
    const pago = await confirmarPagoEnTx(tx, { orderId: orden.id, amountSeen: '399.00' }, como(ctx.admin))
    return pago.entitlements[0]!.id
  })
  await emitirVoucherEnTx_(derecho3)
  const antes = await lote(ctx.lotId)
  await prisma.supplyV2Entitlement.update({ where: { id: derecho3 }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await prisma.supplyV2Voucher.updateMany({ where: { entitlementId: derecho3, status: 'ACTIVE' }, data: { validFrom: new Date(Date.now() - 2 * DIA), validUntil: new Date(Date.now() - 1000) } })
  const r = await barridoSupplyV2()
  assert.ok(r.derechosVencidos >= 1)
  assert.equal((await derecho(derecho3)).status, 'EXPIRED')
  assert.equal(await prisma.supplyV2Voucher.count({ where: { entitlementId: derecho3, status: 'ACTIVE' } }), 0)
  const despues = await lote(ctx.lotId)
  assert.equal(despues.quantityIssued, antes.quantityIssued - 1, 'ISSUED −1')
  assert.equal(despues.quantityClosed, antes.quantityClosed + 1, 'CLOSED +1')
  const r2 = await barridoSupplyV2()
  assert.equal(r2.derechosVencidos, 0)
  await assert.rejects(abrirQr(derecho3), /venció/)
})

const emitirVoucherEnTx_ = (entitlementId: string) => sinEmpresa('prueba', (tx) => emitirVoucherEnTx(tx, entitlementId, ctx.cliente, como(ctx.cliente)))

test('J · el ledger de cada lote cuadra al final', async () => {
  const l = await lote(ctx.lotId)
  assert.equal(l.quantityReceived, 1000)
})
