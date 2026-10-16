import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { actualizarItemEnTx, cambiarEstadoItemEnTx, crearItemEnTx, eliminarVarianteEnTx, agregarVarianteEnTx } from '../../src/modules/catalog/service'
import { activarLotesEnTx, recibirEnTx, registrarEntradaMultipleEnTx, reservarEnTx, venderEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { guardarRecetaDeKitEnTx, quitarRecetaDeKitEnTx, reservarKitEnTx } from '../../src/modules/inventory/kits-service'
import { candidatosAKitEnTx, disponibilidadDeKitsEnTx, kitsDeLaEmpresaEnTx, kitsDondeEntraEnTx, recetasDeKitsEnTx } from '../../src/modules/inventory/kits-queries'
import { cancelarPedidoEnTx, completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, reembolsarPedidoEnTx, type ContextoPedido, type EntradaPedido } from '../../src/modules/orders/service'
import { PedidoError } from '../../src/modules/orders/errores'
import { resumenDelCarritoEnTx } from '../../src/modules/checkout/service'
import { buscarProductosDeCajaEnTx } from '../../src/modules/pos/service'
import { ofertaSupplyDePrueba } from './oferta-supply'

/**
 * INV-5d · KITS contra PostgreSQL de verdad, con el servicio real y pedidos reales.
 *
 *  · la receta (qué se acepta y qué no: sin existencias propias, componentes con inventario, sin anidar, sin repetir) y lo que vigila la base;
 *  · cuántos kits alcanzan (el mínimo de los componentes) por sucursal;
 *  · vender un kit en un pedido aparta sus componentes (todo o nada), el cierre los vende, cancelar los libera y reembolsar los devuelve;
 *  · la receta puede cambiar sin tocar lo ya apartado; lotes de un componente funcionan igual;
 *  · el carrito y la caja enseñan lo que alcanza del kit; el catálogo no deja romper un kit.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T0 = new Date('2030-01-01T10:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', cli: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const empresa = (): ContextoPedido => ({ actor: 'EMPRESA', actorId: ctx.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null, ipAddress: '127.0.0.1', userAgent: 'test' }

let contador = 0
async function crearProducto(opts: { nombre?: string; tipo?: 'PHYSICAL_PRODUCT' | 'BUNDLE' | 'SERVICE'; stock?: number; sucursal?: string; empresaId?: string; precio?: number } = {}): Promise<string> {
  const n = ++contador
  const empresaId = opts.empresaId ?? ctx.a
  const tipo = opts.tipo ?? 'PHYSICAL_PRODUCT'
  const r = await conEmpresa(empresaId, (tx) => crearItemEnTx(tx, empresaId, { name: `${opts.nombre ?? 'Prod'} ${n} ${sufijo}`, type: tipo, price: opts.precio ?? 10, sku: `KT-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  await conEmpresa(empresaId, (tx) => cambiarEstadoItemEnTx(tx, empresaId, r.id, 'ACTIVE', como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  if (opts.stock) await conEmpresa(empresaId, (tx) => recibirEnTx(tx, empresaId, { varianteId: v.id, sucursalId: opts.sucursal ?? ctx.suc1, cantidad: opts.stock!, motivo: 'Stock de prueba' }, como(ctx.usuario)))
  return v.id
}
const crearKitProducto = (nombre = 'Kit') => crearProducto({ nombre, tipo: 'BUNDLE', precio: 300 })

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof PedidoError || e instanceof InventarioError) return e.codigo
    const codigo = (e as { codigo?: unknown } | null)?.codigo
    return typeof codigo === 'string' ? codigo : `OTRO: ${e instanceof Error ? e.message : String(e)}`
  }
  return 'SIN_ERROR'
}
async function mensajeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ''
}

const receta = (kit: string, componentes: unknown) => enA((tx) => guardarRecetaDeKitEnTx(tx, ctx.a, { kitVarianteId: kit, componentes }, como(ctx.usuario)))
const c = (varianteId: string, cantidad: number) => ({ varianteId, cantidad })

async function nivel(v: string, sucursalId = ctx.suc1) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
}
const disp = async (v: string, s = ctx.suc1) => {
  const n = await nivel(v, s)
  return { onHand: n.onHand, reserved: n.reserved, disponible: n.onHand - n.reserved }
}

const entradaPedido = (kit: string, cantidad: number, extra: Partial<EntradaPedido> = {}): EntradaPedido => ({
  customerId: ctx.cli,
  locationId: ctx.suc1,
  origin: 'MARKETPLACE',
  atribucion: { channel: 'MARKETPLACE_BROWSE' },
  ahora: T0,
  lineas: [{ varianteId: kit, cantidad }],
  ...extra,
})
const pedir = (kit: string, cantidad: number, extra: Partial<EntradaPedido> = {}) => enA((tx) => crearPedidoEnTx(tx, ctx.a, entradaPedido(kit, cantidad, extra), cliente))
async function listo(pedidoId: string) {
  const r = await enA((tx) => marcarListoEnTx(tx, ctx.a, pedidoId, empresa(), T0))
  return r.qrToken as string
}
const kitReservas = (pedidoId: string) => prisma.inventoryKitReservation.findMany({ where: { companyId: ctx.a, referenceType: 'ORDER', referenceId: pedidoId }, orderBy: { componentVariantId: 'asc' } })

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Kits ${x} ${sufijo}`, slug: `kits-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-kit-${sufijo}`, email: `kit-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.cli = (await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-clik-${sufijo}`, nombre: 'Cliente', email: `clik-${sufijo}@prueba.test` }, select: { id: true } })).id
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'merchant_commissions',
        'merchant_statements',
        'merchant_ledger_entries',
        'merchant_billing_configs',
        'payment_evidences',
        'customer_confirmations',
        'order_attributions',
        'membego_order_lines',
        'membego_orders',
        'inventory_kit_reservations',
        'inventory_kit_components',
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_variant_costs',
        'inventory_movements',
        'inventory_reservations',
        'inventory_levels',
      ]) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(`"${tabla}"`)} WHERE "companyId" IN (${Prisma.join(ids)})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.auditLog.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  // El usuario se queda: la oferta de Supply de la prueba 13 lo referencia (como en la prueba de pedidos).
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── La receta ────────────────────────────────────────────────────────────────

test('1 · guardar la receta: se acepta lo bueno, es idempotente y reemplaza; lo malo se rechaza sin dejar nada', async () => {
  const c1 = await crearProducto({ nombre: 'Shampoo', stock: 50 })
  const c2 = await crearProducto({ nombre: 'Acondicionador', stock: 20 })
  const c3 = await crearProducto({ nombre: 'Gel', stock: 5 })
  const kit = await crearKitProducto()
  const r = await receta(kit, [c(c2, 1), c(c1, 2)])
  assert.deepEqual([r.componentes, r.nueva, r.sinCambios], [2, true, false])
  assert.deepEqual((await enA((tx) => recetasDeKitsEnTx(tx, ctx.a, [kit]))).get(kit), [c(c1, 2), c(c2, 1)].sort((x, y) => (x.varianteId < y.varianteId ? -1 : 1)))
  // Lo mismo, en otro orden: nada cambia.
  const igual = await receta(kit, [c(c1, 2), c(c2, 1)])
  assert.deepEqual([igual.sinCambios, igual.nueva], [true, false])
  // Reemplazar: se va c2, entra c3, c1 cambia de cantidad.
  const nueva = await receta(kit, [c(c1, 3), c(c3, 1)])
  assert.deepEqual([nueva.sinCambios, nueva.nueva, nueva.componentes], [false, false, 2])
  assert.deepEqual((await prisma.inventoryKitComponent.findMany({ where: { kitVariantId: kit }, select: { componentVariantId: true, quantity: true } })).map((x) => [x.componentVariantId, x.quantity]).sort(), [[c1, 3], [c3, 1]].sort())
  const bitacora = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: kit, accion: 'INVENTORY_CONFIGURED' } })
  assert.equal(bitacora.length, 2, 'la primera y la que cambió; la repetida no deja rastro')

  const foto = async () => prisma.inventoryKitComponent.count({ where: { companyId: ctx.a } })
  const f0 = await foto()
  const otraKit = await crearKitProducto('Otro kit')
  assert.equal(await codigoDe(receta(otraKit, [])), 'RECETA_VACIA')
  assert.equal(await codigoDe(receta(otraKit, [c(c1, 1), c(c1, 2)])), 'COMPONENTE_REPETIDO')
  assert.equal(await codigoDe(receta(otraKit, [c(c1, 0)])), 'CANTIDAD_INVALIDA')
  assert.equal(await codigoDe(receta(otraKit, [c(c1, 1.5)])), 'CANTIDAD_INVALIDA')
  assert.equal(await codigoDe(receta(otraKit, [c(otraKit, 1)])), 'KIT_ES_SU_COMPONENTE')
  assert.equal(await codigoDe(receta(otraKit, [c('no-existe', 1)])), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(receta(otraKit, Array.from({ length: 31 }, (_, i) => c(`v${i}`, 1)))), 'RECETA_LARGA')
  // Un componente que no controla inventario no descuenta nada.
  const servicio = await crearProducto({ nombre: 'Servicio', tipo: 'SERVICE' })
  assert.equal(await codigoDe(receta(otraKit, [c(servicio, 1)])), 'COMPONENTE_SIN_INVENTARIO')
  // Un kit que controla inventario por su cuenta no es un kit.
  assert.equal(await codigoDe(receta(c1, [c(c2, 1)])), 'KIT_CONTROLA_INVENTARIO')
  // Los kits no se anidan: ni un kit como componente, ni un componente como kit.
  assert.equal(await codigoDe(receta(otraKit, [c(kit, 1)])), 'COMPONENTE_ES_KIT')
  const kitComoComponente = await crearKitProducto('Padre')
  assert.equal(await codigoDe(receta(kit, [c(kitComoComponente, 1)])), 'COMPONENTE_SIN_INVENTARIO', 'un kit tampoco lleva inventario, así que no vale de componente')
  // Un producto de otra empresa no entra.
  const ajeno = await crearProducto({ empresaId: ctx.b })
  assert.equal(await codigoDe(receta(otraKit, [c(ajeno, 1)])), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await foto(), f0, 'nada de lo rechazado dejó filas')
})

test('2 · la base: los kits no se anidan ni se componen de sí mismos y las cantidades son enteras positivas', async () => {
  const c1 = await crearProducto({ stock: 5 })
  const c2 = await crearProducto({ stock: 5 })
  const kit1 = await crearKitProducto()
  const kit2 = await crearKitProducto()
  await receta(kit1, [c(c1, 1)])
  const insertar = (k: string, comp: string, q: number) =>
    prisma.$executeRaw`INSERT INTO "inventory_kit_components" ("id","companyId","kitVariantId","componentVariantId","quantity") VALUES (${`x-${Math.random().toString(36).slice(2)}`}, ${ctx.a}, ${k}, ${comp}, ${q})`
  assert.match(await mensajeDe(insertar(kit2, kit2, 1)), /inventory_kit_components_forma/, 'un kit no es su propio componente')
  assert.match(await mensajeDe(insertar(kit2, c2, 0)), /inventory_kit_components_forma/, 'cantidad cero')
  assert.match(await mensajeDe(insertar(kit2, c2, -3)), /inventory_kit_components_forma/, 'cantidad negativa')
  // Anidar (kit2 → kit1, que ya es kit) y al revés (kit1 deja de ser… c1 pasa a ser kit de c2): la base lo rechaza al cerrar la transacción.
  assert.match(await mensajeDe(insertar(kit2, kit1, 1)), /inventory_kit_anidado/)
  assert.match(await mensajeDe(insertar(c1, c2, 1)), /inventory_kit_anidado/)
  assert.equal(await prisma.inventoryKitComponent.count({ where: { kitVariantId: { in: [kit2, c1] } } }), 0)
  // Un componente aparece una sola vez por kit (la base).
  const dup = `x-${Math.random().toString(36).slice(2)}`
  await insertar(kit2, c2, 1)
  assert.match(await mensajeDe(prisma.$executeRaw`INSERT INTO "inventory_kit_components" ("id","companyId","kitVariantId","componentVariantId","quantity") VALUES (${dup}, ${ctx.a}, ${kit2}, ${c2}, 5)`), /unique|duplicate|23505/i)
  assert.equal(await prisma.inventoryKitComponent.count({ where: { kitVariantId: kit2 } }), 1)
})

test('3 · cuántos kits alcanzan: el mínimo de los componentes, por sucursal, y qué componente limita', async () => {
  const c1 = await crearProducto({ stock: 10 })
  const c2 = await crearProducto({ stock: 7 })
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: c1, sucursalId: ctx.suc2, cantidad: 100, motivo: 'x' }, como(ctx.usuario)))
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 2), c(c2, 3)])
  const d1 = (await enA((tx) => disponibilidadDeKitsEnTx(tx, ctx.a, [kit], ctx.suc1))).get(kit)!
  assert.deepEqual(d1, { kits: 2, limitante: c2 }, 'c1 da 5 kits y c2 da 2 (7/3)')
  const d2 = (await enA((tx) => disponibilidadDeKitsEnTx(tx, ctx.a, [kit], ctx.suc2))).get(kit)!
  assert.equal(d2.kits, 0, 'en Norte no hay c2')
  // Lo apartado no cuenta como disponible.
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: c2, sucursalId: ctx.suc1, cantidad: 4, ahora: T0 }, como(ctx.usuario)))
  assert.equal((await enA((tx) => disponibilidadDeKitsEnTx(tx, ctx.a, [kit], ctx.suc1))).get(kit)!.kits, 1)
  // Un producto que no es kit no aparece.
  assert.equal((await enA((tx) => disponibilidadDeKitsEnTx(tx, ctx.a, [c1], ctx.suc1))).size, 0)
  const lista = (await enA((tx) => kitsDeLaEmpresaEnTx(tx, ctx.a))).find((k) => k.varianteId === kit)!
  assert.deepEqual(lista.componentes.map((x) => x.cantidad).sort(), [2, 3])
  assert.deepEqual(lista.porSucursal.map((s) => [s.sucursal, s.kits]).sort(), [['Norte', 0], ['Principal', 1]])
  assert.ok((await enA((tx) => kitsDondeEntraEnTx(tx, ctx.a, c1))).some((k) => k.varianteId === kit))
})

// ── Vender kits en pedidos ───────────────────────────────────────────────────

test('4 · un pedido con un kit aparta sus componentes (todo o nada), anota la foto y el cierre los vende', async () => {
  const c1 = await crearProducto({ nombre: 'Café', stock: 20 })
  const c2 = await crearProducto({ nombre: 'Taza', stock: 10 })
  const kit = await crearKitProducto('Desayuno')
  await receta(kit, [c(c1, 2), c(c2, 1)])
  const p = await pedir(kit, 3)
  assert.equal((await disp(c1)).reserved, 6)
  assert.equal((await disp(c2)).reserved, 3)
  const filas = await kitReservas(p.pedidoId)
  assert.equal(filas.length, 2)
  assert.deepEqual(filas.map((f) => [f.kitQuantity, f.quantity]).sort(), [[3, 3], [3, 6]].sort())
  const linea = await prisma.membegoOrderLine.findFirstOrThrow({ where: { orderId: p.pedidoId } })
  assert.equal(linea.inventoryReservationId, null, 'la línea del kit no tiene reserva propia')
  assert.equal(linea.quantity, 3)
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: kit } }), 0, 'el kit no tiene existencias propias')

  const token = await listo(p.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(), T0))
  assert.deepEqual(await disp(c1), { onHand: 14, reserved: 0, disponible: 14 })
  assert.deepEqual(await disp(c2), { onHand: 7, reserved: 0, disponible: 7 })
  const ventas = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, type: 'SALE', referenceId: p.pedidoId }, select: { quantity: true } })
  assert.deepEqual(ventas.map((v) => v.quantity).sort(), [3, 6])
  // Una reserva, un vínculo; y un kit aparta cada componente una sola vez por pedido (la base).
  const suelta = await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: c1, sucursalId: ctx.suc1, cantidad: 1, ahora: T0 }, como(ctx.usuario)))
  const vinculo = (reservaId: string, ref = p.pedidoId) =>
    prisma.$executeRaw`INSERT INTO "inventory_kit_reservations" ("id","companyId","kitVariantId","componentVariantId","reservationId","referenceType","referenceId","kitQuantity","quantity") VALUES (${`k-${Math.random().toString(36).slice(2)}`}, ${ctx.a}, ${kit}, ${c1}, ${reservaId}, 'ORDER', ${ref}, 1, 1)`
  assert.match(await mensajeDe(vinculo(filas[0].reservationId, 'otro-pedido')), /unique|duplicate|23505/i, 'una reserva, un vínculo (con otro pedido, para que solo esa regla pueda fallar)')
  assert.match(await mensajeDe(vinculo(suelta.reservaId)), /unique|duplicate|23505/i)
  assert.equal(await prisma.inventoryKitReservation.count({ where: { referenceId: p.pedidoId } }), 2)
  // La foto de lo apartado no se edita ni se borra (la base).
  assert.match(await mensajeDe(prisma.inventoryKitReservation.deleteMany({ where: { referenceId: p.pedidoId } })), /inventory_lot_inmutable|no admite/)
  assert.match(await mensajeDe(prisma.$executeRaw`UPDATE "inventory_kit_reservations" SET "quantity" = 99 WHERE "referenceId" = ${p.pedidoId}`), /inventory_lot_inmutable|no admite/)
})

test('5 · si falta un componente no se aparta NADA, el mensaje dice cuál, y un kit sin receta no aparta nada', async () => {
  const c1 = await crearProducto({ nombre: 'Pila', stock: 100 })
  const c2 = await crearProducto({ nombre: 'Linterna', stock: 2 })
  const kit = await crearKitProducto('Linterna con pilas')
  await receta(kit, [c(c1, 4), c(c2, 1)])
  const antes = { c1: await disp(c1), c2: await disp(c2), pedidos: await prisma.membegoOrder.count({ where: { companyId: ctx.a } }), filas: await prisma.inventoryKitReservation.count({ where: { companyId: ctx.a } }) }
  const msg = await mensajeDe(pedir(kit, 3))
  assert.match(msg, /Linterna con pilas/)
  assert.match(msg, /Linterna/)
  assert.equal(await codigoDe(pedir(kit, 3)), 'STOCK_INSUFICIENTE')
  assert.deepEqual({ c1: await disp(c1), c2: await disp(c2), pedidos: await prisma.membegoOrder.count({ where: { companyId: ctx.a } }), filas: await prisma.inventoryKitReservation.count({ where: { companyId: ctx.a } }) }, antes, 'ni reservas, ni pedido, ni filas')
  // Un producto sin inventario y sin receta se vende como siempre (no aparta nada).
  const sinReceta = await crearKitProducto('Sin receta')
  const p = await pedir(sinReceta, 1)
  assert.equal((await kitReservas(p.pedidoId)).length, 0)
  assert.equal(await codigoDe(enA((tx) => reservarKitEnTx(tx, ctx.a, { kitVarianteId: sinReceta, sucursalId: ctx.suc1, cantidad: 1, referencia: { tipo: 'ORDER', id: 'x' }, claveBase: 'x', ahora: T0 }, como(ctx.usuario)))), 'KIT_SIN_RECETA')
})

test('6 · cancelar libera los componentes; reembolsar los devuelve; ninguno de los dos se repite', async () => {
  const c1 = await crearProducto({ stock: 30 })
  const c2 = await crearProducto({ stock: 30 })
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 2), c(c2, 5)])
  const p1 = await pedir(kit, 2)
  assert.deepEqual([(await disp(c1)).reserved, (await disp(c2)).reserved], [4, 10])
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, p1.pedidoId, { motivo: 'Cambio de planes' }, empresa(), T0))
  assert.deepEqual([await disp(c1), await disp(c2)], [{ onHand: 30, reserved: 0, disponible: 30 }, { onHand: 30, reserved: 0, disponible: 30 }])
  const rep = await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, p1.pedidoId, { motivo: 'Cambio de planes' }, empresa(), T0))
  assert.equal(rep.repetido, true)
  assert.equal((await disp(c1)).onHand, 30)

  const p2 = await pedir(kit, 4)
  const token = await listo(p2.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(), T0))
  assert.deepEqual([(await disp(c1)).onHand, (await disp(c2)).onHand], [22, 10])
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, p2.pedidoId, { motivo: 'Lo devolvió', devolverAlInventario: true }, empresa(), T0))
  assert.deepEqual([(await disp(c1)).onHand, (await disp(c2)).onHand], [30, 30], 'volvieron a lo vendible')
  const dev = await prisma.inventoryMovement.count({ where: { companyId: ctx.a, type: 'RETURN', referenceId: p2.pedidoId } })
  assert.equal(dev, 2)
  // Reembolsar sin devolver al inventario no mueve nada.
  const p3 = await pedir(kit, 1)
  const t3 = await listo(p3.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, t3, empresa(), T0))
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, p3.pedidoId, { motivo: 'Dinero de vuelta' }, empresa(), T0))
  assert.deepEqual([(await disp(c1)).onHand, (await disp(c2)).onHand], [28, 25], 'sin devolver, el inventario no vuelve')
})

test('7 · la receta cambia sin tocar lo ya apartado: el pedido vende lo que apartó, no lo que dice la receta de hoy', async () => {
  const c1 = await crearProducto({ stock: 40 })
  const c2 = await crearProducto({ stock: 40 })
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 2)])
  const p = await pedir(kit, 5)
  assert.equal((await disp(c1)).reserved, 10)
  await receta(kit, [c(c2, 7)]) // la receta cambia por completo
  const token = await listo(p.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(), T0))
  assert.deepEqual([(await disp(c1)).onHand, (await disp(c2)).onHand], [30, 40], 'se vendió lo apartado (c1 × 10), no la receta nueva')
  // Y el siguiente pedido ya usa la receta nueva.
  const p2 = await pedir(kit, 2)
  assert.deepEqual([(await disp(c2)).reserved, (await disp(c1)).reserved], [14, 0])
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, p2.pedidoId, { motivo: 'x' }, empresa(), T0))
  // Quitar la receta: el producto vuelve a ser uno cualquiera; sin receta no es kit.
  assert.deepEqual((await enA((tx) => quitarRecetaDeKitEnTx(tx, ctx.a, { kitVarianteId: kit }, como(ctx.usuario)))).componentes, 1)
  assert.equal(await codigoDe(enA((tx) => quitarRecetaDeKitEnTx(tx, ctx.a, { kitVarianteId: kit }, como(ctx.usuario)))), 'KIT_SIN_RECETA')
  assert.equal((await kitReservas(p.pedidoId)).length, 1, 'la foto de lo vendido sigue')
})

test('8 · si la reserva de un componente venció, el cierre vende de lo disponible; si ni así alcanza, no cierra nada', async () => {
  const c1 = await crearProducto({ stock: 6 })
  const c2 = await crearProducto({ stock: 6 })
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 1), c(c2, 1)])
  const p = await pedir(kit, 2)
  // El barrido libera la reserva de c1 (simula que venció) y alguien más se lleva todo el stock disponible.
  const filas = await kitReservas(p.pedidoId)
  const deC1 = filas.find((f) => f.componentVariantId === c1)!
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "inventory_reservations" SET "status" = 'EXPIRED', "resolvedAt" = now() WHERE "id" = ${deC1.reservationId}`
    await tx.$executeRaw`UPDATE "inventory_levels" SET "reserved" = "reserved" - 2 WHERE "catalogVariantId" = ${c1}`
  })
  // Con 6 en existencia y nada apartado de c1, venderle 2 por la vía de lo disponible alcanza.
  const token = await listo(p.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(), T0))
  assert.deepEqual([(await disp(c1)).onHand, (await disp(c2)).onHand], [4, 4])

  // Ahora ni así alcanza: la reserva de c1 se pierde y el stock de c1 se agota.
  const p2 = await pedir(kit, 3)
  const f2 = (await kitReservas(p2.pedidoId)).find((f) => f.componentVariantId === c1)!
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "inventory_reservations" SET "status" = 'EXPIRED', "resolvedAt" = now() WHERE "id" = ${f2.reservationId}`
    await tx.$executeRaw`UPDATE "inventory_levels" SET "reserved" = "reserved" - 3, "onHand" = 1 WHERE "catalogVariantId" = ${c1}`
  })
  const t2 = await listo(p2.pedidoId)
  assert.equal(await codigoDe(enA((tx) => completarPorQrEnTx(tx, ctx.a, t2, empresa(), T0))), 'STOCK_YA_NO_ALCANZA')
  assert.equal((await prisma.membegoOrder.findUniqueOrThrow({ where: { id: p2.pedidoId } })).status, 'READY', 'el pedido sigue listo, nada se vendió a medias')
})

test('9 · los componentes con lotes funcionan igual: el kit aparta por FEFO y el cierre vende de esos lotes', async () => {
  const c1 = await crearProducto({ stock: 0 })
  const c2 = await crearProducto({ stock: 10 })
  await enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: c1, ahora: T0 }, como(ctx.usuario)))
  await enA((tx) =>
    registrarEntradaMultipleEnTx(
      tx,
      ctx.a,
      { sucursalId: ctx.suc1, lineas: [{ varianteId: c1, cantidad: 10, lotes: [{ codigo: 'L-TARDE', vencimiento: '2030-09-01', cantidad: 6 }, { codigo: 'L-PRONTO', vencimiento: '2030-03-01', cantidad: 4 }] }], ahora: T0 },
      como(ctx.usuario)
    )
  )
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 3), c(c2, 1)])
  const p = await pedir(kit, 2)
  const lotes = async () => Object.fromEntries((await prisma.inventoryLotBalance.findMany({ where: { catalogVariantId: c1 }, select: { onHand: true, reserved: true, lot: { select: { code: true } } } })).map((b) => [b.lot.code, [b.onHand, b.reserved]]))
  assert.deepEqual(await lotes(), { 'L-PRONTO': [4, 4], 'L-TARDE': [6, 2] }, 'apartó 6: 4 del que antes vence y 2 del otro')
  const token = await listo(p.pedidoId)
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, token, empresa(), T0))
  assert.deepEqual(await lotes(), { 'L-PRONTO': [0, 0], 'L-TARDE': [4, 0] })
  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, p.pedidoId, { motivo: 'Devuelto', devolverAlInventario: true }, empresa(), T0))
  assert.deepEqual(await lotes(), { 'L-PRONTO': [4, 0], 'L-TARDE': [6, 0] }, 'cada lote vuelve a donde estaba')
})

test('10 · el carrito y la caja enseñan cuántos kits alcanzan; sin receta o sin sucursal no inventan nada', async () => {
  const c1 = await crearProducto({ stock: 9 })
  const kit = await crearKitProducto('Caja de tres')
  await receta(kit, [c(c1, 3)])
  const resumen = await enA((tx) => resumenDelCarritoEnTx(tx, ctx.a, [{ varianteId: kit, cantidad: 4 }], ctx.suc1))
  assert.equal(resumen.renglones[0].existencias, 3)
  assert.equal(resumen.renglones[0].problema, 'Solo quedan 3 en esta sucursal.')
  const ok = await enA((tx) => resumenDelCarritoEnTx(tx, ctx.a, [{ varianteId: kit, cantidad: 3 }], ctx.suc1))
  assert.equal(ok.renglones[0].problema, null)
  const sinSucursal = await enA((tx) => resumenDelCarritoEnTx(tx, ctx.a, [{ varianteId: kit, cantidad: 3 }], null))
  assert.equal(sinSucursal.renglones[0].existencias, null)
  const caja = await enA((tx) => buscarProductosDeCajaEnTx(tx, ctx.a, ctx.suc1, 'Caja de tres'))
  assert.equal(caja.find((x) => x.varianteId === kit)?.disponible, 3)
  const norte = await enA((tx) => buscarProductosDeCajaEnTx(tx, ctx.a, ctx.suc2, 'Caja de tres'))
  assert.equal(norte.find((x) => x.varianteId === kit)?.disponible, 0, 'en Norte no hay componentes')
})

test('11 · el catálogo no deja romper un kit: no se controla su inventario, no se deja de controlar el de un componente, no se borra', async () => {
  const c1 = await crearProducto({ stock: 5 })
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 1)])
  const itemDe = async (v: string) => (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: v }, select: { catalogItemId: true } })).catalogItemId
  const kitItem = await itemDe(kit)
  const compItem = await itemDe(c1)
  assert.equal(await codigoDe(enA((tx) => actualizarItemEnTx(tx, ctx.a, kitItem, { capabilities: { trackInventory: true } }, como(ctx.usuario)))), 'ITEM_ES_KIT')
  // Un componente: dejar el stock en cero no basta, está en un kit.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: c1, sucursalId: ctx.suc1, cantidad: 5, ahora: T0 }, como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => actualizarItemEnTx(tx, ctx.a, compItem, { capabilities: { trackInventory: false } }, como(ctx.usuario)))), 'ITEM_EN_KITS')
  // Borrar la variante de un componente: bloqueado (aquí ya tiene movimientos, así que se prueba con una variante sin ellos).
  const nueva = await enA((tx) => agregarVarianteEnTx(tx, ctx.a, compItem, { name: 'Otra talla', sku: `KT-V-${sufijo}`, price: 10 }, como(ctx.usuario)))
  const nuevaId = nueva.id
  await receta(kit, [c(c1, 1), c(nuevaId, 2)])
  assert.equal(await codigoDe(enA((tx) => eliminarVarianteEnTx(tx, ctx.a, nuevaId, como(ctx.usuario)))), 'VARIANTE_EN_KITS')
  // Un kit que nunca se vendió se borra junto con su receta.
  const kit2 = await crearKitProducto('Efímero')
  const kit2Item = await itemDe(kit2)
  const extraId = (await enA((tx) => agregarVarianteEnTx(tx, ctx.a, kit2Item, { name: 'V2', sku: `KT-E-${sufijo}`, price: 5 }, como(ctx.usuario)))).id
  await receta(extraId, [c(c1, 1)])
  await enA((tx) => eliminarVarianteEnTx(tx, ctx.a, extraId, como(ctx.usuario)))
  assert.equal(await prisma.inventoryKitComponent.count({ where: { kitVariantId: extraId } }), 0)
})

test('12 · candidatos a kit: lo que no controla inventario y no es componente; y dos pedidos de kits a la vez no se interbloquean', async () => {
  const c1 = await crearProducto({ stock: 50 })
  const c2 = await crearProducto({ stock: 50 })
  const nombre = `Candidato ${sufijo}`
  const cand = await crearProducto({ nombre, tipo: 'BUNDLE' })
  const fisico = await crearProducto({ nombre: `Fisico ${sufijo}`, stock: 1 })
  const ids = (await enA((tx) => candidatosAKitEnTx(tx, ctx.a, sufijo))).map((x) => x.varianteId)
  assert.ok(ids.includes(cand), 'un paquete sin inventario es candidato')
  assert.ok(!ids.includes(fisico), 'lo que controla inventario no')
  assert.ok(!ids.includes(c1), 'ni un componente')
  assert.deepEqual(await enA((tx) => candidatosAKitEnTx(tx, ctx.a, 'a')), [], 'texto muy corto: nada')
  assert.deepEqual(await enB((tx) => candidatosAKitEnTx(tx, ctx.b, sufijo)), [], 'otra empresa no ve los de esta')

  // Dos kits con los mismos componentes en orden distinto, vendidos a la vez, no se interbloquean.
  const k1 = await crearKitProducto()
  const k2 = await crearKitProducto()
  await receta(k1, [c(c1, 1), c(c2, 1)])
  await receta(k2, [c(c2, 1), c(c1, 1)])
  const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => pedir(i % 2 === 0 ? k1 : k2, 1)))
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 8)
  assert.equal((await disp(c1)).reserved >= 8, true)
})

test('13 · un producto de Supply no es kit, y editar la receta a la vez no mezcla recetas', async () => {
  const c1 = await crearProducto({ stock: 5 })
  const c2 = await crearProducto({ stock: 5 })
  const c3 = await crearProducto({ stock: 5 })
  const deSupply = await crearKitProducto('De Supply')
  const itemId = (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: deSupply }, select: { catalogItemId: true } })).catalogItemId
  await prisma.catalogItem.update({ where: { id: itemId }, data: { source: 'SUPPLY', supplyV2OfferId: await ofertaSupplyDePrueba(ctx.usuario, `${sufijo}k`) } })
  assert.equal(await codigoDe(receta(deSupply, [c(c1, 1)])), 'KIT_DE_SUPPLY')
  assert.equal(await prisma.inventoryKitComponent.count({ where: { kitVariantId: deSupply } }), 0)

  // Varias personas editando la receta del mismo kit a la vez: se turnan, y queda EXACTAMENTE una de las recetas.
  const kit = await crearKitProducto()
  await receta(kit, [c(c1, 1)])
  const opciones = [[c(c1, 2)], [c(c2, 3)], [c(c3, 4)], [c(c1, 5), c(c2, 6)], [c(c2, 7), c(c3, 8)], [c(c1, 9), c(c3, 1)]]
  const r = await Promise.allSettled(opciones.map((o) => receta(kit, o)))
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 6, 'todas se aplican, una tras otra')
  const final = (await prisma.inventoryKitComponent.findMany({ where: { kitVariantId: kit }, select: { componentVariantId: true, quantity: true } })).map((x) => `${x.componentVariantId}×${x.quantity}`).sort()
  const posibles = opciones.map((o) => o.map((x) => `${x.varianteId}×${x.cantidad}`).sort())
  assert.ok(posibles.some((p) => JSON.stringify(p) === JSON.stringify(final)), `la receta final es una de las pedidas, no una mezcla: ${final.join(', ')}`)
})

