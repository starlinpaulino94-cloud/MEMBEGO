import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { activarLotesEnTx, registrarEntradaMultipleEnTx } from '../../src/modules/inventory/service'
import { cancelarOrdenEnTx, crearProveedorEnTx, guardarOrdenEnTx, pedirOrdenEnTx, recibirOrdenEnTx, type EntradaRecepcionOrden } from '../../src/modules/inventory/compras-service'
import { ordenDetalleEnTx } from '../../src/modules/inventory/compras-queries'
import { entradaDetalleEnTx } from '../../src/modules/inventory/queries'
import { ordenToCsv } from '../../src/modules/inventory/exportacion'

/**
 * INV-5b2 · LOTES EN ÓRDENES DE COMPRA contra PostgreSQL de verdad, con el servicio real.
 *
 * Una orden se hace por PRODUCTO (quien pide no sabe de qué lote vendrá la mercancía): un producto con lotes se pide como cualquier
 * otro. Los lotes se dicen al RECIBIR, tanda por tanda, y viajan a la entrada de mercancía que ya sabe repartir por lote. Lo que solo
 * se comprueba aquí:
 *
 *  · pedir un producto con lotes (antes se negaba) y recibirlo en tandas con lotes y vencimientos, con el stock, los saldos por lote,
 *    el costo promedio y la lectura de la orden de acuerdo;
 *  · que sin lotes, con lotes que no suman, sin el vencimiento que se exige, con lotes en un producto que no los lleva o con otro
 *    vencimiento para un lote que ya existe, NO se mueve nada y la orden queda igual;
 *  · que «recibir todo» no sirve para un producto con lotes;
 *  · que un producto que empieza a llevar lotes DESPUÉS de pedirse la orden se recibe con lotes;
 *  · que una clave de idempotencia repetida con los mismos lotes es un reintento y con otros lotes, no;
 *  · que dos recepciones simultáneas del mismo lote se turnan (y no se pasan de lo pedido).
 *
 * Las fechas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`). `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
/** 12:00 en Santo Domingo del 15-jun-2027. */
const AHORA = new Date('2027-06-15T16:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', proveedor: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
/** Un producto físico ACTIVO de la empresa A. Devuelve su variante. */
async function producto(nombre = 'Compra'): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `CL-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const codigo = (e as { codigo?: unknown } | null)?.codigo
    return typeof codigo === 'string' ? codigo : `OTRO: ${e instanceof Error ? e.message : String(e)}`
  }
  return 'SIN_ERROR'
}

/** El mensaje con que el servicio rechazó `p`. */
async function mensajeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ''
}

const activar = (v: string, exigirVencimiento = false) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, exigirVencimiento, ahora: AHORA }, como(ctx.usuario)))

/** Una orden PEDIDA con esas líneas (`[variante, cantidad, costo]`). Devuelve su id. */
async function ordenPedida(lineas: Array<[string, number, string]>): Promise<string> {
  const o = await enA((tx) =>
    guardarOrdenEnTx(tx, ctx.a, { cabecera: { proveedorId: ctx.proveedor, sucursalId: ctx.suc1 }, lineas: lineas.map(([varianteId, cantidad, costo]) => ({ varianteId, cantidad, costo })), ahora: AHORA }, como(ctx.usuario))
  )
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, ahora: AHORA }, como(ctx.usuario)))
  return o.ordenId
}

const recibir = (ordenId: string, e: Omit<EntradaRecepcionOrden, 'ordenId' | 'ahora'>) => enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId, ahora: AHORA, ...e }, como(ctx.usuario)))

async function nivelDe(v: string, sucursalId = ctx.suc1) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
}

type Cubetas3 = { onHand: number; reserved: number; damaged: number }
/** Lo que hay de cada lote (por código) en una sucursal. */
async function lotesDe(v: string, sucursalId = ctx.suc1): Promise<Record<string, Cubetas3>> {
  const nivel = await nivelDe(v, sucursalId)
  const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: nivel.id }, select: { onHand: true, reserved: true, damaged: true, lot: { select: { code: true } } } })
  return Object.fromEntries(bs.map((b) => [b.lot.code, { onHand: b.onHand, reserved: b.reserved, damaged: b.damaged }]))
}
const enMano = (m: Record<string, Cubetas3>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.onHand]))

/** Los lotes suman el saldo de la sucursal (las tres cubetas) y cada movimiento está repartido por completo. */
async function verificarLotes(v: string): Promise<void> {
  const niveles = await prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, select: { id: true, onHand: true, reserved: true, damaged: true } })
  for (const n of niveles) {
    const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: n.id }, select: { onHand: true, reserved: true, damaged: true } })
    const suma = bs.reduce((t, b) => ({ onHand: t.onHand + b.onHand, reserved: t.reserved + b.reserved, damaged: t.damaged + b.damaged }), { onHand: 0, reserved: 0, damaged: 0 })
    assert.deepEqual(suma, { onHand: n.onHand, reserved: n.reserved, damaged: n.damaged }, 'los lotes suman el saldo de la sucursal')
  }
}

/** Una foto de lo que NO debe cambiar cuando una recepción se rechaza. */
async function foto(v: string[], ordenId: string) {
  const o = await prisma.inventoryPurchaseOrder.findUniqueOrThrow({ where: { id_companyId: { id: ordenId, companyId: ctx.a } }, select: { status: true, lines: { select: { quantityReceived: true, quantityCancelled: true } } } })
  return {
    movimientos: await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }),
    entradas: await prisma.inventoryReceipt.count({ where: { companyId: ctx.a } }),
    lotes: await prisma.inventoryLot.count({ where: { companyId: ctx.a } }),
    niveles: await prisma.inventoryLevel.findMany({ where: { catalogVariantId: { in: v } }, orderBy: [{ catalogVariantId: 'asc' }, { locationId: 'asc' }], select: { onHand: true, reserved: true, damaged: true } }),
    estado: o.status,
    recibido: o.lines.map((l) => [l.quantityReceived, l.quantityCancelled]),
  }
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Compra lotes ${x} ${sufijo}`, slug: `compra-lotes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-complot-${sufijo}`, email: `complot-${sufijo}@prueba.test`, name: 'Comprador', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.proveedor = (await enA((tx) => crearProveedorEnTx(tx, ctx.a, { nombre: `Proveedor ${sufijo}` }, como(ctx.usuario)))).proveedorId
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_purchase_order_lines',
        'inventory_purchase_orders',
        'inventory_variant_suppliers',
        'inventory_suppliers',
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
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── Pedir y recibir en tandas ────────────────────────────────────────────────

test('1 · un producto con lotes se pide como cualquier otro y se recibe en tandas diciendo los lotes: stock, saldos por lote, vencimientos, costo y lectura de la orden cuadran', async () => {
  const conLotes = await producto('Con lotes')
  const sinLotes = await producto('Sin lotes')
  await activar(conLotes, true)
  // Antes (5a) esto se negaba con LOTES_NO_SOPORTADO.
  const ordenId = await ordenPedida([
    [conLotes, 10, '12.50'],
    [sinLotes, 6, '3'],
  ])
  const antes = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, ordenId))
  assert.equal(antes?.estado, 'ORDERED')
  assert.deepEqual(
    antes?.detalle.map((l) => [l.varianteId === conLotes, l.llevaLotes, l.exigeVencimiento, l.lotesRecibidos]),
    [
      [true, true, true, null],
      [false, false, false, null],
    ],
    'la lectura dice qué producto lleva lotes y si exige vencimiento'
  )

  // Tanda 1: 5 de 10 del producto con lotes (dos lotes) y 4 de 6 del otro.
  const t1 = await recibir(ordenId, {
    lineas: [
      { varianteId: conLotes, cantidad: 5, lotes: [{ codigo: 'a-1', vencimiento: '2027-09-01', cantidad: 3 }, { codigo: 'B-1', vencimiento: '2027-10-01', cantidad: 2 }] },
      { varianteId: sinLotes, cantidad: 4 },
    ],
  })
  assert.equal(t1.estado, 'PARTIAL')
  assert.equal(t1.recibidas, 9)
  assert.equal(t1.pendientes, 7)
  assert.deepEqual(enMano(await lotesDe(conLotes)), { 'A-1': 3, 'B-1': 2 }, 'los códigos se normalizan (a-1 es A-1)')
  assert.equal((await nivelDe(conLotes)).onHand, 5)
  assert.equal((await nivelDe(sinLotes)).onHand, 4)
  const lotes = await prisma.inventoryLot.findMany({ where: { catalogVariantId: conLotes, legacy: false }, orderBy: { code: 'asc' }, select: { code: true, expiresOn: true } })
  assert.deepEqual(lotes.map((l) => [l.code, l.expiresOn?.toISOString().slice(0, 10)]), [['A-1', '2027-09-01'], ['B-1', '2027-10-01']], 'cada lote guarda su vencimiento')
  await verificarLotes(conLotes)

  // El costo de la ORDEN (no el del navegador) mueve el promedio; el último costo del proveedor queda en el vínculo.
  const costo = await prisma.inventoryVariantCost.findFirstOrThrow({ where: { companyId: ctx.a, catalogVariantId: conLotes } })
  assert.equal(costo.averageCost.toFixed(2), '12.50')

  // La entrada que produjo la tanda dice de qué lotes llegó cada línea.
  const entrada = await enA((tx) => entradaDetalleEnTx(tx, ctx.a, t1.entradaId!, { conCostos: true }))
  assert.deepEqual(entrada?.detalle.map((l) => l.lotes), ['A-1 ×3, B-1 ×2', null])

  // Tanda 2: el resto, con un lote que ya existía y uno nuevo.
  const t2 = await recibir(ordenId, {
    lineas: [
      { varianteId: conLotes, cantidad: 5, lotes: [{ codigo: 'A-1', vencimiento: '2027-09-01', cantidad: 2 }, { codigo: 'C-1', vencimiento: '2027-11-01', cantidad: 3 }] },
      { varianteId: sinLotes, cantidad: 2 },
    ],
  })
  assert.equal(t2.estado, 'RECEIVED')
  assert.equal(t2.pendientes, 0)
  assert.deepEqual(enMano(await lotesDe(conLotes)), { 'A-1': 5, 'B-1': 2, 'C-1': 3 })
  assert.equal((await nivelDe(conLotes)).onHand, 10)
  await verificarLotes(conLotes)
  assert.equal(await prisma.inventoryLotBalance.count({ where: { catalogVariantId: sinLotes } }), 0, 'el producto sin lotes no tiene saldos por lote')

  // La orden lo cuenta producto por producto, sumando las dos tandas (de más a menos, y a igual cantidad por código).
  const despues = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, ordenId))
  assert.deepEqual(despues?.detalle.map((l) => l.lotesRecibidos), ['A-1 ×5, C-1 ×3, B-1 ×2', null])
  assert.equal(despues?.entradas.length, 2)

  // El archivo de la orden trae los lotes recibidos de cada línea.
  const csv = ordenToCsv(despues!, ZONA)
  assert.match(csv, /Lotes recibidos/)
  assert.match(csv, /A-1 ×5, C-1 ×3, B-1 ×2/)
})

