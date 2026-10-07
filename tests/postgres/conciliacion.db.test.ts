import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa, sinEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { recibirEnTx } from '../../src/modules/inventory/service'
import {
  cancelarPedidoEnTx,
  completarPorQrEnTx,
  confirmarMontoEnTx,
  crearPedidoEnTx,
  marcarListoEnTx,
  reembolsarPedidoEnTx,
  registrarPagoEnTx,
  type ContextoPedido,
} from '../../src/modules/orders/service'
import { crearOfertaEnTx, publicarOfertaEnTx, reclamarOfertaEnTx } from '../../src/modules/deals/service'
import { venderEnMostradorEnTx } from '../../src/modules/pos/service'
import { conciliarEnTx } from '../../src/modules/conciliacion/queries'
import { REGLAS } from '../../src/modules/conciliacion/domain'

/**
 * CONCILIACIÓN DEL COMERCIO contra PostgreSQL de verdad (Fase 9).
 *
 * Una base SANA —creada solo con los servicios: pedido cobrado en efectivo, con transferencia verificada antes de
 * entregar, reembolsado, cancelado, abierto, cupón de oferta canjeado y venta de mostrador— no produce ningún
 * hallazgo. Después se ROMPE a mano, de una en una, cada cosa que la conciliación vigila (saltándose los
 * disparadores con `session_replication_role = replica`, como lo haría una escritura manual) y se comprueba que
 * cambian EXACTAMENTE las reglas que deben —ni más, ni menos—. Es lo que impide que una regla sea decorativa.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const ctx = { usuario: '', a: '', b: '', demo: '', s1: '', sB: '', sDemo: '', caja: '', cajaDemo: '', clientes: [] as string[], clienteB: '', clienteDemo: '', servicio: '', fisico: '', varB: '', varDemo: '' }

const empresa: ContextoPedido = { actor: 'EMPRESA', actorId: null }
const clienteCtx: ContextoPedido = { actor: 'CLIENTE', actorId: null }
const aud = () => ({ actorId: ctx.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const enA = <T>(fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(ctx.a, fn)

let n = 0
const siguienteCliente = () => ctx.clientes[n++ % ctx.clientes.length]

before(async () => {
  const u = await prisma.user.create({ data: { supabaseId: `sb-conc-${sufijo}`, email: `conc-${sufijo}@prueba.test`, name: 'Conciliación', role: 'SUPERADMIN' }, select: { id: true } })
  ctx.usuario = u.id
  const empresaNueva = async (k: string, esDemo = false) => (await prisma.company.create({ data: { name: `CONC ${k} ${sufijo}`, slug: `conc-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', esDemo }, select: { id: true } })).id
  ctx.a = await empresaNueva('a')
  ctx.b = await empresaNueva('b')
  ctx.demo = await empresaNueva('demo', true)
  const suc = async (companyId: string) => (await prisma.sucursal.create({ data: { companyId, nombre: 'Principal' }, select: { id: true } })).id
  ctx.s1 = await suc(ctx.a)
  ctx.sB = await suc(ctx.b)
  ctx.sDemo = await suc(ctx.demo)
  ctx.caja = (await prisma.cajaSesion.create({ data: { companyId: ctx.a, sucursalId: ctx.s1, abiertaPorId: u.id, estado: 'ABIERTA', balanceInicial: 0 }, select: { id: true } })).id
  for (let i = 0; i < 6; i++) {
    ctx.clientes.push((await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-concli-${i}-${sufijo}`, nombre: `Cliente Conc ${i}`, email: `concli-${i}-${sufijo}@prueba.test` }, select: { id: true } })).id)
  }
  ctx.clienteB = (await prisma.cliente.create({ data: { companyId: ctx.b, supabaseId: `sb-conclib-${sufijo}`, nombre: 'Cliente B', email: `conclib-${sufijo}@prueba.test` }, select: { id: true } })).id
  ctx.clienteDemo = (await prisma.cliente.create({ data: { companyId: ctx.demo, supabaseId: `sb-conclid-${sufijo}`, nombre: 'Cliente Demo', email: `conclid-${sufijo}@prueba.test` }, select: { id: true } })).id

  const crear = async (companyId: string, name: string, type: 'PHYSICAL_PRODUCT' | 'SERVICE', price: number, sku: string) => {
    const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name, type, price, sku }, aud()))
    await conEmpresa(companyId, (tx) => cambiarEstadoItemEnTx(tx, companyId, r.id, 'ACTIVE', aud()))
    return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  }
  ctx.servicio = await crear(ctx.a, `Servicio conc ${sufijo}`, 'SERVICE', 250, `CONC-S-${sufijo}`)
  ctx.fisico = await crear(ctx.a, `Producto conc ${sufijo}`, 'PHYSICAL_PRODUCT', 100, `CONC-F-${sufijo}`)
  ctx.varB = await crear(ctx.b, `Servicio B ${sufijo}`, 'SERVICE', 60, `CONC-B-${sufijo}`)
  ctx.varDemo = await crear(ctx.demo, `Servicio demo ${sufijo}`, 'SERVICE', 60, `CONC-D-${sufijo}`)
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico, sucursalId: ctx.s1, cantidad: 500, motivo: 'Stock de prueba' }, aud()))
})

after(async () => {
  const ids = [ctx.a, ctx.b, ctx.demo]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "transaction_transitions" WHERE "transactionId" IN (SELECT "id" FROM "transactions" WHERE "companyId" IN (${Prisma.join(ids)}))`
    for (const tabla of ['transactions', 'caja_sesiones', 'deal_claims', 'deals', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  // Ya sin filas rotas: las CHECK vuelven a estar validadas.
  for (const t of tocadas) {
    const [tabla, nombre] = t.split('|')
    await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" VALIDATE CONSTRAINT "${nombre}"`)
  }
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

/**
 * Escritura «a mano»: sin disparadores Y sin las CHECK de la tabla (la base ya impide casi todo esto; la conciliación
 * existe para lo que se salte esas reglas). Las CHECK se quitan solo durante la escritura y se vuelven a poner
 * `NOT VALID` (siguen vigiladas para lo nuevo); al final de la prueba, cuando ya se borró lo roto, se validan de nuevo.
 */
