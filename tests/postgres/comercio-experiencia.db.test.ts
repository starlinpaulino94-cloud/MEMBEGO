import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { configurarUmbralEnTx, recibirEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { PedidoError } from '../../src/modules/orders/errores'
import { aceptarPedidoEnTx, cancelarPedidoEnTx, completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { crearOfertaEnTx, publicarOfertaEnTx, reclamarOfertaEnTx } from '../../src/modules/deals/service'
import { itemCatalogoPublico, catalogoPublicoGlobal } from '../../src/modules/catalog/publico'
import { ofertasPublicas } from '../../src/modules/deals/publico'
import { productosEnTx } from '../../src/modules/analytics/queries'
import { panoramaDelItemEnTx } from '../../src/modules/comercio/panorama-item'
import { resumenComercioEmpresa } from '../../src/modules/comercio/dashboard'
import { avisarPasoDelPedido, textoParaElCliente, textoParaLaEmpresa } from '../../src/modules/orders/avisos'
import { avisarStockBajo } from '../../src/modules/inventory/avisos'
import { getOnboardingEmpresa } from '../../src/modules/empresas/onboarding'

/**
 * EXPERIENCIA COMERCIAL · de punta a punta contra PostgreSQL de verdad (2026-10-08).
 *
 * Los cinco recorridos que el encargo exige, al nivel del servicio (lo que la
 * interfaz llama), con la base migrada (disparadores y CHECK incluidos):
 *
 *   1. Empresa → sucursal → producto → 100 unidades → publicar → oferta 20 % →
 *      el cliente ve el precio promocional y NO el stock exacto → compra 2 →
 *      se apartan 2 → la empresa acepta y marca listo → el cliente recibe sus
 *      avisos → QR → COMPLETED → onHand 98, reservado 0 → la analítica lo cuenta.
 *   2. Servicio sin inventario → oferta 25 % → obtener → QR → canje, sin
 *      mover una sola unidad de stock.
 *   3. Stock = 1 y dos clientes compran a la vez: una reserva, un rechazo,
 *      nunca −1.
 *   4. Stock 100 → compra 2 → disponible 98 → cancela → disponible 100.
 *   5. Base 1 000 · 20 % → 800: la línea guarda base, descuento y final, y el
 *      servidor rechaza un precio que mande el cliente.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const E = { id: '', slug: `tech-store-${sufijo}`, sucursal: '', sucursal2: '', admin: '', usuarioCliente: '' }
const CLI: string[] = []
const SB = (i: number) => `sb-exp-cli-${i}-${sufijo}`

const ctxOp = () => ({ actorId: E.admin, ipAddress: '127.0.0.1', userAgent: 'test' })
const empresa = (): ContextoPedido => ({ actor: 'EMPRESA', actorId: E.admin, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null, ipAddress: '127.0.0.1', userAgent: 'test' }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const en = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(E.id, fn)

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof PedidoError || e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

async function producto(nombre: string, slug: string, precio: number, opciones: { tipo?: 'PHYSICAL_PRODUCT' | 'SERVICE'; stock?: number; umbral?: number } = {}) {
  const tipo = opciones.tipo ?? 'PHYSICAL_PRODUCT'
  const r = await en((tx) => crearItemEnTx(tx, E.id, { name: nombre, type: tipo, price: precio, sku: `EXP-${slug}-${sufijo}` }, ctxOp()))
  await prisma.catalogItem.update({ where: { id: r.id }, data: { slug: `${slug}-${sufijo}` } })
  await en((tx) => cambiarEstadoItemEnTx(tx, E.id, r.id, 'ACTIVE', ctxOp()))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  if (opciones.stock) await en((tx) => recibirEnTx(tx, E.id, { varianteId: v.id, sucursalId: E.sucursal, cantidad: opciones.stock!, motivo: 'Compra inicial' }, ctxOp()))
  if (opciones.umbral) await en((tx) => configurarUmbralEnTx(tx, E.id, { varianteId: v.id, sucursalId: E.sucursal, umbral: opciones.umbral! }, ctxOp()))
  return { itemId: r.id, varianteId: v.id, slug: `${slug}-${sufijo}` }
}

async function ofertaActiva(varianteId: string, pct: number, titulo: string): Promise<string> {
  const { id } = await en((tx) => crearOfertaEnTx(tx, E.id, { title: titulo, catalogVariantId: varianteId, discountType: 'PERCENT', discountValue: pct, startsAt: new Date(Date.now() - 3_600_000), endsAt: null, maxClaims: 50, budgetTotal: 10_000 }, ctxOp()))
  await en((tx) => publicarOfertaEnTx(tx, E.id, id, ctxOp()))
  return id
}

const nivel = (varianteId: string, sucursalId = E.sucursal) => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } } })
const pedido = (id: string) => prisma.membegoOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } })
const claves = (o: unknown): string[] => (Array.isArray(o) ? o.flatMap(claves) : o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [k, ...claves(v)]) : [])

before(async () => {
  // La empresa se registra, completa su perfil y se publica (lo que hace el onboarding).
  const c = await prisma.company.create({
    data: { name: `Tech Store ${sufijo}`, slug: E.slug, type: 'retail', ciudad: 'Punta Cana', isPublished: true, isActive: true, esDemo: false, description: 'Tecnología y accesorios en Bávaro y Verón.' },
    select: { id: true },
  })
  E.id = c.id
  const admin = await prisma.user.create({ data: { supabaseId: `sb-exp-admin-${sufijo}`, email: `exp-admin-${sufijo}@prueba.test`, name: 'Admin Tech', role: 'ADMINISTRADOR', companyId: c.id }, select: { id: true } })
  E.admin = admin.id
  E.sucursal = (await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Bávaro' }, select: { id: true } })).id
  E.sucursal2 = (await prisma.sucursal.create({ data: { companyId: c.id, nombre: 'Verón' }, select: { id: true } })).id
  for (let i = 0; i < 4; i++) {
    CLI.push((await prisma.cliente.create({ data: { companyId: c.id, supabaseId: SB(i), nombre: `Cliente ${i}`, email: `exp-cli-${i}-${sufijo}@prueba.test` }, select: { id: true } })).id)
  }
  // El cliente 0 tiene cuenta en la app: es a quien se le avisa.
  E.usuarioCliente = (await prisma.user.create({ data: { supabaseId: SB(0), email: `exp-cli-0-${sufijo}@prueba.test`, name: 'Cliente Cero', role: 'CLIENTE', companyId: c.id }, select: { id: true } })).id
})

after(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['deal_claims', 'deals', 'merchant_commissions', 'merchant_statements', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
      await tx.$executeRaw`${Prisma.raw(`DELETE FROM "${tabla}" WHERE "companyId" = `)}${E.id}`
    }
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: E.id } })
  await prisma.notificacion.deleteMany({ where: { userId: { in: [E.admin, E.usuarioCliente] } } })
})

// ─────────────────────────────────────────────────────────────────────────────

test('1 · el recorrido completo: producto, 100 unidades, oferta 20 %, el cliente compra 2, la empresa entrega con QR, el stock baja y la analítica lo cuenta', async () => {
  const airpods = await producto(`AirPods Pro ${sufijo}`, 'airpods-pro', 12_000, { stock: 100, umbral: 10 })
  const dealId = await ofertaActiva(airpods.varianteId, 20, `AirPods 20 % ${sufijo}`)

  // Crear la oferta NO resta inventario.
  let n = await nivel(airpods.varianteId)
  assert.equal(n.onHand, 100)
  assert.equal(n.reserved, 0)

  // Lo que ve el consumidor: precio promocional y disponibilidad, NUNCA el stock exacto.
  const publico = await itemCatalogoPublico(E.slug, airpods.slug)
  assert.ok(publico, 'el producto publicado se ve en el marketplace')
  assert.equal(publico.disponibilidad, 'DISPONIBLE')
  assert.equal(publico.variants[0].available, true)
  assert.deepEqual(publico.variants[0].sucursalesConStock, [E.sucursal], 'solo Bávaro tiene existencias; Verón no')
  const todas = claves(publico)
  for (const prohibida of ['onHand', 'reserved', 'damaged', 'cost', 'sku', 'barcode', 'lowStockThreshold', 'incoming', 'capabilities']) {
    assert.ok(!todas.includes(prohibida), `el público ve «${prohibida}»`)
  }
  assert.ok(!JSON.stringify(publico).includes('"100"') && !JSON.stringify(publico).includes(':100'), 'la cantidad exacta no sale por ningún campo')
  const ofertas = await ofertasPublicas({ companySlug: E.slug })
  const oferta = ofertas.find((o) => o.id === dealId)
  assert.ok(oferta, 'la oferta se ve en el marketplace')
  assert.equal(oferta.precioAntes, '12000.00')
  assert.equal(oferta.precioAhora, '9600.00')
  assert.equal(oferta.ahorro, '2400.00')
  assert.equal(oferta.itemSlug, airpods.slug, 'la oferta REFERENCIA al producto; no hay un «AirPods Promoción» duplicado')
  const feed = await catalogoPublicoGlobal({ q: `AirPods Pro ${sufijo}` })
  assert.equal(feed.items.filter((i) => i.company.slug === E.slug).length, 1, 'un solo ítem en el feed: la promoción no crea otro')

  // El cliente compra 2 unidades: se apartan 2 (onHand sigue en 100, disponible 98).
  const r = await en((tx) => crearPedidoEnTx(tx, E.id, { customerId: CLI[0], locationId: E.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: airpods.varianteId, cantidad: 2 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))
  assert.equal(r.status, 'AWAITING_MERCHANT')
  n = await nivel(airpods.varianteId)
  assert.equal(n.onHand, 100)
  assert.equal(n.reserved, 2)
  const reserva = await prisma.inventoryReservation.findFirstOrThrow({ where: { referenceType: 'ORDER', referenceId: r.pedidoId } })
  assert.equal(reserva.status, 'ACTIVE')
  assert.equal(reserva.quantity, 2)

  // La ficha del producto en el panel enseña el pedido que espera y el stock por sucursal.
  const panorama = await en((tx) => panoramaDelItemEnTx(tx, E.id, airpods.itemId))
  assert.ok(panorama)
  assert.equal(panorama.ventas.pedidosEsperando, 1)
  assert.equal(panorama.stock[0].totalDisponible, 98)
  assert.equal(panorama.stock[0].totalReservado, 2)
  assert.equal(panorama.ofertas.length, 1)
  assert.equal(panorama.ofertas[0].precioOferta, '9600.00')

  // Los avisos: la empresa recibe «Nuevo pedido», el cliente «Pedido recibido».
  await avisarPasoDelPedido(E.id, r.pedidoId, 'RECIBIDO', 'CLIENTE')
  assert.equal(await prisma.notificacion.count({ where: { userId: E.admin, dedupeKey: `pedido:${r.pedidoId}:RECIBIDO` } }), 1)
  assert.equal(await prisma.notificacion.count({ where: { userId: E.usuarioCliente, dedupeKey: `pedido:${r.pedidoId}:RECIBIDO` } }), 1)
  await avisarPasoDelPedido(E.id, r.pedidoId, 'RECIBIDO', 'CLIENTE')
  assert.equal(await prisma.notificacion.count({ where: { userId: E.usuarioCliente, dedupeKey: `pedido:${r.pedidoId}:RECIBIDO` } }), 1, 'repetir el hecho no repite el aviso')

  // La empresa acepta, prepara y marca listo: el cliente se entera y tiene su QR.
  await en((tx) => aceptarPedidoEnTx(tx, E.id, r.pedidoId, empresa()))
  await avisarPasoDelPedido(E.id, r.pedidoId, 'ACEPTADO', 'EMPRESA')
  const listo = await en((tx) => marcarListoEnTx(tx, E.id, r.pedidoId, empresa()))
  await avisarPasoDelPedido(E.id, r.pedidoId, 'LISTO', 'EMPRESA')
  assert.ok(listo.qrToken)
  const avisosCliente = await prisma.notificacion.findMany({ where: { userId: E.usuarioCliente, href: `/cliente/pedidos/${r.pedidoId}` }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(avisosCliente.map((a) => a.titulo), ['Pedido recibido', 'Pedido confirmado', 'Tu pedido está listo'])

  // Pickup con QR: COMPLETED, la reserva se consume, onHand baja a 98 y el movimiento SALE queda en el ledger.
  const cierre = await en((tx) => completarPorQrEnTx(tx, E.id, listo.qrToken as string, empresa()))
  assert.equal(cierre.status, 'COMPLETED')
  n = await nivel(airpods.varianteId)
  assert.equal(n.onHand, 98)
  assert.equal(n.reserved, 0)
  assert.equal((await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: reserva.id } })).status, 'CONSUMED')
  const venta = await prisma.inventoryMovement.findFirst({ where: { companyId: E.id, type: 'SALE', referenceType: 'ORDER', referenceId: r.pedidoId } })
  assert.ok(venta, 'la venta dejó su movimiento auditable')
  assert.equal(venta.quantity, 2)
  await avisarPasoDelPedido(E.id, r.pedidoId, 'COMPLETADO', 'EMPRESA')
  assert.equal(await prisma.notificacion.count({ where: { userId: E.usuarioCliente, titulo: 'Pedido completado' } }), 1)

  // La analítica por producto y el dashboard reflejan la venta.
  const productos = await en((tx) => productosEnTx(tx, { companyId: E.id }, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000), 10))
  const fila = productos.find((p) => p.itemId === airpods.itemId)
  assert.ok(fila)
  assert.equal(fila.unidades, 2)
  assert.equal(fila.completados, 1)
  assert.equal(fila.ventas, 24_000)
  const resumen = await resumenComercioEmpresa(E.id)
  assert.ok(resumen)
  assert.equal(resumen.pedidosCompletadosMes >= 1, true)
  assert.equal(resumen.ofertasActivas >= 1, true)
  assert.equal(resumen.productosPublicados >= 1, true)

  // Onboarding comercial: con sucursal, producto, inventario, publicado y oferta, los pasos de comercio están hechos.
  const ob = await getOnboardingEmpresa(E.id)
  assert.ok(ob)
  for (const k of ['sucursal', 'producto', 'inventario', 'publicar', 'oferta']) assert.equal(ob.items.find((i) => i.key === k)?.done, true, `paso ${k}`)
})

test('2 · un servicio sin inventario: oferta 25 %, el cliente la obtiene, visita, QR y canje — sin tocar el stock', async () => {
  const lavado = await producto(`Lavado Premium ${sufijo}`, 'lavado-premium', 1_000, { tipo: 'SERVICE' })
  const publico = await itemCatalogoPublico(E.slug, lavado.slug)
  assert.ok(publico)
  assert.equal(publico.disponibilidad, 'DISPONIBLE', 'un servicio no se agota por stock')
  assert.equal(publico.variants[0].sucursalesConStock, null, 'sin inventario, cualquier sucursal activa sirve')
  const dealId = await ofertaActiva(lavado.varianteId, 25, `Lavado 25 % ${sufijo}`)
  const movimientosAntes = await prisma.inventoryMovement.count({ where: { companyId: E.id } })

  const r = await en((tx) => reclamarOfertaEnTx(tx, E.id, { dealId, customerId: CLI[1], locationId: E.sucursal2 }))
  const p = await pedido(r.orderId)
  assert.equal(p.status, 'READY', 'obtener la oferta deja el cupón listo con su QR')
  assert.equal(p.lines[0].unitPrice.toFixed(2), '1000.00')
  assert.equal(p.lines[0].discount.toFixed(2), '250.00')
  assert.equal(p.lines[0].lineTotal.toFixed(2), '750.00')
  assert.equal(p.lines[0].inventoryReservationId, null, 'un servicio no aparta unidades')
  assert.equal((await prisma.dealClaim.findUniqueOrThrow({ where: { orderId: r.orderId } })).status, 'CLAIMED', 'obtenida ≠ canjeada')

  const cierre = await en((tx) => completarPorQrEnTx(tx, E.id, p.qrToken as string, empresa()))
  assert.equal(cierre.status, 'COMPLETED')
  assert.equal((await prisma.dealClaim.findUniqueOrThrow({ where: { orderId: r.orderId } })).status, 'REDEEMED', 'canjeada solo al pasar el QR')
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: E.id } }), movimientosAntes, 'ni un movimiento de stock')
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: lavado.varianteId } }), 0)
})

test('3 · stock = 1 y dos clientes compran a la vez: una reserva, un rechazo, nunca −1', async () => {
  const unico = await producto(`Última unidad ${sufijo}`, 'ultima-unidad', 500, { stock: 1 })
  const comprar = (i: number) => en((tx) => crearPedidoEnTx(tx, E.id, { customerId: CLI[i], locationId: E.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: unico.varianteId, cantidad: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))
  const resultados = await Promise.allSettled([comprar(2), comprar(3)])
  const ok = resultados.filter((r) => r.status === 'fulfilled')
  const ko = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1, 'exactamente una compra gana')
  assert.equal(ko.length, 1)
  assert.ok(ko[0].reason instanceof InventarioError && ko[0].reason.codigo === 'STOCK_INSUFICIENTE', `el otro se rechaza por stock: ${String(ko[0].reason)}`)
  const n = await nivel(unico.varianteId)
  assert.equal(n.onHand, 1)
  assert.equal(n.reserved, 1)
  assert.equal(n.onHand - n.reserved, 0, 'disponible 0, jamás negativo')
  assert.equal(await prisma.inventoryReservation.count({ where: { level: { catalogVariantId: unico.varianteId }, status: 'ACTIVE' } }), 1)

  // Agotado para el público (y una oferta activa no lo salta).
  await ofertaActiva(unico.varianteId, 10, `Última 10 % ${sufijo}`)
  const publico = await itemCatalogoPublico(E.slug, unico.slug)
  assert.ok(publico)
  assert.equal(publico.disponibilidad, 'AGOTADO')
  assert.equal(publico.variants[0].available, false)
  assert.equal(await codigoDe(comprar(0)), 'STOCK_INSUFICIENTE', 'con la oferta activa, agotado sigue siendo agotado')
})

test('4 · cancelar devuelve lo apartado: 100 → compra 2 → 98 → cancela → 100', async () => {
  const coca = await producto(`Coca-Cola 20 oz ${sufijo}`, 'coca-cola', 75, { stock: 100 })
  const r = await en((tx) => crearPedidoEnTx(tx, E.id, { customerId: CLI[0], locationId: E.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: coca.varianteId, cantidad: 2 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))
  let n = await nivel(coca.varianteId)
  assert.equal(n.onHand - n.reserved, 98)
  await en((tx) => cancelarPedidoEnTx(tx, E.id, r.pedidoId, { motivo: 'Cambié de opinión', customerId: CLI[0] }, cliente))
  n = await nivel(coca.varianteId)
  assert.equal(n.onHand, 100)
  assert.equal(n.reserved, 0)
  assert.equal(n.onHand - n.reserved, 100)
  const liberacion = await prisma.inventoryMovement.findFirst({ where: { companyId: E.id, type: 'RESERVATION_RELEASE', level: { catalogVariantId: coca.varianteId } } })
  assert.ok(liberacion, 'la liberación es un movimiento con motivo, fecha y referencia')
  assert.match(liberacion.reason ?? '', /cancelado/)
  // La empresa se entera de que el cliente canceló; el cliente recibe la confirmación.
  await avisarPasoDelPedido(E.id, r.pedidoId, 'CANCELADO', 'CLIENTE')
  assert.equal(await prisma.notificacion.count({ where: { userId: E.admin, titulo: 'Un cliente canceló su pedido' } }), 1)
  assert.equal(await prisma.notificacion.count({ where: { userId: E.usuarioCliente, titulo: 'Pedido cancelado' } }), 1)
})

test('5 · el precio lo pone el servidor: base 1 000 · 20 % → 800 en la línea, y un precio del navegador se rechaza', async () => {
  const item = await producto(`Audífonos ${sufijo}`, 'audifonos', 1_000, { stock: 10 })
  const dealId = await ofertaActiva(item.varianteId, 20, `Audífonos 20 % ${sufijo}`)
  const r = await en((tx) => reclamarOfertaEnTx(tx, E.id, { dealId, customerId: CLI[2], locationId: E.sucursal }))
  const p = await pedido(r.orderId)
  assert.equal(p.lines[0].unitPrice.toFixed(2), '1000.00', 'base')
  assert.equal(p.lines[0].discount.toFixed(2), '200.00', 'descuento')
  assert.equal(p.lines[0].lineTotal.toFixed(2), '800.00', 'final')
  assert.equal(p.subtotal.toFixed(2), '1000.00')
  assert.equal(p.discount.toFixed(2), '200.00')
  assert.equal(p.total.toFixed(2), '800.00')
  // La línea es un snapshot: cambiar el precio del catálogo no cambia el pedido.
  await prisma.catalogVariant.update({ where: { id: item.varianteId }, data: { price: 5_000 } })
  assert.equal((await pedido(r.orderId)).lines[0].unitPrice.toFixed(2), '1000.00')
  // Nunca se confía en el navegador.
  assert.equal(
    await codigoDe(en((tx) => crearPedidoEnTx(tx, E.id, { customerId: CLI[3], locationId: E.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: item.varianteId, cantidad: 1, precioUnitario: 1 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))),
    'PRECIO_NO_PERMITIDO'
  )
  assert.equal(
    await codigoDe(en((tx) => crearPedidoEnTx(tx, E.id, { customerId: CLI[3], locationId: E.sucursal, origin: 'MARKETPLACE', lineas: [{ varianteId: item.varianteId, cantidad: 1, descuento: 999 }], atribucion: { channel: 'MARKETPLACE_BROWSE' } }, cliente))),
    'DESCUENTO_NO_PERMITIDO'
  )
})

test('6 · «Pocas unidades» solo si la empresa fijó un umbral; el aviso de stock bajo llega una vez al día', async () => {
  const pocas = await producto(`Cable USB-C ${sufijo}`, 'cable-usb-c', 300, { stock: 3, umbral: 5 })
  const publico = await itemCatalogoPublico(E.slug, pocas.slug)
  assert.ok(publico)
  assert.equal(publico.disponibilidad, 'POCAS_UNIDADES')
  assert.ok(!JSON.stringify(publico).includes('"3"'), 'tampoco aquí sale la cantidad')
  const sinUmbral = await producto(`Funda ${sufijo}`, 'funda', 200, { stock: 2 })
  assert.equal((await itemCatalogoPublico(E.slug, sinUmbral.slug))?.disponibilidad, 'DISPONIBLE', 'sin umbral el cliente ve «Disponible» hasta que se acaba')

  assert.equal(await avisarStockBajo(E.id, [pocas.varianteId, sinUmbral.varianteId]), 1, 'solo avisa la variante con umbral')
  assert.equal(await avisarStockBajo(E.id, [pocas.varianteId]), 0, 'el mismo día no vuelve a sonar')
  assert.equal(await prisma.notificacion.count({ where: { userId: E.admin, titulo: 'Stock bajo' } }), 1)
})

test('7 · los textos de los avisos distinguen quién hizo qué', () => {
  const p = { code: 'MBG-PED-2026-000001', empresa: 'Tech Store', sucursal: 'Bávaro', total: '9600.00', currency: 'DOP', cancelReason: null }
  assert.equal(textoParaElCliente('LISTO', p)?.titulo, 'Tu pedido está listo')
  assert.match(textoParaElCliente('LISTO', p)?.mensaje ?? '', /Bávaro/)
  assert.equal(textoParaLaEmpresa('RECIBIDO', 'CLIENTE', p)?.titulo, 'Nuevo pedido Membego')
  assert.equal(textoParaLaEmpresa('CANCELADO', 'EMPRESA', p), null, 'la empresa no se avisa a sí misma')
  assert.equal(textoParaLaEmpresa('CANCELADO', 'SISTEMA', p)?.titulo, 'Pedido cancelado por falta de respuesta')
  assert.equal(textoParaLaEmpresa('ACEPTADO', 'EMPRESA', p), null)
})
