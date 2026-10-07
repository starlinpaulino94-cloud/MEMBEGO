import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { recibirEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { PedidoError } from '../../src/modules/orders/errores'
import {
  cancelarPedidoEnTx,
  confirmarMontoEnTx,
  crearPedidoEnTx,
  marcarListoEnTx,
  reembolsarPedidoEnTx,
  type ContextoPedido,
} from '../../src/modules/orders/service'
import { crearOfertaEnTx, publicarOfertaEnTx, reclamarOfertaEnTx } from '../../src/modules/deals/service'
import { getResumenSesion } from '../../src/modules/caja/queries'
import { PosError } from '../../src/modules/pos/errores'
import {
  buscarClientesDeCajaEnTx,
  buscarProductosDeCajaEnTx,
  cobrarPedidoEnCajaEnTx,
  venderEnMostradorEnTx,
  type ContextoCaja,
} from '../../src/modules/pos/service'
import { ID_CLIENTE_DE_MOSTRADOR } from '../../src/modules/pos/domain'

/**
 * POS CONECTADO A COMMERCE CORE contra PostgreSQL de verdad (Fase 7).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · una venta de mostrador crea el pedido POS, vende las existencias, registra el pago y deja el cobro
 *    (con su ticket) en la caja del turno, TODO en una transacción: si algo falla no queda nada;
 *  · reenviar el mismo formulario no vende dos veces; dos cajeros cobrando el mismo pedido a la vez
 *    producen UN solo cobro;
 *  · cobrar en la caja el pedido de la vitrina (con su QR) lo cierra con la evidencia del pago: una
 *    transferencia con referencia sobre un monto que el cliente confirmó llega a PAYMENT_VERIFIED y la
 *    comisión es el 8 %; el efectivo no verifica; el cupón de una oferta cobra su cuota y su descuento;
 *  · la venta de mostrador pura NO comisiona y nunca pasa de REDEEMED (no hay confirmación del cliente);
 *  · la caja tiene que estar abierta y ser de la empresa; un pedido de otra sucursal no se cobra en esta;
 *  · aislamiento entre empresas.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const ctx = {
  usuario: '',
  a: '',
  b: '',
  s1: '',
  s2: '',
  sB: '',
  caja: '',
  cajaS2: '',
  cajaB: '',
  cajaCerrada: '',
  servicio: '',
  fisico: '',
  soloMarketplace: '',
  borrador: '',
  varB: '',
  clientes: [] as string[],
  clienteB: '',
}

const caja = (): ContextoCaja => ({ actorId: ctx.usuario, nombre: 'Cajero de prueba', ipAddress: '127.0.0.1', userAgent: 'test' })
const empresa: ContextoPedido = { actor: 'EMPRESA', actorId: null }
const clienteCtx: ContextoPedido = { actor: 'CLIENTE', actorId: null }
const aud = () => ({ actorId: ctx.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const enA = <T>(fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(ctx.b, fn)

let claveN = 0
const clave = () => `venta-${sufijo}-${++claveN}`

before(async () => {
  const u = await prisma.user.create({ data: { supabaseId: `sb-pos-${sufijo}`, email: `pos-${sufijo}@prueba.test`, name: 'POS', role: 'SUPERADMIN' }, select: { id: true } })
  ctx.usuario = u.id
  const empresaNueva = async (k: string) => (await prisma.company.create({ data: { name: `POS ${k} ${sufijo}`, slug: `pos-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })).id
  ctx.a = await empresaNueva('a')
  ctx.b = await empresaNueva('b')
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.s1 = (await suc(ctx.a, 'Principal')).id
  ctx.s2 = (await suc(ctx.a, 'Norte')).id
  ctx.sB = (await suc(ctx.b, 'De B')).id
  const sesion = (companyId: string, sucursalId: string, estado: 'ABIERTA' | 'CERRADA' = 'ABIERTA') =>
    prisma.cajaSesion.create({ data: { companyId, sucursalId, abiertaPorId: u.id, estado, balanceInicial: 0 }, select: { id: true } })
  ctx.caja = (await sesion(ctx.a, ctx.s1)).id
  ctx.cajaS2 = (await sesion(ctx.a, ctx.s2)).id
  ctx.cajaB = (await sesion(ctx.b, ctx.sB)).id
  // Una caja ya cerrada (con su cierre registrado): cobrar contra ella no se puede.
  ctx.cajaCerrada = (await prisma.cajaSesion.create({ data: { companyId: ctx.a, sucursalId: ctx.s1, abiertaPorId: u.id, estado: 'CERRADA', balanceInicial: 0, cerradaPorId: u.id, cerradaAt: new Date() }, select: { id: true } })).id
  for (let i = 0; i < 3; i++) {
    ctx.clientes.push((await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-pcli-${i}-${sufijo}`, nombre: `Cliente Caja ${i}`, email: `pcli-${i}-${sufijo}@prueba.test`, telefono: `809555010${i}` }, select: { id: true } })).id)
  }
  ctx.clienteB = (await prisma.cliente.create({ data: { companyId: ctx.b, supabaseId: `sb-pclib-${sufijo}`, nombre: 'Cliente de B', email: `pclib-${sufijo}@prueba.test` }, select: { id: true } })).id

  const crear = async (companyId: string, name: string, type: 'PHYSICAL_PRODUCT' | 'SERVICE', price: number, sku: string, activar = true, capabilities?: Record<string, boolean>) => {
    const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name, type, price, sku, ...(capabilities ? { capabilities } : {}) }, aud()))
    if (activar) await conEmpresa(companyId, (tx) => cambiarEstadoItemEnTx(tx, companyId, r.id, 'ACTIVE', aud()))
    return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  }
  ctx.servicio = await crear(ctx.a, `Lavado caja ${sufijo}`, 'SERVICE', 250, `POS-S-${sufijo}`)
  ctx.fisico = await crear(ctx.a, `Camiseta caja ${sufijo}`, 'PHYSICAL_PRODUCT', 100, `POS-F-${sufijo}`)
  ctx.soloMarketplace = await crear(ctx.a, `Solo vitrina ${sufijo}`, 'SERVICE', 90, `POS-M-${sufijo}`, true, { availablePOS: false })
  ctx.borrador = await crear(ctx.a, `Borrador caja ${sufijo}`, 'SERVICE', 10, `POS-D-${sufijo}`, false)
  ctx.varB = await crear(ctx.b, `Ajeno caja ${sufijo}`, 'SERVICE', 60, `POS-B-${sufijo}`)
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico, sucursalId: ctx.s1, cantidad: 50, motivo: 'Stock de prueba' }, aud()))
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "transaction_transitions" WHERE "transactionId" IN (SELECT "id" FROM "transactions" WHERE "companyId" IN (${Prisma.join(ids)}))`
    for (const tabla of ['transactions', 'caja_sesiones', 'deal_claims', 'deals', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof PosError || e instanceof PedidoError || e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

const vender = (extra: Partial<Parameters<typeof venderEnMostradorEnTx>[2]> = {}, cajaSesionId = ctx.caja) =>
  enA((tx) =>
    venderEnMostradorEnTx(tx, ctx.a, { cajaSesionId, lineas: [{ varianteId: ctx.servicio, cantidad: 1 }], metodo: 'EFECTIVO', clave: clave(), ...extra }, caja())
  )

const pedidoDe = (id: string) => prisma.membegoOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, attribution: true, payment: true, commission: true } })
const nivel = async (variante: string, sucursal = ctx.s1) => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: variante, locationId: sucursal } } })
const cuentaPedidos = () => prisma.membegoOrder.count({ where: { companyId: ctx.a } })
const cuentaTx = () => prisma.transaction.count({ where: { companyId: ctx.a } })

/** Un pedido del marketplace LISTO con su QR, para cobrarlo en la caja. */
async function pedidoListo(opts: { cliente?: number; sucursal?: string; variante?: string; confirmado?: boolean } = {}) {
  const customerId = ctx.clientes[opts.cliente ?? 0]
  const r = await enA((tx) =>
    crearPedidoEnTx(tx, ctx.a, { customerId, locationId: opts.sucursal ?? ctx.s1, origin: 'MARKETPLACE', lineas: [{ varianteId: opts.variante ?? ctx.servicio, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, clienteCtx)
  )
  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa))
  if (opts.confirmado) await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId, montoVisto: r.total }, clienteCtx))
  return { pedidoId: r.pedidoId, token: listo.qrToken as string, total: r.total }
}

