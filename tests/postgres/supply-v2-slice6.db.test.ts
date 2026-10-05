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
import { crearOfertaComisionEnTx, crearOfertaEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import {
  abrirOrdenClienteEnTx,
  cancelarOrdenClienteEnTx,
  confirmarCoberturaTotalEnTx,
  confirmarPagoEnTx,
  expirarOrdenEnTx,
} from '../../src/modules/supply-v2/commerce/checkout'
import { abrirSesionQrEnTx, confirmarEntregaEnTx, type EmpleadoProveedor } from '../../src/modules/supply-v2/redemption/service'
import {
  aprobarBeneficioEnTx,
  asignarBeneficioEnTx,
  cancelarAsignacionEnTx,
  cancelarBeneficioEnTx,
  crearBeneficioEnTx,
  expirarBeneficiosEnTx,
  pausarBeneficioEnTx,
  reanudarBeneficioEnTx,
  recalcularPresupuestoEnTx,
  reversarAplicacionBeneficioEnTx,
} from '../../src/modules/supply-v2/benefits/service'
import { generarLiquidacionEnTx } from '../../src/modules/supply-v2/finance/settlements'
import { calcularEconomia } from '../../src/modules/supply-v2/economics/queries'
import { beneficiosParaOferta, fichaBeneficio, misBeneficios } from '../../src/modules/supply-v2/benefits/queries'
import { barridoSupplyV2 } from '../../src/modules/supply-v2/commerce/barrido'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 contra PostgreSQL de verdad (§36).
 *
 *   A  Bono parcial: 1 000 − 500 = 500 a pagar; comisión 80 sobre el valor
 *      contractual, neto 920, presupuesto reservado → consumido, ledger cuadrado
 *   B  Cobertura total: saldo 0, el cliente confirma sin pago bancario
 *   C  Financiación compartida: 1 000 − 100 (proveedor) − 300 (Membego) = 600
 *   D  Dos checkouts a la vez con el MISMO bono de un uso: solo uno pasa
 *   E  Presupuesto al límite bajo concurrencia; EXHAUSTED; liberar reactiva
 *   F  Vencimientos y cancelaciones: beneficio vencido, asignación retirada,
 *      cancelación bloqueada con reservas vivas
 *   G  Comisión: el neto del proveedor NO baja por el bono; base CUSTOMER_PAID_AMOUNT
 *   H  Precompra: solo bono de Membego; el descuento del proveedor se rechaza
 *   I  Canje: el QR de siempre, con la foto de la financiación en la redención
 *   J  Liquidación y economía: GMV, contractual, subsidio, cobros, contribución
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
  tours: { supplierId: '', itemId: '', itemPago: '', agreementId: '', agreementPago: '', offerId: '', offerPago: '', offerShared: '', offerCupo: '' },
  pizza: { supplierId: '', itemId: '', agreementId: '', lotId: '', offerId: '' },
}

async function ofertaComision(itemId: string, d: { salePrice?: number; publicPrice?: number; titulo?: string; perCustomerLimit?: number; cantidad?: number | null }) {
  return sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaComisionEnTx(
      tx,
      {
        catalogItemId: itemId,
        title: `${d.titulo ?? 'Excursión'} ${sufijo}`,
        publicPrice: d.publicPrice ?? 1200,
        salePrice: d.salePrice ?? 1000,
        availabilityMode: d.cantidad == null ? 'UNLIMITED' : 'FIXED_QUANTITY',
        availabilityQuantity: d.cantidad ?? null,
        perCustomerLimit: d.perCustomerLimit ?? 5,
        startsAt: new Date(ahora.getTime() - 60_000),
        endsAt: new Date(ahora.getTime() + 30 * DIA),
      },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return o.id
  })
}

/** Crea un beneficio y lo deja ACTIVE (lo aprueba OTRA persona, §34). */
async function beneficioActivo(d: Parameters<typeof crearBeneficioEnTx>[1]): Promise<string> {
  const b = await sinEmpresa('prueba', (tx) => crearBeneficioEnTx(tx, d, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas)))
  return b.id
}
const asignar = (benefitId: string, customerId: string, d: { usesAllowed?: number | null; expiresAt?: Date | null } = {}) =>
  sinEmpresa('prueba', (tx) => asignarBeneficioEnTx(tx, { benefitId, customerId, ...d }, como(ctx.compras)))

async function comprarConBeneficio(offerId: string, customerId: string, customerBenefitId: string | null, quantity = 1) {
  return sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity, customerBenefitId }, como(customerId)))
}
const confirmar = (orderId: string, amountSeen: string) => sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId, amountSeen }, como(ctx.finanzas)))
const beneficioDe = (id: string) => prisma.supplyV2Benefit.findUniqueOrThrow({ where: { id } })
const reservaDeOrden = (orderId: string) => prisma.supplyV2BenefitReservation.findFirstOrThrow({ where: { orderId } })

async function redimir(entitlementId: string, customerId: string): Promise<string> {
  const s = await sinEmpresa('prueba', (tx) => abrirSesionQrEnTx(tx, { entitlementId, customerId, branchId: ctx.sucursal }, como(customerId)))
  const r = await sinEmpresa('prueba', (tx) => confirmarEntregaEnTx(tx, { nonce: s.nonce, empleado: ctx.empleado, branchId: ctx.sucursal }, como(ctx.empleado.userId)))
  return r.id
}

