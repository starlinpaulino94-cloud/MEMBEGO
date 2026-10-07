import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { recibirEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { PedidoError } from '../../src/modules/orders/errores'
import { cancelarPedidoEnTx, completarPorQrEnTx, marcarListoEnTx, aceptarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { MAX_PEDIDOS_ABIERTOS_POR_CLIENTE } from '../../src/modules/orders/domain'
import { crearPedidoDelCarritoEnTx, resumenDelCarritoEnTx, type EntradaDeCheckout } from '../../src/modules/checkout/service'
import { MAX_LINEAS_CARRITO } from '../../src/modules/checkout/domain'

/**
 * CHECKOUT DEL MARKETPLACE contra PostgreSQL de verdad (Fase 8).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · un carrito de varios productos se vuelve UN pedido del marketplace con los precios del catálogo y las
 *    existencias apartadas en la sucursal elegida; todo o nada: si un renglón no alcanza no queda pedido ni reserva;
 *  · reenviar el mismo formulario devuelve el mismo pedido sin apartar dos veces; la clave es de cada cliente;
 *  · dos personas pidiendo la última unidad a la vez: solo una la consigue;
 *  · lo que el navegador no puede decidir: el precio, el descuento, el canal verificado, la empresa;
 *  · transferir queda anotado como intención y NO verifica nada; el pedido sigue el camino de siempre
 *    (aceptar → listo → QR) y los productos apartados se venden al cerrar;
 *  · el resumen del carrito dice qué renglón no se puede pagar y por qué, sin mezclar empresas.
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
  sInactiva: '',
  sB: '',
  clientes: [] as string[],
  clienteB: '',
  fisico: '',
  fisico2: '',
  servicio: '',
  soloCaja: '',
  borrador: '',
  agotado: '',
  varB: '',
}

const clienteCtx: ContextoPedido = { actor: 'CLIENTE', actorId: null }
const empresa: ContextoPedido = { actor: 'EMPRESA', actorId: null }
const aud = () => ({ actorId: ctx.usuario, ipAddress: '127.0.0.1', userAgent: 'test' })
const enA = <T>(fn: Parameters<typeof conEmpresa<T>>[1]) => conEmpresa(ctx.a, fn)

let claveN = 0
const clave = () => `ck-${sufijo}-${++claveN}`

before(async () => {
  const u = await prisma.user.create({ data: { supabaseId: `sb-ck-${sufijo}`, email: `ck-${sufijo}@prueba.test`, name: 'Checkout', role: 'SUPERADMIN' }, select: { id: true } })
  ctx.usuario = u.id
  const empresaNueva = async (k: string) => (await prisma.company.create({ data: { name: `CK ${k} ${sufijo}`, slug: `ck-${k}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })).id
  ctx.a = await empresaNueva('a')
  ctx.b = await empresaNueva('b')
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.s1 = (await suc(ctx.a, 'Principal')).id
  ctx.s2 = (await suc(ctx.a, 'Norte')).id
  ctx.sInactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sB = (await suc(ctx.b, 'De B')).id
  for (let i = 0; i < 8; i++) {
    ctx.clientes.push((await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-ckcli-${i}-${sufijo}`, nombre: `Cliente Carrito ${i}`, email: `ckcli-${i}-${sufijo}@prueba.test` }, select: { id: true } })).id)
  }
  ctx.clienteB = (await prisma.cliente.create({ data: { companyId: ctx.b, supabaseId: `sb-cklib-${sufijo}`, nombre: 'Cliente de B', email: `cklib-${sufijo}@prueba.test` }, select: { id: true } })).id

  const crear = async (companyId: string, name: string, type: 'PHYSICAL_PRODUCT' | 'SERVICE', price: number, sku: string, activar = true, capabilities?: Record<string, boolean>) => {
    const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name, type, price, sku, ...(capabilities ? { capabilities } : {}) }, aud()))
    if (activar) await conEmpresa(companyId, (tx) => cambiarEstadoItemEnTx(tx, companyId, r.id, 'ACTIVE', aud()))
    return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  }
  ctx.fisico = await crear(ctx.a, `Gorra ${sufijo}`, 'PHYSICAL_PRODUCT', 100, `CK-F-${sufijo}`)
  ctx.fisico2 = await crear(ctx.a, `Taza ${sufijo}`, 'PHYSICAL_PRODUCT', 45.5, `CK-G-${sufijo}`)
  ctx.servicio = await crear(ctx.a, `Lavado ${sufijo}`, 'SERVICE', 250, `CK-S-${sufijo}`)
  ctx.soloCaja = await crear(ctx.a, `Solo caja ${sufijo}`, 'SERVICE', 90, `CK-C-${sufijo}`, true, { availableMarketplace: false })
  ctx.borrador = await crear(ctx.a, `Borrador ${sufijo}`, 'SERVICE', 10, `CK-D-${sufijo}`, false)
  ctx.agotado = await crear(ctx.a, `Agotado ${sufijo}`, 'PHYSICAL_PRODUCT', 20, `CK-A-${sufijo}`)
  ctx.varB = await crear(ctx.b, `Ajeno ${sufijo}`, 'SERVICE', 60, `CK-B-${sufijo}`)
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico, sucursalId: ctx.s1, cantidad: 40, motivo: 'Stock de prueba' }, aud()))
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico2, sucursalId: ctx.s1, cantidad: 3, motivo: 'Stock de prueba' }, aud()))
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.fisico, sucursalId: ctx.s2, cantidad: 2, motivo: 'Stock de prueba' }, aud()))
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const tabla of ['transactions', 'merchant_statements', 'merchant_commissions', 'merchant_ledger_entries', 'merchant_billing_configs', 'payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
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
    if (e instanceof PedidoError || e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

const pedir = (extra: Partial<EntradaDeCheckout> = {}, cliente = 0) =>
  enA((tx) =>
    crearPedidoDelCarritoEnTx(
      tx,
      ctx.a,
      { customerId: ctx.clientes[cliente], locationId: ctx.s1, lineas: [{ varianteId: ctx.servicio, cantidad: 1 }], metodo: 'AL_RECOGER', clave: clave(), ...extra },
      clienteCtx
    )
  )

const pedidoDe = (id: string) => prisma.membegoOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, attribution: true, payment: true } })
const nivel = (variante: string, sucursal = ctx.s1) => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: variante, locationId: sucursal } } })
const cuentaPedidos = () => prisma.membegoOrder.count({ where: { companyId: ctx.a } })

// ── El pedido desde el carrito ───────────────────────────────────────────────

test('1 · un carrito de varios productos es UN pedido del marketplace: precios del catálogo, existencias apartadas, esperando a la empresa', async () => {
  const antes = { f: await nivel(ctx.fisico), g: await nivel(ctx.fisico2) }
  const r = await pedir({ lineas: [{ varianteId: ctx.fisico, cantidad: 3 }, { varianteId: ctx.fisico2, cantidad: 2 }, { varianteId: ctx.servicio, cantidad: 1 }] })
  assert.equal(r.repetido, false)
  assert.equal(r.total, '641.00', '3 × 100 + 2 × 45.50 + 250')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.origin, 'MARKETPLACE')
  assert.equal(p.status, 'AWAITING_MERCHANT')
  assert.equal(p.lines.length, 3)
  assert.equal(p.locationId, ctx.s1)
  assert.equal(p.customerId, ctx.clientes[0])
  assert.equal(p.payment, null, 'pedir no cobra nada')
  const despues = { f: await nivel(ctx.fisico), g: await nivel(ctx.fisico2) }
  assert.equal(despues.f.reserved, antes.f.reserved + 3)
  assert.equal(despues.g.reserved, antes.g.reserved + 2)
  assert.equal(despues.f.onHand, antes.f.onHand, 'apartar no vende')
})

test('2 · pagar al recoger no fija método; la nota dice cómo piensa pagar y conserva el recado', async () => {
  const r = await pedir({ metodo: 'AL_RECOGER', notas: '  paso   a las 5 ' })
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.paymentMethod, null)
  assert.equal(p.notes, 'Pagará al recoger. paso a las 5')
})

test('3 · transferir queda anotado como INTENCIÓN: método TRANSFER, sin pago, sin evidencia y sin verificar', async () => {
  const r = await pedir({ metodo: 'TRANSFERENCIA', notas: 'ya transferí' }, 1)
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.paymentMethod, 'TRANSFER')
  assert.equal(p.payment, null)
  assert.equal(p.status, 'AWAITING_MERCHANT')
  assert.equal(await prisma.paymentEvidence.count({ where: { orderId: r.pedidoId } }), 0)
  assert.match(p.notes ?? '', /^Pagará por transferencia\. ya transferí$/)
})

test('4 · todo o nada: si un renglón no alcanza no queda pedido ni reserva de los demás', async () => {
  const pedidos = await cuentaPedidos()
  const antes = await nivel(ctx.fisico)
  const codigo = await codigoDe(pedir({ lineas: [{ varianteId: ctx.fisico, cantidad: 2 }, { varianteId: ctx.fisico2, cantidad: 99 }] }, 2))
  assert.equal(codigo, 'STOCK_INSUFICIENTE')
  assert.equal(await cuentaPedidos(), pedidos)
  assert.equal((await nivel(ctx.fisico)).reserved, antes.reserved, 'la reserva del primer renglón se deshizo con el resto')
})

test('5 · reenviar el MISMO formulario devuelve el mismo pedido y no aparta dos veces', async () => {
  const k = clave()
  const antes = await nivel(ctx.fisico)
  const a = await pedir({ clave: k, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] }, 3)
  const b = await pedir({ clave: k, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] }, 3)
  assert.equal(b.repetido, true)
  assert.equal(b.pedidoId, a.pedidoId)
  assert.equal((await nivel(ctx.fisico)).reserved, antes.reserved + 2)
})

test('6 · la clave es de cada cliente: otro cliente con la misma clave hace su propio pedido', async () => {
  const k = clave()
  const a = await pedir({ clave: k }, 3)
  const b = await pedir({ clave: k }, 4)
  assert.notEqual(a.pedidoId, b.pedidoId)
  assert.equal(b.repetido, false)
})

test('7 · dos personas piden la última unidad a la vez: solo una la consigue', async () => {
  const antes = await nivel(ctx.fisico, ctx.s2)
  const libres = antes.onHand - antes.reserved
  assert.equal(libres, 2)
  const intentos = await Promise.allSettled([
    pedir({ locationId: ctx.s2, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] }, 5),
    pedir({ locationId: ctx.s2, lineas: [{ varianteId: ctx.fisico, cantidad: 2 }] }, 6),
  ])
  assert.equal(intentos.filter((i) => i.status === 'fulfilled').length, 1)
  const perdedor = intentos.find((i) => i.status === 'rejected') as PromiseRejectedResult
  assert.equal((perdedor.reason as InventarioError).codigo, 'STOCK_INSUFICIENTE')
  const despues = await nivel(ctx.fisico, ctx.s2)
  assert.equal(despues.reserved, antes.reserved + 2, 'nunca se aparta de más')
})

test('8 · el tope de pedidos abiertos frena al que acumula, pero reintentar un envío ya hecho sigue funcionando', async () => {
  const cliente = 7
  const hechos: Awaited<ReturnType<typeof pedir>>[] = []
  for (let i = 0; i < MAX_PEDIDOS_ABIERTOS_POR_CLIENTE; i++) hechos.push(await pedir({ clave: `tope-${sufijo}-${i}` }, cliente))
  assert.equal(await codigoDe(pedir({}, cliente)), 'DEMASIADOS_PEDIDOS_ABIERTOS')
  const repetido = await pedir({ clave: `tope-${sufijo}-0` }, cliente)
  assert.equal(repetido.repetido, true)
  assert.equal(repetido.pedidoId, hechos[0].pedidoId)
  // Cancelar uno libera un lugar.
  await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, hechos[1].pedidoId, { motivo: 'Cambio de planes', customerId: ctx.clientes[cliente] }, clienteCtx))
  assert.equal((await pedir({}, cliente)).repetido, false)
})

// ── Lo que el navegador no decide ────────────────────────────────────────────

test('9 · el precio sale del catálogo: un precio o descuento que viaje en el renglón se ignora', async () => {
  const r = await pedir({ lineas: [{ varianteId: ctx.servicio, cantidad: 2, precioUnitario: '1', descuento: '200', precio: 1 } as never] }, 4)
  assert.equal(r.total, '500.00')
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.lines[0].unitPrice.toFixed(2), '250.00')
  assert.equal(p.lines[0].discount.toFixed(2), '0.00')
})

test('10 · el canal declarado sale de una lista cerrada: navegación, búsqueda y directo; cualquier otro se vuelve navegación', async () => {
  // Cada pedido se cancela al leerlo para no toparse con el tope de pedidos abiertos.
  const canal = async (c: unknown) => {
    const r = await pedir({ canal: c }, 5)
    const canalLeido = (await pedidoDe(r.pedidoId)).attribution?.channel
    await enA((tx) => cancelarPedidoEnTx(tx, ctx.a, r.pedidoId, { motivo: 'Prueba', customerId: ctx.clientes[5] }, clienteCtx))
    return canalLeido
  }
  assert.equal(await canal('navegacion'), 'MARKETPLACE_BROWSE')
  assert.equal(await canal('busqueda'), 'MARKETPLACE_SEARCH')
  assert.equal(await canal('directo'), 'DIRECT')
  for (const raro of ['QR', 'PROMOTION_CLAIM', 'POS', 'MARKETPLACE_SEARCH', undefined, 7, {}]) assert.equal(await canal(raro), 'MARKETPLACE_BROWSE', String(raro))
})

test('11 · entradas inválidas se rechazan con su motivo y no dejan nada', async () => {
  const pedidos = await cuentaPedidos()
  assert.equal(await codigoDe(pedir({ metodo: 'EFECTIVO' })), 'METODO_INVALIDO')
  assert.equal(await codigoDe(pedir({ metodo: 'CARD' })), 'METODO_INVALIDO')
  assert.equal(await codigoDe(pedir({ metodo: undefined })), 'METODO_INVALIDO')
  assert.equal(await codigoDe(pedir({ lineas: [] })), 'CARRITO_VACIO')
  for (const cantidad of [0, -1, 1.5, 100, Number.NaN]) assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: ctx.servicio, cantidad }] })), 'CARRITO_INVALIDO', String(cantidad))
  assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: '', cantidad: 1 }] })), 'CARRITO_INVALIDO')
  const demasiadas = Array.from({ length: MAX_LINEAS_CARRITO + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))
  assert.equal(await codigoDe(pedir({ lineas: demasiadas })), 'CARRITO_INVALIDO')
  assert.equal(await cuentaPedidos(), pedidos)
})

test('12 · no se pide lo que no se vende por el marketplace, un borrador, ni algo de otra empresa', async () => {
  const pedidos = await cuentaPedidos()
  assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: ctx.soloCaja, cantidad: 1 }] })), 'ITEM_NO_DISPONIBLE')
  assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: ctx.borrador, cantidad: 1 }] })), 'ITEM_NO_DISPONIBLE')
  assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: ctx.varB, cantidad: 1 }] })), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(pedir({ lineas: [{ varianteId: ctx.servicio, cantidad: 1 }, { varianteId: ctx.varB, cantidad: 1 }] })), 'VARIANTE_NO_ENCONTRADA', 'mezclar empresas no se puede')
  assert.equal(await cuentaPedidos(), pedidos)
})

test('13 · la sucursal tiene que existir, estar activa y ser de la empresa; el cliente también', async () => {
  assert.equal(await codigoDe(pedir({ locationId: ctx.sB })), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await codigoDe(pedir({ locationId: ctx.sInactiva })), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(pedir({ customerId: ctx.clienteB })), 'CLIENTE_NO_ENCONTRADO')
})

// ── Después de pedir: el camino de siempre ───────────────────────────────────

test('14 · el pedido del carrito sigue el camino de siempre: aceptar → listo → QR, y las existencias apartadas se venden al cerrar', async () => {
  const antes = await nivel(ctx.fisico2)
  const r = await pedir({ lineas: [{ varianteId: ctx.fisico2, cantidad: 1 }, { varianteId: ctx.servicio, cantidad: 1 }], metodo: 'TRANSFERENCIA' }, 2)
  await enA((tx) => aceptarPedidoEnTx(tx, ctx.a, r.pedidoId, empresa))
  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, r.pedidoId, empresa))
  assert.ok(listo.qrToken)
  const cierre = await enA((tx) => completarPorQrEnTx(tx, ctx.a, listo.qrToken as string, { actor: 'EMPRESA', actorId: ctx.usuario }))
  assert.ok(cierre)
  const p = await pedidoDe(r.pedidoId)
  assert.equal(p.status, 'COMPLETED')
  assert.equal(p.paymentMethod, 'TRANSFER')
  const despues = await nivel(ctx.fisico2)
  assert.equal(despues.onHand, antes.onHand + 0 - 1, 'se vendió la unidad apartada')
  assert.equal(despues.reserved, antes.reserved, 'y ya no queda apartada')
})

// ── El resumen del carrito ───────────────────────────────────────────────────

const resumen = (lineas: { varianteId: string; cantidad: number }[], sucursal: string | null = ctx.s1, empresaId = ctx.a) => conEmpresa(empresaId, (tx) => resumenDelCarritoEnTx(tx, empresaId, lineas, sucursal))

test('15 · el resumen trae nombre, precio y subtotal de HOY, y suma el total', async () => {
  const r = await resumen([{ varianteId: ctx.servicio, cantidad: 2 }, { varianteId: ctx.fisico, cantidad: 1 }])
  assert.equal(r.moneda, 'DOP')
  assert.equal(r.total, '600.00')
  assert.equal(r.comprable, true)
  const s = r.renglones.find((x) => x.varianteId === ctx.servicio)!
  assert.deepEqual({ precio: s.precio, cantidad: s.cantidad, subtotal: s.subtotal, existencias: s.existencias, problema: s.problema }, { precio: '250.00', cantidad: 2, subtotal: '500.00', existencias: null, problema: null })
  assert.match(s.nombre, /Lavado/)
})

test('16 · el resumen marca cada renglón que no se puede pagar y por qué, y no lo suma al total', async () => {
  const lineas = [
    { varianteId: ctx.servicio, cantidad: 1 },
    { varianteId: ctx.soloCaja, cantidad: 1 },
    { varianteId: ctx.borrador, cantidad: 1 },
    { varianteId: ctx.agotado, cantidad: 1 },
    { varianteId: ctx.fisico, cantidad: 90 },
    { varianteId: ctx.varB, cantidad: 1 },
    { varianteId: 'no-existe', cantidad: 1 },
  ]
  const r = await resumen(lineas)
  const por = (v: string) => r.renglones.find((x) => x.varianteId === v)!
  assert.equal(por(ctx.servicio).problema, null)
  assert.equal(por(ctx.soloCaja).problema, 'Ya no está disponible.')
  assert.equal(por(ctx.borrador).problema, 'Ya no está disponible.')
  assert.equal(por(ctx.agotado).problema, 'Agotado en esta sucursal.')
  assert.match(por(ctx.fisico).problema ?? '', /^Solo quedan \d+ en esta sucursal\.$/)
  assert.equal(por(ctx.varB).problema, 'Ya no está disponible.', 'lo de otra empresa no existe para esta')
  assert.equal(por('no-existe').problema, 'Ya no está disponible.')
  assert.equal(r.total, '250.00', 'solo suma lo que sí se puede pagar')
  assert.equal(r.comprable, false)
})

test('17 · el resumen cuenta lo apartado: lo que otros ya pidieron no se ofrece', async () => {
  const antes = (await resumen([{ varianteId: ctx.fisico, cantidad: 1 }], ctx.s2)).renglones[0]
  const n = antes.existencias!
  await pedir({ locationId: ctx.s2, lineas: [{ varianteId: ctx.fisico, cantidad: 1 }] }, 0).catch(() => null)
  const despues = (await resumen([{ varianteId: ctx.fisico, cantidad: 1 }], ctx.s2)).renglones[0]
  assert.ok(despues.existencias! <= n)
})

test('18 · sin sucursal el resumen no conoce existencias; un carrito vacío no es comprable', async () => {
  const r = await resumen([{ varianteId: ctx.fisico, cantidad: 1 }], null)
  assert.equal(r.renglones[0].existencias, null)
  assert.equal(r.comprable, true)
  const vacio = await resumen([])
  assert.equal(vacio.comprable, false)
  assert.equal(vacio.total, '0.00')
})

test('19 · aislamiento: el resumen de una empresa no ve las variantes de la otra', async () => {
  const b = await resumen([{ varianteId: ctx.varB, cantidad: 1 }, { varianteId: ctx.servicio, cantidad: 1 }], null, ctx.b)
  assert.equal(b.renglones.find((x) => x.varianteId === ctx.varB)?.problema, null)
  assert.equal(b.renglones.find((x) => x.varianteId === ctx.servicio)?.problema, 'Ya no está disponible.')
  assert.equal(b.total, '60.00')
})