const cobrar = (token: string, extra: Record<string, unknown> = {}, cajaSesionId = ctx.caja) =>
  enA((tx) => cobrarPedidoEnCajaEnTx(tx, ctx.a, { cajaSesionId, token, metodo: 'EFECTIVO', ...extra }, caja()))

// ── Lo que se puede vender ───────────────────────────────────────────────────

test('1 · el catálogo de la caja: solo lo que se vende en caja, con existencias de ESA sucursal, y nada de otra empresa', async () => {
  const todo = await enA((tx) => buscarProductosDeCajaEnTx(tx, ctx.a, ctx.s1, ''))
  const ids = todo.map((p) => p.varianteId)
  assert.ok(ids.includes(ctx.servicio) && ids.includes(ctx.fisico))
  assert.ok(!ids.includes(ctx.soloMarketplace), 'lo que no se vende en caja no sale')
  assert.ok(!ids.includes(ctx.borrador), 'un borrador no se vende')
  assert.ok(!ids.includes(ctx.varB), 'lo de otra empresa no existe')
  assert.equal(todo.find((p) => p.varianteId === ctx.fisico)?.disponible, 50)
  assert.equal(todo.find((p) => p.varianteId === ctx.servicio)?.disponible, null, 'un servicio no controla inventario')
  assert.equal((await enA((tx) => buscarProductosDeCajaEnTx(tx, ctx.a, ctx.s2, 'Camiseta')))[0]?.disponible, 0, 'en otra sucursal no hay existencias')
  assert.equal((await enA((tx) => buscarProductosDeCajaEnTx(tx, ctx.a, ctx.s1, 'Camiseta'))).length, 1, 'la búsqueda filtra por nombre')
})