before(async () => {
  const [compras, finanzas, c1, c2, pedro] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['c1', 'CLIENTE'],
        ['c2', 'CLIENTE'],
        ['pedro', 'ADMINISTRADOR'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-s6-${k}-${sufijo}`, email: `s6-${k}-${sufijo}@prueba.test`, name: `s6 ${k}`, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = c1.id
  ctx.cliente2 = c2.id
  const empresa = await prisma.company.create({ data: { name: `Tours S6 ${sufijo}`, slug: `tours-s6-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.empresaId = empresa.id
  ctx.sucursal = (await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Bávaro' }, select: { id: true } })).id
  await prisma.user.update({ where: { id: pedro.id }, data: { companyId: empresa.id } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.tours.supplierId = p.id
    ctx.empleado = { userId: pedro.id, companyId: empresa.id, supplierId: p.id }
    ctx.tours.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: 'Excursión Saona S6', category: 'Tours', publicPrice: 1200 }, como(ctx.compras))).id
    ctx.tours.itemPago = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'SERVICE', name: 'Excursión Samaná S6', category: 'Viajes', publicPrice: 1200 }, como(ctx.compras))).id
    // Acuerdo a comisión sobre el valor contractual (el de fábrica).
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'ITEM', catalogItemId: ctx.tours.itemId, commissionPercentage: 8, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    ctx.tours.agreementId = a.id
    // Acuerdo a comisión sobre lo que PAGA EL CLIENTE (§14).
    const b = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'ITEM', catalogItemId: ctx.tours.itemPago, commissionPercentage: 8, commissionBase: 'CUSTOMER_PAID_AMOUNT', startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, b.id, como(ctx.finanzas))
    ctx.tours.agreementPago = b.id

    // Proveedor de PRECOMPRA (Slices 1–4): su mundo no cambia.
    const pz = await crearProveedorExternoEnTx(tx, { commercialName: `Pizza S6 ${sufijo}` }, como(ctx.compras))
    ctx.pizza.supplierId = pz.id
    ctx.pizza.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: pz.id, type: 'PRODUCT', name: 'Pizza S6', publicPrice: 600 }, como(ctx.compras))).id
    const ap = await crearAcuerdoEnTx(tx, { supplierId: pz.id, type: 'PREPAID_PURCHASE', catalogItemId: ctx.pizza.itemId, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, ap.id, como(ctx.finanzas))
    ctx.pizza.agreementId = ap.id
    const po = await crearOrdenEnTx(tx, { supplierId: pz.id, agreementId: ap.id, lines: [{ catalogItemId: ctx.pizza.itemId, quantity: 10, unitCost: 300 }], paymentMode: 'PREPAID' }, como(ctx.compras))
    await enviarAprobacionEnTx(tx, po.id, como(ctx.compras))
    await aprobarOrdenEnTx(tx, po.id, como(ctx.finanzas))
    const linea = await tx.supplyV2PurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id }, select: { id: true } })
    const r = await confirmarRecepcionEnTx(tx, { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: linea.id, quantity: 10, expiresAt: new Date(ahora.getTime() + 60 * DIA) }] }, como(ctx.finanzas))
    ctx.pizza.lotId = r.lots[0]!.id
    const of = await crearOfertaEnTx(tx, { catalogItemId: ctx.pizza.itemId, title: `Pizza S6 ${sufijo}`, publicPrice: 600, salePrice: 500, quantity: 8, perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000) }, como(ctx.compras))
    await publicarOfertaEnTx(tx, of.id, como(ctx.compras))
    ctx.pizza.offerId = of.id
  })
  ctx.tours.offerId = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona' })
  ctx.tours.offerPago = await ofertaComision(ctx.tours.itemPago, { titulo: 'Samaná' })
})

// ── Alta, aprobación y asignación (§7, §10, §34) ────────────────────────────

test('alta: el beneficio nace BORRADOR, con código propio, y NO lo aprueba quien lo creó', async () => {
  const b = await sinEmpresa('prueba', (tx) =>
    crearBeneficioEnTx(tx, { name: 'Bono bienvenida', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 500, scope: 'SPECIFIC_OFFER', offerId: ctx.tours.offerId, budgetTotal: 10_000, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
  )
  assert.equal(b.status, 'DRAFT')
  assert.match(b.code, /^MBG-BN-\d{4}-\d{6}$/)
  // Un borrador no rebaja nada: no se puede usar todavía.
  await asignar(b.id, ctx.cliente)
  await assert.rejects(comprarConBeneficio(ctx.tours.offerId, ctx.cliente, (await prisma.supplyV2CustomerBenefit.findFirstOrThrow({ where: { benefitId: b.id, customerId: ctx.cliente } })).id), /no está activo/)
  await sinEmpresa('prueba', (tx) => aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas)))
  const activo = await beneficioDe(b.id)
  assert.equal(activo.status, 'ACTIVE')
  assert.equal(activo.approvedById, ctx.finanzas)
  // Idempotente: aprobar dos veces no rompe nada.
  assert.equal((await sinEmpresa('prueba', (tx) => aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas)))).repetido, true)
  await sinEmpresa('prueba', (tx) => cancelarBeneficioEnTx(tx, b.id, 'fin de la prueba de alta', como(ctx.finanzas)))
})