const tocadas = new Set<string>()
const rompe = (tabla: string, sql: Prisma.Sql) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    const cs = await tx.$queryRawUnsafe<{ conname: string; def: string }[]>(`SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = '"${tabla}"'::regclass AND c.contype = 'c'`)
    for (const c of cs) await tx.$executeRawUnsafe(`ALTER TABLE "${tabla}" DROP CONSTRAINT "${c.conname}"`)
    await tx.$executeRaw(sql)
    for (const c of cs) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${tabla}" ADD CONSTRAINT "${c.conname}" ${c.def} NOT VALID`)
      tocadas.add(`${tabla}|${c.conname}`)
    }
  })

async function totales(companyId: string | null = ctx.a, muestra = 1): Promise<Record<string, number>> {
  const r = companyId ? await conEmpresa(companyId, (tx) => conciliarEnTx(tx, { companyId }, { muestra })) : await sinEmpresa('conciliación de prueba (plataforma)', (tx) => conciliarEnTx(tx, { companyId: null }, { muestra }))
  const fallidas = r.filter((h) => h.error)
  assert.deepEqual(fallidas.map((h) => h.regla.codigo), [], 'ninguna regla puede fallar al evaluarse')
  return Object.fromEntries(r.map((h) => [h.regla.codigo, h.total]))
}

/** Qué reglas cambiaron, y cuánto, al hacer `fn`. */
async function cambios(fn: () => Promise<unknown>): Promise<Record<string, number>> {
  const antes = await totales()
  await fn()
  const despues = await totales()
  const d: Record<string, number> = {}
  for (const k of Object.keys(despues)) if (despues[k] !== antes[k]) d[k] = despues[k] - antes[k]
  return d
}