test('2 · buscar clientes: por nombre, teléfono o correo; mínimo dos letras; nunca la ficha de mostrador ni las de otra empresa', async () => {
  assert.equal((await enA((tx) => buscarClientesDeCajaEnTx(tx, ctx.a, 'a'))).length, 0)
  assert.equal((await enA((tx) => buscarClientesDeCajaEnTx(tx, ctx.a, 'Cliente Caja 1')))[0]?.id, ctx.clientes[1])
  assert.equal((await enA((tx) => buscarClientesDeCajaEnTx(tx, ctx.a, '8095550102')))[0]?.id, ctx.clientes[2])
  assert.equal((await enA((tx) => buscarClientesDeCajaEnTx(tx, ctx.a, 'Cliente de B'))).length, 0)
  await vender() // crea la ficha de mostrador
  assert.equal((await enA((tx) => buscarClientesDeCajaEnTx(tx, ctx.a, 'mostrador'))).length, 0)
})

// ── Venta de mostrador ───────────────────────────────────────────────────────

test('3 · una venta en efectivo: pedido POS completado, existencias vendidas, cobro en la caja del turno y cambio', async () => {
  const antes = await nivel(ctx.fisico)
  const r = await vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 2 }, { varianteId: ctx.fisico, cantidad: 3 }], recibido: '1000' })
  assert.equal(r.total, '800.00', '2 × 250 + 3 × 100, con los precios del catálogo')
  assert.equal(r.cambio, '200.00')
  assert.equal(r.repetido, false)

  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.origin, 'POS')
  assert.equal(p.status, 'COMPLETED')
  assert.equal(p.attribution?.channel, 'DIRECT')
  assert.equal(p.locationId, ctx.s1, 'se vende en la sucursal de la caja')
  assert.equal(p.completedByUserId, ctx.usuario)
  assert.equal(p.payment?.method, 'CASH')
  const despues = await nivel(ctx.fisico)
  assert.equal(despues.onHand, antes.onHand - 3, 'la existencia bajó')
  assert.equal(despues.reserved, antes.reserved, 'y no queda nada apartado')

  const t = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })
  assert.equal(t.tipo, 'SALE')
  assert.equal(t.cajaSesionId, ctx.caja)
  assert.equal(t.metodoCobro, 'EFECTIVO')
  assert.equal(Number(t.monto), 800)
  assert.equal(t.clienteId, p.customerId)
  const snap = t.snapshot as { lineas: unknown[]; ordenId: string; metodoCobroLabel: string; cambio: string }
  assert.equal(snap.lineas.length, 2, 'el ticket lleva el detalle de cada renglón')
  assert.equal(snap.ordenId, p.id)
  assert.equal(snap.cambio, '200.00')
  assert.equal(await prisma.auditLog.count({ where: { companyId: ctx.a, accion: 'COBRO_REGISTRADO', entidadId: p.id } }), 1)

  const resumen = await getResumenSesion(ctx.caja)
  assert.ok(resumen.totalEfectivo >= 800, 'el arqueo de la caja cuenta el cobro')
})