test('2 · lo que se rechaza al recibir con lotes no mueve NADA: ni stock, ni lotes, ni la orden', async () => {
  const v = await producto('Rechazos')
  const otro = await producto('Sin lotes rechazos')
  await activar(v, true)
  // Un lote que ya existe con un vencimiento.
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 1, lotes: [{ codigo: 'EXISTE', vencimiento: '2027-12-01', cantidad: 1 }] }], ahora: AHORA }, como(ctx.usuario)))
  const ordenId = await ordenPedida([
    [v, 10, '5'],
    [otro, 4, '2'],
  ])
  const base = await foto([v, otro], ordenId)

  const rechaza = async (esperado: string, e: Omit<EntradaRecepcionOrden, 'ordenId' | 'ahora'>, que: string) => {
    assert.equal(await codigoDe(recibir(ordenId, e)), esperado, que)
    assert.deepEqual(await foto([v, otro], ordenId), base, `${que}: nada cambió`)
  }
  await rechaza('LOTES_FALTAN', { lineas: [{ varianteId: v, cantidad: 3 }] }, 'un producto con lotes sin decir el lote')
  await rechaza('LOTES_FALTAN', { lineas: [{ varianteId: v, cantidad: 3, lotes: [] }] }, 'una lista de lotes vacía')
  await rechaza('LOTES_NO_CUADRAN', { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'X', vencimiento: '2027-12-01', cantidad: 2 }] }] }, 'lotes que no suman la cantidad')
  await rechaza('VENCIMIENTO_OBLIGATORIO', { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'X', cantidad: 3 }] }] }, 'sin el vencimiento que el producto exige')
  await rechaza('LOTE_VENCIMIENTO_DISTINTO', { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'EXISTE', vencimiento: '2028-01-01', cantidad: 3 }] }] }, 'otro vencimiento para un lote que ya existe')
  await rechaza('VENCIMIENTO_DISTINTO', { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'X', vencimiento: '2027-12-01', cantidad: 1 }, { codigo: 'x', vencimiento: '2027-12-02', cantidad: 2 }] }] }, 'el mismo lote con dos vencimientos en la misma línea')
  await rechaza('LOTE_INVALIDO', { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'SIN LOTE', cantidad: 3 }, { codigo: '=cmd|x', vencimiento: '2027-12-01', cantidad: 0 }] }] }, 'un código que no es un código')
  await rechaza('LOTES_NO_APLICAN', { lineas: [{ varianteId: otro, cantidad: 2, lotes: [{ codigo: 'X', vencimiento: '2027-12-01', cantidad: 2 }] }] }, 'lotes en un producto que no los lleva')
  await rechaza('LOTES_INVALIDOS', { lineas: [{ varianteId: v, cantidad: 3, lotes: 'A-1' as never }] }, 'lotes que no son una lista')
  await rechaza('LOTES_FALTAN', { todo: true }, '«recibir todo» no sabe de qué lote llegó un producto con lotes')
  await rechaza('RECIBE_MAS_DE_LO_PEDIDO', { lineas: [{ varianteId: v, cantidad: 11, lotes: [{ codigo: 'X', vencimiento: '2027-12-01', cantidad: 11 }] }] }, 'más de lo pedido, también con lotes')
  assert.match(await mensajeDe(recibir(ordenId, { todo: true })), /lleva lotes: indica de qué lote llegó lo que se recibe \(no se puede recibir «todo» sin decirlo\)/, 'y lo dice con claridad')
  // Todo o nada: una línea buena no entra si la otra se rechaza.
  await rechaza('LOTES_FALTAN', { lineas: [{ varianteId: otro, cantidad: 2 }, { varianteId: v, cantidad: 3 }] }, 'una línea buena y otra mala')
  await verificarLotes(v)
})