const pedido = (opts: { variante?: string; cantidad?: number; cliente?: string; sucursal?: string; companyId?: string } = {}) => {
  const companyId = opts.companyId ?? ctx.a
  return conEmpresa(companyId, (tx) =>
    crearPedidoEnTx(tx, companyId, { customerId: opts.cliente ?? siguienteCliente(), locationId: opts.sucursal ?? ctx.s1, origin: 'MARKETPLACE', lineas: [{ varianteId: opts.variante ?? ctx.servicio, cantidad: opts.cantidad ?? 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx)
  )
}

const tokenDe = async (id: string) => (await prisma.membegoOrder.findUniqueOrThrow({ where: { id }, select: { qrToken: true } })).qrToken as string

/** Pedido listo → cerrado con su QR (sin evidencia: nivel REDEEMED, comisión CPA). */
async function cerradoEnEfectivo(opts: { variante?: string; cantidad?: number } = {}) {
  const r = await pedido(opts)
  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa))
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, listo.qrToken as string, empresa))
  return r
}

/** Confirmado por el cliente, transferencia con referencia ANTES de entregar → PAYMENT_VERIFIED y 8 %. */
async function cerradoVerificado(opts: { variante?: string; cantidad?: number } = {}) {
  const cliente = siguienteCliente()
  const r = await pedido({ ...opts, cliente })
  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: cliente, montoVisto: r.total }, clienteCtx))
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'TRANSFER', amount: r.total, reference: `TRF-${sufijo}-${n}` }, empresa))
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, listo.qrToken as string, empresa))
  return r
}

const abierto = (opts: { variante?: string; cantidad?: number } = {}) => pedido(opts)

async function ofertaCanjeada(canjear = true) {
  const cliente = siguienteCliente()
  const oferta = await enA((tx) =>
    crearOfertaEnTx(tx, ctx.a, { title: `Oferta conc ${sufijo}-${++n}`, catalogVariantId: ctx.servicio, discountType: 'PERCENT', discountValue: 20, startsAt: new Date(Date.now() - 3_600_000), endsAt: null, maxClaims: 5, budgetTotal: 1000 }, aud())
  )
  await enA((tx) => publicarOfertaEnTx(tx, ctx.a, oferta.id, aud()))
  const reclamo = await enA((tx) => reclamarOfertaEnTx(tx, ctx.a, { dealId: oferta.id, customerId: cliente, locationId: ctx.s1 }))
  if (canjear) {
    const token = await tokenDe(reclamo.orderId)
    await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa))
  }
  return { dealId: oferta.id, pedidoId: reclamo.orderId }
}

// ── La base sana ─────────────────────────────────────────────────────────────