test('4 · una venta de mostrador pura NO comisiona y nunca pasa de REDEEMED (no hay confirmación del cliente)', async () => {
  const r = await vender({ metodo: 'TRANSFERENCIA', referencia: 'TRF-001' })
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.commission, null, 'la plataforma no cobra por lo que no trajo')
  assert.equal(p.verificationLevel, 'REDEEMED')
  assert.equal(r.nivel, 'REDEEMED')
  assert.equal(p.payment?.method, 'TRANSFER')
  assert.equal(p.payment?.reference, 'TRF-001')
  assert.equal(await prisma.commission.count({ where: { orderId: r.pedidoId } }), 0)
})

test('5 · transferencia y tarjeta exigen su referencia; la tarjeta se anota como «otro» en la caja', async () => {
  const antes = await cuentaPedidos()
  assert.equal(await codigoDe(vender({ metodo: 'TRANSFERENCIA' })), 'COBRO_INVALIDO')
  assert.equal(await codigoDe(vender({ metodo: 'TARJETA', referencia: '  ' })), 'COBRO_INVALIDO')
  assert.equal(await codigoDe(vender({ metodo: 'CRIPTO' })), 'COBRO_INVALIDO')
  assert.equal(await cuentaPedidos(), antes, 'un cobro inválido no deja ningún pedido a medias')
  const r = await vender({ metodo: 'TARJETA', referencia: 'AUT-445566' })
  const t = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })
  assert.equal(t.metodoCobro, 'OTRO')
  assert.equal((t.snapshot as { metodoCobroLabel: string }).metodoCobroLabel, 'Tarjeta')
  assert.equal((await pedidoDe(r.pedidoId)).payment?.method, 'CARD')
})

test('6 · efectivo: lo recibido tiene que alcanzar; sin decirlo no hay cambio', async () => {
  const antes = await cuentaPedidos()
  assert.equal(await codigoDe(vender({ recibido: '100' })), 'COBRO_INVALIDO', 'RD$ 250 no se paga con 100')
  assert.equal(await codigoDe(vender({ recibido: 'mucho' })), 'COBRO_INVALIDO')
  assert.equal(await cuentaPedidos(), antes)
  assert.equal((await vender()).cambio, null)
  assert.equal((await vender({ recibido: '250' })).cambio, '0.00')
})

test('7 · reenviar el MISMO formulario no vende dos veces', async () => {
  const k = clave()
  const pedidos = await cuentaPedidos()
  const antes = await nivel(ctx.fisico)
  const a = await vender({ clave: k, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] })
  const b = await vender({ clave: k, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] })
  assert.equal(a.repetido, false)
  assert.equal(b.repetido, true)
  assert.equal(b.pedidoId, a.pedidoId)
  assert.equal(b.transaccion.codigo, a.transaccion.codigo, 'devuelve el mismo ticket')
  assert.equal(await cuentaPedidos(), pedidos + 1)
  assert.equal((await nivel(ctx.fisico)).onHand, antes.onHand - 2, 'las existencias bajaron UNA vez')
  assert.equal(await prisma.transaction.count({ where: { companyId: ctx.a, snapshot: { path: ['ordenId'], equals: a.pedidoId } } }), 1)
})