test('asignación: solo a clientes, idempotente, con usos dentro del límite y vencimiento acotado', async () => {
  const id = await beneficioActivo({ name: 'Bono asignable', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 100, scope: 'SPECIFIC_OFFER', offerId: ctx.tours.offerId, perCustomerLimit: 2, endsAt: new Date(ahora.getTime() + 10 * DIA), startsAt: new Date(ahora.getTime() - DIA) })
  await assert.rejects(asignar(id, ctx.compras), /no es un cliente/)
  const g1 = await asignar(id, ctx.cliente, { usesAllowed: 2 })
  const g2 = await asignar(id, ctx.cliente)
  assert.equal(g2.repetida, true)
  assert.equal(g2.id, g1.id)
  await assert.rejects(asignar(id, ctx.cliente2, { usesAllowed: 3 }), /entre 1 y 2/)
  await assert.rejects(asignar(id, ctx.cliente2, { expiresAt: new Date(ahora.getTime() + 20 * DIA) }), /vencer después/)
  // El ledger registra la asignación aunque no mueva presupuesto.
  const movs = await prisma.supplyV2BenefitMovement.findMany({ where: { benefitId: id, type: 'GRANTED' } })
  assert.equal(movs.length, 1)
  assert.equal(movs[0]!.reservedDelta.toFixed(2), '0.00')
})

// ── A · bono parcial de punta a punta ───────────────────────────────────────

test('A · bono parcial: 1 000 − 500 = 500 a pagar; comisión 80 y neto 920 sobre el valor contractual', async () => {
  const id = await beneficioActivo({ name: 'Bono 500 Saona', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 500, scope: 'SPECIFIC_OFFER', offerId: ctx.tours.offerId, budgetTotal: 10_000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente)

  // Lo que el cliente ve ANTES de comprar coincide con lo que se congela.
  const vista = await beneficiosParaOferta(ctx.cliente, ctx.tours.offerId, 1)
  const mio = vista.find((v) => v.benefitId === id)!
  assert.ok(mio, 'el bono asignado aparece en la vista previa de la oferta')
  assert.deepEqual([mio.bonoMembego, mio.aPagar, mio.cubreTodo], ['500.00', '500.00', false])
  // La vista ordena por lo que más rebaja: el bono de 500 va primero.
  assert.equal(vista[0]!.benefitId, id)

  const orden = await comprarConBeneficio(ctx.tours.offerId, ctx.cliente, g.id)
  assert.equal(orden.total, '500.00')
  const o = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id }, include: { lines: true } })
  assert.deepEqual(
    [o.total.toFixed(2), o.contractualValue.toFixed(2), o.supplierDiscountTotal.toFixed(2), o.membegoSubsidyTotal.toFixed(2), o.commissionAmount?.toFixed(2), o.supplierNet?.toFixed(2), o.commissionBase],
    ['500.00', '1000.00', '0.00', '500.00', '80.00', '920.00', 'CONTRACTUAL_SALE_VALUE']
  )
  assert.ok(o.benefitFundingSnapshot, 'la orden guarda la foto del reparto (§15)')
  assert.equal(o.lines[0]!.benefitId, id)

  // Presupuesto RESERVADO, no consumido: todavía no hay pago.
  const reservado = await beneficioDe(id)
  assert.deepEqual([reservado.budgetReserved.toFixed(2), reservado.budgetConsumed.toFixed(2)], ['500.00', '0.00'])
  const r = await reservaDeOrden(orden.id)
  assert.deepEqual([r.status, r.membegoAmount.toFixed(2), r.supplierAmount.toFixed(2)], ['ACTIVE', '500.00', '0.00'])

  // El monto que se confirma es el que paga el cliente, no el valor contractual.
  await assert.rejects(confirmar(orden.id, '1000.00'), /no coincide/)
  const pago = await confirmar(orden.id, '500.00')
  assert.equal(pago.entitlements.length, 1)

  const consumido = await beneficioDe(id)
  assert.deepEqual([consumido.budgetReserved.toFixed(2), consumido.budgetConsumed.toFixed(2)], ['0.00', '500.00'])
  assert.equal((await reservaDeOrden(orden.id)).status, 'APPLIED')
  const asignacion = await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: g.id } })
  assert.deepEqual([asignacion.usesConsumed, asignacion.status], [1, 'EXHAUSTED'])

  // El derecho guarda las dos cifras separadas: lo que pagó el cliente y el valor contractual.
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: pago.entitlements[0]!.id } })
  assert.deepEqual([d.customerUnitPrice.toFixed(2), d.contractualUnitValue.toFixed(2), d.membegoSubsidyAmount.toFixed(2), d.supplierNet?.toFixed(2)], ['500.00', '1000.00', '500.00', '920.00'])

  // Economía: el subsidio es su propio evento, nunca un descuento del ingreso.
  const eventos = await prisma.supplyV2EconomicEvent.findMany({ where: { entitlementId: d.id }, orderBy: { occurredAt: 'asc' } })
  const venta = eventos.find((e) => e.type === 'COMMISSION_REVENUE')!
  const subsidio = eventos.find((e) => e.type === 'MEMBEGO_SUBSIDY')!
  assert.deepEqual([venta.gmvAmount.toFixed(2), venta.revenueAmount.toFixed(2), venta.contractualAmount?.toFixed(2), venta.customerPaidAmount?.toFixed(2)], ['1000.00', '80.00', '1000.00', '500.00'])
  assert.equal(subsidio.subsidyAmount?.toFixed(2), '500.00')

  // El ledger explica el presupuesto: caché y movimientos coinciden.
  const saldo = await sinEmpresa('prueba', (tx) => recalcularPresupuestoEnTx(tx, id))
  assert.deepEqual([saldo.reserved.toFixed(2), saldo.consumed.toFixed(2)], ['0.00', '500.00'])
  const ficha = await fichaBeneficio(id)
  assert.equal(ficha!.ledger.cuadra, true)
  assert.equal(ficha!.economia.subsidioAplicado, '500.00')
  assert.equal(ficha!.economia.valorContractual, '1000.00')
  assert.equal(ficha!.economia.cobradoAlCliente, '500.00')

  ctx.tours.offerCupo = orden.id
})