test('1 · una base creada solo con los servicios cuadra: ninguna regla encuentra nada', async () => {
  // Efectivo (con existencias), transferencia verificada antes de entregar, reembolsado, cancelado, abierto, cupón y venta de mostrador.
  await cerradoEnEfectivo({ variante: ctx.fisico, cantidad: 2 })
  await cerradoVerificado({ variante: ctx.fisico, cantidad: 3 })
  const reembolsado = await cerradoEnEfectivo({ variante: ctx.fisico, cantidad: 1 })
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, reembolsado.pedidoId, { motivo: 'Devolución', devolverAlInventario: true }, empresa))
  const cancelado = await abierto({ variante: ctx.fisico, cantidad: 1 })
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, cancelado.pedidoId, { motivo: 'Cambio de planes' }, empresa))
  await abierto({ variante: ctx.fisico, cantidad: 4 })
  const cupon = await ofertaCanjeada()
  assert.ok(cupon.pedidoId)
  await enA((tx) => venderEnMostradorEnTx(tx, ctx.a, { cajaSesionId: ctx.caja, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }], metodo: 'EFECTIVO', clave: `venta-${sufijo}` }, { actorId: ctx.usuario, nombre: 'Cajero', ipAddress: '127.0.0.1', userAgent: 'test' }))

  const t = await totales()
  assert.deepEqual(Object.fromEntries(Object.entries(t).filter(([, v]) => v !== 0)), {}, 'una base sana no tiene hallazgos')
  // Y TODAS las reglas se pueden evaluar también en el alcance de la plataforma (otra variante de cada consulta).
  const plataforma = await sinEmpresa('conciliación de prueba (plataforma)', (tx) => conciliarEnTx(tx, { companyId: null }, { muestra: 1 }))
  assert.deepEqual(plataforma.filter((h) => h.error).map((h) => h.regla.codigo), [], 'ninguna regla falla en el alcance de la plataforma')
  assert.deepEqual(Object.keys(t).sort(), REGLAS.map((r) => r.codigo).sort(), 'todas las reglas corren')
  // Y había de qué hablar: hay pedidos de todos los estados y comisiones de las dos clases.
  const estados = await prisma.membegoOrder.groupBy({ by: ['status'], where: { companyId: ctx.a }, _count: true })
  assert.ok(['COMPLETED', 'REFUNDED', 'CANCELLED', 'AWAITING_MERCHANT'].every((s) => estados.some((e) => e.status === s)), JSON.stringify(estados))
  const tipos = await prisma.commission.groupBy({ by: ['type'], where: { companyId: ctx.a }, _count: true })
  assert.ok(tipos.some((x) => x.type === 'PERCENTAGE') && tipos.some((x) => x.type === 'CPA_FIXED'))
})

// ── Se rompe una cosa y cambia lo que debe ───────────────────────────────────

const ids = (id: string) => Prisma.sql`${id}`

test('2 · C01: un pedido del marketplace completado sin su comisión', async () => {
  const r = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('merchant_commissions', Prisma.sql`DELETE FROM "merchant_commissions" WHERE "orderId" = ${ids(r.pedidoId)}`)), { C01: 1 })
})

test('3 · C02: un pedido reembolsado cuya comisión sigue confirmada', async () => {
  const r = await cerradoEnEfectivo()
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Devolución' }, empresa))
  assert.deepEqual(await cambios(() => rompe('merchant_commissions', Prisma.sql`UPDATE "merchant_commissions" SET "status" = 'CONFIRMED', "reversalEntryId" = NULL, "reversedAt" = NULL WHERE "orderId" = ${ids(r.pedidoId)}`)), { C02: 1 })
})

test('4 · C03: una comisión confirmada sobre un pedido que quedó cancelado', async () => {
  const r = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "status" = 'CANCELLED' WHERE "id" = ${ids(r.pedidoId)}`)), { C03: 1 })
})

test('5 · C04: una comisión sobre un pedido de un origen que no comisiona', async () => {
  const r = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "origin" = 'POS' WHERE "id" = ${ids(r.pedidoId)}`)), { C04: 1 })
})

test('6 · C05: una comisión por porcentaje con un monto que no es base × tasa (y su asiento ya no coincide)', async () => {
  const r = await cerradoVerificado()
  assert.equal((await prisma.commission.findUniqueOrThrow({ where: { orderId: r.pedidoId } })).type, 'PERCENTAGE')
  assert.deepEqual(await cambios(() => rompe('merchant_commissions', Prisma.sql`UPDATE "merchant_commissions" SET "amount" = "amount" + 1 WHERE "orderId" = ${ids(r.pedidoId)}`)), { C05: 1, G02: 1 })
})

test('7 · C06: una comisión cobrada sobre una base distinta de la del pedido', async () => {
  const r = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('merchant_commissions', Prisma.sql`UPDATE "merchant_commissions" SET "baseAmount" = "baseAmount" + 1 WHERE "orderId" = ${ids(r.pedidoId)}`)), { C06: 1 })
})