test('8 · con cliente identificado la venta queda a su nombre; la ficha de otra empresa no se acepta', async () => {
  const r = await vender({ clienteId: ctx.clientes[1] })
  assert.equal((await pedidoDe(r.pedidoId)).customerId, ctx.clientes[1])
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })).clienteId, ctx.clientes[1])
  assert.equal(await codigoDe(vender({ clienteId: ctx.clienteB })), 'CLIENTE_NO_ENCONTRADO')
  // Sin cliente: la ficha compartida de mostrador, una sola por empresa.
  const x = await vender()
  const y = await vender()
  const fichas = await prisma.cliente.findMany({ where: { companyId: ctx.a, supabaseId: ID_CLIENTE_DE_MOSTRADOR } })
  assert.equal(fichas.length, 1)
  assert.equal(fichas[0].esLocal, true)
  assert.equal((await pedidoDe(x.pedidoId)).customerId, fichas[0].id)
  assert.equal((await pedidoDe(y.pedidoId)).customerId, fichas[0].id)
})

test('9 · sin caja abierta, o con la caja de otra empresa, no se vende ni queda nada', async () => {
  const pedidos = await cuentaPedidos()
  const txs = await cuentaTx()
  assert.equal(await codigoDe(vender({}, ctx.cajaCerrada)), 'CAJA_CERRADA')
  assert.equal(await codigoDe(vender({}, ctx.cajaB)), 'CAJA_CERRADA', 'la caja de B no es de A')
  assert.equal(await codigoDe(vender({}, 'caja-inventada')), 'CAJA_CERRADA')
  assert.equal(await cuentaPedidos(), pedidos)
  assert.equal(await cuentaTx(), txs)
})

test('10 · el carrito: vacío, cantidades absurdas y productos que no se venden en caja se rechazan; el precio no lo manda el navegador', async () => {
  const pedidos = await cuentaPedidos()
  assert.equal(await codigoDe(vender({ lineas: [] })), 'CARRITO_INVALIDO')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 0 }] })), 'CARRITO_INVALIDO')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 1000 }] })), 'CARRITO_INVALIDO')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 1.5 }] })), 'CARRITO_INVALIDO')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.soloMarketplace, cantidad: 1 }] })), 'ITEM_NO_DISPONIBLE')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.borrador, cantidad: 1 }] })), 'ITEM_NO_DISPONIBLE')
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.varB, cantidad: 1 }] })), 'VARIANTE_NO_ENCONTRADA', 'lo de otra empresa no existe')
  assert.equal(await cuentaPedidos(), pedidos, 'nada a medias')
  // Un precio o un descuento escondido en el renglón se ignora: el total sale del catálogo.
  const r = await vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 1, precio: 1, precioUnitario: 1, descuento: 200 } as never] })
  assert.equal(r.total, '250.00')
})

test('11 · sin existencias suficientes la venta falla ENTERA: ni pedido, ni cobro, ni existencias movidas', async () => {
  const pedidos = await cuentaPedidos()
  const txs = await cuentaTx()
  const antes = await nivel(ctx.fisico)
  assert.equal(await codigoDe(vender({ lineas: [{ varianteId: ctx.servicio, cantidad: 1 }, { varianteId: ctx.fisico, cantidad: 500 }] })), 'STOCK_INSUFICIENTE')
  assert.equal(await cuentaPedidos(), pedidos)
  assert.equal(await cuentaTx(), txs)
  const despues = await nivel(ctx.fisico)
  assert.deepEqual({ onHand: despues.onHand, reserved: despues.reserved }, { onHand: antes.onHand, reserved: antes.reserved })
})

// ── Cobrar un pedido Membego ─────────────────────────────────────────────────

test('12 · cobrar en efectivo el pedido de la vitrina: se cierra con su QR, comisiona CPA y queda en la caja', async () => {
  const p = await pedidoListo({ confirmado: true })
  const r = await cobrar(p.token, { recibido: '300' })
  assert.equal(r.total, '250.00')
  assert.equal(r.cambio, '50.00')
  const o = await pedidoDe(p.pedidoId)
  assert.equal(o.status, 'COMPLETED')
  assert.equal(o.payment?.method, 'CASH')
  assert.match(o.payment?.notes ?? '', /Recibido 300\.00, cambio 50\.00/)
  assert.equal(o.verificationLevel, 'CUSTOMER_VERIFIED', 'el efectivo deja constancia pero no verifica')
  assert.equal(o.commission?.type, 'CPA_FIXED')
  assert.equal(o.commission?.amount.toFixed(2), '100.00')
  const t = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })
  assert.equal(t.cajaSesionId, ctx.caja)
  assert.equal(Number(t.monto), 250)
  assert.equal((t.snapshot as { ordenTipo: string }).ordenTipo, 'PEDIDO_MEMBEGO')
})

