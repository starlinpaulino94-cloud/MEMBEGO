import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma, type MembegoOrderStatus } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { recibirEnTx, venderEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { PedidoError } from '../../src/modules/orders/errores'
import {
  aceptarPedidoEnTx,
  ajustarMontoEnTx,
  cancelarPedidoEnTx,
  cerrarPedidoExternoEnTx,
  completarPorQrEnTx,
  contarPedidosAbiertosEnTx,
  confirmarMontoEnTx,
  crearPedidoEnTx,
  marcarListoEnTx,
  obtenerPedidoEnTx,
  reembolsarPedidoEnTx,
  registrarPagoEnTx,
  verificarPagoExternamenteEnTx,
  renovarQrEnTx,
  type ContextoPedido,
  type EntradaPedido,
} from '../../src/modules/orders/service'
import { CANALES, DATO_DEL_CANAL, ESTADOS, puedeTransicionar } from '../../src/modules/orders/domain'
import { ofertaSupplyDePrueba } from './oferta-supply'
import { barridoPedidos, DIAS_SIN_RESPUESTA } from '../../src/modules/orders/barrido'
import { buscarPedidoPorQr } from '../../src/modules/orders/escaner'

/**
 * COMMERCE CORE · pedidos Membego contra PostgreSQL de verdad (Fase 3).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que la base hace cumplir la máquina de estados (las 49 combinaciones), los
 *    totales, las fechas de cada estado, el QR, la inmutabilidad de las líneas y
 *    el cuadre pedido ↔ líneas, y que el dominio y la base dicen lo mismo;
 *  · que dos escaneos simultáneos del mismo QR cierran el pedido UNA vez y venden
 *    el inventario UNA vez;
 *  · que el flujo completo (crear → aceptar → ajustar → confirmar → listo → QR)
 *    aparta, vende y libera el inventario y deja la atribución y la bitácora;
 *  · que la numeración es correlativa por empresa aun creando pedidos en paralelo;
 *  · que ninguna empresa ve ni toca el pedido de otra, y que las FK compuestas
 *    rechazan mezclar sucursal, cliente o variante de empresas distintas.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T0 = new Date('2030-01-01T10:00:00.000Z')
const dias = (n: number) => new Date(T0.getTime() + n * 86_400_000)

const ctx = {
  a: '',
  b: '',
  usuario: '',
  sucA1: '',
  sucA2Inactiva: '',
  sucB: '',
  cli1: '',
  cli2: '',
  cliB: '',
  fisico: '', // variante controlada, 100.00
  servicio: '', // variante sin inventario, 250.00
  borrador: '', // variante de un ítem en DRAFT
  supply: '', // variante de un ítem de origen SUPPLY
  oferta: '', // la oferta de Supply a la que está atado ese ítem
  noMarketplace: '', // variante de un ítem que no se vende por marketplace
  varB: '',
}

const empresa = (actorId: string | null): ContextoPedido => ({ actor: 'EMPRESA', actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null, ipAddress: '127.0.0.1', userAgent: 'test' }
const sistema: ContextoPedido = { actor: 'SISTEMA', actorId: null }
const comoInventario = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

const pedidosCreados: string[] = []

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) =>
      prisma.company.create({
        data: { name: `Pedidos ${x} ${sufijo}`, slug: `pedidos-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' },
        select: { id: true },
      })
    )
  )
  ctx.a = a.id
  ctx.b = b.id
  const u = await prisma.user.create({
    data: { supabaseId: `sb-ped-${sufijo}`, email: `ped-${sufijo}@prueba.test`, name: 'Pedidos', role: 'SUPERADMIN' },
    select: { id: true },
  })
  ctx.usuario = u.id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2Inactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  const cli = (companyId: string, x: string) =>
    prisma.cliente.create({ data: { companyId, supabaseId: `sb-cli-${x}-${sufijo}`, nombre: `Cliente ${x}`, email: `cli-${x}-${sufijo}@prueba.test` }, select: { id: true } })
  ctx.cli1 = (await cli(ctx.a, '1')).id
  ctx.cli2 = (await cli(ctx.a, '2')).id
  ctx.cliB = (await cli(ctx.b, 'b')).id

  const crear = async (companyId: string, name: string, type: 'PHYSICAL_PRODUCT' | 'SERVICE', price: number, sku: string, activar = true, capabilities?: Record<string, boolean>) => {
    const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name, type, price, sku, ...(capabilities ? { capabilities } : {}) }, comoInventario(ctx.usuario)))
    if (activar) await conEmpresa(companyId, (tx) => cambiarEstadoItemEnTx(tx, companyId, r.id, 'ACTIVE', comoInventario(ctx.usuario)))
    const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
    return { itemId: r.id, varianteId: v.id }
  }
  ctx.fisico = (await crear(ctx.a, `Camiseta ${sufijo}`, 'PHYSICAL_PRODUCT', 100, `PED-F-${sufijo}`)).varianteId
  ctx.servicio = (await crear(ctx.a, `Lavado ${sufijo}`, 'SERVICE', 250, `PED-S-${sufijo}`)).varianteId
  ctx.borrador = (await crear(ctx.a, `Borrador ${sufijo}`, 'SERVICE', 10, `PED-D-${sufijo}`, false)).varianteId
  ctx.noMarketplace = (await crear(ctx.a, `Interno ${sufijo}`, 'SERVICE', 10, `PED-N-${sufijo}`, true, { availableMarketplace: false })).varianteId
  const sup = await crear(ctx.a, `Oferta ${sufijo}`, 'SERVICE', 80, `PED-O-${sufijo}`)
  const ofertaId = await ofertaSupplyDePrueba(ctx.usuario, sufijo)
  await prisma.catalogItem.update({ where: { id: sup.itemId }, data: { source: 'SUPPLY', supplyV2OfferId: ofertaId } })
  ctx.supply = sup.varianteId
  ctx.oferta = ofertaId
  ctx.varB = (await crear(ctx.b, `Ajeno ${sufijo}`, 'PHYSICAL_PRODUCT', 100, `PED-B-${sufijo}`)).varianteId

  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico, sucursalId: ctx.sucA1, cantidad: 1000, motivo: 'Stock de prueba' }, comoInventario(ctx.usuario)))
  await enB((tx) => recibirEnTx(tx, ctx.b, { varianteId: ctx.varB, sucursalId: ctx.sucB, cantidad: 100, motivo: 'Stock de prueba' }, comoInventario(ctx.usuario)))
})

after(async () => {
  // Las líneas y el ledger no se borran (lo prohíbe la base). Para limpiar el
  // rastro de la prueba se desactivan los disparadores ordinarios solo en esta
  // transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    // Cerrar un pedido de marketplace cobra su comisión (Fase 4): también se limpia lo de la cuenta.
    await tx.$executeRaw`DELETE FROM "merchant_commissions" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "merchant_statements" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "merchant_ledger_entries" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "merchant_billing_configs" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "payment_evidences" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "customer_confirmations" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "order_attributions" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "membego_order_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "membego_orders" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_movements" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_reservations" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_levels" WHERE "companyId" IN (${Prisma.join(ids)})`
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

/** El código del error de dominio (de pedidos o de inventario), o falla la prueba si fue otra cosa. */
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof PedidoError || e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

const entrada = (parcial: Partial<EntradaPedido> & Pick<EntradaPedido, 'lineas'>): EntradaPedido => ({
  customerId: ctx.cli1,
  locationId: ctx.sucA1,
  origin: 'MARKETPLACE',
  atribucion: { channel: 'MARKETPLACE_BROWSE' },
  ahora: T0,
  ...parcial,
})

async function crear(parcial: Partial<EntradaPedido> & Pick<EntradaPedido, 'lineas'>) {
  const r = await enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada(parcial), cliente))
  pedidosCreados.push(r.pedidoId)
  return r
}

const nivelFisico = () => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: ctx.fisico, locationId: ctx.sucA1 } } })
const pedidoDe = (id: string) => prisma.membegoOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, attribution: true, confirmation: true, payment: true } })
const SERVICIO_1 = { varianteId: '', cantidad: 1 }
const lineaServicio = (cantidad = 1) => ({ ...SERVICIO_1, varianteId: ctx.servicio, cantidad })
const lineaFisico = (cantidad = 1) => ({ varianteId: ctx.fisico, cantidad })

/** Lleva un pedido recién creado hasta LISTO y devuelve su QR. */
async function listo(pedidoId: string, ahora = T0) {
  const r = await enA((tx) => marcarListoEnTx(tx, ctx.a, pedidoId, empresa(ctx.usuario), ahora))
  assert.ok(r.qrToken)
  return r.qrToken as string
}

/** Una variante controlada de A con `cantidad` unidades en la sucursal principal. */
async function varianteConStock(name: string, sku: string, cantidad: number): Promise<string> {
  const r0 = await conEmpresa(ctx.a, (tx) => crearItemEnTx(tx, ctx.a, { name, type: 'PHYSICAL_PRODUCT', price: 10, sku }, comoInventario(ctx.usuario)))
  await conEmpresa(ctx.a, (tx) => cambiarEstadoItemEnTx(tx, ctx.a, r0.id, 'ACTIVE', comoInventario(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r0.id }, select: { id: true } })
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v.id, sucursalId: ctx.sucA1, cantidad, motivo: 'Stock de prueba' }, comoInventario(ctx.usuario)))
  return v.id
}

const completar = (token: string, ahora = T0) => enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(ctx.usuario), ahora))

// ── Crear ────────────────────────────────────────────────────────────────────