// ── B · cobertura total (§21) ───────────────────────────────────────────────

test('B · cobertura total: saldo 0, el cliente confirma sin pago bancario y nadie confirma un pago', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { salePrice: 400, titulo: 'Saona corta' })
  const id = await beneficioActivo({ name: 'Bono cubre todo', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 500, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 5000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente2)
  const orden = await comprarConBeneficio(offer, ctx.cliente2, g.id)
  assert.equal(orden.total, '0.00')

  // No hay pago bancario que avisar ni que confirmar.
  await assert.rejects(confirmar(orden.id, '0'), /cubierta por completo/)
  // Y la orden es del cliente: otro no la confirma.
  await assert.rejects(sinEmpresa('prueba', (tx) => confirmarCoberturaTotalEnTx(tx, { orderId: orden.id, customerId: ctx.cliente }, como(ctx.cliente))), /no es tuya/)

  const r = await sinEmpresa('prueba', (tx) => confirmarCoberturaTotalEnTx(tx, { orderId: orden.id, customerId: ctx.cliente2 }, como(ctx.cliente2)))
  assert.equal(r.entitlements.length, 1)
  const o = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id } })
  assert.deepEqual([o.status, o.paymentStatus, o.paymentAmountSeen?.toFixed(2), o.paymentMethod, o.paymentConfirmedById], ['PAID', 'COVERED_BY_BENEFIT', '0.00', null, null])
  assert.equal(o.membegoSubsidyTotal.toFixed(2), '400.00', 'el bono se capa al total: nunca deja saldo negativo')
  // El derecho es el de siempre, con su QR; el proveedor cobra su contractual.
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: r.entitlements[0]!.id } })
  assert.deepEqual([d.status, d.customerUnitPrice.toFixed(2), d.contractualUnitValue.toFixed(2), d.supplierNet?.toFixed(2)], ['ACTIVE', '0.00', '400.00', '368.00'])
  // Idempotente.
  assert.equal((await sinEmpresa('prueba', (tx) => confirmarCoberturaTotalEnTx(tx, { orderId: orden.id, customerId: ctx.cliente2 }, como(ctx.cliente2)))).repetido, true)
  assert.equal(await prisma.supplyV2Entitlement.count({ where: { orderId: orden.id } }), 1)
})

// ── C · financiación compartida (§4) ────────────────────────────────────────

test('C · compartida: 1 000 − 100 (proveedor) − 300 (Membego) = 600; contractual 900 y comisión 90', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona compartida' })
  ctx.tours.offerShared = offer
  const id = await beneficioActivo({
    name: 'Promo compartida',
    funding: 'SHARED',
    valueType: 'FIXED_AMOUNT',
    membegoValue: 300,
    supplierValue: 100,
    scope: 'SPECIFIC_OFFER',
    offerId: offer,
    supplierId: ctx.tours.supplierId,
    budgetTotal: 3000,
    startsAt: new Date(ahora.getTime() - DIA),
  })
  const g = await asignar(id, ctx.cliente)
  const orden = await comprarConBeneficio(offer, ctx.cliente, g.id)
  assert.equal(orden.total, '600.00')
  const pago = await confirmar(orden.id, '600.00')
  const o = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id } })
  assert.deepEqual(
    [o.contractualValue.toFixed(2), o.supplierDiscountTotal.toFixed(2), o.membegoSubsidyTotal.toFixed(2), o.commissionAmount?.toFixed(2), o.supplierNet?.toFixed(2)],
    ['900.00', '100.00', '300.00', '72.00', '828.00']
  )
  // Solo el subsidio de Membego consume presupuesto; el descuento del proveedor no.
  const b = await beneficioDe(id)
  assert.deepEqual([b.budgetConsumed.toFixed(2), b.budgetReserved.toFixed(2)], ['300.00', '0.00'])
  const mov = await prisma.supplyV2BenefitMovement.findFirstOrThrow({ where: { benefitId: id, type: 'APPLIED' } })
  assert.deepEqual([mov.consumedDelta.toFixed(2), mov.supplierAmount.toFixed(2)], ['300.00', '100.00'])
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: pago.entitlements[0]!.id } })
  assert.deepEqual([d.supplierDiscountAmount.toFixed(2), d.membegoSubsidyAmount.toFixed(2), d.contractualUnitValue.toFixed(2)], ['100.00', '300.00', '900.00'])
})

// ── D · dos checkouts con el mismo bono (§33) ───────────────────────────────

test('D · dos checkouts a la vez con el MISMO bono de un uso: solo uno pasa', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona carrera', perCustomerLimit: 5 })
  const id = await beneficioActivo({ name: 'Bono un uso', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 200, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 10_000, perCustomerLimit: 1, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente)
  const res = await Promise.allSettled([comprarConBeneficio(offer, ctx.cliente, g.id), comprarConBeneficio(offer, ctx.cliente, g.id)])
  const ok = res.filter((r) => r.status === 'fulfilled')
  assert.equal(ok.length, 1, 'el candado del beneficio serializa los dos checkouts')
  const b = await beneficioDe(id)
  assert.equal(b.budgetReserved.toFixed(2), '200.00')
  assert.equal(await prisma.supplyV2BenefitReservation.count({ where: { benefitId: id, status: 'ACTIVE' } }), 1)

  // Cancelar el checkout devuelve el presupuesto y el uso.
  const orderId = ok.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : []))[0]!
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, orderId, ctx.cliente, como(ctx.cliente)))
  const tras = await beneficioDe(id)
  assert.deepEqual([tras.budgetReserved.toFixed(2), tras.budgetConsumed.toFixed(2)], ['0.00', '0.00'])
  assert.equal((await reservaDeOrden(orderId)).status, 'RELEASED')
  // Y el bono vuelve a estar usable.
  const segunda = await comprarConBeneficio(offer, ctx.cliente, g.id)
  assert.equal(segunda.total, '800.00')
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, segunda.id, ctx.cliente, como(ctx.cliente)))
})

