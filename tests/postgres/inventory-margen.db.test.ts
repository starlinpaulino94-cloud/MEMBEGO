import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { ajustarEnTx, danarEnTx, registrarEntradaMultipleEnTx, venderEnTx } from '../../src/modules/inventory/service'
import { completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'
import { margenEnTx, totalesDeMargenEnTx, type MargenVista } from '../../src/modules/inventory/margen-queries'
import { resumenInventarioEmpresa } from '../../src/modules/inventory/dashboard'
import { CIFRAS_VACIAS, filaDeMargen, sumarCifras, totalDeMargen, type FiltrosMargen, type OrdenMargen } from '../../src/modules/inventory/margen'
import { parsearCosto, type Costo } from '../../src/modules/inventory/costos'
import { diaLocal, sumarDias } from '../../src/modules/reportes/rango'

/**
 * INV-4c · MARGEN REAL contra PostgreSQL de verdad, con el FLUJO REAL de pedidos (crear → listo → completar por QR → reembolsar).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el ingreso (la línea del pedido) y el costo (el movimiento `SALE` del ledger, con el costo que congeló) se unen bien:
 *    por pedido y variante, con descuento de línea, centavos y costos de cuatro decimales;
 *  · lo que NO entra al margen y por qué: unidades sin costo (ni como cero), pedidos reembolsados (devuelvan o no la mercancía),
 *    pedidos en otra moneda y ventas que no vienen de un pedido;
 *  · los cinco órdenes, el rango de días (en el calendario de la empresa), los filtros, las páginas y el archivo;
 *  · que los totales son exactamente la suma de las filas;
 *  · la tarjeta del dashboard (valor, margen del mes, lo perdido) con y sin la función de costos;
 *  · que cada empresa ve solo lo suyo.
 *
 * Las fechas del ledger se mueven con `session_replication_role = replica` solo en estas pruebas.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'

const ctx = { a: '', b: '', c: '', usuario: '', suc1: '', suc2: '', sucB: '', sucC: '', cli: '', cliB: '', cliC: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)
const enC = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.c, fn)

const comoInv = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const empresa = (actorId: string | null): ContextoPedido => ({ actor: 'EMPRESA', actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const cliente: ContextoPedido = { actor: 'CLIENTE', actorId: null, ipAddress: '127.0.0.1', userAgent: 'test' }
const sistema: ContextoPedido = { actor: 'SISTEMA', actorId: null }

const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, t)
  return r.valor
}
const CERO = BigInt(0)

let contador = 0
/** Un producto físico ACTIVO de la empresa dada, con su precio (y moneda). Devuelve la variante. */
async function producto(empresaId: string, nombre: string, precio: number, moneda?: string, skuPropio?: string): Promise<{ id: string; sku: string }> {
  const n = ++contador
  const sku = skuPropio ? `${skuPropio}-${sufijo}`.toUpperCase() : `MGN-${n}-${sufijo}`.toUpperCase()
  const r = await conEmpresa(empresaId, (tx) => crearItemEnTx(tx, empresaId, { name: `${nombre} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: precio, sku, ...(moneda ? { currency: moneda } : {}) }, comoInv(ctx.usuario)))
  await conEmpresa(empresaId, (tx) => cambiarEstadoItemEnTx(tx, empresaId, r.id, 'ACTIVE', comoInv(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return { id: v.id, sku }
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Margen ${x} ${sufijo}`, slug: `margen-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b, cc] = await Promise.all([mk('a'), mk('b'), mk('c')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.c = cc.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-mgn-${sufijo}`, email: `mgn-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  ctx.sucC = (await suc(ctx.c, 'De C')).id
  const cli = (companyId: string, x: string) => prisma.cliente.create({ data: { companyId, supabaseId: `sb-mgn-cli-${x}-${sufijo}`, nombre: `Cliente ${x}`, email: `mgn-cli-${x}-${sufijo}@prueba.test` }, select: { id: true } })
  ctx.cli = (await cli(ctx.a, 'a')).id
  ctx.cliB = (await cli(ctx.b, 'b')).id
  ctx.cliC = (await cli(ctx.c, 'c')).id
})

after(async () => {
  const ids = [ctx.a, ctx.b, ctx.c]
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
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_variant_costs',
        'inventory_movements',
        'inventory_reservations',
        'inventory_levels',
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.auditLog.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

const entradaDe = (conEmp: <T>(fn: (tx: Transaccion) => Promise<T>) => Promise<T>, empresaId: string, sucursalId: string) =>
  (lineas: Array<{ varianteId: string; cantidad: number; costo?: string }>) =>
    conEmp((tx) => registrarEntradaMultipleEnTx(tx, empresaId, { sucursalId, lineas }, comoInv(ctx.usuario)))
const entradaA = (v: string, cantidad: number, costo?: string, sucursalId = ctx.suc1) => entradaDe(enA, ctx.a, sucursalId)([{ varianteId: v, cantidad, ...(costo ? { costo } : {}) }])

/** Mueve a «hace `dias` días» las ventas (y devoluciones) de un pedido: el ledger es inmutable, solo la prueba lo toca. */
async function moverPedido(pedidoId: string, dias: number) {
  if (dias === 0) return
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`UPDATE "inventory_movements" SET "createdAt" = "createdAt" - interval '${dias} days' WHERE "referenceType" = 'ORDER' AND "referenceId" = '${pedidoId}'`)
  })
}

interface OpcionesVenta {
  dias?: number
  sucursalId?: string
  actor?: ContextoPedido
  reembolso?: 'devolviendo' | 'sin devolver'
  empresaId?: string
  clienteId?: string
}

/** Un pedido de verdad: se crea, se pone listo, se completa por su QR y, si se pide, se reembolsa. Devuelve su id. */
async function vender(lineas: Array<{ varianteId: string; cantidad: number; descuento?: number }>, o: OpcionesVenta = {}): Promise<string> {
  const empresaId = o.empresaId ?? ctx.a
  const sucursalId = o.sucursalId ?? (empresaId === ctx.a ? ctx.suc1 : empresaId === ctx.b ? ctx.sucB : ctx.sucC)
  const clienteId = o.clienteId ?? (empresaId === ctx.a ? ctx.cli : empresaId === ctx.b ? ctx.cliB : ctx.cliC)
  const r = await conEmpresa(empresaId, (tx) =>
    crearPedidoEnTx(tx, empresaId, { customerId: clienteId, locationId: sucursalId, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas }, o.actor ?? cliente)
  )
  const listo = await conEmpresa(empresaId, (tx) => marcarListoEnTx(tx, empresaId, r.pedidoId, empresa(ctx.usuario)))
  assert.ok(listo.qrToken)
  await conEmpresa(empresaId, (tx) => completarPorQrEnTx(tx, empresaId, listo.qrToken as string, empresa(ctx.usuario)))
  if (o.reembolso) {
    await conEmpresa(empresaId, (tx) => reembolsarPedidoEnTx(tx, empresaId, r.pedidoId, { motivo: 'Prueba', devolverAlInventario: o.reembolso === 'devolviendo' }, empresa(ctx.usuario)))
  }
  await moverPedido(r.pedidoId, o.dias ?? 0)
  return r.pedidoId
}

const hoy = () => diaLocal(new Date(), ZONA)
const diasAtras = (n: number) => sumarDias(hoy(), -n)

const margen = (f: Partial<FiltrosMargen> = {}, o: { todas?: boolean; empresa?: 'a' | 'b' | 'c' } = {}): Promise<MargenVista> => {
  const [conEmp, empresaId] = o.empresa === 'b' ? [enB, ctx.b] : o.empresa === 'c' ? [enC, ctx.c] : [enA, ctx.a]
  return conEmp((tx) => margenEnTx(tx, empresaId, { orden: 'margen', pagina: 1, ...f }, { zonaHoraria: ZONA, todas: o.todas }))
}

/**
 * Una empresa con ventas de todo tipo, armadas con el flujo real. Se arma UNA vez (cada prueba filtra por `q` y no suma lo suyo a lo
 * de las demás). Productos: P1 (con descuento de línea, dos sucursales y una venta fuera del rango), P2 (se vende bajo el costo), P3 (sin
 * costo), P4 (reembolsado, con y sin devolver al inventario), P5 (en otra moneda), P6 (ventas sin pedido) y P7 (centavos y costo de
 * cuatro decimales).
 */
let armado: ReturnType<typeof armarLedger> | null = null
const ledger = () => (armado ??= armarLedger())
async function armarLedger() {
  const p1 = await producto(ctx.a, 'Margen uno', 100)
  const p2 = await producto(ctx.a, 'Margen dos', 50)
  const p3 = await producto(ctx.a, 'Margen tres', 40)
  const p4 = await producto(ctx.a, 'Margen cuatro', 10)
  const p5 = await producto(ctx.a, 'Margen cinco', 30)
  const p6 = await producto(ctx.a, 'Margen seis', 10)
  const p7 = await producto(ctx.a, 'Margen siete', 33.33)
  const p8 = await producto(ctx.a, 'Referencia ocho', 10)
  const p9 = await producto(ctx.a, 'Referencia nueve', 10)
  const p10 = await producto(ctx.a, 'Parcial diez', 20)
  await entradaA(p1.id, 200, '60')
  await entradaA(p1.id, 50, '60', ctx.suc2)
  await entradaA(p2.id, 100, '80')
  await entradaA(p3.id, 100) // SIN costo
  await entradaA(p4.id, 50, '4')
  await entradaA(p5.id, 50, '10')
  await entradaA(p6.id, 50, '6')
  await entradaA(p7.id, 50, '12.3456')
  await entradaA(p8.id, 50, '3')
  await entradaA(p9.id, 50, '5')
  await entradaA(p10.id, 50, '5')

  // P1: 2 u a 100 = 200 (costo 120) · 3 u con 30 de descuento de línea = 270 (costo 180) · 1 u en Norte = 100 (costo 60).
  const o1 = await vender([{ varianteId: p1.id, cantidad: 2 }], { dias: 12 })
  const o2 = await vender([{ varianteId: p1.id, cantidad: 3, descuento: 30 }], { dias: 11, actor: sistema })
  const o8 = await vender([{ varianteId: p1.id, cantidad: 1 }], { dias: 9, sucursalId: ctx.suc2 })
  // …y una venta de P1 de hace 70 días: fuera del rango por defecto.
  const o7 = await vender([{ varianteId: p1.id, cantidad: 1 }], { dias: 70 })
  // P2: 4 u a 50 = 200, costaron 320: se vendió bajo el costo.
  const o3 = await vender([{ varianteId: p2.id, cantidad: 4 }], { dias: 8 })
  // P3: 5 u a 40 = 200, sin costo conocido.
  const o4 = await vender([{ varianteId: p3.id, cantidad: 5 }], { dias: 7 })
  // P4: reembolsado devolviendo la mercancía (2 u) y reembolsado SIN devolverla (1 u).
  const o5 = await vender([{ varianteId: p4.id, cantidad: 2 }], { dias: 6, reembolso: 'devolviendo' })
  const o5b = await vender([{ varianteId: p4.id, cantidad: 1 }], { dias: 6, reembolso: 'sin devolver' })
  // P5: un pedido que acaba en otra moneda (se completa y luego se cambia su moneda: el cierre de un pedido en otra moneda
  // depende de la cuenta Membego, que aquí no es el asunto).
  const o6 = await vender([{ varianteId: p5.id, cantidad: 1 }], { dias: 5 })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`UPDATE "membego_orders" SET "currency" = 'USD' WHERE "id" = '${o6}'`)
  })
  // P6: ventas que no vienen de un pedido (a mano) y una que cita un pedido que no existe.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p6.id, sucursalId: ctx.suc1, cantidad: 3 }, comoInv(ctx.usuario)))
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p6.id, sucursalId: ctx.suc1, cantidad: 1, referencia: { tipo: 'ORDER', id: `no-existe-${sufijo}` } }, comoInv(ctx.usuario)))
  // P7: 3 u a 33.33 = 99.99, costo 3 × 12.3456 = 37.0368.
  const o9 = await vender([{ varianteId: p7.id, cantidad: 3 }], { dias: 4 })
  // P8: una venta de verdad y otra a mano que CITA ese pedido con otro tipo de referencia: no es una venta de ese pedido.
  const o10 = await vender([{ varianteId: p8.id, cantidad: 1 }], { dias: 3 })
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p8.id, sucursalId: ctx.suc1, cantidad: 1, referencia: { tipo: 'FACTURA', id: o10 } }, comoInv(ctx.usuario)))
  // P9: una venta a mano que cita un pedido REAL (el de P1) donde este producto no tiene línea: tampoco hay a cuánto se vendió.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p9.id, sucursalId: ctx.suc1, cantidad: 2, referencia: { tipo: 'ORDER', id: o1 } }, comoInv(ctx.usuario)))
  // P10: un pedido de 5 unidades cuya línea acaba valiendo 10 (el ledger vendió solo la mitad): el ingreso es la mitad de la línea.
  const o11 = await vender([{ varianteId: p10.id, cantidad: 5 }], { dias: 2 })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`UPDATE "membego_order_lines" SET "quantity" = 10, "lineTotal" = 200 WHERE "orderId" = '${o11}'`)
  })
  return { p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, o1, o2, o3, o4, o5, o5b, o6, o7, o8, o9, o10, o11 }
}

const porProducto = (v: MargenVista, sku: string) => v.filas.find((f) => f.sku === sku)!

// ── Las cifras ───────────────────────────────────────────────────────────────

test('1 · el margen de cada producto sale del precio de la línea contra el costo congelado: con descuento de línea, en dos sucursales, bajo el costo, con centavos', async () => {
  const { p1, p2, p7 } = await ledger()
  const v = await margen({ q: 'Margen ' })
  // P1: 200 + 270 (con 30 de descuento) + 100 (Norte) = 570; costo 120 + 180 + 60 = 360. La venta de hace 70 días no entra.
  const f1 = porProducto(v, p1.sku)
  assert.deepEqual([f1.unidades, f1.ingresos, f1.costo, f1.margen, f1.margenPct, f1.unidadesSinCosto], [6, c('570'), c('360'), c('210'), 36.8, 0])
  // P2: se vendió por debajo del costo: el margen es NEGATIVO, no cero.
  const f2 = porProducto(v, p2.sku)
  assert.deepEqual([f2.unidades, f2.ingresos, f2.costo, f2.margen, f2.margenPct], [4, c('200'), c('320'), -c('120'), -60])
  // P7: centavos y costo de cuatro decimales, exactos (sin coma flotante).
  const f7 = porProducto(v, p7.sku)
  assert.deepEqual([f7.unidades, f7.ingresos, f7.costo, f7.margen, f7.margenPct], [3, c('99.99'), c('37.0368'), c('62.9532'), 63])
})

test('2 · lo vendido SIN costo conocido no entra al margen —ni con costo cero, que lo inflaría—: se cuenta aparte con lo que se cobró por ello', async () => {
  const { p3 } = await ledger()
  const v = await margen({ q: 'Margen ' })
  const f3 = porProducto(v, p3.sku)
  assert.deepEqual([f3.unidades, f3.ingresos, f3.costo, f3.unidadesSinCosto, f3.ingresosSinCosto], [5, c('200'), CERO, 5, c('200')])
  assert.equal(f3.margen, CERO, 'ni una ganancia total de 200 ni una pérdida')
  assert.equal(f3.margenPct, null, 'sin base de costo no hay porcentaje')
  assert.deepEqual([v.totales.unidadesSinCosto, v.totales.ingresosSinCosto], [5, c('200')])
})

test('3 · los totales son lo que entra al margen: la base excluye lo sin costo y el porcentaje sale del total, no del promedio de porcentajes', async () => {
  await ledger()
  const v = await margen({ q: 'Margen ' })
  const t = v.totales
  // P1 6 u + P2 4 u + P3 5 u + P7 3 u. Ingresos 570 + 200 + 200 + 99.99; costo 360 + 320 + 0 + 37.0368.
  assert.deepEqual([t.productos, t.unidades, t.ingresos, t.costo], [4, 18, c('1069.99'), c('717.0368')])
  assert.equal(t.baseConCosto, c('869.99'), '1069.99 menos los 200 cobrados por lo que no tiene costo')
  assert.equal(t.margen, c('152.9532'))
  assert.equal(t.margenPct, 17.6)
  assert.equal(v.moneda, 'DOP')
})

test('4 · un pedido reembolsado sale del margen —devuelva o no la mercancía—, y un pedido en otra moneda y una venta sin pedido tampoco entran', async () => {
  await ledger()
  const v = await margen({ q: 'Margen ' })
  const por = Object.fromEntries(v.excluidas.map((e) => [e.clase, e]))
  // P4: 2 u reembolsadas devolviendo + 1 u sin devolver = 3 u a costo 4 = 12 (el costo de lo que SALIÓ como venta).
  assert.deepEqual([por.REEMBOLSADO.unidades, por.REEMBOLSADO.costo], [3, c('12')])
  // P5: 1 u a costo 10, en otra moneda.
  assert.deepEqual([por.OTRA_MONEDA.unidades, por.OTRA_MONEDA.costo], [1, c('10')])
  // P6: 3 u sin referencia + 1 u que cita un pedido inexistente = 4 u a costo 6 = 24.
  assert.deepEqual([por.SIN_INGRESO.unidades, por.SIN_INGRESO.costo], [4, c('24')])
  assert.deepEqual(v.excluidas.map((e) => e.clase), ['REEMBOLSADO', 'OTRA_MONEDA', 'SIN_INGRESO'])
  // Y ninguno aparece como fila del margen.
  assert.equal(v.filas.length, 4)
  const { p4, p5, p6 } = await ledger()
  for (const p of [p4, p5, p6]) assert.equal(v.filas.some((f) => f.sku === p.sku), false, p.sku)
})

test('5 · un pedido sin devolver la mercancía es una venta reembolsada, no una pérdida escondida: queda a la vista fuera del margen', async () => {
  const { p4 } = await ledger()
  // El ledger lo dice: salieron 3 unidades como venta y solo 2 volvieron.
  const movs = await prisma.inventoryMovement.groupBy({ by: ['type'], where: { companyId: ctx.a, level: { catalogVariantId: p4.id } }, _sum: { quantity: true } })
  const suma = Object.fromEntries(movs.map((m) => [m.type, m._sum.quantity]))
  assert.deepEqual([suma.SALE, suma.RETURN], [3, 2])
  const v = await margen({ q: p4.sku.toLowerCase() })
  assert.equal(v.totales.productos, 0)
  assert.equal(v.excluidas.find((e) => e.clase === 'REEMBOLSADO')!.unidades, 3)
})

test('5b · una venta solo es de un pedido si cita ese pedido COMO pedido y el pedido tiene línea de ese producto; si no, no hay a cuánto se vendió', async () => {
  const { p8, p9 } = await ledger()
  const v = await margen({ q: 'Referencia' })
  // P8: la venta del pedido entra (1 u a 10, costó 3); la que cita el pedido con otro tipo de referencia (FACTURA) no se le suma.
  assert.deepEqual(v.filas.map((f) => [f.sku, f.unidades, f.ingresos, f.costo, f.margen]), [[p8.sku, 1, c('10'), c('3'), c('7')]])
  // P8 (1 u, costo 3) + P9 (2 u, costo 5 → 10): ventas sin pedido que diga a cuánto.
  const sin = v.excluidas.find((e) => e.clase === 'SIN_INGRESO')!
  assert.deepEqual([sin.unidades, sin.costo], [3, c('13')])
  assert.equal(v.filas.some((f) => f.sku === p9.sku), false, 'citar un pedido donde el producto no tiene línea no lo vuelve una venta con precio')
})

test('5c · si el ledger vendió solo una parte de la línea del pedido, el ingreso es esa parte de la línea (ni la línea entera ni más)', async () => {
  const { p10 } = await ledger()
  // La línea dice 10 u a 20 = 200; el ledger vendió 5 con costo 5: ingreso 100, costo 25.
  const v = await margen({ q: 'Parcial' })
  assert.deepEqual(v.filas.map((f) => [f.sku, f.unidades, f.ingresos, f.costo, f.margen, f.margenPct]), [[p10.sku, 5, c('100'), c('25'), c('75'), 75]])
})

// ── Orden ────────────────────────────────────────────────────────────────────

test('6 · los cinco órdenes, y el orden de SQL es el del margen que calcula el código para cada fila', async () => {
  const { p1, p2, p3, p7 } = await ledger()
  const skus = async (orden: OrdenMargen) => (await margen({ q: 'Margen ', orden })).filas.map((f) => f.sku)
  // Margen: P1 210 · P7 62,95 · P3 0 · P2 −120.
  assert.deepEqual(await skus('margen'), [p1.sku, p7.sku, p3.sku, p2.sku])
  // Peor margen primero: lo que se vende bajo el costo.
  assert.deepEqual(await skus('peor'), [p2.sku, p3.sku, p7.sku, p1.sku])
  // Porcentaje: P7 63 % · P1 36,8 % · P2 −60 % · P3 sin porcentaje (al final).
  assert.deepEqual(await skus('porcentaje'), [p7.sku, p1.sku, p2.sku, p3.sku])
  // Ingresos: P1 570 · P2 y P3 200 (empate: por SKU) · P7 99,99.
  assert.deepEqual(await skus('ingresos'), [p1.sku, p2.sku, p3.sku, p7.sku])
  // Unidades: P1 6 · P3 5 · P2 4 · P7 3.
  assert.deepEqual(await skus('unidades'), [p1.sku, p3.sku, p2.sku, p7.sku])
  // El margen y el porcentaje de cada fila (que calcula el código) siguen el orden que dio la base.
  const m = (await margen({ q: 'Margen ', orden: 'margen' })).filas
  for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].margen >= m[i].margen, `fila ${i} fuera de orden`)
  const p = (await margen({ q: 'Margen ', orden: 'porcentaje' })).filas.filter((f) => f.margenPct !== null)
  for (let i = 1; i < p.length; i++) assert.ok((p[i - 1].margenPct ?? 0) >= (p[i].margenPct ?? 0), `porcentaje ${i} fuera de orden`)
})

test('6b · a igual margen, ingresos y unidades el orden sigue fijo (por SKU), en los cinco órdenes, aunque los productos se hayan creado al revés', async () => {
  // Seis productos idénticos (1 u a 10, costo 4) creados con SKU de la Z a la A: sin desempate, el orden dependería de la base.
  const letras = ['F', 'E', 'D', 'C', 'B', 'A']
  const ps: Array<{ id: string; sku: string }> = []
  for (const l of letras) ps.push(await producto(ctx.a, `Empate margen ${l}`, 10, undefined, `EMP-${l}`))
  await entradaDe(enA, ctx.a, ctx.suc1)(ps.map((p) => ({ varianteId: p.id, cantidad: 5, costo: '4' })))
  await vender(ps.map((p) => ({ varianteId: p.id, cantidad: 1 })), { dias: 1 })
  const esperado = [...ps].map((p) => p.sku).sort()
  for (const orden of ['margen', 'peor', 'porcentaje', 'ingresos', 'unidades'] as OrdenMargen[]) {
    const v = await margen({ q: 'Empate margen', orden })
    assert.deepEqual(v.filas.map((f) => f.sku), esperado, orden)
  }
})

test('7b · el rango por defecto son EXACTAMENTE los últimos 30 días: la venta de hace 29 días entra y la de hace 30 no', async () => {
  const p = await producto(ctx.a, 'Borde margen', 10)
  await entradaA(p.id, 20, '4')
  await vender([{ varianteId: p.id, cantidad: 1 }], { dias: 29 })
  await vender([{ varianteId: p.id, cantidad: 2 }], { dias: 30 })
  const v = await margen({ q: 'Borde margen' })
  assert.deepEqual([v.desde, v.hasta], [diasAtras(29), hoy()])
  assert.deepEqual(v.filas.map((f) => [f.unidades, f.ingresos]), [[1, c('10')]], 'la de hace 30 días queda fuera')
  const mas = await margen({ q: 'Borde margen', desde: diasAtras(30) })
  assert.deepEqual(mas.filas.map((f) => f.unidades), [3], 'con un rango que la alcanza, entra')
})

test('7c · un pedido reembolsado que además está en otra moneda cuenta como reembolsado (la razón más informativa decide primero)', async () => {
  const p = await producto(ctx.a, 'Doble margen', 10)
  await entradaA(p.id, 20, '4')
  const o = await vender([{ varianteId: p.id, cantidad: 2 }], { dias: 1, reembolso: 'devolviendo' })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`UPDATE "membego_orders" SET "currency" = 'USD' WHERE "id" = '${o}'`)
  })
  const v = await margen({ q: 'Doble margen' })
  const por = Object.fromEntries(v.excluidas.map((e) => [e.clase, e]))
  assert.deepEqual([por.REEMBOLSADO.unidades, por.REEMBOLSADO.costo, por.OTRA_MONEDA.unidades, v.totales.productos], [2, c('8'), 0, 0])
})

// ── Rango y filtros ──────────────────────────────────────────────────────────

test('7 · el rango: por defecto los últimos 30 días; un rango propio incluye el primer y el último día y se mide en el calendario de la empresa', async () => {
  const { p1 } = await ledger()
  assert.equal(porProducto(await margen({ q: 'Margen ' }), p1.sku).unidades, 6, 'la venta de hace 70 días no está en los últimos 30')
  const ancho = await margen({ q: 'Margen ', desde: diasAtras(80) })
  assert.equal(porProducto(ancho, p1.sku).unidades, 7, 'con un rango que la alcanza, sí')
  assert.equal(porProducto(ancho, p1.sku).ingresos, c('670'))
  // Un solo día: justo el de la venta de hace 12 días (2 u a 100).
  const uno = await margen({ q: 'Margen ', desde: diasAtras(12), hasta: diasAtras(12) })
  assert.deepEqual([uno.filas.length, uno.filas[0].sku, uno.filas[0].unidades, uno.filas[0].ingresos], [1, p1.sku, 2, c('200')])
  // El día anterior y el siguiente no la incluyen.
  assert.equal((await margen({ q: 'Margen ', desde: diasAtras(13), hasta: diasAtras(13) })).filas.length, 0)
  assert.equal((await margen({ q: 'Margen ', desde: diasAtras(11), hasta: diasAtras(11) })).filas.map((f) => f.sku).join(), p1.sku, 'la de hace 11 días (3 u con descuento)')
  assert.deepEqual([(await margen({ q: 'Margen ', desde: diasAtras(10), hasta: diasAtras(10) })).filas.length], [0], 'hace 10 días no hubo ventas')
})

test('8 · filtros: por sucursal, por producto (nombre, SKU y código de barras) y una sucursal de otra empresa no devuelve nada', async () => {
  const { p1, p2 } = await ledger()
  const norte = await margen({ q: 'Margen ', sucursalId: ctx.suc2 })
  assert.deepEqual(norte.filas.map((f) => [f.sku, f.unidades, f.ingresos, f.costo]), [[p1.sku, 1, c('100'), c('60')]])
  assert.equal(norte.totales.productos, 1)
  const principal = await margen({ q: p1.sku, sucursalId: ctx.suc1 })
  assert.equal(principal.filas[0].unidades, 5, '2 + 3 de la sucursal Principal')
  assert.equal(norte.excluidas.every((e) => e.unidades === 0), true, 'lo excluido también sigue el filtro de sucursal')
  assert.deepEqual((await margen({ q: p2.sku.toLowerCase() })).filas.map((f) => f.sku), [p2.sku], 'el SKU busca sin importar mayúsculas')
  const barcode = `8${Date.now().toString().slice(-9)}${contador}`
  await prisma.catalogVariant.update({ where: { id: p2.id }, data: { barcode } })
  assert.deepEqual((await margen({ q: barcode })).filas.map((f) => f.sku), [p2.sku], 'el código de barras también busca')
  assert.equal((await margen({ q: 'nada-que-coincida-xyz' })).totales.productos, 0)
  const ajena = await margen({ q: 'Margen ', sucursalId: ctx.sucB })
  assert.equal(ajena.totales.productos, 0, 'una sucursal de otra empresa no devuelve nada')
  assert.equal(ajena.filas.length, 0)
  // Los comodines de la búsqueda no son comodines: «%» no trae todo.
  assert.equal((await margen({ q: '%' })).totales.productos, 0)
})

// ── Páginas y archivo ────────────────────────────────────────────────────────

test('9 · páginas y archivo: no se repite ni se pierde ningún producto, y el archivo trae todos aunque pasen de una página; los totales son de TODO', async () => {
  const ids: string[] = []
  const lineas: Array<{ varianteId: string; cantidad: number }> = []
  for (let i = 0; i < 52; i++) {
    const p = await producto(ctx.a, `Muchos margen ${String(i).padStart(2, '0')}`, 20)
    ids.push(p.id)
    lineas.push({ varianteId: p.id, cantidad: 1 })
  }
  await entradaDe(enA, ctx.a, ctx.suc1)(ids.map((id) => ({ varianteId: id, cantidad: 5, costo: '8' })))
  await vender(lineas, { dias: 3 })
  const p1 = await margen({ q: 'Muchos margen', pagina: 1 })
  const p2 = await margen({ q: 'Muchos margen', pagina: 2 })
  assert.deepEqual([p1.filas.length, p2.filas.length, p1.totales.productos, p2.totales.productos, p1.pagina, p2.pagina], [50, 2, 52, 52, 1, 2])
  const todas = await margen({ q: 'Muchos margen', pagina: 2 }, { todas: true })
  assert.equal(todas.filas.length, 52, 'el archivo trae todo y no salta a la página pedida')
  assert.equal(todas.pagina, 1)
  const vistos = [...p1.filas, ...p2.filas].map((f) => f.varianteId)
  assert.equal(new Set(vistos).size, 52)
  assert.deepEqual(todas.filas.map((f) => f.varianteId), vistos, 'el archivo y las páginas van en el mismo orden')
  assert.deepEqual([p1.totales.unidades, p1.totales.ingresos, p1.totales.costo, p1.totales.margen], [52, c('1040'), c('416'), c('624')], 'los totales son de todo el rango, no de la página')
  assert.equal((await margen({ q: 'Muchos margen', pagina: 99 })).filas.length, 0)
})

test('10 · los totales son EXACTAMENTE la suma de las filas (y de lo excluido, cada clase), con cualquier filtro', async () => {
  await ledger()
  for (const f of [{ q: 'Margen ' }, { q: 'Margen ', sucursalId: ctx.suc2 }, { q: 'Margen ', desde: diasAtras(80) }, { q: 'Margen dos' }]) {
    const v = await margen(f, { todas: true })
    const suma = v.filas.reduce((t, x) => sumarCifras(t, x), CIFRAS_VACIAS)
    assert.deepEqual(
      [v.totales.unidades, v.totales.ingresos, v.totales.costo, v.totales.unidadesSinCosto, v.totales.ingresosSinCosto, v.totales.productos],
      [suma.unidades, suma.ingresos, suma.costo, suma.unidadesSinCosto, suma.ingresosSinCosto, v.filas.length],
      JSON.stringify(f)
    )
    const t = totalDeMargen(suma, v.filas.length)
    assert.deepEqual([v.totales.margen, v.totales.margenPct], [t.margen, t.margenPct])
    // Cada fila es la misma cuenta que hace el código sobre sus cifras.
    for (const x of v.filas) assert.deepEqual(filaDeMargen(x), x)
  }
  // Y el total de la función que usa el dashboard es el mismo que el del informe.
  const rango = { gte: new Date(Date.now() - 80 * 86_400_000), lt: new Date(Date.now() + 86_400_000) }
  const t = await enA((tx) => totalesDeMargenEnTx(tx, ctx.a, rango, { q: 'Margen ' }))
  const v = await margen({ q: 'Margen ', desde: diasAtras(80) }, { todas: true })
  assert.deepEqual([t.totales.unidades, t.totales.ingresos, t.totales.costo, t.totales.margen], [v.totales.unidades, v.totales.ingresos, v.totales.costo, v.totales.margen])
})

// ── Aislamiento ──────────────────────────────────────────────────────────────

test('11 · cada empresa ve solo lo suyo', async () => {
  await ledger()
  const pb = await producto(ctx.b, 'Ajeno margen', 100)
  await entradaDe(enB, ctx.b, ctx.sucB)([{ varianteId: pb.id, cantidad: 10, costo: '70' }])
  await vender([{ varianteId: pb.id, cantidad: 2 }], { empresaId: ctx.b })
  const b = await margen({}, { empresa: 'b' })
  assert.deepEqual(b.filas.map((f) => [f.sku, f.unidades, f.ingresos, f.costo, f.margen]), [[pb.sku, 2, c('200'), c('140'), c('60')]])
  assert.deepEqual(b.excluidas.map((e) => e.unidades), [0, 0, 0])
  const a = await margen({ q: 'Ajeno margen' })
  assert.equal(a.totales.productos, 0, 'lo de B no aparece en A')
  const aTodo = await margen({ q: 'Margen ' })
  assert.equal(aTodo.filas.some((f) => f.sku === pb.sku), false)
})

// ── La tarjeta del dashboard ─────────────────────────────────────────────────

test('12 · la tarjeta del dashboard: valor, margen del mes y lo perdido salen de la misma cuenta que los informes; sin la función de costos no se lee ni un costo', async () => {
  const p = await producto(ctx.c, 'Tarjeta', 100)
  await entradaDe(enC, ctx.c, ctx.sucC)([{ varianteId: p.id, cantidad: 50, costo: '60' }])
  await vender([{ varianteId: p.id, cantidad: 3 }], { empresaId: ctx.c })
  await enC((tx) => ajustarEnTx(tx, ctx.c, { varianteId: p.id, sucursalId: ctx.sucC, cambio: -2, motivoCodigo: 'LOST' }, comoInv(ctx.usuario)))
  await enC((tx) => danarEnTx(tx, ctx.c, { varianteId: p.id, sucursalId: ctx.sucC, cantidad: 1, motivoCodigo: 'HANDLING' }, comoInv(ctx.usuario)))
  // 50 − 3 vendidas − 2 perdidas = 45; una dañada sigue en la sucursal: 45 unidades físicas a 60 = 2.700.
  const con = await resumenInventarioEmpresa(ctx.c, ZONA, { conCostos: true })
  assert.equal(con.conCostos, true)
  assert.match(con.mes, /^\d{4}-\d{2}$/)
  assert.deepEqual([con.unidadesEnExistencia, con.valor, con.unidadesSinCosto], [45, c('2700'), 0])
  // Margen del mes: 3 u a 100 = 300, costaron 180 → 120 (40 %).
  assert.deepEqual([con.margen!.unidades, con.margen!.ingresos, con.margen!.costo, con.margen!.margen, con.margen!.margenPct], [3, c('300'), c('180'), c('120'), 40])
  // Perdido: el faltante de 2 u (a 60 = 120); lo dañado todavía está en la sucursal y no cuenta.
  assert.deepEqual([con.perdido.unidades, con.perdido.movimientos, con.perdido.valor, con.perdido.unidadesSinCosto], [2, 1, c('120'), 0])

  // Sin la función `costos`: unidades y nada más (ni valor, ni margen, ni lo que costó lo perdido).
  const sin = await resumenInventarioEmpresa(ctx.c, ZONA, { conCostos: false })
  assert.deepEqual([sin.conCostos, sin.unidadesEnExistencia, sin.valor, sin.unidadesSinCosto, sin.margen], [false, 45, null, null, null])
  assert.deepEqual([sin.perdido.unidades, sin.perdido.movimientos, sin.perdido.valor, sin.perdido.unidadesSinCosto], [2, 1, null, null])

  // El mes lo decide el calendario de la empresa: dentro de 40 días ya es otro mes, sin las ventas ni las pérdidas de este (el valor sí sigue).
  const proximo = await resumenInventarioEmpresa(ctx.c, ZONA, { conCostos: true, ahora: new Date(Date.now() + 40 * 86_400_000) })
  assert.notEqual(proximo.mes, con.mes)
  assert.deepEqual([proximo.margen!.productos, proximo.margen!.unidades, proximo.perdido.unidades, proximo.perdido.movimientos], [0, 0, 0, 0])
  assert.deepEqual([proximo.unidadesEnExistencia, proximo.valor], [45, c('2700')], 'lo que hay y lo que vale no dependen del mes')
})

test('13 · la tarjeta de una empresa sin ventas ni mermas: ceros, un margen sin base y nada que reviente', async () => {
  const vacia = await prisma.company.create({ data: { name: `Margen vacía ${sufijo}`, slug: `margen-vacia-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  try {
    const r = await resumenInventarioEmpresa(vacia.id, ZONA, { conCostos: true })
    assert.deepEqual([r.unidadesEnExistencia, r.valor, r.unidadesSinCosto], [0, CERO, 0])
    assert.deepEqual([r.margen!.productos, r.margen!.margen, r.margen!.margenPct], [0, CERO, null])
    assert.deepEqual([r.perdido.unidades, r.perdido.movimientos, r.perdido.valor], [0, 0, CERO])
    const sin = await resumenInventarioEmpresa(vacia.id, ZONA, { conCostos: false })
    assert.deepEqual([sin.unidadesEnExistencia, sin.valor, sin.margen], [0, null, null])
  } finally {
    await prisma.company.delete({ where: { id: vacia.id } })
  }
})

// Lo que el esquema no permite se comprueba en la propia base (y no cuesta nada): una empresa con la moneda cambiada compara con SU moneda.
test('14 · lo que entra al margen es lo que está en la moneda de la empresa: si la empresa cambia su moneda, lo de la otra deja de contar', async () => {
  const p = await producto(ctx.b, 'Moneda margen', 100)
  await entradaDe(enB, ctx.b, ctx.sucB)([{ varianteId: p.id, cantidad: 10, costo: '40' }])
  await vender([{ varianteId: p.id, cantidad: 1 }], { empresaId: ctx.b })
  const antes = await margen({ q: 'Moneda margen' }, { empresa: 'b' })
  assert.deepEqual([antes.moneda, antes.totales.unidades], ['DOP', 1])
  await prisma.company.update({ where: { id: ctx.b }, data: { moneda: 'USD' } })
  try {
    const despues = await margen({ q: 'Moneda margen' }, { empresa: 'b' })
    assert.equal(despues.moneda, 'USD')
    assert.equal(despues.totales.productos, 0, 'el pedido está en DOP y la empresa ahora cuenta en USD')
    assert.deepEqual([despues.excluidas.find((e) => e.clase === 'OTRA_MONEDA')!.unidades, despues.excluidas.find((e) => e.clase === 'OTRA_MONEDA')!.costo], [1, c('40')])
  } finally {
    await prisma.company.update({ where: { id: ctx.b }, data: { moneda: 'DOP' } })
  }
})