test('13 · transferencia con referencia sobre un monto que el cliente confirmó: PAYMENT_VERIFIED y comisión del 8 %', async () => {
  const p = await pedidoListo({ confirmado: true })
  const r = await cobrar(p.token, { metodo: 'TRANSFERENCIA', referencia: 'TRF-889900' })
  assert.equal(r.nivel, 'PAYMENT_VERIFIED')
  const o = await pedidoDe(p.pedidoId)
  assert.equal(o.verificationLevel, 'PAYMENT_VERIFIED')
  assert.equal(o.payment?.reference, 'TRF-889900')
  assert.equal(o.commission?.type, 'PERCENTAGE')
  assert.equal(o.commission?.amount.toFixed(2), '20.00', '8 % de 250')
})

test('14 · sin la confirmación del cliente, ni una transferencia con referencia pasa de REDEEMED (la cadena de evidencia no se salta)', async () => {
  const p = await pedidoListo({ confirmado: false })
  const r = await cobrar(p.token, { metodo: 'TRANSFERENCIA', referencia: 'TRF-1' })
  assert.equal(r.nivel, 'REDEEMED')
  assert.equal((await pedidoDe(p.pedidoId)).commission?.type, 'CPA_FIXED')
})

test('15 · el cupón de una oferta se cobra en la caja con su descuento y su cuota de oferta', async () => {
  const oferta = await enA((tx) =>
    crearOfertaEnTx(tx, ctx.a, { title: `Oferta caja ${sufijo}`, catalogVariantId: ctx.servicio, discountType: 'PERCENT', discountValue: 20, startsAt: new Date(Date.now() - 3_600_000), endsAt: null, maxClaims: 5, budgetTotal: 1000 }, aud())
  )
  await enA((tx) => publicarOfertaEnTx(tx, ctx.a, oferta.id, aud()))
  const reclamo = await enA((tx) => reclamarOfertaEnTx(tx, ctx.a, { dealId: oferta.id, customerId: ctx.clientes[2], locationId: ctx.s1 }))
  const cupon = await prisma.membegoOrder.findUniqueOrThrow({ where: { id: reclamo.orderId }, select: { qrToken: true } })
  const r = await cobrar(cupon.qrToken as string, { metodo: 'TRANSFERENCIA', referencia: 'TRF-OFERTA' })
  assert.equal(r.total, '200.00', '20 % menos que RD$ 250')
  const claim = await prisma.dealClaim.findUniqueOrThrow({ where: { orderId: reclamo.orderId } })
  assert.equal(claim.status, 'REDEEMED')
  const d = await prisma.deal.findUniqueOrThrow({ where: { id: oferta.id } })
  assert.equal(d.budgetSpent.toFixed(2), '100.00')
  const c = await prisma.commission.findUniqueOrThrow({ where: { orderId: reclamo.orderId } })
  assert.equal(c.dealId, oferta.id)
  assert.equal(c.amount.toFixed(2), '100.00', 'la oferta cobra SU cuota CPA aunque el pago esté verificado')
  assert.equal(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })).monto), 200)
})