// ── E · presupuesto al límite (§11, §33) ────────────────────────────────────

test('E · presupuesto para un solo uso: dos clientes a la vez y solo uno pasa; se agota y al liberar revive', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona presupuesto', perCustomerLimit: 5 })
  const id = await beneficioActivo({ name: 'Bono presupuesto corto', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 300, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 300, requiresAssignment: false, perCustomerLimit: 1, startsAt: new Date(ahora.getTime() - DIA) })
  const res = await Promise.allSettled([
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: offer, quantity: 1, benefitId: id }, como(ctx.cliente))),
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente2, offerId: offer, quantity: 1, benefitId: id }, como(ctx.cliente2))),
  ])
  const ok = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  assert.equal(ok.length, 1, 'el presupuesto no se sobregira ni con dos checkouts simultáneos')
  const fallo = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
  // El que pierde la carrera se topa con el presupuesto agotado: o lo dice el
  // cálculo («no tiene presupuesto disponible») o ya lo dice el estado, porque
  // el primero dejó el beneficio en AGOTADO dentro del mismo candado.
  assert.match(String(fallo.reason), /presupuesto|agot|no está activo/i)
  const agotado = await beneficioDe(id)
  assert.deepEqual([agotado.status, agotado.budgetReserved.toFixed(2)], ['EXHAUSTED', '300.00'])

  // Expirar el checkout devuelve el presupuesto y reactiva el beneficio.
  await sinEmpresa('prueba', (tx) => expirarOrdenEnTx(tx, ok[0]!.id, como(null), new Date(ahora.getTime() + 2 * DIA)))
  const revivido = await beneficioDe(id)
  assert.deepEqual([revivido.status, revivido.budgetReserved.toFixed(2), revivido.budgetConsumed.toFixed(2)], ['ACTIVE', '0.00', '0.00'])
  assert.equal((await reservaDeOrden(ok[0]!.id)).status, 'EXPIRED')
  // La base es la última palabra: el CHECK no deja reservado + consumido por encima del total.
  await assert.rejects(prisma.$executeRaw`UPDATE "supply_v2_benefits" SET "budgetConsumed" = 400 WHERE "id" = ${id}`, /supply_v2_benefits_budget/)
})

// ── F · vencimientos y cancelaciones (§27) ──────────────────────────────────

test('F · pausar, cancelar con reservas vivas, retirar una asignación y vencer por el barrido', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona ciclo', perCustomerLimit: 5 })
  const id = await beneficioActivo({ name: 'Bono ciclo', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 150, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 5000, perCustomerLimit: 2, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente, { usesAllowed: 2 })

  // Pausado: no se puede usar en compras nuevas.
  await sinEmpresa('prueba', (tx) => pausarBeneficioEnTx(tx, id, como(ctx.compras)))
  await assert.rejects(comprarConBeneficio(offer, ctx.cliente, g.id), /no está activo/)
  await sinEmpresa('prueba', (tx) => reanudarBeneficioEnTx(tx, id, como(ctx.compras)))

  // Con un checkout en curso, cancelar el beneficio se bloquea: primero se pausa y se espera.
  const orden = await comprarConBeneficio(offer, ctx.cliente, g.id)
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarBeneficioEnTx(tx, id, 'por las dudas', como(ctx.finanzas))), /checkout\(s\) en curso/)
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarAsignacionEnTx(tx, g.id, 'ya no', como(ctx.finanzas))), /checkout en curso/)
  // Y cancelar exige motivo.
  await assert.rejects(sinEmpresa('prueba', (tx) => cancelarBeneficioEnTx(tx, id, '   ', como(ctx.finanzas))), /motivo/)
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, orden.id, ctx.cliente, como(ctx.cliente)))

  // Retirar la asignación: el cliente deja de verlo y no puede usarlo.
  await sinEmpresa('prueba', (tx) => cancelarAsignacionEnTx(tx, g.id, 'cliente se dio de baja', como(ctx.finanzas)))
  assert.equal((await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: g.id } })).status, 'CANCELLED')
  await assert.rejects(comprarConBeneficio(offer, ctx.cliente, g.id), /ya no está disponible|no está en tu cuenta/)

  // Vencimiento por el barrido: el beneficio y sus asignaciones vivas pasan a vencidos.
  const vence = await beneficioActivo({ name: 'Bono que vence', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 100, scope: 'SPECIFIC_OFFER', offerId: offer, endsAt: new Date(ahora.getTime() + 60_000), startsAt: new Date(ahora.getTime() - DIA) })
  const gv = await asignar(vence, ctx.cliente2)
  /**
   * El reloj se adelanta DOS MINUTOS, no un día.
   *
   * `expirarBeneficiosEnTx` vence TODO beneficio de la base cuya vigencia haya
   * pasado, no solo los de este archivo, y los archivos de prueba corren en
   * paralelo. Con el reloj un día adelante, «vencido» incluiría los beneficios
   * vivos de los Slices 7 y 8 y este archivo los apagaría sin que nadie
   * entendiera por qué. El beneficio que esta prueba quiere vencer termina
   * dentro de 60 segundos, así que con dos minutos basta: es el desplazamiento
   * más pequeño que cubre su propio dato y no alcanza a nadie más.
   */
  const r = await sinEmpresa('prueba', (tx) => expirarBeneficiosEnTx(tx, como(null), new Date(ahora.getTime() + 120_000)))
  assert.ok(r.beneficios >= 1)
  assert.equal((await beneficioDe(vence)).status, 'EXPIRED')
  assert.equal((await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: gv.id } })).status, 'EXPIRED')
  // Un beneficio vencido es final: ni se reactiva ni se usa.
  await assert.rejects(sinEmpresa('prueba', (tx) => reanudarBeneficioEnTx(tx, vence, como(ctx.compras))), /no se puede pasar de/)
  await assert.rejects(comprarConBeneficio(offer, ctx.cliente2, gv.id), /venció|no está activo/)
  /**
   * El barrido del cron pasa por el mismo camino, y se corre con el reloj DE
   * VERDAD.
   *
   * Antes esta línea era `barridoSupplyV2(ahora + 1 día)`, y eso rompía otros
   * archivos de prueba. `barridoSupplyV2` expira TODA orden PENDING cuya
   * reserva haya caducado, en toda la base: con el reloj un día adelante,
   * «caducada» incluye cualquier reserva viva —la de reserva son 15 minutos—.
   * Como `node --test` corre los archivos EN PARALELO, este barrido expiraba la
   * orden recién creada del Slice 2 y su prueba N fallaba en una aserción que
   * no tenía nada que ver con los beneficios. Tardó en aparecer porque depende
   * de qué dos archivos coincidan en el tiempo.
   *
   * Y la aserción que había —`beneficiosVencidos >= 0`— no comprobaba nada:
   * es cierta para cualquier número. Lo que de verdad importa aquí es que el
   * barrido NO deshaga lo ya vencido, y eso sí se puede afirmar.
   */
  const barrido = await barridoSupplyV2()
  assert.ok(barrido.beneficiosVencidos >= 0)
  assert.equal((await beneficioDe(vence)).status, 'EXPIRED', 'el barrido no resucita un beneficio vencido')
  assert.equal(
    (await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: gv.id } })).status,
    'EXPIRED',
    'ni su asignación'
  )
})