test('3 · un producto que empieza a llevar lotes DESPUÉS de pedirse la orden se recibe con lotes (y lo que había queda en «SIN LOTE»)', async () => {
  const v = await producto('Activado después')
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 10 }], ahora: AHORA }, como(ctx.usuario)))
  const ordenId = await ordenPedida([[v, 8, '4']])
  await activar(v, false)
  assert.equal(await codigoDe(recibir(ordenId, { lineas: [{ varianteId: v, cantidad: 8 }] })), 'LOTES_FALTAN', 'sin decir el lote')
  assert.equal(await codigoDe(recibir(ordenId, { todo: true })), 'LOTES_FALTAN', 'ni con «todo»')
  const r = await recibir(ordenId, { lineas: [{ varianteId: v, cantidad: 8, lotes: [{ codigo: 'NUEVO', cantidad: 5 }, { codigo: 'SIN LOTE', cantidad: 3 }] }] })
  assert.equal(r.estado, 'RECEIVED')
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 13, NUEVO: 5 }, 'lo de antes (10) más lo que llegó sin lote (3)')
  assert.equal((await nivelDe(v)).onHand, 18)
  await verificarLotes(v)
})

test('4 · la clave de idempotencia: los mismos lotes son un reintento (no suma dos veces); otros lotes u otras cantidades, no', async () => {
  const v = await producto('Idempotencia')
  await activar(v, true)
  const ordenId = await ordenPedida([[v, 20, '7']])
  const lineas = [{ varianteId: v, cantidad: 6, lotes: [{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 4 }, { codigo: 'K-2', vencimiento: '2027-09-10', cantidad: 2 }] }]
  const clave = `clave-lotes-${sufijo}`
  const primera = await recibir(ordenId, { lineas, idempotencyKey: clave })
  assert.equal(primera.repetido, false)

  // El mismo envío, escrito distinto (otro orden de los lotes, código en minúsculas): sigue siendo el mismo.
  const igual = await recibir(ordenId, {
    lineas: [{ varianteId: v, cantidad: 6, lotes: [{ codigo: ' k-2 ', vencimiento: '2027-09-10', cantidad: 2 }, { codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 4 }] }],
    idempotencyKey: clave,
  })
  assert.equal(igual.repetido, true)
  assert.equal(igual.entradaId, primera.entradaId)
  assert.equal((await nivelDe(v)).onHand, 6, 'no se sumó dos veces')

  const otra = async (lotes: Array<{ codigo: string; vencimiento: string; cantidad: number }>, que: string) => {
    assert.equal(await codigoDe(recibir(ordenId, { lineas: [{ varianteId: v, cantidad: lotes.reduce((s, l) => s + l.cantidad, 0), lotes }], idempotencyKey: clave })), 'CLAVE_REUTILIZADA', que)
    assert.equal((await nivelDe(v)).onHand, 6, `${que}: no se movió nada`)
  }
  await otra([{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 3 }, { codigo: 'K-2', vencimiento: '2027-09-10', cantidad: 3 }], 'las mismas 6 unidades repartidas de otra forma')
  await otra([{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 4 }, { codigo: 'K-3', vencimiento: '2027-09-10', cantidad: 2 }], 'otro código de lote')
  await otra([{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 6 }], 'un lote en vez de dos')
  await otra([{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 4 }], 'menos unidades')
  // Con lotes mal armados, la clave repetida dice qué está mal (no la toma por otra recepción).
  assert.equal(await codigoDe(recibir(ordenId, { lineas: [{ varianteId: v, cantidad: 6, lotes: [{ codigo: 'K-1', vencimiento: '2027-09-09', cantidad: 5 }] }], idempotencyKey: clave })), 'LOTES_NO_CUADRAN')
  assert.deepEqual(enMano(await lotesDe(v)), { 'K-1': 4, 'K-2': 2 })
  await verificarLotes(v)
})