test('1 · crear un pedido de servicio: AWAITING_MERCHANT, precios de la base, código correlativo y atribución', async () => {
  const r = await crear({ lineas: [lineaServicio(2)], notas: '  sin prisa  ' })
  assert.equal(r.status, 'AWAITING_MERCHANT')
  assert.equal(r.repetido, false)
  assert.match(r.code, /^MBG-PED-\d{4}-\d{6}$/)
  assert.equal(r.total, '500.00')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.status, 'AWAITING_MERCHANT')
  assert.equal(p.verificationLevel, 'ATTRIBUTED')
  assert.equal(p.origin, 'MARKETPLACE')
  assert.equal(p.notes, 'sin prisa')
  assert.equal(p.subtotal.toFixed(2), '500.00')
  assert.equal(p.commissionableBase.toFixed(2), '500.00')
  assert.equal(p.total.toFixed(2), '500.00')
  assert.equal(p.lines.length, 1)
  assert.equal(p.lines[0].quantity, 2)
  assert.equal(p.lines[0].unitPrice.toFixed(2), '250.00')
  assert.equal(p.lines[0].inventoryReservationId, null, 'un servicio sin inventario no aparta nada')
  assert.match(p.lines[0].description, /Lavado/)
  assert.equal(p.attribution?.channel, 'MARKETPLACE_BROWSE')
  const auditoria = await prisma.auditLog.findMany({ where: { entidadTipo: 'MembegoOrder', entidadId: r.pedidoId } })
  assert.deepEqual(auditoria.map((a) => a.accion), ['ORDER_CREATED'])
  assert.equal(auditoria[0].userId, null, 'una acción del cliente no escribe un usuario de la empresa')
})

test('2 · un pedido con una variante que controla inventario la aparta con una reserva', async () => {
  const antes = await nivelFisico()
  const r = await crear({ lineas: [lineaFisico(3)] })
  const p = await pedidoDe(r.pedidoId)
  const reservaId = p.lines[0].inventoryReservationId
  assert.ok(reservaId)
  const reserva = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: reservaId } })
  assert.equal(reserva.status, 'ACTIVE')
  assert.equal(reserva.quantity, 3)
  assert.equal(reserva.referenceType, 'ORDER')
  assert.equal(reserva.referenceId, r.pedidoId)
  const despues = await nivelFisico()
  assert.equal(despues.reserved, antes.reserved + 3)
  assert.equal(despues.onHand, antes.onHand)
})

test('3 · sin stock suficiente el pedido NO se crea: no queda pedido, ni línea, ni reserva', async () => {
  const antes = await nivelFisico()
  const pedidosAntes = await prisma.membegoOrder.count({ where: { companyId: ctx.a } })
  const codigo = await codigoDe(enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada({ lineas: [lineaFisico(5000)] }), cliente)))
  assert.equal(codigo, 'STOCK_INSUFICIENTE')
  assert.equal(await prisma.membegoOrder.count({ where: { companyId: ctx.a } }), pedidosAntes)
  const despues = await nivelFisico()
  assert.equal(despues.reserved, antes.reserved)
})

test('4 · el precio sale de la base y se congela: cambiar el precio después no cambia el pedido', async () => {
  const r = await crear({ lineas: [lineaServicio(1)] })
  await prisma.catalogVariant.update({ where: { id: ctx.servicio }, data: { price: 999 } })
  try {
    const p = await pedidoDe(r.pedidoId)
    assert.equal(p.lines[0].unitPrice.toFixed(2), '250.00')
    assert.equal(p.total.toFixed(2), '250.00')
    const nuevo = await crear({ lineas: [lineaServicio(1)] })
    assert.equal(nuevo.total, '999.00', 'un pedido nuevo toma el precio vigente')
  } finally {
    await prisma.catalogVariant.update({ where: { id: ctx.servicio }, data: { price: 250 } })
  }
})

test('5 · dos renglones de la misma variante se unen en una línea', async () => {
  const r = await crear({ lineas: [lineaServicio(1), lineaServicio(2)] })
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.lines.length, 1)
  assert.equal(p.lines[0].quantity, 3)
  assert.equal(p.total.toFixed(2), '750.00')
})

const intentaConCliente = (parcial: Partial<EntradaPedido> & Pick<EntradaPedido, 'lineas'>) => codigoDe(enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada(parcial), cliente)))

test('6 · un descuento de línea baja la base comisionable', async () => {
  // El descuento de una línea lo fija el sistema (una oferta, el envoltorio de Supply): una persona no.
  const r = await enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada({ lineas: [{ varianteId: ctx.servicio, cantidad: 2, descuento: 50 }] }), { actor: 'SISTEMA', actorId: null }))
  pedidosCreados.push(r.pedidoId)
  assert.equal(await intentaConCliente({ lineas: [{ varianteId: ctx.servicio, cantidad: 2, descuento: 50 }] }), 'DESCUENTO_NO_PERMITIDO', 'quien pide no fija descuentos')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.subtotal.toFixed(2), '500.00')
  assert.equal(p.discount.toFixed(2), '50.00')
  assert.equal(p.commissionableBase.toFixed(2), '450.00')
  assert.equal(p.total.toFixed(2), '450.00')
  assert.equal(p.lines[0].lineTotal.toFixed(2), '450.00')
})

test('7 · lo que no se puede pedir se rechaza con su código', async () => {
  const intenta = (parcial: Partial<EntradaPedido> & Pick<EntradaPedido, 'lineas'>, ctxx: ContextoPedido = cliente) => codigoDe(enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada(parcial), ctxx)))
  assert.equal(await intenta({ lineas: [] }), 'SIN_LINEAS')
  assert.equal(await intenta({ lineas: [lineaServicio(0)] }), 'PEDIDO_INVALIDO')
  assert.equal(await intenta({ lineas: [lineaServicio(1.5)] }), 'PEDIDO_INVALIDO')
  assert.equal(await intenta({ lineas: [{ varianteId: 'no-existe', cantidad: 1 }] }), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await intenta({ lineas: [{ varianteId: ctx.varB, cantidad: 1 }] }), 'VARIANTE_NO_ENCONTRADA', 'la variante de otra empresa no existe para esta')
  assert.equal(await intenta({ lineas: [lineaServicio()], customerId: ctx.cliB }), 'CLIENTE_NO_ENCONTRADO', 'el cliente de otra empresa no existe para esta')
  assert.equal(await intenta({ lineas: [lineaServicio()], locationId: ctx.sucB }), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await intenta({ lineas: [lineaServicio()], locationId: ctx.sucA2Inactiva }), 'SUCURSAL_INACTIVA')
  assert.equal(await intenta({ lineas: [{ varianteId: ctx.borrador, cantidad: 1 }] }), 'ITEM_NO_DISPONIBLE', 'un borrador no se vende')
  assert.equal(await intenta({ lineas: [{ varianteId: ctx.noMarketplace, cantidad: 1 }] }), 'ITEM_NO_DISPONIBLE', 'lo que no se vende por marketplace')
  assert.equal(await intenta({ lineas: [{ varianteId: ctx.supply, cantidad: 1 }] }), 'ITEM_DE_SUPPLY', 'las ofertas de Supply se compran por su checkout')
  assert.equal(await intenta({ lineas: [lineaServicio()], atribucion: { channel: 'REFERRAL' } }), 'ATRIBUCION_INVALIDA')
  assert.equal(await intenta({ lineas: [lineaServicio()], notas: 'x'.repeat(501) }), 'NOTA_INVALIDA')
  assert.equal(await intenta({ lineas: [lineaServicio()], idempotencyKey: 'x'.repeat(121) }), 'CLAVE_INVALIDA')
  assert.equal(await intenta({ lineas: [{ varianteId: ctx.servicio, cantidad: 1, descuento: 251 }] }, { actor: 'SISTEMA', actorId: null }), 'PEDIDO_INVALIDO', 'un descuento mayor a la línea')
})