// ── G · comisión y base del acuerdo (§14, §25) ──────────────────────────────

test('G · el neto del proveedor no baja por el bono; con base CUSTOMER_PAID_AMOUNT sí baja la comisión', async () => {
  // Misma oferta, mismo bono: el proveedor cobra lo mismo con bono y sin bono.
  const sinBono = await comprarConBeneficio(ctx.tours.offerId, ctx.cliente2, null)
  await confirmar(sinBono.id, sinBono.total)
  const a = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: sinBono.id } })
  assert.deepEqual([a.total.toFixed(2), a.contractualValue.toFixed(2), a.commissionAmount?.toFixed(2), a.supplierNet?.toFixed(2)], ['1000.00', '1000.00', '80.00', '920.00'])

  // Acuerdo con base «lo que pagó el cliente»: la comisión se calcula sobre 500.
  const id = await beneficioActivo({ name: 'Bono base pagado', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 500, scope: 'SPECIFIC_OFFER', offerId: ctx.tours.offerPago, budgetTotal: 5000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente)
  const orden = await comprarConBeneficio(ctx.tours.offerPago, ctx.cliente, g.id)
  const o = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({ where: { id: orden.id } })
  assert.deepEqual(
    [o.commissionBase, o.total.toFixed(2), o.contractualValue.toFixed(2), o.commissionAmount?.toFixed(2), o.supplierNet?.toFixed(2)],
    ['CUSTOMER_PAID_AMOUNT', '500.00', '1000.00', '40.00', '960.00']
  )
  await confirmar(orden.id, '500.00')
})

// ── H · precompra (§25) ─────────────────────────────────────────────────────