test('5 · cerrar con faltante y cancelar también funcionan con productos con lotes', async () => {
  const v = await producto('Faltante')
  await activar(v, false)
  const ordenId = await ordenPedida([[v, 10, '2']])
  const cierre = await recibir(ordenId, { lineas: [{ varianteId: v, cantidad: 7, lotes: [{ codigo: 'F-1', cantidad: 7 }] }], cerrarConFaltante: true, motivo: 'El proveedor mandó menos' })
  assert.equal(cierre.estado, 'RECEIVED')
  assert.equal(cierre.cerradas, 3)
  assert.deepEqual(enMano(await lotesDe(v)), { 'F-1': 7 })
  const detalle = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, ordenId))
  assert.equal(detalle?.faltantes, 3)
  assert.equal(detalle?.detalle[0].lotesRecibidos, 'F-1 ×7')

  // Una orden con lotes sin recibir nada se cancela como cualquier otra, y un borrador se descarta.
  const pedida = await ordenPedida([[v, 4, '2']])
  const c = await enA((tx) => cancelarOrdenEnTx(tx, ctx.a, { ordenId: pedida, motivo: 'Ya no hace falta', ahora: AHORA }, como(ctx.usuario)))
  assert.equal(c.repetido, false)
  const borrador = await enA((tx) => guardarOrdenEnTx(tx, ctx.a, { cabecera: { proveedorId: ctx.proveedor, sucursalId: ctx.suc1 }, lineas: [{ varianteId: v, cantidad: 1, costo: '1' }], ahora: AHORA }, como(ctx.usuario)))
  assert.equal((await enA((tx) => cancelarOrdenEnTx(tx, ctx.a, { ordenId: borrador.ordenId, ahora: AHORA }, como(ctx.usuario)))).repetido, false)
  assert.deepEqual(enMano(await lotesDe(v)), { 'F-1': 7 }, 'cancelar no movió nada')
  await verificarLotes(v)
})