test('7b · se cuentan los pedidos ABIERTOS de una ficha (esperando, en preparación o listos): lo cerrado y lo cancelado no cuentan', async () => {
  const cli = await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-cli-abiertos-${sufijo}`, nombre: 'Abiertos', email: `abiertos-${sufijo}@prueba.test` }, select: { id: true } })
  const abiertos = () => enA((tx) => contarPedidosAbiertosEnTx(tx, ctx.a, cli.id))
  assert.equal(await abiertos(), 0)
  const ped = async () => (await crear({ customerId: cli.id, lineas: [lineaServicio()] })).pedidoId
  const a = await ped()
  const b = await ped()
  const c = await ped()
  assert.equal(await abiertos(), 3)
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, b, empresa(ctx.usuario)))
  assert.equal(await abiertos(), 3, 'aceptado sigue abierto')
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, a, { motivo: 'x' }, empresa(ctx.usuario)))
  assert.equal(await abiertos(), 2, 'cancelado no cuenta')
  await completar(await listo(c))
  assert.equal(await abiertos(), 1, 'completado no cuenta')
  assert.equal(await enB((tx) => contarPedidosAbiertosEnTx(tx, ctx.b, cli.id)), 0, 'otra empresa no ve los pedidos de esta ficha')
})

test('8 · el origen SUPPLY solo acepta ofertas de Supply, y estas solo con ese origen', async () => {
  const r = await enA((tx) =>
    crearPedidoEnTx(tx, ctx.a, entrada({ origin: 'SUPPLY', lineas: [{ varianteId: ctx.supply, cantidad: 1 }], atribucion: { channel: 'SUPPLY_OFFER', supplyV2OfferId: ctx.oferta } }), sistema)
  )
  pedidosCreados.push(r.pedidoId)
  assert.equal(r.total, '80.00')
  const codigo = await codigoDe(enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada({ origin: 'SUPPLY', lineas: [lineaServicio()], atribucion: { channel: 'SUPPLY_OFFER', supplyV2OfferId: ctx.oferta } }), sistema)))
  assert.equal(codigo, 'ORIGEN_INCOHERENTE')
})

test('9 · idempotencia: la misma clave devuelve el pedido ya creado, sin apartar de nuevo', async () => {
  const clave = `clave-${sufijo}-1`
  const antes = await nivelFisico()
  const a = await crear({ lineas: [lineaFisico(2)], idempotencyKey: clave })
  const b = await crear({ lineas: [lineaFisico(2)], idempotencyKey: clave })
  assert.equal(b.pedidoId, a.pedidoId)
  assert.equal(b.repetido, true)
  assert.equal((await nivelFisico()).reserved, antes.reserved + 2, 'apartó una sola vez')
  const otro = await codigoDe(enA((tx) => crearPedidoEnTx(tx, ctx.a, entrada({ lineas: [lineaFisico(2)], idempotencyKey: clave, customerId: ctx.cli2 }), cliente)))
  assert.equal(otro, 'CLAVE_REUTILIZADA')
})

test('10 · el mismo documento de origen genera UN pedido (envoltorio idempotente)', async () => {
  const fuente = { tipo: 'DOCUMENTO_DE_PRUEBA', id: `doc-${sufijo}` }
  const a = await crear({ lineas: [lineaServicio()], fuente })
  const b = await crear({ lineas: [lineaServicio()], fuente })
  assert.equal(b.pedidoId, a.pedidoId)
  assert.equal(b.repetido, true)
  assert.equal(await prisma.membegoOrder.count({ where: { companyId: ctx.a, sourceType: fuente.tipo, sourceId: fuente.id } }), 1)
})

test('11 · numeración: 12 pedidos simultáneos reciben 12 códigos distintos y consecutivos; cada empresa lleva la suya', async () => {
  const antes = await prisma.membegoOrder.count({ where: { companyId: ctx.b } })
  assert.equal(antes, 0)
  const tandas = await Promise.all(
    Array.from({ length: 12 }, () => enB((tx) => crearPedidoEnTx(tx, ctx.b, { customerId: ctx.cliB, locationId: ctx.sucB, origin: 'MARKETPLACE', lineas: [{ varianteId: ctx.varB, cantidad: 1 }], atribucion: { channel: 'DIRECT' }, ahora: T0 }, cliente)))
  )
  for (const t of tandas) pedidosCreados.push(t.pedidoId)
  const codigos = tandas.map((t) => t.code).sort()
  assert.equal(new Set(codigos).size, 12)
  assert.deepEqual(codigos, Array.from({ length: 12 }, (_, i) => `MBG-PED-2030-${String(i + 1).padStart(6, '0')}`))
})

// ── Aceptar, ajustar, confirmar, listo ───────────────────────────────────────

test('12 · aceptar: AWAITING_MERCHANT → IN_PROGRESS; repetirlo es inofensivo; aceptar uno listo no se puede', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const a = await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario), T0))
  assert.equal(a.status, 'IN_PROGRESS')
  assert.equal(a.repetido, false)
  assert.equal((await pedidoDe(r.pedidoId)).acceptedAt?.toISOString(), T0.toISOString())
  const otra = await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario), T0))
  assert.equal(otra.repetido, true)
  await listo(r.pedidoId)
  assert.equal(await codigoDe(enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))), 'ESTADO_INVALIDO')
})

test('13 · ajustar el monto: recalcula base y total, exige motivo, es un valor (no un incremento) y borra la confirmación', async () => {
  const r = await crear({ lineas: [lineaServicio(2)] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1, montoVisto: '500.00' }, cliente))
  assert.ok((await pedidoDe(r.pedidoId)).customerConfirmedAt)

  assert.equal(await codigoDe(enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -50, motivo: '  ' }, empresa(ctx.usuario)))), 'MOTIVO_INVALIDO')
  const a1 = await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -50, motivo: 'Cliente frecuente' }, empresa(ctx.usuario)))
  assert.equal(a1.total, '450.00')
  let p = await pedidoDe(r.pedidoId)
  assert.equal(p.adjustment.toFixed(2), '-50.00')
  assert.equal(p.adjustmentReason, 'Cliente frecuente')
  assert.equal(p.commissionableBase.toFixed(2), '450.00')
  assert.equal(p.customerConfirmedAt, null, 'el cliente tiene que confirmar el monto nuevo')

  const igual = await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -50, motivo: 'Cliente frecuente' }, empresa(ctx.usuario)))
  assert.equal(igual.repetido, true)
  assert.equal((await pedidoDe(r.pedidoId)).total.toFixed(2), '450.00', 'pedir el mismo ajuste dos veces no lo suma')

  await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: 30, motivo: 'Recargo por urgencia' }, empresa(ctx.usuario)))
  p = await pedidoDe(r.pedidoId)
  assert.equal(p.total.toFixed(2), '530.00')
  await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: 0, motivo: 'Sin ajuste' }, empresa(ctx.usuario)))
  p = await pedidoDe(r.pedidoId)
  assert.equal(p.total.toFixed(2), '500.00')
  assert.equal(p.adjustmentReason, null)

  assert.equal(await codigoDe(enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -500.01, motivo: 'Demasiado' }, empresa(ctx.usuario)))), 'AJUSTE_INVALIDO', 'no puede dejar el pedido en negativo')
  assert.equal(await codigoDe(enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: 'abc', motivo: 'x' }, empresa(ctx.usuario)))), 'AJUSTE_INVALIDO')
  const acciones = (await prisma.auditLog.findMany({ where: { entidadTipo: 'MembegoOrder', entidadId: r.pedidoId }, orderBy: { createdAt: 'asc' } })).map((a) => a.accion)
  assert.equal(acciones.filter((a) => a === 'ORDER_ADJUSTED').length, 3, 'la repetición no audita')
})

test('14 · un pedido que aún espera a la empresa se puede ajustar; uno completado, no', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: 10, motivo: 'Cargo de envío' }, empresa(ctx.usuario)))
  const token = await listo(r.pedidoId)
  await completar(token)
  assert.equal(await codigoDe(enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: 0, motivo: 'Tarde' }, empresa(ctx.usuario)))), 'ESTADO_INVALIDO')
})

test('15 · confirmar el monto: solo el dueño, solo con el monto que vio, y una sola fila aunque se reconfirme', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const intento = (cid: string, visto: string | number) => enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: cid, montoVisto: visto }, cliente))
  assert.equal(await codigoDe(intento(ctx.cli1, '250.00')), 'ESTADO_INVALIDO', 'antes de que la empresa acepte el monto no es firme')
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  assert.equal(await codigoDe(intento(ctx.cli2, '250.00')), 'PEDIDO_NO_ENCONTRADO', 'el pedido de otro cliente no existe para este')
  assert.equal(await codigoDe(intento(ctx.cli1, '249.99')), 'MONTO_CAMBIO')
  assert.equal(await codigoDe(intento(ctx.cli1, 'abc')), 'MONTO_INVALIDO')
  const ok = await intento(ctx.cli1, '250.00')
  assert.equal(ok.repetido, false)
  assert.equal((await intento(ctx.cli1, 250)).repetido, true)

  // La empresa ajusta: la confirmación vieja ya no vale y el cliente confirma de nuevo.
  await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -25, motivo: 'Cortesía' }, empresa(ctx.usuario)))
  assert.equal(await codigoDe(intento(ctx.cli1, '250.00')), 'MONTO_CAMBIO', 'el monto que vio ya no es el vigente')
  await intento(ctx.cli1, '225.00')
  const filas = await prisma.customerConfirmation.findMany({ where: { orderId: r.pedidoId } })
  assert.equal(filas.length, 1, 'una confirmación por pedido')
  assert.equal(filas[0].confirmedTotal.toFixed(2), '225.00')
})

test('16 · marcar listo emite el QR (7 días), es idempotente y un QR renovado invalida el anterior', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const a = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario), T0))
  assert.equal(a.status, 'READY')
  assert.ok(a.qrToken && a.qrToken.length >= 32)
  assert.equal(a.qrExpiresAt?.toISOString(), dias(7).toISOString())
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.readyAt?.toISOString(), T0.toISOString())
  assert.equal(p.acceptedAt?.toISOString(), T0.toISOString(), 'pasar directo a listo también deja la fecha de aceptación')
  const otra = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario), T0))
  assert.equal(otra.repetido, true)
  assert.equal(otra.qrToken, a.qrToken, 'no se emite un QR nuevo por repetir')

  assert.equal(await codigoDe(enA((tx) => renovarQrEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli2 }, cliente))), 'PEDIDO_NO_ENCONTRADO')
  const nuevo = await enA((tx) => renovarQrEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1 }, cliente, dias(3)))
  assert.notEqual(nuevo.qrToken, a.qrToken)
  assert.equal(nuevo.qrExpiresAt.toISOString(), dias(10).toISOString())
  assert.equal(await codigoDe(completar(a.qrToken as string)), 'QR_INVALIDO', 'el QR anterior ya no cierra el pedido')
  assert.equal((await completar(nuevo.qrToken)).status, 'COMPLETED')
})

// ── Completar por QR ─────────────────────────────────────────────────────────

test('17 · completar por QR vende lo apartado: la reserva se consume y el stock baja UNA vez', async () => {
  const antes = await nivelFisico()
  const r = await crear({ lineas: [lineaFisico(4)] })
  const token = await listo(r.pedidoId)
  const c = await completar(token)
  assert.equal(c.status, 'COMPLETED')
  assert.equal(c.nivel, 'REDEEMED')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.status, 'COMPLETED')
  assert.equal(p.completedAt?.toISOString(), T0.toISOString())
  assert.equal(p.completedByUserId, ctx.usuario)
  assert.equal(p.verificationLevel, 'REDEEMED')
  const reserva = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: p.lines[0].inventoryReservationId as string } })
  assert.equal(reserva.status, 'CONSUMED')
  const despues = await nivelFisico()
  assert.equal(despues.onHand, antes.onHand - 4)
  assert.equal(despues.reserved, antes.reserved)
  const ventas = await prisma.inventoryMovement.findMany({ where: { referenceType: 'ORDER', referenceId: r.pedidoId, type: 'SALE' } })
  assert.equal(ventas.length, 1)
  assert.equal(ventas[0].quantity, 4)
})

test('18 · el nivel de verificación sube con la evidencia: REDEEMED → CUSTOMER_VERIFIED → EXTERNAL_PAYMENT_REPORTED (lo que registra la empresa) → PAYMENT_VERIFIED (fuente externa)', async () => {
  // Solo QR
  const a = await crear({ lineas: [lineaServicio()] })
  assert.equal((await completar(await listo(a.pedidoId))).nivel, 'REDEEMED')

  // QR + confirmación del cliente
  const b = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, b.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, b.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  assert.equal((await completar(await listo(b.pedidoId))).nivel, 'CUSTOMER_VERIFIED')

  // QR + confirmación + pago verificable (registrado antes de cerrar)
  const c = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, c.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, c.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  const tc = await listo(c.pedidoId)
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, c.pedidoId, { method: 'TRANSFER', amount: '250.00', reference: 'TRF-123' }, empresa(ctx.usuario)))
  assert.equal((await completar(tc)).nivel, 'EXTERNAL_PAYMENT_REPORTED', 'la referencia que registra la empresa es su palabra, no una verificación')

  // La evidencia llega DESPUÉS de cerrar: el nivel se recalcula; y solo una fuente externa lo lleva a PAYMENT_VERIFIED.
  const d = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, d.pedidoId, empresa(ctx.usuario)))
  const td = await listo(d.pedidoId)
  await completar(td)
  assert.equal((await pedidoDe(d.pedidoId)).verificationLevel, 'REDEEMED')
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, d.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  assert.equal((await pedidoDe(d.pedidoId)).verificationLevel, 'CUSTOMER_VERIFIED')
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, d.pedidoId, { method: 'CARD', amount: '250.00', reference: 'AUTH-9' }, empresa(ctx.usuario)))
  assert.equal((await pedidoDe(d.pedidoId)).verificationLevel, 'EXTERNAL_PAYMENT_REPORTED')
  const v = await enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, d.pedidoId, { source: 'GATEWAY_VERIFIED', verificationRef: `gw-${sufijo}-18`, method: 'CARD', amount: '250.00', reference: 'AUTH-9' }, sistema))
  assert.equal(v.nivel, 'PAYMENT_VERIFIED')
  assert.equal(v.repetido, false)
  const pd = await pedidoDe(d.pedidoId)
  assert.equal(pd.verificationLevel, 'PAYMENT_VERIFIED')
  assert.equal(pd.payment?.source, 'GATEWAY_VERIFIED')
  assert.equal(pd.payment?.verificationRef, `gw-${sufijo}-18`)
  assert.ok(pd.payment?.verifiedAt)
})

test('18b · verificar un pago es cosa del sistema o del superadmin, con la referencia del hecho externo; es idempotente por esa referencia y no se pisa', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  const token = await listo(r.pedidoId)
  const v = { source: 'BANK_RECONCILED' as const, verificationRef: `banco-${sufijo}-18b`, method: 'TRANSFER' as const, amount: '250.00', reference: 'TRF-1' }
  // La empresa no verifica; el superadmin sí (actorId obligatorio); el sistema sí.
  assert.equal(await codigoDe(enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, v, empresa(ctx.usuario)))), 'SOLO_SISTEMA')
  assert.equal(await codigoDe(enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, { ...v, source: 'MERCHANT_REPORTED' }, sistema))), 'VERIFICACION_INVALIDA')
  assert.equal(await codigoDe(enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, { ...v, verificationRef: '' }, sistema))), 'VERIFICACION_INVALIDA')
  assert.equal(await codigoDe(enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, { ...v, method: 'CASH' }, sistema))), 'VERIFICACION_INVALIDA')
  const sa = await enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, v, { ...empresa(ctx.usuario), superadmin: true }))
  assert.equal(sa.nivel, 'ATTRIBUTED', 'aún no está completado: la evidencia cuenta al cerrar')
  assert.equal((await pedidoDe(r.pedidoId)).payment?.source, 'BANK_RECONCILED')
  // La misma referencia externa otra vez: repetido, sin tocar nada. Otra referencia sobre un pedido ya verificado: se rechaza.
  assert.equal((await enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, v, sistema))).repetido, true)
  assert.equal(await codigoDe(enA((tx) => verificarPagoExternamenteEnTx(tx, ctx.a, r.pedidoId, { ...v, verificationRef: 'otro-hecho' }, sistema))), 'PAGO_YA_VERIFICADO')
  // Y la empresa no puede registrar encima de una constancia verificada.
  assert.equal(await codigoDe(enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CASH', amount: '250.00' }, empresa(ctx.usuario)))), 'PAGO_YA_VERIFICADO')
  assert.equal((await completar(token)).nivel, 'PAYMENT_VERIFIED')
  // La base: una constancia «reportada» no lleva verificación, y una verificada la lleva entera.
  await assert.rejects(
    prisma.paymentEvidence.update({ where: { orderId: r.pedidoId }, data: { source: 'MERCHANT_REPORTED' } }),
    /payment_evidences_fuente/
  )
  await assert.rejects(
    prisma.paymentEvidence.update({ where: { orderId: r.pedidoId }, data: { verificationRef: null } }),
    /payment_evidences_fuente/
  )
})

test('19 · un pago en efectivo o por otro monto deja constancia pero NO verifica; registrar otra vez reemplaza', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  assert.equal(await codigoDe(enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CASH', amount: 250 }, empresa(ctx.usuario)))), 'ESTADO_INVALIDO', 'aún no está listo')
  const token = await listo(r.pedidoId)
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CASH', amount: '250.00', reference: 'recibo 1' }, empresa(ctx.usuario)))
  await completar(token)
  assert.equal((await pedidoDe(r.pedidoId)).verificationLevel, 'CUSTOMER_VERIFIED', 'efectivo no verifica')
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'TRANSFER', amount: '100.00', reference: 'TRF-1' }, empresa(ctx.usuario)))
  assert.equal((await pedidoDe(r.pedidoId)).verificationLevel, 'CUSTOMER_VERIFIED', 'otro monto no verifica')
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'TRANSFER', amount: '250.00', reference: 'TRF-2' }, empresa(ctx.usuario)))
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.verificationLevel, 'EXTERNAL_PAYMENT_REPORTED')
  assert.equal(p.payment?.source, 'MERCHANT_REPORTED')
  assert.equal(p.paymentMethod, 'TRANSFER')
  assert.equal((await prisma.paymentEvidence.findMany({ where: { orderId: r.pedidoId } })).length, 1, 'una constancia por pedido')
  assert.equal(await codigoDe(enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CARD', amount: -1 }, empresa(ctx.usuario)))), 'PAGO_INVALIDO')
})

test('20 · canjear dos veces: el segundo escaneo recibe YA_COMPLETADO y el stock baja una sola vez', async () => {
  const antes = await nivelFisico()
  const r = await crear({ lineas: [lineaFisico(2)] })
  const token = await listo(r.pedidoId)
  await completar(token)
  assert.equal(await codigoDe(completar(token)), 'YA_COMPLETADO')
  assert.equal((await nivelFisico()).onHand, antes.onHand - 2)
})

test('21 · CONCURRENCIA: 6 escaneos simultáneos del mismo QR cierran el pedido UNA vez y venden UNA vez', async () => {
  const antes = await nivelFisico()
  const r = await crear({ lineas: [lineaFisico(5)] })
  const token = await listo(r.pedidoId)
  const resultados = await Promise.allSettled(Array.from({ length: 6 }, () => completar(token)))
  const ok = resultados.filter((x) => x.status === 'fulfilled')
  const rechazos = resultados.filter((x): x is PromiseRejectedResult => x.status === 'rejected')
  assert.equal(ok.length, 1, 'exactamente un escaneo gana')
  for (const x of rechazos) assert.equal((x.reason as PedidoError).codigo, 'YA_COMPLETADO')
  assert.equal(rechazos.length, 5)
  assert.equal((await nivelFisico()).onHand, antes.onHand - 5)
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceType: 'ORDER', referenceId: r.pedidoId, type: 'SALE' } }), 1)
})

test('22 · un QR desconocido, vacío, de otra empresa o vencido no cierra nada', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const token = await listo(r.pedidoId, T0)
  assert.equal(await codigoDe(completar('no-existe')), 'QR_INVALIDO')
  assert.equal(await codigoDe(completar('   ')), 'QR_INVALIDO')
  assert.equal(await codigoDe(completar('x'.repeat(201))), 'QR_INVALIDO')
  assert.equal(await codigoDe(enB((tx) => completarPorQrEnTx(tx, ctx.b, token, empresa(null), T0))), 'QR_INVALIDO', 'el QR de una empresa no sirve en otra')
  assert.equal(await codigoDe(completar(token, dias(7))), 'QR_VENCIDO', 'vence exactamente a los 7 días')
  assert.equal((await pedidoDe(r.pedidoId)).status, 'READY', 'sigue listo: el cliente puede renovar el QR')
  const nuevo = await enA((tx) => renovarQrEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1 }, cliente, dias(7)))
  assert.equal((await completar(nuevo.qrToken, dias(8))).status, 'COMPLETED')
})

test('23 · el QR de un pedido que aún no está listo, o ya cancelado, no existe', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const token = await listo(r.pedidoId)
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Cambio de planes' }, empresa(ctx.usuario)))
  assert.equal(await codigoDe(completar(token)), 'QR_INVALIDO', 'cancelar borra el QR')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.qrToken, null)
  assert.equal(p.qrExpiresAt, null)
})

test('24 · la reserva venció antes del cierre: se vende de lo disponible', async () => {
  // Variante propia: vencer una reserva toca TODAS las del mismo saldo.
  const v = await varianteConStock(`Vence ${sufijo}`, `PED-V-${sufijo}`, 10)
  const r = await crear({ lineas: [{ varianteId: v, cantidad: 3 }] }) // reserva hasta T0 + 7 días
  const nivel = () => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: ctx.sucA1 } } })
  assert.equal((await nivel()).reserved, 3)
  const token = await listo(r.pedidoId, dias(6)) // QR hasta T0 + 13 días
  const c = await completar(token, dias(8)) // la reserva ya venció
  assert.equal(c.status, 'COMPLETED')
  const despues = await nivel()
  assert.equal(despues.onHand, 7)
  assert.equal(despues.reserved, 0, 'nada quedó apartado')
  const ventas = await prisma.inventoryMovement.findMany({ where: { referenceType: 'ORDER', referenceId: r.pedidoId, type: 'SALE' } })
  assert.equal(ventas.length, 1)
  assert.equal(ventas[0].sourceBucket, 'AVAILABLE', 'vendió de lo disponible, no de una reserva')
  const reserva = await prisma.inventoryReservation.findFirstOrThrow({ where: { referenceType: 'ORDER', referenceId: r.pedidoId } })
  assert.equal(reserva.status, 'EXPIRED')
})

test('25 · la reserva venció y el stock ya no alcanza: el cierre falla claro y el pedido sigue LISTO', async () => {
  const v = { id: await varianteConStock(`Escaso ${sufijo}`, `PED-E-${sufijo}`, 5) }
  const r = await crear({ lineas: [{ varianteId: v.id, cantidad: 5 }] })
  const token = await listo(r.pedidoId, dias(6))
  // Vence la reserva (otra persona toca el saldo pasada la vigencia) y se vende el stock a otro.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v.id, sucursalId: ctx.sucA1, cantidad: 5, ahora: dias(8) }, comoInventario(ctx.usuario)))
  assert.equal(await codigoDe(completar(token, dias(8))), 'STOCK_YA_NO_ALCANZA')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.status, 'READY', 'la transacción se deshizo entera')
  assert.equal(p.completedAt, null)
})

// ── Cancelar y reembolsar ────────────────────────────────────────────────────

test('26 · el cliente cancela antes de que la empresa acepte: se libera la reserva y se anota el motivo', async () => {
  const antes = await nivelFisico()
  const r = await crear({ lineas: [lineaFisico(3)] })
  assert.equal((await nivelFisico()).reserved, antes.reserved + 3)
  assert.equal(await codigoDe(enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: ' ', customerId: ctx.cli1 }, cliente))), 'MOTIVO_INVALIDO')
  assert.equal(await codigoDe(enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Ya no', customerId: ctx.cli2 }, cliente))), 'PEDIDO_NO_ENCONTRADO')
  const c = await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Ya no lo necesito', customerId: ctx.cli1 }, cliente, T0))
  assert.equal(c.status, 'CANCELLED')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.cancelReason, 'Ya no lo necesito')
  assert.equal(p.cancelledAt?.toISOString(), T0.toISOString())
  const reserva = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: p.lines[0].inventoryReservationId as string } })
  assert.equal(reserva.status, 'RELEASED')
  const despues = await nivelFisico()
  assert.equal(despues.reserved, antes.reserved)
  assert.equal(despues.onHand, antes.onHand)
  const otra = await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Otra vez', customerId: ctx.cli1 }, cliente))
  assert.equal(otra.repetido, true)
})

test('27 · el cliente NO puede cancelar un pedido que la empresa ya está atendiendo; la empresa sí, hasta que se cierre', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Ya no', customerId: ctx.cli1 }, cliente))), 'ESTADO_INVALIDO')
  await listo(r.pedidoId)
  const c = await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'No hay cómo atenderlo' }, empresa(ctx.usuario)))
  assert.equal(c.status, 'CANCELLED')

  const cerrado = await crear({ lineas: [lineaServicio()] })
  await completar(await listo(cerrado.pedidoId))
  assert.equal(await codigoDe(enA((tx) => cancelarPedidoEnTx(tx, ctx.a, cerrado.pedidoId, { motivo: 'Tarde' }, empresa(ctx.usuario)))), 'ESTADO_INVALIDO', 'un pedido cerrado se reembolsa, no se cancela')
})

test('28 · reembolsar un pedido completado: sin devolver stock no mueve el inventario; devolviéndolo, lo repone', async () => {
  const r1 = await crear({ lineas: [lineaFisico(2)] })
  await completar(await listo(r1.pedidoId))
  assert.equal(await codigoDe(enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r1.pedidoId, { motivo: '  ' }, empresa(ctx.usuario)))), 'MOTIVO_INVALIDO')
  const antes = await nivelFisico()
  const e = await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r1.pedidoId, { motivo: 'El cliente lo devolvió' }, empresa(ctx.usuario), T0))
  assert.equal(e.status, 'REFUNDED')
  assert.equal((await nivelFisico()).onHand, antes.onHand, 'sin devolver al inventario no se repone')
  assert.equal((await pedidoDe(r1.pedidoId)).refundReason, 'El cliente lo devolvió')
  assert.equal((await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r1.pedidoId, { motivo: 'otra vez' }, empresa(ctx.usuario)))).repetido, true)

  const r2 = await crear({ lineas: [lineaFisico(2)] })
  await completar(await listo(r2.pedidoId))
  const antes2 = await nivelFisico()
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r2.pedidoId, { motivo: 'Defectuoso', devolverAlInventario: true }, empresa(ctx.usuario), T0))
  assert.equal((await nivelFisico()).onHand, antes2.onHand + 2)
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceType: 'ORDER', referenceId: r2.pedidoId, type: 'RETURN' } }), 1)

  const noCompletado = await crear({ lineas: [lineaServicio()] })
  assert.equal(await codigoDe(enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, noCompletado.pedidoId, { motivo: 'x' }, empresa(ctx.usuario)))), 'ESTADO_INVALIDO')
})

test('29 · la bitácora recoge cada paso del flujo completo, con quién lo hizo', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => ajustarMontoEnTx(tx, ctx.a, r.pedidoId, { ajuste: -10, motivo: 'Promoción' }, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1, montoVisto: '240.00' }, cliente))
  const token = await listo(r.pedidoId)
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CASH', amount: '240.00' }, empresa(ctx.usuario)))
  await completar(token)
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Prueba' }, empresa(ctx.usuario)))
  const filas = await prisma.auditLog.findMany({ where: { entidadTipo: 'MembegoOrder', entidadId: r.pedidoId }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(
    filas.map((f) => f.accion),
    ['ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_ADJUSTED', 'ORDER_CONFIRMED', 'ORDER_READY', 'ORDER_PAYMENT_RECORDED', 'ORDER_COMPLETED', 'ORDER_REFUNDED']
  )
  const porCliente = filas.filter((f) => (f.payload as { por?: string }).por === 'CLIENTE')
  assert.deepEqual(porCliente.map((f) => f.accion), ['ORDER_CREATED', 'ORDER_CONFIRMED'])
  for (const f of porCliente) assert.equal(f.userId, null)
  for (const f of filas.filter((x) => (x.payload as { por?: string }).por === 'EMPRESA')) assert.equal(f.userId, ctx.usuario)
  for (const f of filas) assert.equal(f.companyId, ctx.a)
})

test('30 · aislamiento: ninguna empresa lee ni toca el pedido de otra', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  assert.equal(await enB((tx) => obtenerPedidoEnTx(tx, ctx.b, r.pedidoId)), null)
  // Funciones y no promesas: una promesa creada de antemano rechazaría sin que nadie la espere todavía.
  for (const intento of [
    () => enB((tx) => aceptarPedidoEnTx(tx, ctx.b, r.pedidoId, empresa(null))),
    () => enB((tx) => marcarListoEnTx(tx, ctx.b, r.pedidoId, empresa(null))),
    () => enB((tx) => cancelarPedidoEnTx(tx, ctx.b, r.pedidoId, { motivo: 'x' }, empresa(null))),
    () => enB((tx) => ajustarMontoEnTx(tx, ctx.b, r.pedidoId, { ajuste: 1, motivo: 'x' }, empresa(null))),
  ]) {
    assert.equal(await codigoDe(intento()), 'PEDIDO_NO_ENCONTRADO')
  }
  assert.equal((await pedidoDe(r.pedidoId)).status, 'AWAITING_MERCHANT')
})

test('30b · el barrido cancela los pedidos que la empresa no atendió en 7 días y libera lo apartado; no toca lo aceptado ni lo reciente', async () => {
  const ahora = Date.now()
  const antes = await nivelFisico()
  const sinAtender = await crear({ lineas: [lineaFisico(2)] })
  const aceptado = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, aceptado.pedidoId, empresa(ctx.usuario)))
  assert.equal((await nivelFisico()).reserved, antes.reserved + 2)

  // A los 3 días todavía es pronto.
  const temprano = await barridoPedidos(new Date(ahora + (DIAS_SIN_RESPUESTA - 4) * 86_400_000))
  assert.equal(temprano.errores, 0)
  assert.equal((await pedidoDe(sinAtender.pedidoId)).status, 'AWAITING_MERCHANT')

  const tarde = new Date(ahora + (DIAS_SIN_RESPUESTA + 1) * 86_400_000)
  const r = await barridoPedidos(tarde)
  assert.equal(r.errores, 0)
  assert.ok(r.cancelados >= 1)
  const p = await pedidoDe(sinAtender.pedidoId)
  assert.equal(p.status, 'CANCELLED')
  assert.equal(p.cancelReason, 'La empresa no respondió a tiempo')
  const reserva = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: p.lines[0].inventoryReservationId as string } })
  assert.equal(reserva.status, 'RELEASED')
  assert.equal((await pedidoDe(aceptado.pedidoId)).status, 'IN_PROGRESS', 'un pedido aceptado no se cancela solo')
  assert.equal((await barridoPedidos(tarde)).cancelados, 0, 'idempotente')
  const auditoria = await prisma.auditLog.findFirst({ where: { entidadId: sinAtender.pedidoId, accion: 'ORDER_CANCELLED' } })
  assert.equal((auditoria?.payload as { por?: string })?.por, 'SISTEMA')
})

test('30c · cerrar sin QR es cosa del sistema, nunca de un pedido de la vitrina; deriva el nivel de la evidencia', async () => {
  const hecho = await enA((tx) =>
    crearPedidoEnTx(tx, ctx.a, entrada({ origin: 'API', lineas: [lineaServicio()], atribucion: { channel: 'DIRECT' } }), sistema)
  )
  pedidosCreados.push(hecho.pedidoId)
  assert.equal(await codigoDe(enA((tx) => cerrarPedidoExternoEnTx(tx, ctx.a, hecho.pedidoId, { completedAt: T0, confirmadoPorCliente: true }, empresa(ctx.usuario)))), 'SOLO_SISTEMA')
  const web = await crear({ lineas: [lineaServicio()] })
  assert.equal(await codigoDe(enA((tx) => cerrarPedidoExternoEnTx(tx, ctx.a, web.pedidoId, { completedAt: T0, confirmadoPorCliente: true }, sistema))), 'SOLO_CON_QR')

  const r = await enA((tx) =>
    cerrarPedidoExternoEnTx(tx, ctx.a, hecho.pedidoId, { completedAt: T0, confirmadoPorCliente: true, pago: { method: 'TRANSFER', amount: '250.00', reference: 'TRF-77', source: 'PROVIDER_VERIFIED', verificationRef: `ext-${sufijo}-30c` } }, sistema)
  )
  assert.equal(r.status, 'COMPLETED')
  assert.equal(r.nivel, 'PAYMENT_VERIFIED')
  const p = await pedidoDe(hecho.pedidoId)
  assert.equal(p.qrToken, null)
  assert.equal(p.completedAt?.toISOString(), T0.toISOString())
  assert.equal(p.payment?.reference, 'TRF-77')
  const otra = await enA((tx) => cerrarPedidoExternoEnTx(tx, ctx.a, hecho.pedidoId, { completedAt: T0, confirmadoPorCliente: true }, sistema))
  assert.equal(otra.repetido, true)
})

test('30d · el escáner: un QR de pedido LISTO se puede cerrar; vencido, ya canjeado o desconocido, se explica', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const token = await listo(r.pedidoId, T0)
  const listoParaCerrar = await buscarPedidoPorQr(token, T0)
  assert.ok(listoParaCerrar)
  assert.equal(listoParaCerrar.companyId, ctx.a)
  assert.equal(listoParaCerrar.pedido.puedeCerrar, true)
  assert.equal(listoParaCerrar.pedido.code, r.code)
  assert.equal(listoParaCerrar.pedido.total, '250.00')
  assert.equal(listoParaCerrar.pedido.confirmado, false)
  assert.deepEqual(listoParaCerrar.pedido.lineas.map((l) => l.quantity), [1])

  const vencido = await buscarPedidoPorQr(token, dias(7))
  assert.equal(vencido?.pedido.puedeCerrar, false)
  assert.match(vencido?.pedido.mensaje ?? '', /venció/)

  await completar(token, T0)
  const usado = await buscarPedidoPorQr(token, T0)
  assert.equal(usado?.pedido.puedeCerrar, false)
  assert.match(usado?.pedido.mensaje ?? '', /ya se canjeó/)

  assert.equal(await buscarPedidoPorQr('no-existe'), null)
  assert.equal(await buscarPedidoPorQr(''), null)
  assert.equal(await buscarPedidoPorQr('x'.repeat(201)), null)
})

// ═════════════════════════════════════════════════════════════════════════════
// LA BASE (no el servicio): reglas que valen para cualquier otra puerta
// ═════════════════════════════════════════════════════════════════════════════

const FIN = Symbol('deshacer')

/** Ejecuta `fn` en una transacción que SIEMPRE se deshace, y devuelve lo que `fn` devolvió. */
async function efimera<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let salida!: T
  try {
    await prisma.$transaction(async (tx) => {
      salida = await fn(tx)
      throw FIN
    })
  } catch (e) {
    if (e !== FIN) throw e
  }
  return salida
}

/** El mensaje de error de PostgreSQL de `fn`, o null si no falló. Usa un savepoint: la transacción sigue viva. */
async function mensajeDe(tx: Prisma.TransactionClient, fn: () => Promise<unknown>): Promise<string | null> {
  await tx.$executeRawUnsafe('SAVEPOINT intento')
  try {
    await fn()
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT intento')
    return null
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT intento')
    return e instanceof Error ? e.message : String(e)
  }
}

interface FilaPedido {
  id: string
  status: MembegoOrderStatus
  subtotal: number
  discount: number
  adjustment: number
  base: number
  tax: number
  total: number
  extra: Record<string, unknown>
}

/** Inserta un pedido «a mano» (con los disparadores desactivados) en el estado que se pida. */
async function sembrar(tx: Prisma.TransactionClient, parcial: Partial<FilaPedido> & { code?: string } = {}): Promise<FilaPedido & { code: string }> {
  const f: FilaPedido & { code: string } = {
    id: randomUUID(),
    status: 'CREATED',
    subtotal: 100,
    discount: 0,
    adjustment: 0,
    base: 100,
    tax: 0,
    total: 100,
    extra: {},
    code: `MBG-PED-2031-${String(Math.floor(Math.random() * 900000) + 100000)}`,
    ...parcial,
  }
  const cols = {
    id: f.id,
    companyId: ctx.a,
    code: f.code,
    locationId: ctx.sucA1,
    customerId: ctx.cli1,
    status: f.status,
    origin: 'MARKETPLACE',
    subtotal: f.subtotal,
    discount: f.discount,
    adjustment: f.adjustment,
    commissionableBase: f.base,
    tax: f.tax,
    total: f.total,
    updatedAt: new Date(),
    ...(f.adjustment !== 0 ? { adjustmentReason: 'prueba' } : {}),
    ...columnasDeEstado(f.status),
    ...f.extra,
  }
  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
  const nombres = Object.keys(cols)
  const marcadores = nombres.map((_, i) => `$${i + 1}${columnaConTipo(nombres[i])}`)
  await tx.$executeRawUnsafe(`INSERT INTO "membego_orders" (${nombres.map((n) => `"${n}"`).join(', ')}) VALUES (${marcadores.join(', ')})`, ...Object.values(cols))
  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin')
  return f
}

function columnaConTipo(nombre: string): string {
  if (nombre === 'status') return '::"MembegoOrderStatus"'
  if (nombre === 'origin') return '::"MembegoOrderOrigin"'
  return ''
}

/** Las columnas que cada estado exige (los CHECK de fechas, motivos y QR). */
function columnasDeEstado(s: MembegoOrderStatus): Record<string, unknown> {
  const ahora = new Date()
  switch (s) {
    case 'READY':
      return { qrToken: `qr-${randomUUID()}`, qrExpiresAt: ahora, readyAt: ahora }
    case 'COMPLETED':
      return { completedAt: ahora }
    case 'CANCELLED':
      return { cancelledAt: ahora, cancelReason: 'prueba' }
    case 'REFUNDED':
      return { completedAt: ahora, refundedAt: ahora, refundReason: 'prueba' }
    default:
      return {}
  }
}

test('31 · la base y el dominio dicen LO MISMO: las 49 combinaciones de estado', async () => {
  let n = 0
  for (const desde of ESTADOS) {
    for (const hasta of ESTADOS) {
      n++
      if (desde === hasta) continue
      await efimera(async (tx) => {
        const f = await sembrar(tx, { status: desde })
        // Las columnas del estado de destino; las del origen que ya no aplican se limpian.
        const limpiar = { qrToken: null, qrExpiresAt: null, cancelledAt: null, cancelReason: null, completedAt: null, refundedAt: null, refundReason: null, readyAt: null }
        const nuevas = { ...limpiar, ...columnasDeEstado(hasta) }
        const sets = Object.keys(nuevas).map((k, i) => `"${k}" = $${i + 2}`)
        const mensaje = await mensajeDe(tx, () =>
          tx.$executeRawUnsafe(`UPDATE "membego_orders" SET "status" = '${hasta}'::"MembegoOrderStatus", ${sets.join(', ')} WHERE "id" = $1`, f.id, ...Object.values(nuevas))
        )
        if (puedeTransicionar(desde, hasta)) assert.equal(mensaje, null, `${desde} → ${hasta} debería ser legal y la base dijo: ${mensaje}`)
        else assert.match(mensaje ?? 'NO FALLÓ', /membego_orders_transicion/, `${desde} → ${hasta} debería rechazarla el disparador`)
      })
    }
  }
  assert.equal(n, 49)
})

test('32 · un pedido nace CREATED: insertarlo en otro estado lo rechaza la base', async () => {
  await efimera(async (tx) => {
    const id = randomUUID()
    const mensaje = await mensajeDe(tx, () =>
      tx.$executeRawUnsafe(
        `INSERT INTO "membego_orders" ("id","companyId","code","locationId","customerId","status","origin","subtotal","commissionableBase","total","updatedAt")
         VALUES ($1,$2,'MBG-PED-2031-777777',$3,$4,'READY','MARKETPLACE',1,1,1,now())`,
        id, ctx.a, ctx.sucA1, ctx.cli1
      )
    )
    assert.match(mensaje ?? 'NO FALLÓ', /un pedido nace CREATED|membego_orders_estado/)
  })
})

test('33 · lo que identifica el pedido y fija lo vendido no cambia nunca; el monto de un pedido cerrado tampoco', async () => {
  await efimera(async (tx) => {
    const f = await sembrar(tx, { status: 'AWAITING_MERCHANT' })
    for (const set of [`"code" = 'MBG-PED-2031-000001'`, `"customerId" = '${ctx.cli2}'`, `"locationId" = '${ctx.sucA2Inactiva}'`, `"origin" = 'POS'::"MembegoOrderOrigin"`, `"subtotal" = 50, "commissionableBase" = 50, "total" = 50`, `"discount" = 10, "commissionableBase" = 90, "total" = 90`, `"tax" = 5, "total" = 105`, `"currency" = 'USD'`]) {
      const m = await mensajeDe(tx, () => tx.$executeRawUnsafe(`UPDATE "membego_orders" SET ${set} WHERE "id" = $1`, f.id))
      assert.match(m ?? 'NO FALLÓ', /membego_orders_inmutable/, set)
    }
    // El ajuste sí se puede mover mientras se atiende.
    assert.equal(await mensajeDe(tx, () => tx.$executeRawUnsafe(`UPDATE "membego_orders" SET "adjustment" = -10, "adjustmentReason" = 'x', "commissionableBase" = 90, "total" = 90 WHERE "id" = $1`, f.id)), null)
  })
  for (const estado of ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const) {
    await efimera(async (tx) => {
      const f = await sembrar(tx, { status: estado })
      const m = await mensajeDe(tx, () => tx.$executeRawUnsafe(`UPDATE "membego_orders" SET "adjustment" = -10, "adjustmentReason" = 'x', "commissionableBase" = 90, "total" = 90 WHERE "id" = $1`, f.id))
      assert.match(m ?? 'NO FALLÓ', /ya está cerrado/, estado)
    })
  }
})

test('34 · CHECK de montos: los totales cuadran o la base rechaza el pedido', async () => {
  const malos: [string, Partial<FilaPedido>][] = [
    ['total distinto de base + impuesto', { total: 101 }],
    ['base distinta de subtotal − descuento + ajuste', { base: 90, total: 90 }],
    ['subtotal negativo', { subtotal: -1, base: -1, total: -1 }],
    ['descuento mayor al subtotal', { discount: 150, base: -50, total: -50 }],
    ['impuesto negativo', { tax: -5, total: 95 }],
    ['base negativa por un ajuste', { adjustment: -200, base: -100, total: -100 }],
  ]
  for (const [nombre, parcial] of malos) {
    await efimera(async (tx) => {
      const m = await mensajeDe(tx, () => sembrar(tx, parcial))
      assert.match(m ?? 'NO FALLÓ', /membego_orders_montos/, nombre)
    })
  }
  await efimera(async (tx) => {
    const m = await mensajeDe(tx, () => sembrar(tx, { adjustment: 0, extra: { adjustmentReason: null } }))
    assert.equal(m, null, 'un pedido coherente sí entra')
    const ajusteSinMotivo = await mensajeDe(tx, () =>
      tx.$executeRawUnsafe(
        `INSERT INTO "membego_orders" ("id","companyId","code","locationId","customerId","status","origin","subtotal","adjustment","commissionableBase","total","updatedAt")
         VALUES ($1,$2,'MBG-PED-2031-888888',$3,$4,'CREATED','MARKETPLACE',100,-10,90,90,now())`,
        randomUUID(), ctx.a, ctx.sucA1, ctx.cli1
      )
    )
    assert.match(ajusteSinMotivo ?? 'NO FALLÓ', /membego_orders_ajuste/)
  })
})

test('35 · CHECK de estado ↔ fechas, motivos, QR, fuente y código', async () => {
  const casos: [string, string, Record<string, unknown>, MembegoOrderStatus][] = [
    ['cancelado sin fecha', 'membego_orders_estado_fechas', { cancelledAt: null }, 'CANCELLED'],
    ['reembolsado sin fecha de reembolso', 'membego_orders_estado_fechas', { refundedAt: null }, 'REFUNDED'],
    ['completado sin fecha', 'membego_orders_estado_fechas', { completedAt: null }, 'COMPLETED'],
    ['fecha de cancelación en un pedido vivo', 'membego_orders_estado_fechas', { cancelledAt: new Date() }, 'AWAITING_MERCHANT'],
    ['cancelado sin motivo', 'membego_orders_motivos', { cancelReason: '  ' }, 'CANCELLED'],
    ['reembolsado sin motivo', 'membego_orders_motivos', { refundReason: null }, 'REFUNDED'],
    ['listo sin QR', 'membego_orders_qr', { qrToken: null, qrExpiresAt: null }, 'READY'],
    ['QR sin vencimiento', 'membego_orders_qr', { qrExpiresAt: null }, 'READY'],
    ['fuente sin id', 'membego_orders_fuente', { sourceType: 'X' }, 'AWAITING_MERCHANT'],
    ['código mal formado', 'membego_orders_codigo', { code: 'PED-1' }, 'AWAITING_MERCHANT'],
    ['código con año de tres dígitos', 'membego_orders_codigo', { code: 'MBG-PED-203-000001' }, 'AWAITING_MERCHANT'],
  ]
  for (const [nombre, restriccion, extra, status] of casos) {
    await efimera(async (tx) => {
      const m = await mensajeDe(tx, () => sembrar(tx, { status, extra, ...(extra.code ? { code: extra.code as string } : {}) }))
      assert.match(m ?? 'NO FALLÓ', new RegExp(restriccion), nombre)
    })
  }
})

test('36 · las líneas no se editan ni se borran, ni siquiera por SQL directo', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const linea = (await pedidoDe(r.pedidoId)).lines[0]
  await efimera(async (tx) => {
    for (const sql of [
      `UPDATE "membego_order_lines" SET "quantity" = 99 WHERE "id" = '${linea.id}'`,
      `UPDATE "membego_order_lines" SET "unitPrice" = 1 WHERE "id" = '${linea.id}'`,
      `DELETE FROM "membego_order_lines" WHERE "id" = '${linea.id}'`,
      `TRUNCATE "membego_order_lines"`,
    ]) {
      const m = await mensajeDe(tx, () => tx.$executeRawUnsafe(sql))
      assert.match(m ?? 'NO FALLÓ', /membego_order_lines_inmutable/, sql)
    }
  })
  assert.equal((await pedidoDe(r.pedidoId)).lines[0].quantity, linea.quantity)
})

test('37 · CHECK de las líneas: cantidad positiva, descuento acotado y total de línea exacto', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const p = await pedidoDe(r.pedidoId)
  const intento = (cols: { quantity: number; unitPrice: number; discount: number; lineTotal: number }) => (tx: Prisma.TransactionClient) =>
    tx.$executeRawUnsafe(
      `INSERT INTO "membego_order_lines" ("id","companyId","orderId","catalogVariantId","description","sku","quantity","unitPrice","discount","lineTotal")
       VALUES ($1,$2,$3,$4,'x','SKU',$5,$6,$7,$8)`,
      randomUUID(), ctx.a, p.id, ctx.servicio, cols.quantity, cols.unitPrice, cols.discount, cols.lineTotal
    )
  for (const [nombre, cols] of [
    ['cantidad cero', { quantity: 0, unitPrice: 10, discount: 0, lineTotal: 0 }],
    ['precio negativo', { quantity: 1, unitPrice: -1, discount: 0, lineTotal: -1 }],
    ['descuento mayor a la línea', { quantity: 1, unitPrice: 10, discount: 11, lineTotal: -1 }],
    ['total de línea que no cuadra', { quantity: 2, unitPrice: 10, discount: 0, lineTotal: 19 }],
  ] as const) {
    await efimera(async (tx) => {
      const m = await mensajeDe(tx, () => intento(cols)(tx))
      assert.match(m ?? 'NO FALLÓ', /membego_order_lines_montos/, nombre)
    })
  }
})

test('38 · un pedido sin líneas, o con líneas que no suman, no se confirma (disparador diferido)', async () => {
  const insertarPedido = (tx: Prisma.TransactionClient, id: string, code: string, subtotal: number, discount = 0) =>
    tx.$executeRawUnsafe(
      `INSERT INTO "membego_orders" ("id","companyId","code","locationId","customerId","status","origin","subtotal","discount","commissionableBase","total","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'CREATED','MARKETPLACE',$6,$7,$8,$8,now())`,
      id, ctx.a, code, ctx.sucA1, ctx.cli1, subtotal, discount, subtotal - discount
    )
  const insertarLinea = (tx: Prisma.TransactionClient, orderId: string, cantidad: number, precio: number, descuento = 0) =>
    tx.$executeRawUnsafe(
      `INSERT INTO "membego_order_lines" ("id","companyId","orderId","catalogVariantId","description","sku","quantity","unitPrice","discount","lineTotal")
       VALUES ($1,$2,$3,$4,'x','SKU',$5,$6,$7,$8)`,
      randomUUID(), ctx.a, orderId, ctx.servicio, cantidad, precio, descuento, cantidad * precio - descuento
    )
  const confirmar = async (preparar: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string | null> => {
    try {
      await prisma.$transaction(async (tx) => {
        await preparar(tx)
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
        throw FIN // llegó al punto de confirmar sin que el disparador lo rechazara
      })
    } catch (e) {
      if (e === FIN) return null
      return e instanceof Error ? e.message : String(e)
    }
    return null
  }
  assert.match((await confirmar((tx) => insertarPedido(tx, randomUUID(), 'MBG-PED-2031-100001', 100))) ?? 'NO FALLÓ', /no tiene líneas/)
  assert.match(
    (await confirmar(async (tx) => {
      const id = randomUUID()
      await insertarPedido(tx, id, 'MBG-PED-2031-100002', 100)
      await insertarLinea(tx, id, 1, 90)
    })) ?? 'NO FALLÓ',
    /suman/
  )
  assert.match(
    (await confirmar(async (tx) => {
      const id = randomUUID()
      await insertarPedido(tx, id, 'MBG-PED-2031-100003', 100, 10)
      await insertarLinea(tx, id, 1, 100, 5) // descuento 5 ≠ 10
    })) ?? 'NO FALLÓ',
    /suman/
  )
  assert.equal(
    await confirmar(async (tx) => {
      const id = randomUUID()
      await insertarPedido(tx, id, 'MBG-PED-2031-100004', 100, 10)
      await insertarLinea(tx, id, 2, 30, 0)
      await insertarLinea(tx, id, 1, 40, 10)
    }),
    null,
    'un pedido cuyas líneas suman exacto sí se confirma'
  )
})

test('39 · atribución: la base exige el dato de cada canal (la misma tabla que el dominio)', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  const otro = await crear({ lineas: [lineaServicio()] })
  void r
  for (const canal of CANALES) {
    const dato = DATO_DEL_CANAL[canal]
    const columnas: Record<string, string | null> = { campaignId: null, promotionId: null, referralCode: null, supplyV2OfferId: null }
    // Sin dato
    await efimera(async (tx) => {
      await tx.$executeRawUnsafe('DELETE FROM "order_attributions" WHERE "orderId" = $1', otro.pedidoId)
      const m = await mensajeDe(tx, () =>
        tx.$executeRawUnsafe(`INSERT INTO "order_attributions" ("id","companyId","orderId","channel") VALUES ($1,$2,$3,'${canal}'::"MembegoAttributionChannel")`, randomUUID(), ctx.a, otro.pedidoId)
      )
      if (dato) assert.match(m ?? 'NO FALLÓ', /order_attributions_canal/, `${canal} sin ${dato}`)
      else assert.equal(m, null, `${canal} no pide dato`)
    })
    // Con su dato
    if (dato) {
      columnas[dato] = dato === 'supplyV2OfferId' ? ctx.oferta : 'dato-de-prueba'
      await efimera(async (tx) => {
        await tx.$executeRawUnsafe('DELETE FROM "order_attributions" WHERE "orderId" = $1', otro.pedidoId)
        const m = await mensajeDe(tx, () =>
          tx.$executeRawUnsafe(
            `INSERT INTO "order_attributions" ("id","companyId","orderId","channel","${dato}") VALUES ($1,$2,$3,'${canal}'::"MembegoAttributionChannel",$4)`,
            randomUUID(), ctx.a, otro.pedidoId, columnas[dato]
          )
        )
        assert.equal(m, null, `${canal} con ${dato}`)
      })
    }
  }
})