test('H · precompra: el bono de Membego sí; el descuento del proveedor NO (ya le pagamos la unidad)', async () => {
  // Un descuento del proveedor sobre una oferta de supply ya comprado no se acepta.
  const soloComision = await sinEmpresa('prueba', (tx) =>
    crearBeneficioEnTx(tx, { name: 'Descuento pizza', funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', supplierValue: 100, scope: 'SPECIFIC_OFFER', offerId: ctx.pizza.offerId, supplierId: ctx.pizza.supplierId, requiresAssignment: false, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
  )
  await sinEmpresa('prueba', (tx) => aprobarBeneficioEnTx(tx, soloComision.id, como(ctx.finanzas)))
  await assert.rejects(
    sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: ctx.pizza.offerId, quantity: 1, benefitId: soloComision.id }, como(ctx.cliente))),
    /ofertas vendidas a comisión/
  )

  // Un bono de Membego sí: el lote, el costo y el margen siguen siendo los del Slice 4.
  const id = await beneficioActivo({ name: 'Bono pizza', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 200, scope: 'SPECIFIC_OFFER', offerId: ctx.pizza.offerId, budgetTotal: 2000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente)
  const orden = await comprarConBeneficio(ctx.pizza.offerId, ctx.cliente, g.id)
  assert.equal(orden.total, '300.00')
  const pago = await confirmar(orden.id, '300.00')
  const d = await prisma.supplyV2Entitlement.findUniqueOrThrow({ where: { id: pago.entitlements[0]!.id } })
  assert.deepEqual(
    [d.sourceType, d.lotId, d.actualUnitCost.toFixed(2), d.customerUnitPrice.toFixed(2), d.contractualUnitValue.toFixed(2), d.membegoSubsidyAmount.toFixed(2)],
    ['PREPURCHASED_SUPPLY', ctx.pizza.lotId, '300.00', '300.00', '500.00', '200.00']
  )
  // El ingreso es el valor contractual (500) y el margen 200: el bono NO infla ni reduce el margen bruto…
  const venta = await prisma.supplyV2EconomicEvent.findFirstOrThrow({ where: { entitlementId: d.id, type: 'SALE_REVENUE' } })
  assert.deepEqual([venta.revenueAmount.toFixed(2), venta.costAmount.toFixed(2), venta.grossMarginAmount.toFixed(2), venta.customerPaidAmount?.toFixed(2)], ['500.00', '300.00', '200.00', '300.00'])
  // …y el subsidio se registra aparte, como costo promocional.
  const subsidio = await prisma.supplyV2EconomicEvent.findFirstOrThrow({ where: { entitlementId: d.id, type: 'MEMBEGO_SUBSIDY' } })
  assert.equal(subsidio.subsidyAmount?.toFixed(2), '200.00')
  // La precompra no crea ninguna obligación nueva con el proveedor (§25).
  assert.equal(await prisma.supplyV2SupplierObligation.count({ where: { supplierId: ctx.pizza.supplierId, redemption: { entitlementId: d.id } } }), 0)
  ctx.pizza.offerId = ctx.pizza.offerId
})

// ── I · canje con el QR de siempre (§23) ────────────────────────────────────

test('I · el canje es el del Slice 3: un QR, una entrega, con la foto de la financiación', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona canje' })
  const id = await beneficioActivo({ name: 'Bono canje', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 400, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 5000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente)
  const orden = await comprarConBeneficio(offer, ctx.cliente, g.id)
  const pago = await confirmar(orden.id, '600.00')
  const entitlementId = pago.entitlements[0]!.id
  const redencionId = await redimir(entitlementId, ctx.cliente)

  const red = await prisma.supplyV2Redemption.findUniqueOrThrow({ where: { id: redencionId } })
  assert.deepEqual(
    [red.customerUnitPriceSnapshot.toFixed(2), red.contractualValueSnapshot?.toFixed(2), red.membegoSubsidySnapshot?.toFixed(2), red.supplierDiscountSnapshot?.toFixed(2), red.supplierNetSnapshot?.toFixed(2)],
    ['600.00', '1000.00', '400.00', '0.00', '920.00']
  )
  // La obligación con el proveedor es por el neto CONTRACTUAL, no por lo que pagó el cliente.
  const ob = await prisma.supplyV2SupplierObligation.findUniqueOrThrow({ where: { redemptionId: redencionId } })
  assert.equal(ob.outstandingAmount.toFixed(2), '920.00', 'la deuda con el proveedor es el neto contractual, no lo que pagó el cliente')
  // El bono aplicado no se reversa si el derecho ya se entregó (§27).
  const r = await reservaDeOrden(orden.id)
  await assert.rejects(sinEmpresa('prueba', (tx) => reversarAplicacionBeneficioEnTx(tx, r.id, 'error de la campaña', como(ctx.finanzas))), /derechos vivos|entregados/i)
})

test('I · reversar una aplicación solo cuando no quedan derechos vivos: el presupuesto y el uso vuelven', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona reversa' })
  const id = await beneficioActivo({ name: 'Bono reversa', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 250, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 5000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente2)
  const orden = await comprarConBeneficio(offer, ctx.cliente2, g.id)
  const pago = await confirmar(orden.id, '750.00')
  // Se deja vencer el derecho para poder reversar sin que nadie haya recibido nada.
  await prisma.supplyV2Entitlement.update({ where: { id: pago.entitlements[0]!.id }, data: { status: 'EXPIRED' } })
  const r = await reservaDeOrden(orden.id)
  await assert.rejects(sinEmpresa('prueba', (tx) => reversarAplicacionBeneficioEnTx(tx, r.id, '  ', como(ctx.finanzas))), /motivo/)
  await sinEmpresa('prueba', (tx) => reversarAplicacionBeneficioEnTx(tx, r.id, 'campaña cargada por error', como(ctx.finanzas)))
  const b = await beneficioDe(id)
  assert.deepEqual([b.budgetConsumed.toFixed(2), b.budgetReserved.toFixed(2)], ['0.00', '0.00'])
  const g2 = await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: g.id } })
  assert.deepEqual([g2.usesConsumed, g2.status], [0, 'AVAILABLE'])
  // Idempotente y con rastro en el ledger.
  await sinEmpresa('prueba', (tx) => reversarAplicacionBeneficioEnTx(tx, r.id, 'otra vez', como(ctx.finanzas)))
  assert.equal(await prisma.supplyV2BenefitMovement.count({ where: { reservationId: r.id, type: 'REVERSED' } }), 1)
  const saldo = await sinEmpresa('prueba', (tx) => recalcularPresupuestoEnTx(tx, id))
  assert.deepEqual([saldo.reserved.toFixed(2), saldo.consumed.toFixed(2)], ['0.00', '0.00'])
})

// ── J · liquidación y economía (§26, §28) ───────────────────────────────────