test('6 · la sucursal que recibe es la de la orden: los lotes entran ahí y la otra sucursal no se entera', async () => {
  const v = await producto('Sucursal')
  await activar(v, false)
  const o = await enA((tx) => guardarOrdenEnTx(tx, ctx.a, { cabecera: { proveedorId: ctx.proveedor, sucursalId: ctx.suc2 }, lineas: [{ varianteId: v, cantidad: 5, costo: '9' }], ahora: AHORA }, como(ctx.usuario)))
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, ahora: AHORA }, como(ctx.usuario)))
  await recibir(o.ordenId, { lineas: [{ varianteId: v, cantidad: 5, lotes: [{ codigo: 'N-2', cantidad: 2 }, { codigo: 'N-1', cantidad: 2 }, { codigo: 'N-9', cantidad: 1 }] }] })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'N-1': 2, 'N-2': 2, 'N-9': 1 })
  // A igual cantidad, por código; y la lectura de una orden cuenta solo las entradas de ESA orden (aunque otra traiga el mismo producto).
  const otra = await enA((tx) => guardarOrdenEnTx(tx, ctx.a, { cabecera: { proveedorId: ctx.proveedor, sucursalId: ctx.suc2 }, lineas: [{ varianteId: v, cantidad: 4, costo: '9' }], ahora: AHORA }, como(ctx.usuario)))
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: otra.ordenId, ahora: AHORA }, como(ctx.usuario)))
  await recibir(otra.ordenId, { lineas: [{ varianteId: v, cantidad: 4, lotes: [{ codigo: 'OTRA-1', cantidad: 4 }] }] })
  assert.deepEqual((await enA((tx) => ordenDetalleEnTx(tx, ctx.a, o.ordenId)))?.detalle.map((l) => l.lotesRecibidos), ['N-1 ×2, N-2 ×2, N-9 ×1'])
  assert.deepEqual((await enA((tx) => ordenDetalleEnTx(tx, ctx.a, otra.ordenId)))?.detalle.map((l) => l.lotesRecibidos), ['OTRA-1 ×4'])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'N-1': 2, 'N-2': 2, 'N-9': 1, 'OTRA-1': 4 })
  assert.equal(await prisma.inventoryLotBalance.count({ where: { catalogVariantId: v, lot: { code: 'N-1' } } }), 1, 'el lote solo tiene saldo en la sucursal de la orden')
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: v, locationId: ctx.suc1 } }), 0, 'la otra sucursal ni se enteró')
  await verificarLotes(v)
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('7 · dos recepciones simultáneas del mismo lote se turnan y suman; el mismo envío dos veces a la vez es UNA entrada; y no se pasan de lo pedido', async () => {
  const v = await producto('Concurrencia')
  await activar(v, true)
  const ordenId = await ordenPedida([[v, 10, '6']])
  const tanda = (cantidad: number, clave?: string) => recibir(ordenId, { lineas: [{ varianteId: v, cantidad, lotes: [{ codigo: 'CC-1', vencimiento: '2027-12-12', cantidad }] }], idempotencyKey: clave })

  // Dos tandas distintas del MISMO lote, a la vez.
  const [x, y] = await Promise.all([tanda(3), tanda(2)])
  assert.equal(x.repetido || y.repetido, false)
  assert.deepEqual(enMano(await lotesDe(v)), { 'CC-1': 5 })
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v, code: 'CC-1' } }), 1, 'un solo lote')
  assert.equal((await enA((tx) => ordenDetalleEnTx(tx, ctx.a, ordenId)))?.entradas.length, 2)

  // El MISMO envío dos veces a la vez: una sola entrada.
  const clave = `cc-${sufijo}`
  const [p, q] = await Promise.all([tanda(1, clave), tanda(1, clave)])
  assert.deepEqual([p.repetido, q.repetido].sort(), [false, true])
  assert.equal(p.entradaId, q.entradaId)
  assert.deepEqual(enMano(await lotesDe(v)), { 'CC-1': 6 })

  // Quedan 4 por llegar: dos de 3 a la vez, solo UNA cabe.
  const resultados = await Promise.all([codigoDe(tanda(3)), codigoDe(tanda(3))])
  assert.deepEqual([...resultados].sort(), ['RECIBE_MAS_DE_LO_PEDIDO', 'SIN_ERROR'])
  assert.deepEqual(enMano(await lotesDe(v)), { 'CC-1': 9 })
  const orden = await prisma.inventoryPurchaseOrder.findUniqueOrThrow({ where: { id_companyId: { id: ordenId, companyId: ctx.a } }, select: { status: true, lines: { select: { quantityReceived: true } } } })
  assert.equal(orden.lines[0].quantityReceived, 9)
  assert.equal(orden.status, 'PARTIAL')
  await verificarLotes(v)
})