test('40 · FK compuestas: la base rechaza juntar sucursal, cliente o variante de empresas distintas', async () => {
  await efimera(async (tx) => {
    const insertar = (locationId: string, customerId: string, code: string) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "membego_orders" ("id","companyId","code","locationId","customerId","status","origin","subtotal","commissionableBase","total","updatedAt")
         VALUES ($1,$2,$3,$4,$5,'CREATED','MARKETPLACE',1,1,1,now())`,
        randomUUID(), ctx.a, code, locationId, customerId
      )
    assert.match((await mensajeDe(tx, () => insertar(ctx.sucB, ctx.cli1, 'MBG-PED-2031-200001'))) ?? 'NO FALLÓ', /membego_orders_locationId_companyId_fkey/)
    assert.match((await mensajeDe(tx, () => insertar(ctx.sucA1, ctx.cliB, 'MBG-PED-2031-200002'))) ?? 'NO FALLÓ', /membego_orders_customerId_companyId_fkey/)
    assert.equal(await mensajeDe(tx, () => insertar(ctx.sucA1, ctx.cli1, 'MBG-PED-2031-200003')), null)
  })
  const r = await crear({ lineas: [lineaServicio()] })
  await efimera(async (tx) => {
    const m = await mensajeDe(tx, () =>
      tx.$executeRawUnsafe(
        `INSERT INTO "membego_order_lines" ("id","companyId","orderId","catalogVariantId","description","sku","quantity","unitPrice","lineTotal")
         VALUES ($1,$2,$3,$4,'x','SKU',1,1,1)`,
        randomUUID(), ctx.a, r.pedidoId, ctx.varB
      )
    )
    assert.match(m ?? 'NO FALLÓ', /membego_order_lines_catalogVariantId_companyId_fkey/)
  })
})

test('41 · una sola atribución, una sola confirmación y un solo pago por pedido; el QR es único en toda la base', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa(ctx.usuario)))
  await enA((tx) => confirmarMontoEnTx(tx, ctx.a, r.pedidoId, { customerId: ctx.cli1, montoVisto: '250.00' }, cliente))
  const token = await listo(r.pedidoId)
  await enA((tx) => registrarPagoEnTx(tx, ctx.a, r.pedidoId, { method: 'CARD', amount: '250.00', reference: 'A' }, empresa(ctx.usuario)))
  await efimera(async (tx) => {
    const m = (sql: string, ...args: unknown[]) => mensajeDe(tx, () => tx.$executeRawUnsafe(sql, ...args))
    assert.match((await m(`INSERT INTO "order_attributions" ("id","companyId","orderId","channel") VALUES ($1,$2,$3,'DIRECT')`, randomUUID(), ctx.a, r.pedidoId)) ?? 'NO FALLÓ', /already exists|23505/)
    assert.match((await m(`INSERT INTO "customer_confirmations" ("id","companyId","orderId","confirmedTotal") VALUES ($1,$2,$3,1)`, randomUUID(), ctx.a, r.pedidoId)) ?? 'NO FALLÓ', /already exists|23505/)
    assert.match((await m(`INSERT INTO "payment_evidences" ("id","companyId","orderId","method","amount") VALUES ($1,$2,$3,'CASH',1)`, randomUUID(), ctx.a, r.pedidoId)) ?? 'NO FALLÓ', /already exists|23505/)
    const f = await sembrar(tx, { status: 'READY', extra: { qrToken: token, qrExpiresAt: new Date() } }).then(
      () => null,
      (e: Error) => e.message
    )
    assert.match(f ?? 'NO FALLÓ', /already exists|23505/)
  })
})

test('42 · con pedidos no se borra la variante, el cliente ni la sucursal (RESTRICT)', async () => {
  const r = await crear({ lineas: [lineaServicio()] })
  void r
  await efimera(async (tx) => {
    assert.match((await mensajeDe(tx, () => tx.$executeRawUnsafe(`DELETE FROM "catalog_variants" WHERE "id" = $1`, ctx.servicio))) ?? 'NO FALLÓ', /membego_order_lines_catalogVariantId_companyId_fkey|violates foreign key/)
    assert.match((await mensajeDe(tx, () => tx.$executeRawUnsafe(`DELETE FROM "clientes" WHERE "id" = $1`, ctx.cli1))) ?? 'NO FALLÓ', /membego_orders_customerId_companyId_fkey|violates foreign key/)
    assert.match((await mensajeDe(tx, () => tx.$executeRawUnsafe(`DELETE FROM "sucursales" WHERE "id" = $1`, ctx.sucA1))) ?? 'NO FALLÓ', /membego_orders_locationId_companyId_fkey|violates foreign key/)
  })
})

test('43 · el stock cuadra al final: lo apartado es exactamente lo que suman las reservas vivas', async () => {
  const n = await nivelFisico()
  const vivas = await prisma.inventoryReservation.aggregate({ where: { inventoryLevelId: n.id, status: 'ACTIVE' }, _sum: { quantity: true } })
  assert.equal(n.reserved, vivas._sum.quantity ?? 0)
  assert.ok(n.onHand - n.reserved >= 0)
})