test('J · liquidación: bruto = contractual + descuento; el bono se informa y no rebaja el neto', async () => {
  const periodo = { periodStart: new Date(ahora.getTime() - 7 * DIA), periodEnd: new Date(ahora.getTime() + 7 * DIA) }
  const s = await sinEmpresa('prueba', (tx) => generarLiquidacionEnTx(tx, { supplierId: ctx.tours.supplierId, frequency: 'MANUAL', ...periodo }, como(ctx.compras)))
  const liq = await prisma.supplyV2Settlement.findUniqueOrThrow({ where: { id: s.id }, include: { lines: true } })
  const linea = liq.lines.find((l) => l.membegoSubsidyAmount.greaterThan(0))!
  assert.ok(linea, 'la liquidación trae la entrega con bono')
  assert.equal(linea.contractualAmount.toFixed(2), '1000.00')
  assert.equal(linea.membegoSubsidyAmount.toFixed(2), '400.00')
  assert.equal(linea.customerPaidAmount.toFixed(2), '600.00')
  assert.equal(linea.grossAmount.toFixed(2), '1000.00', 'GMV = contractual + descuento del proveedor')
  assert.equal(linea.supplierNet.toFixed(2), '920.00', 'el neto del proveedor no lo toca el bono')
  // Los totales suman las columnas, no se recalculan con precios de hoy.
  assert.equal(liq.contractualValue.toFixed(2), liq.lines.reduce((t, l) => t.plus(l.contractualAmount), D(0)).toFixed(2))
  assert.equal(liq.membegoSubsidyTotal.toFixed(2), liq.lines.reduce((t, l) => t.plus(l.membegoSubsidyAmount), D(0)).toFixed(2))
  assert.equal(liq.customerPaidTotal.toFixed(2), liq.lines.reduce((t, l) => t.plus(l.customerPaidAmount), D(0)).toFixed(2))
})

test('J · economía: subsidio, descuento, cobros y contribución tras el subsidio, cada uno por su nombre', async () => {
  const e = await calcularEconomia({ ventana: 'RANGO', desde: new Date(ahora.getTime() - DIA), hasta: new Date(ahora.getTime() + DIA), supplierId: ctx.tours.supplierId })
  assert.ok(e.membegoSubsidy.greaterThan(0), 'el subsidio del periodo se reporta')
  assert.ok(e.supplierDiscount.greaterThan(0), 'el descuento del proveedor se reporta aparte')
  assert.equal(e.promotionalCost.toFixed(2), e.membegoSubsidy.toFixed(2))
  assert.equal(e.contributionAfterSubsidy.toFixed(2), e.grossMargin.minus(e.membegoSubsidy).toFixed(2))
  assert.ok(e.customerCollections.lessThan(e.gmv), 'lo cobrado es menor que el GMV porque parte la puso Membego')
  // El ingreso a comisión sigue siendo SOLO la comisión: el bono no lo cambia.
  assert.ok(e.commission.revenue.lessThan(e.commission.gmv))
  assert.equal(e.supplierObligations.toFixed(2), e.commission.supplierNet.toFixed(2))
})

test('J · «Mis beneficios» del cliente: lo que tiene, dónde vale y por qué no puede usar uno', async () => {
  const mios = await misBeneficios(ctx.cliente)
  assert.ok(mios.length > 0)
  const usados = mios.filter((b) => b.status === 'EXHAUSTED')
  assert.ok(usados.length > 0, 'un bono ya usado se ve, con su motivo')
  assert.ok(usados.every((b) => !b.usable && b.motivo))
  // Nunca se filtra el presupuesto de la campaña en el DTO del cliente.
  for (const b of mios) {
    assert.ok(!Object.keys(b).some((k) => /budget|presupuesto/i.test(k)), `el DTO del cliente no habla de presupuesto (${b.code})`)
  }
  // Y el beneficio de otro cliente nunca aparece aquí.
  const ajenos = await prisma.supplyV2CustomerBenefit.findMany({ where: { customerId: ctx.cliente2 }, select: { id: true } })
  assert.ok(ajenos.length > 0)
  assert.ok(!mios.some((b) => ajenos.some((a) => a.id === b.customerBenefitId)))
})

test('J · un beneficio ajeno no se usa ni conociendo su id (§33)', async () => {
  const offer = await ofertaComision(ctx.tours.itemId, { titulo: 'Saona ajena' })
  const id = await beneficioActivo({ name: 'Bono de otro', funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 100, scope: 'SPECIFIC_OFFER', offerId: offer, budgetTotal: 1000, startsAt: new Date(ahora.getTime() - DIA) })
  const g = await asignar(id, ctx.cliente2)
  await assert.rejects(comprarConBeneficio(offer, ctx.cliente, g.id), /no es tuyo/)
  // Y sin asignación tampoco, aunque se pase el id del beneficio.
  await assert.rejects(sinEmpresa('prueba', (tx) => abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente, offerId: offer, quantity: 1, benefitId: id }, como(ctx.cliente))), /no está en tu cuenta/)
  // Una oferta que el beneficio no cubre tampoco.
  await assert.rejects(comprarConBeneficio(ctx.tours.offerShared, ctx.cliente2, g.id), /no aplica a este producto/)
})

test('J · una línea lleva UN solo beneficio: la reserva viva es única por orden y por línea (§18)', async () => {
  const unica = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'supply_v2_benefit_reservations' AND indexname = 'supply_v2_benefit_reservations_viva_por_orden'`
  assert.equal(unica.length, 1, 'el índice parcial que impide dos beneficios vivos por orden existe')
  const porLinea = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'supply_v2_benefit_reservations' AND indexdef LIKE '%UNIQUE%orderLineId%'`
  assert.ok(porLinea.length >= 1, 'una línea no puede tener dos reservas')
})