test('8 · P01: nivel «pago verificado» sin constancia de pago (y, de paso, sin confirmación y con la comisión en CPA)', async () => {
  const r = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "verificationLevel" = 'PAYMENT_VERIFIED' WHERE "id" = ${ids(r.pedidoId)}`)), { P01: 1, P03: 1, P04: 1 })
})

test('9 · P02: una constancia que no respalda el pago verificado (otro monto, efectivo o sin referencia)', async () => {
  const monto = await cerradoVerificado()
  assert.deepEqual(await cambios(() => rompe('payment_evidences', Prisma.sql`UPDATE "payment_evidences" SET "amount" = "amount" + 1 WHERE "orderId" = ${ids(monto.pedidoId)}`)), { P02: 1 })
  const metodo = await cerradoVerificado()
  assert.deepEqual(await cambios(() => rompe('payment_evidences', Prisma.sql`UPDATE "payment_evidences" SET "method" = 'CASH' WHERE "orderId" = ${ids(metodo.pedidoId)}`)), { P02: 1 })
  const sinRef = await cerradoVerificado()
  assert.deepEqual(await cambios(() => rompe('payment_evidences', Prisma.sql`UPDATE "payment_evidences" SET "reference" = NULL WHERE "orderId" = ${ids(sinRef.pedidoId)}`)), { P02: 1 })
})

test('10 · P03: verificado por el cliente con una confirmación que ya no es la vigente', async () => {
  const r = await cerradoVerificado()
  assert.deepEqual(await cambios(() => rompe('customer_confirmations', Prisma.sql`UPDATE "customer_confirmations" SET "confirmedTotal" = "confirmedTotal" + 1 WHERE "orderId" = ${ids(r.pedidoId)}`)), { P03: 1 })
})

test('11 · P04: el negocio registra el pago DESPUÉS de entregar — la comisión se queda en CPA (por diseño, pero se ve)', async () => {
  const cliente = siguienteCliente()
  const r = await pedido({ cliente })
  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: cliente, montoVisto: r.total }, clienteCtx))
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, listo.qrToken as string, empresa))
  const antes = await totales()
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'TRANSFER', amount: r.total, reference: `TARDE-${sufijo}` }, empresa))
  const despues = await totales()
  assert.equal((await prisma.membegoOrder.findUniqueOrThrow({ where: { id: r.pedidoId } })).verificationLevel, 'PAYMENT_VERIFIED')
  assert.equal((await prisma.commission.findUniqueOrThrow({ where: { orderId: r.pedidoId } })).type, 'CPA_FIXED')
  assert.equal(despues.P04 - antes.P04, 1)
  assert.equal(despues.P01 - antes.P01 + (despues.P02 - antes.P02) + (despues.P03 - antes.P03), 0, 'no es una incoherencia: la evidencia sí está')
})

test('12 · L01–L04: los montos del pedido tienen que salir de sus renglones', async () => {
  const sinLineas = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_order_lines', Prisma.sql`DELETE FROM "membego_order_lines" WHERE "orderId" = ${ids(sinLineas.pedidoId)}`)), { L01: 1 })
  const subtotal = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "subtotal" = "subtotal" + 1 WHERE "id" = ${ids(subtotal.pedidoId)}`)), { L02: 1, L03: 1 })
  const total = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "total" = "total" + 1 WHERE "id" = ${ids(total.pedidoId)}`)), { L03: 1 })
  const renglon = await cerradoEnEfectivo()
  assert.deepEqual(await cambios(() => rompe('membego_order_lines', Prisma.sql`UPDATE "membego_order_lines" SET "lineTotal" = "lineTotal" + 1 WHERE "orderId" = ${ids(renglon.pedidoId)}`)), { L04: 1 })
})

test('13 · O01–O05: el presupuesto, los cupos y los cupones de una oferta tienen que cuadrar', async () => {
  const gastado = await ofertaCanjeada()
  assert.deepEqual(await cambios(() => rompe('deals', Prisma.sql`UPDATE "deals" SET "budgetSpent" = "budgetSpent" + 1 WHERE "id" = ${ids(gastado.dealId)}`)), { O01: 1 })
  const apartado = await ofertaCanjeada()
  assert.deepEqual(await cambios(() => rompe('deals', Prisma.sql`UPDATE "deals" SET "budgetReserved" = "budgetReserved" + 1 WHERE "id" = ${ids(apartado.dealId)}`)), { O02: 1 })
  const cupos = await ofertaCanjeada()
  assert.deepEqual(await cambios(() => rompe('deals', Prisma.sql`UPDATE "deals" SET "claimsActive" = "claimsActive" + 1 WHERE "id" = ${ids(cupos.dealId)}`)), { O03: 1 })
  const estado = await ofertaCanjeada()
  assert.deepEqual(await cambios(() => rompe('deal_claims', Prisma.sql`UPDATE "deal_claims" SET "status" = 'EXPIRED' WHERE "orderId" = ${ids(estado.pedidoId)}`)), { O01: 1, O03: 1, O04: 1 })
  const cuota = await ofertaCanjeada()
  assert.deepEqual(await cambios(() => rompe('deal_claims', Prisma.sql`UPDATE "deal_claims" SET "fee" = "fee" + 1 WHERE "orderId" = ${ids(cuota.pedidoId)}`)), { O01: 1, O05: 1 })
})

test('14 · I01–I04: las existencias apartadas tienen que ser las de las reservas, y cada reserva seguir a su pedido', async () => {
  const nivel = await abierto({ variante: ctx.fisico, cantidad: 1 })
  assert.ok(nivel.pedidoId)
  assert.deepEqual(await cambios(() => rompe('inventory_levels', Prisma.sql`UPDATE "inventory_levels" SET "reserved" = "reserved" + 1 WHERE "catalogVariantId" = ${ids(ctx.fisico)} AND "locationId" = ${ids(ctx.s1)}`)), { I01: 1 })
  await rompe('inventory_levels', Prisma.sql`UPDATE "inventory_levels" SET "reserved" = "reserved" - 1 WHERE "catalogVariantId" = ${ids(ctx.fisico)} AND "locationId" = ${ids(ctx.s1)}`)

  const vendido = await cerradoEnEfectivo({ variante: ctx.fisico, cantidad: 1 })
  assert.deepEqual(await cambios(() => rompe('inventory_reservations', Prisma.sql`UPDATE "inventory_reservations" SET "status" = 'ACTIVE' WHERE "id" IN (SELECT "inventoryReservationId" FROM "membego_order_lines" WHERE "orderId" = ${ids(vendido.pedidoId)})`)), { I01: 1, I02: 1 })
  await rompe('inventory_reservations', Prisma.sql`UPDATE "inventory_reservations" SET "status" = 'CONSUMED' WHERE "id" IN (SELECT "inventoryReservationId" FROM "membego_order_lines" WHERE "orderId" = ${ids(vendido.pedidoId)})`)

  const cancelado = await abierto({ variante: ctx.fisico, cantidad: 1 })
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, cancelado.pedidoId, { motivo: 'Cambio de planes' }, empresa))
  assert.deepEqual(await cambios(() => rompe('inventory_reservations', Prisma.sql`UPDATE "inventory_reservations" SET "status" = 'ACTIVE' WHERE "id" IN (SELECT "inventoryReservationId" FROM "membego_order_lines" WHERE "orderId" = ${ids(cancelado.pedidoId)})`)), { I01: 1, I03: 1 })
  await rompe('inventory_reservations', Prisma.sql`UPDATE "inventory_reservations" SET "status" = 'RELEASED' WHERE "id" IN (SELECT "inventoryReservationId" FROM "membego_order_lines" WHERE "orderId" = ${ids(cancelado.pedidoId)})`)

  const abiertoRoto = await abierto({ variante: ctx.fisico, cantidad: 1 })
  assert.deepEqual(await cambios(() => rompe('inventory_reservations', Prisma.sql`UPDATE "inventory_reservations" SET "status" = 'RELEASED' WHERE "id" IN (SELECT "inventoryReservationId" FROM "membego_order_lines" WHERE "orderId" = ${ids(abiertoRoto.pedidoId)})`)), { I01: 1, I04: 1 })
})

test('15 · G02–G03: el asiento de una comisión y su reverso tienen que ser los suyos', async () => {
  const revertida = await cerradoEnEfectivo()
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, revertida.pedidoId, { motivo: 'Devolución' }, empresa))
  assert.deepEqual(await cambios(() => rompe('merchant_commissions', Prisma.sql`UPDATE "merchant_commissions" SET "reversalEntryId" = NULL WHERE "orderId" = ${ids(revertida.pedidoId)}`)), { G03: 1 })
  // El asiento de la ÚLTIMA comisión cobrada cambia de monto y de saldo a la vez (la cadena sigue sumando).
  const ultima = await cerradoEnEfectivo()
  const c = await prisma.commission.findUniqueOrThrow({ where: { orderId: ultima.pedidoId } })
  assert.deepEqual(
    await cambios(() => rompe('merchant_ledger_entries', Prisma.sql`UPDATE "merchant_ledger_entries" SET "amount" = "amount" + 1, "balance" = "balance" + 1 WHERE "id" = ${ids(c.ledgerEntryId)}`)),
    { G02: 1 }
  )
})

test('16 · G01: un saldo del libro que no es el anterior más el monto (y el siguiente asiento ya no suma)', async () => {
  // Se hace en una empresa propia para no arrastrar los asientos rotos de las pruebas anteriores.
  const u = ctx.usuario
  const empresaLibro = (await prisma.company.create({ data: { name: `CONC libro ${sufijo}`, slug: `conc-libro-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })).id
  const suc = (await prisma.sucursal.create({ data: { companyId: empresaLibro, nombre: 'Principal' }, select: { id: true } })).id
  const cli = (await prisma.cliente.create({ data: { companyId: empresaLibro, supabaseId: `sb-conclibro-${sufijo}`, nombre: 'Cliente libro', email: `conclibro-${sufijo}@prueba.test` }, select: { id: true } })).id
  const item = await conEmpresa(empresaLibro, (tx) => crearItemEnTx(tx, empresaLibro, { name: `Libro ${sufijo}`, type: 'SERVICE', price: 80, sku: `CONC-L-${sufijo}` }, { actorId: u, ipAddress: '127.0.0.1', userAgent: 'test' }))
  await conEmpresa(empresaLibro, (tx) => cambiarEstadoItemEnTx(tx, empresaLibro, item.id, 'ACTIVE', { actorId: u, ipAddress: '127.0.0.1', userAgent: 'test' }))
  const variante = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: item.id }, select: { id: true } })).id
  for (let i = 0; i < 3; i++) {
    const r = await conEmpresa(empresaLibro, (tx) => crearPedidoEnTx(tx, empresaLibro, { customerId: cli, locationId: suc, origin: 'MARKETPLACE', lineas: [{ varianteId: variante, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx))
    const listo = await conEmpresa(empresaLibro, (tx) => marcarListoEnTx(tx, empresaLibro, r.pedidoId, empresa))
    await conEmpresa(empresaLibro, (tx) => completarPorQrEnTx(tx, empresaLibro, listo.qrToken as string, empresa))
  }
  const cuenta = async () => (await conEmpresa(empresaLibro, (tx) => conciliarEnTx(tx, { companyId: empresaLibro }, { reglas: ['G01'] })))[0]
  assert.equal((await cuenta()).total, 0)
  const medio = await prisma.merchantLedgerEntry.findFirstOrThrow({ where: { companyId: empresaLibro, seq: 2 } })
  await rompe('merchant_ledger_entries', Prisma.sql`UPDATE "merchant_ledger_entries" SET "balance" = "balance" + 5 WHERE "id" = ${ids(medio.id)}`)
  const g = await cuenta()
  assert.equal(g.total, 2, 'el asiento roto y el que le sigue (que ya no suma desde ese saldo)')
  assert.deepEqual(g.muestra.map((f) => f.referencia).sort(), ['#2', '#3'])
  // Un salto de numeración también se ve.
  await rompe('merchant_ledger_entries', Prisma.sql`UPDATE "merchant_ledger_entries" SET "balance" = "balance" - 5 WHERE "id" = ${ids(medio.id)}`)
  assert.equal((await cuenta()).total, 0)
  await rompe('merchant_ledger_entries', Prisma.sql`UPDATE "merchant_ledger_entries" SET "seq" = 7 WHERE "companyId" = ${ids(empresaLibro)} AND "seq" = 3`)
  assert.equal((await cuenta()).total, 1)
  // Limpieza de esta empresa.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'order_attributions', 'membego_order_lines', 'membego_orders']) await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" = '${empresaLibro}'`)
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: empresaLibro } })
})