test('16 · lo que NO se cobra: otra sucursal, un QR ajeno o inventado, ya cobrado, cancelado, y sin caja abierta', async () => {
  const otraSuc = await pedidoListo({ sucursal: ctx.s2 })
  assert.equal(await codigoDe(cobrar(otraSuc.token)), 'OTRA_SUCURSAL')
  assert.equal((await pedidoDe(otraSuc.pedidoId)).status, 'READY', 'sigue listo')
  assert.equal((await cobrar(otraSuc.token, {}, ctx.cajaS2)).total, '250.00', 'en la caja de SU sucursal sí')

  assert.equal(await codigoDe(cobrar('token-inventado')), 'QR_INVALIDO')
  assert.equal(await codigoDe(cobrar('')), 'QR_INVALIDO')
  const ajeno = await pedidoListo()
  assert.equal(await codigoDe(enB((tx) => cobrarPedidoEnCajaEnTx(tx, ctx.b, { cajaSesionId: ctx.cajaB, token: ajeno.token, metodo: 'EFECTIVO' }, caja()))), 'QR_INVALIDO', 'el QR de A no sirve en la caja de B')

  assert.equal((await cobrar(ajeno.token)).total, '250.00')
  assert.equal(await codigoDe(cobrar(ajeno.token)), 'YA_COBRADO', 'el mismo QR no cobra dos veces')

  const cancelado = await pedidoListo()
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, cancelado.pedidoId, { motivo: 'prueba' }, empresa))
  assert.equal(await codigoDe(cobrar(cancelado.token)), 'QR_INVALIDO', 'al cancelarse el QR deja de valer')

  const listo = await pedidoListo()
  assert.equal(await codigoDe(cobrar(listo.token, {}, ctx.cajaCerrada)), 'CAJA_CERRADA')
  assert.equal((await pedidoDe(listo.pedidoId)).status, 'READY')
  assert.equal(await codigoDe(cobrar(listo.token, { metodo: 'TARJETA' })), 'COBRO_INVALIDO', 'la tarjeta sin autorización no cobra')
  assert.equal((await pedidoDe(listo.pedidoId)).status, 'READY', 'un cobro inválido deja el pedido como estaba')
  assert.equal((await pedidoDe(listo.pedidoId)).payment, null, 'y sin pago a medias')
})

test('17 · dos cajeros cobrando el MISMO pedido a la vez: un solo cobro', async () => {
  const p = await pedidoListo({ confirmado: true })
  const txs = await cuentaTx()
  const resultados = await Promise.allSettled([cobrar(p.token), cobrar(p.token), cobrar(p.token, { metodo: 'TRANSFERENCIA', referencia: 'TRF-RACE' })])
  const bien = resultados.filter((r) => r.status === 'fulfilled')
  assert.equal(bien.length, 1, 'solo uno gana')
  for (const r of resultados) if (r.status === 'rejected') assert.ok(r.reason instanceof PosError || r.reason instanceof PedidoError, 'los demás fallan con un mensaje de dominio')
  assert.equal(await cuentaTx(), txs + 1)
  assert.equal(await prisma.commission.count({ where: { orderId: p.pedidoId } }), 1)
  assert.equal((await pedidoDe(p.pedidoId)).status, 'COMPLETED')
})

// ── Después ──────────────────────────────────────────────────────────────────

test('18 · reembolsar una venta de mostrador devuelve las existencias; el cobro de la caja queda registrado (el reverso del efectivo es del cierre)', async () => {
  const antes = await nivel(ctx.fisico)
  const r = await vender({ lineas: [{ varianteId: ctx.fisico, cantidad: 4 }] })
  assert.equal((await nivel(ctx.fisico)).onHand, antes.onHand - 4)
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Devolución', devolverAlInventario: true }, empresa))
  assert.equal((await pedidoDe(r.pedidoId)).status, 'REFUNDED')
  assert.equal((await nivel(ctx.fisico)).onHand, antes.onHand, 'las existencias volvieron')
  const t = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transaccion.id } })
  assert.equal(t.estado, 'APPLIED', 'el ticket de la caja no se toca solo: la devolución del dinero es una decisión de quien cierra la caja')
})

test('19 · aislamiento: la analítica y los pedidos de B no ven nada de lo cobrado en la caja de A', async () => {
  const deB = await prisma.membegoOrder.count({ where: { companyId: ctx.b } })
  const txB = await prisma.transaction.count({ where: { companyId: ctx.b } })
  assert.equal(deB, 0)
  assert.equal(txB, 0)
  const r = await enB((tx) => venderEnMostradorEnTx(tx, ctx.b, { cajaSesionId: ctx.cajaB, lineas: [{ varianteId: ctx.varB, cantidad: 1 }], metodo: 'EFECTIVO', clave: clave() }, caja()))
  assert.equal(r.total, '60.00')
  assert.equal(await codigoDe(enB((tx) => venderEnMostradorEnTx(tx, ctx.b, { cajaSesionId: ctx.cajaB, lineas: [{ varianteId: ctx.servicio, cantidad: 1 }], metodo: 'EFECTIVO', clave: clave() }, caja()))), 'VARIANTE_NO_ENCONTRADA')
  const cobrosA = await prisma.transaction.count({ where: { companyId: ctx.a, cajaSesionId: ctx.cajaB } })
  assert.equal(cobrosA, 0)
})