// ── Alcance, muestra y aislamiento ───────────────────────────────────────────

test('17 · la muestra se acota pero el total cuenta todos; una regla se puede pedir sola', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await cerradoEnEfectivo()
    await rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "total" = "total" + 1 WHERE "id" = ${ids(r.pedidoId)}`)
  }
  const [h] = await enA((tx) => conciliarEnTx(tx, { companyId: ctx.a }, { reglas: ['L03'], muestra: 2 }))
  assert.ok(h.total >= 3)
  assert.equal(h.muestra.length, 2)
  assert.ok(h.muestra.every((f) => f.empresa.startsWith('CONC a ') && /^MBG-PED-/.test(f.referencia) && f.detalle.includes('Total')))
  const solo = await enA((tx) => conciliarEnTx(tx, { companyId: ctx.a }, { reglas: ['L03', 'C01'] }))
  assert.deepEqual(solo.map((x) => x.regla.codigo), ['C01', 'L03'].sort((a, b) => REGLAS.findIndex((r) => r.codigo === a) - REGLAS.findIndex((r) => r.codigo === b)))
})

test('18 · aislamiento: lo roto en una empresa no aparece en otra, y la plataforma ve a todas menos a las de práctica', async () => {
  // B: sana. Su conciliación no ve nada de A.
  const rb = await conEmpresa(ctx.b, async (tx) => {
    const r = await crearPedidoEnTx(tx, ctx.b, { customerId: ctx.clienteB, locationId: ctx.sB, origin: 'MARKETPLACE', lineas: [{ varianteId: ctx.varB, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx)
    return r
  })
  assert.ok(rb.pedidoId)
  assert.deepEqual(Object.values(await totales(ctx.b)).filter((v) => v !== 0), [])
  // Una anomalía en la empresa de práctica: la plataforma no la cuenta.
  const rd = await conEmpresa(ctx.demo, (tx) => crearPedidoEnTx(tx, ctx.demo, { customerId: ctx.clienteDemo, locationId: ctx.sDemo, origin: 'MARKETPLACE', lineas: [{ varianteId: ctx.varDemo, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx))
  await rompe('membego_orders', Prisma.sql`UPDATE "membego_orders" SET "total" = "total" + 1 WHERE "id" = ${ids(rd.pedidoId)}`)
  const plataforma = await sinEmpresa('conciliación de prueba (plataforma)', (tx) => conciliarEnTx(tx, { companyId: null }, { reglas: ['L03'], muestra: 50 }))
  const empresas = new Set(plataforma[0].muestra.map((f) => f.companyId))
  assert.ok(empresas.has(ctx.a), 'la plataforma ve lo roto de A')
  assert.ok(!empresas.has(ctx.demo), 'y deja fuera las empresas de práctica')
  const dedemo = await conEmpresa(ctx.demo, (tx) => conciliarEnTx(tx, { companyId: ctx.demo }, { reglas: ['L03'] }))
  assert.equal(dedemo[0].total, 1, 'la propia empresa de práctica sí se concilia cuando se pide por ella')
})
