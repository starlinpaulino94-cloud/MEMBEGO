import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { InventoryBucket, InventoryMovementType } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { BUCKETS, MOVIMIENTOS_PERMITIDOS, TIPOS_CON_MOTIVO_OBLIGATORIO, aplicarMovimiento, cubetasDeSaldo, saldoDeCubetas, saldoDeMovimientos, type Cubetas } from '../../src/modules/inventory/domain'

/**
 * INV-5a.1 · LA BASE DE LOS LOTES (migración `20261068_inventory_lots`) contra PostgreSQL de verdad.
 *
 * Aquí no pasa por el servicio: se escribe SQL y filas a mano, porque lo que se comprueba es lo que la BASE hace cumplir aunque el
 * servicio se equivoque, o aunque entre un script o una puerta nueva:
 *
 *  · activar los lotes de un producto: «SIN LOTE», un saldo por lote que nace en cero y una apertura que lo pone al día, y todo
 *    cuadrado con el saldo de la sucursal al terminar la transacción;
 *  · que el saldo por lote lo mueve SOLO la base (con la apertura y los repartos) y que se mueve igual que el saldo de la
 *    sucursal para CADA traslado de cubetas que el dominio permite;
 *  · que los lotes SUMAN lo que hay: un movimiento sin repartir, repartido de menos o de más, o un saldo que cambia sin
 *    movimiento, hacen fallar la transacción;
 *  · las reglas de un lote (código, vencimiento, «SIN LOTE»), el aislamiento por empresa y por producto;
 *  · que repartos, aperturas y lotes no se editan, y que solo un producto SIN historial se limpia.
 *
 * Los saldos por lote y los repartos se comprueban en el COMMIT (disparadores diferidos): por eso los casos de rechazo abren la
 * transacción, escriben lo malo y esperan el error al cerrarla.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', sucB: '' }
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const comoInv = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
/** Un producto físico ACTIVO de la empresa dada. Devuelve su variante. */
async function producto(empresaId: string): Promise<string> {
  const n = ++contador
  const r = await conEmpresa(empresaId, (tx) =>
    crearItemEnTx(tx, empresaId, { name: `Lote ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `LOT-${n}-${sufijo}`.toUpperCase() }, comoInv(ctx.usuario))
  )
  await conEmpresa(empresaId, (tx) => cambiarEstadoItemEnTx(tx, empresaId, r.id, 'ACTIVE', comoInv(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return v.id
}

/** Un saldo de sucursal con lo dado (sin movimientos: lo que importa aquí es lo que la base exige de lo que se escriba después). */
async function nivel(companyId: string, catalogVariantId: string, locationId: string, saldo: { onHand?: number; reserved?: number; damaged?: number } = {}): Promise<string> {
  const l = await prisma.inventoryLevel.create({ data: { companyId, catalogVariantId, locationId, onHand: saldo.onHand ?? 0, reserved: saldo.reserved ?? 0, damaged: saldo.damaged ?? 0 }, select: { id: true } })
  return l.id
}

/** Lo que hace la activación: producto con lotes, «SIN LOTE», y por cada saldo su saldo por lote en cero + la apertura. */
async function activarEnTx(tx: Tx, companyId: string, catalogVariantId: string, niveles: Array<{ id: string; onHand?: number; reserved?: number; damaged?: number }>): Promise<string> {
  await tx.inventoryLotTracking.create({ data: { companyId, catalogVariantId } })
  const legado = await tx.inventoryLot.create({ data: { companyId, catalogVariantId, code: 'SIN LOTE', legacy: true }, select: { id: true } })
  for (const n of niveles) {
    await tx.inventoryLotBalance.create({ data: { companyId, inventoryLevelId: n.id, catalogVariantId, lotId: legado.id } })
    await tx.inventoryLotOpening.create({ data: { companyId, inventoryLevelId: n.id, lotId: legado.id, onHand: n.onHand ?? 0, reserved: n.reserved ?? 0, damaged: n.damaged ?? 0 } })
  }
  return legado.id
}

async function saldoPorLote(inventoryLevelId: string, lotId: string) {
  return prisma.inventoryLotBalance.findUniqueOrThrow({ where: { inventoryLevelId_lotId: { inventoryLevelId, lotId } }, select: { onHand: true, reserved: true, damaged: true } })
}

async function saldoDe(nivelId: string) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { id: nivelId }, select: { onHand: true, reserved: true, damaged: true } })
}

/** Un movimiento COMPLETO a mano: el movimiento, el saldo de la sucursal y el reparto. Devuelve las cubetas resultantes. */
async function moverEnTx(
  tx: Tx,
  o: { companyId: string; nivelId: string; antes: Cubetas; tipo: InventoryMovementType; origen: InventoryBucket | null; destino: InventoryBucket | null; cantidad: number; reparto: Array<{ lotId: string; cantidad: number }> }
): Promise<{ movimientoId: string; despues: Cubetas }> {
  const movimiento = { type: o.tipo, sourceBucket: o.origen, destinationBucket: o.destino, quantity: o.cantidad, reason: TIPOS_CON_MOTIVO_OBLIGATORIO.includes(o.tipo) ? 'prueba' : null }
  const despues = aplicarMovimiento(o.antes, movimiento)
  const antes = saldoDeCubetas(o.antes)
  const nuevo = saldoDeCubetas(despues)
  const m = await tx.inventoryMovement.create({
    data: { companyId: o.companyId, inventoryLevelId: o.nivelId, type: o.tipo, sourceBucket: o.origen, destinationBucket: o.destino, quantity: o.cantidad, previousOnHand: antes.onHand, newOnHand: nuevo.onHand, reason: movimiento.reason },
    select: { id: true },
  })
  await tx.inventoryLevel.update({ where: { id: o.nivelId }, data: { onHand: nuevo.onHand, reserved: nuevo.reserved, damaged: nuevo.damaged } })
  for (const r of o.reparto) {
    await tx.inventoryMovementLot.create({ data: { companyId: o.companyId, movementId: m.id, inventoryLevelId: o.nivelId, lotId: r.lotId, quantity: r.cantidad } })
  }
  return { movimientoId: m.id, despues }
}

/** El mensaje con que la base rechazó `fn`; falla si no la rechazó. */
async function rechazo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  assert.fail('se esperaba que la base lo rechazara y lo aceptó')
}

const enTransaccion = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => prisma.$transaction(fn, { timeout: 30_000 })

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Lotes ${x} ${sufijo}`, slug: `lotes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-lot-${sufijo}`, email: `lot-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of ['inventory_movement_lots', 'inventory_lot_openings', 'inventory_lot_balances', 'inventory_lots', 'inventory_lot_tracking', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
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

test('1 · activar: «SIN LOTE», saldos por lote que nacen en cero y una apertura que los pone al día', async () => {
  const v = await producto(ctx.a)
  const n1 = await nivel(ctx.a, v, ctx.suc1, { onHand: 10, reserved: 2, damaged: 1 })
  const n2 = await nivel(ctx.a, v, ctx.suc2, { onHand: 4 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n1, onHand: 10, reserved: 2, damaged: 1 }, { id: n2, onHand: 4 }]))

  assert.deepEqual(await saldoPorLote(n1, legado), { onHand: 10, reserved: 2, damaged: 1 }, 'la apertura puso el saldo de partida (con sus tres cubetas)')
  assert.deepEqual(await saldoPorLote(n2, legado), { onHand: 4, reserved: 0, damaged: 0 })
  const lote = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: legado }, select: { code: true, legacy: true, expiresOn: true } })
  assert.deepEqual(lote, { code: 'SIN LOTE', legacy: true, expiresOn: null })
  assert.equal(await prisma.inventoryLotOpening.count({ where: { inventoryLevelId: { in: [n1, n2] } } }), 2)
})

test('2 · activar sin dejar cuadrados los lotes con lo que ya hay se rechaza al cerrar la transacción (y no deja nada)', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 10 })
  // «SIN LOTE» y el saldo por lote, pero SIN la apertura: los lotes suman 0 y el saldo dice 10.
  const m1 = await rechazo(() =>
    enTransaccion(async (tx) => {
      await tx.inventoryLotTracking.create({ data: { companyId: ctx.a, catalogVariantId: v } })
      const l = await tx.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'SIN LOTE', legacy: true }, select: { id: true } })
      await tx.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: l.id } })
    })
  )
  assert.match(m1, /inventory_lots_suma/)
  // Ni siquiera el saldo por lote.
  const m2 = await rechazo(() =>
    enTransaccion(async (tx) => {
      await tx.inventoryLotTracking.create({ data: { companyId: ctx.a, catalogVariantId: v } })
      await tx.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'SIN LOTE', legacy: true } })
    })
  )
  assert.match(m2, /inventory_lots_suma/)
  // Una apertura DE MENOS también descuadra.
  const m3 = await rechazo(() => enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 9 }])))
  assert.match(m3, /inventory_lots_suma/)
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0, 'todo o nada: no quedó la activación a medias')
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 0)
})

test('3 · un producto con lotes tiene su «SIN LOTE»; un lote solo existe para un producto que lleva lotes', async () => {
  const v = await producto(ctx.a)
  assert.match(
    await rechazo(() => enTransaccion((tx) => tx.inventoryLotTracking.create({ data: { companyId: ctx.a, catalogVariantId: v } }))),
    /inventory_lots_sin_seguimiento/,
    'activar sin «SIN LOTE»'
  )
  assert.match(
    await rechazo(() => prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'L-1' } })),
    /inventory_lots_sin_seguimiento/,
    'un lote de un producto que no lleva lotes'
  )
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0)
})

test('4 · el saldo por lote nace en cero y solo lo mueve la base: ni la aplicación ni un script lo editan', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 5 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 5 }]))
  const otro = await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'L-OTRO' }, select: { id: true } })

  assert.match(
    await rechazo(() => prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: otro.id, onHand: 3 } })),
    /inventory_lot_balances_solo_por_disparador/,
    'nace en cero'
  )
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: otro.id } })
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_balances" SET "onHand" = "onHand" + 1 WHERE "inventoryLevelId" = ${n} AND "lotId" = ${legado}`), /inventory_lot_balances_solo_por_disparador/)
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_balances" SET "damaged" = 1 WHERE "inventoryLevelId" = ${n} AND "lotId" = ${otro.id}`), /inventory_lot_balances_solo_por_disparador/)
  assert.match(
    await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_balances" SET "lotId" = ${otro.id} WHERE "inventoryLevelId" = ${n} AND "lotId" = ${legado}`),
    /inventory_lot_balances_solo_por_disparador/,
    'ni cambia de lote'
  )
  // Marcar la transacción como el disparador desde fuera tampoco sirve: el cuadre con el saldo de la sucursal falla al cerrar.
  const m = await rechazo(() =>
    enTransaccion(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('membego.lot_balance', 'disparador', true)`)
      await tx.$executeRaw`UPDATE "inventory_lot_balances" SET "onHand" = "onHand" + 1 WHERE "inventoryLevelId" = ${n} AND "lotId" = ${legado}`
    })
  )
  assert.match(m, /inventory_lots_suma/)
  assert.deepEqual(await saldoPorLote(n, legado), { onHand: 5, reserved: 0, damaged: 0 }, 'nada cambió')
})

test('5 · las reglas de un lote: código, «SIN LOTE», vencimiento y unicidad por producto', async () => {
  const v = await producto(ctx.a)
  const v2 = await producto(ctx.a)
  await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, []))
  await enTransaccion((tx) => activarEnTx(tx, ctx.a, v2, []))
  const crear = (data: { code: string; legacy?: boolean; expiresOn?: Date | null }, variante = v) => prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: variante, ...data } })
  const dia = (s: string) => new Date(`${s}T00:00:00.000Z`)

  assert.match(await rechazo(() => crear({ code: '' })), /inventory_lots_codigo/, 'código vacío')
  assert.match(await rechazo(() => crear({ code: ' L-1' })), /inventory_lots_codigo/, 'espacio al principio')
  assert.match(await rechazo(() => crear({ code: 'L-1 ' })), /inventory_lots_codigo/, 'espacio al final')
  assert.match(await rechazo(() => crear({ code: 'X'.repeat(61) })), /inventory_lots_codigo/, '61 caracteres')
  await crear({ code: 'X'.repeat(60) })
  assert.match(await rechazo(() => crear({ code: 'SIN LOTE' })), /inventory_lots_legado|Unique/i, '«SIN LOTE» no es un lote de nadie salvo el legado (aquí además ya hay uno)')
  assert.match(await rechazo(() => crear({ code: 'OTRO', legacy: true })), /inventory_lots_legado/, 'legado con otro código')
  assert.match(await rechazo(() => crear({ code: 'sin lote' })), /Unique|unique|duplicate/i, 'sin distinguir mayúsculas: choca con «SIN LOTE»')
  // El CHECK se evalúa antes que los índices únicos: con un «SIN LOTE» ya existente, lo que dice el mensaje es la regla del legado.
  assert.match(await rechazo(() => crear({ code: 'SIN LOTE', legacy: true, expiresOn: new Date('2027-05-31T00:00:00.000Z') })), /inventory_lots_legado/, 'el «SIN LOTE» no vence')

  assert.match(await rechazo(() => crear({ code: 'V-1999', expiresOn: dia('1999-12-31') })), /inventory_lots_vencimiento/, 'antes del 2000')
  assert.match(await rechazo(() => crear({ code: 'V-2101', expiresOn: dia('2101-01-01') })), /inventory_lots_vencimiento/, 'después del 2100')
  await crear({ code: 'V-OK', expiresOn: dia('2027-05-31') })
  await crear({ code: 'V-SIN' })

  assert.match(await rechazo(() => crear({ code: 'lote-a' }).then(() => crear({ code: 'LOTE-A' }))), /Unique|unique|duplicate/i, 'un código por producto, sin distinguir mayúsculas')
  await crear({ code: 'LOTE-A' }, v2) // el mismo código en OTRO producto sí
  const guardado = await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'V-OK' }, select: { expiresOn: true } })
  assert.equal(guardado.expiresOn?.toISOString().slice(0, 10), '2027-05-31', 'el vencimiento es un día de calendario: sin hora ni corrimiento de zona')
})

test('6 · los lotes suman lo que hay: un movimiento sin repartir, de menos o de más, o un saldo que cambia solo, fallan al cerrar', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 10 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 10 }]))
  const lote2 = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'L-2' }, select: { id: true } })).id
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: lote2 } })
  const cubetas = (): Cubetas => ({ AVAILABLE: 10, RESERVED: 0, DAMAGED: 0 })

  // Lo bueno: una entrada de 6 unidades del lote 2 y una venta de 4 repartida entre los dos lotes.
  const entrada = await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes: cubetas(), tipo: 'PURCHASE', origen: null, destino: 'AVAILABLE', cantidad: 6, reparto: [{ lotId: lote2, cantidad: 6 }] }))
  assert.deepEqual(await saldoPorLote(n, lote2), { onHand: 6, reserved: 0, damaged: 0 })
  const venta = await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes: entrada.despues, tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 4, reparto: [{ lotId: legado, cantidad: 3 }, { lotId: lote2, cantidad: 1 }] }))
  assert.deepEqual(await saldoPorLote(n, legado), { onHand: 7, reserved: 0, damaged: 0 })
  assert.deepEqual(await saldoPorLote(n, lote2), { onHand: 5, reserved: 0, damaged: 0 })
  assert.deepEqual(await saldoDe(n), { onHand: 12, reserved: 0, damaged: 0 }, 'los lotes suman el saldo de la sucursal: 7 + 5')

  const base = venta.despues
  const venta1 = { companyId: ctx.a, nivelId: n, antes: base, tipo: 'SALE' as const, origen: 'AVAILABLE' as const, destino: null, cantidad: 2 }

  // (a) El movimiento dice 2 y el saldo y los lotes se movieron 2, pero SIN reparto: la suma del reparto (0) no es la cantidad.
  assert.match(await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { ...venta1, reparto: [] }))), /inventory_lots_(suma|reparto)/, 'sin repartir')
  // (b) Solo el movimiento, sin tocar ni el saldo: dice 2 unidades y no reparte ninguna. Aísla la comprobación del movimiento.
  assert.match(
    await rechazo(() => enTransaccion((tx) => tx.inventoryMovement.create({ data: { companyId: ctx.a, inventoryLevelId: n, type: 'SALE', sourceBucket: 'AVAILABLE', quantity: 2, previousOnHand: 12, newOnHand: 10 } }))),
    /inventory_lots_reparto/,
    'un movimiento nuevo de un producto con lotes sin reparto'
  )
  // (c) El movimiento dice 4, pero el saldo y los lotes se movieron 3: cuadran entre sí, no con el movimiento.
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        const m = await tx.inventoryMovement.create({ data: { companyId: ctx.a, inventoryLevelId: n, type: 'SALE', sourceBucket: 'AVAILABLE', quantity: 4, previousOnHand: 12, newOnHand: 9 }, select: { id: true } })
        await tx.inventoryLevel.update({ where: { id: n }, data: { onHand: 9 } })
        await tx.inventoryMovementLot.create({ data: { companyId: ctx.a, movementId: m.id, inventoryLevelId: n, lotId: legado, quantity: 3 } })
      })
    ),
    /inventory_lots_reparto/,
    'repartido de menos que la cantidad del movimiento'
  )
  // (d) De más: el movimiento dice 2 y el reparto 3 (el saldo bajó 3).
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        const m = await tx.inventoryMovement.create({ data: { companyId: ctx.a, inventoryLevelId: n, type: 'SALE', sourceBucket: 'AVAILABLE', quantity: 2, previousOnHand: 12, newOnHand: 9 }, select: { id: true } })
        await tx.inventoryLevel.update({ where: { id: n }, data: { onHand: 9 } })
        await tx.inventoryMovementLot.create({ data: { companyId: ctx.a, movementId: m.id, inventoryLevelId: n, lotId: legado, quantity: 3 } })
      })
    ),
    /inventory_lots_reparto/,
    'repartido de más'
  )
  // (e) El saldo de la sucursal cambia SIN movimiento: los lotes ya no suman lo que dice.
  assert.match(await rechazo(() => prisma.inventoryLevel.update({ where: { id: n }, data: { onHand: { decrement: 1 } } })), /inventory_lots_suma/, 'saldo editado por fuera')
  assert.match(await rechazo(() => prisma.inventoryLevel.update({ where: { id: n }, data: { damaged: 3 } })), /inventory_lots_suma/, 'lo dañado también cuadra')
  assert.match(await rechazo(() => prisma.inventoryLevel.update({ where: { id: n }, data: { reserved: 1 } })), /inventory_lots_suma/, 'y lo apartado también')
  // (f) Un saldo de sucursal NUEVO, con unidades y sin lotes, para un producto con lotes.
  assert.match(await rechazo(() => prisma.inventoryLevel.create({ data: { companyId: ctx.a, catalogVariantId: v, locationId: ctx.suc2, onHand: 3 } })), /inventory_lots_suma/, 'un saldo nuevo con unidades y sin lotes')
  // …y uno nuevo VACÍO es normal (una sucursal nueva): suma 0 y es 0.
  const vacio = await prisma.inventoryLevel.create({ data: { companyId: ctx.a, catalogVariantId: v, locationId: ctx.suc2 }, select: { id: true } })
  assert.deepEqual(await saldoDe(vacio.id), { onHand: 0, reserved: 0, damaged: 0 })

  assert.deepEqual(await saldoDe(n), { onHand: 12, reserved: 0, damaged: 0 }, 'ningún rechazo dejó rastro')
  assert.deepEqual(await saldoPorLote(n, legado), { onHand: 7, reserved: 0, damaged: 0 })
})

test('7 · un reparto solo cuelga de un movimiento de ese saldo, de un lote del mismo producto y de la misma empresa', async () => {
  const v = await producto(ctx.a)
  const vOtro = await producto(ctx.a)
  const n1 = await nivel(ctx.a, v, ctx.suc1, { onHand: 10 })
  const n2 = await nivel(ctx.a, v, ctx.suc2, { onHand: 10 })
  const nOtro = await nivel(ctx.a, vOtro, ctx.suc1, { onHand: 10 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n1, onHand: 10 }, { id: n2, onHand: 10 }]))
  const legadoOtro = await enTransaccion((tx) => activarEnTx(tx, ctx.a, vOtro, [{ id: nOtro, onHand: 10 }]))
  const mov = (id: string) => ({ companyId: ctx.a, nivelId: id, antes: { AVAILABLE: 10, RESERVED: 0, DAMAGED: 0 }, tipo: 'SALE' as const, origen: 'AVAILABLE' as const, destino: null, cantidad: 1 })
  const FK = /Foreign key constraint|foreign key/i

  // Un reparto del saldo n2 colgado de un movimiento del saldo n1 (con un lote que SÍ tiene saldo por lote en n2).
  const soloEnN2 = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'SOLO-N2' }, select: { id: true } })).id
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n2, catalogVariantId: v, lotId: soloEnN2 } })
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        const m = await moverEnTx(tx, { ...mov(n1), reparto: [{ lotId: legado, cantidad: 1 }] })
        await tx.inventoryMovementLot.create({ data: { companyId: ctx.a, movementId: m.movimientoId, inventoryLevelId: n2, lotId: soloEnN2, quantity: 1 } })
      })
    ),
    FK,
    'otro saldo'
  )
  // Un lote de OTRO producto no puede tener saldo por lote en este saldo…
  assert.match(
    await rechazo(() => prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n1, catalogVariantId: v, lotId: legadoOtro } })),
    FK,
    'lote de otro producto'
  )
  // …ni el saldo de otra empresa puede juntarse con un lote de esta.
  const deA = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'DE-A' }, select: { id: true } })).id
  assert.match(await rechazo(() => prisma.inventoryLotBalance.create({ data: { companyId: ctx.b, inventoryLevelId: n1, catalogVariantId: v, lotId: deA } })), FK, 'otra empresa')
  // Y un reparto hacia un lote que no tiene saldo en esa sucursal tampoco (hay que crear el saldo por lote primero).
  const sinSaldo = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'SIN-SALDO' }, select: { id: true } })).id
  assert.match(
    await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { ...mov(n1), reparto: [{ lotId: sinSaldo, cantidad: 1 }] }))),
    FK,
    'lote sin saldo en la sucursal'
  )
  // Un movimiento de OTRA empresa para ese saldo.
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        const m = await moverEnTx(tx, { ...mov(n1), reparto: [{ lotId: legado, cantidad: 1 }] })
        await tx.$executeRaw`UPDATE "inventory_movement_lots" SET "companyId" = ${ctx.b} WHERE "movementId" = ${m.movimientoId}`
      })
    ),
    /inventory_lot_inmutable|Foreign key|foreign key/i,
    'otra empresa'
  )
  // El mismo lote dos veces en un movimiento no cabe: un renglón por lote.
  assert.match(
    await rechazo(() =>
      enTransaccion((tx) => moverEnTx(tx, { ...mov(n1), cantidad: 2, reparto: [{ lotId: legado, cantidad: 1 }, { lotId: legado, cantidad: 1 }] }))
    ),
    /Unique|unique|duplicate/i,
    'un renglón por lote'
  )
  // Un renglón de 0 unidades junto a uno bueno: el reparto SUMA bien (1 + 0), así que solo lo detiene el CHECK de la cantidad.
  const cero = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'CERO' }, select: { id: true } })).id
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n1, catalogVariantId: v, lotId: cero } })
  assert.match(
    await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { ...mov(n1), cantidad: 1, reparto: [{ lotId: legado, cantidad: 1 }, { lotId: cero, cantidad: 0 }] }))),
    /inventory_movement_lots_cantidad/,
    'un renglón de reparto de cero unidades'
  )
  assert.match(await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { ...mov(n1), cantidad: 1, reparto: [{ lotId: legado, cantidad: 0 }] }))), /inventory_movement_lots_cantidad|inventory_lots_reparto/, 'cantidad cero')

  // El saldo por lote de un saldo de OTRO producto, o de OTRA empresa, aunque el lote y la variante sean coherentes entre sí: solo
  // lo detiene la clave (saldo, variante, empresa). (Con un lote de otro producto la rechaza la clave del lote, no esta.)
  const FK_SALDO = /inventory_lot_balances_level_variant_company_fkey/
  assert.match(await rechazo(() => prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: nOtro, catalogVariantId: v, lotId: legado } })), FK_SALDO, 'el saldo es de otro producto')
  const vB = await producto(ctx.b)
  const nB = await nivel(ctx.b, vB, ctx.sucB, { onHand: 1 })
  assert.match(await rechazo(() => prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: nB, catalogVariantId: v, lotId: legado } })), FK_SALDO, 'el saldo es de otra empresa')
  assert.deepEqual(await saldoDe(n1), { onHand: 10, reserved: 0, damaged: 0 }, 'ningún rechazo dejó rastro')
})

test('8 · para CADA traslado de cubetas que el dominio permite, el saldo por lote se mueve igual que el saldo de la sucursal', async () => {
  const v = await producto(ctx.a)
  // Holgura de sobra en las tres cubetas: 60 vendibles, 30 apartados, 30 dañados (cada traslado mueve 3).
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 90, reserved: 30, damaged: 30 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 90, reserved: 30, damaged: 30 }]))
  let cubetas: Cubetas = cubetasDeSaldo({ onHand: 90, reserved: 30, damaged: 30 })
  let recorridos = 0
  for (const [tipo, traspasos] of Object.entries(MOVIMIENTOS_PERMITIDOS) as Array<[InventoryMovementType, ReadonlyArray<{ source: InventoryBucket | null; destination: InventoryBucket | null }>]>) {
    for (const t of traspasos) {
      const r = (await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes: cubetas, tipo, origen: t.source, destino: t.destination, cantidad: 3, reparto: [{ lotId: legado, cantidad: 3 }] })))
      cubetas = r.despues
      const nivelAhora = await saldoDe(n)
      assert.deepEqual(await saldoPorLote(n, legado), nivelAhora, `${tipo} ${t.source ?? 'fuera'}→${t.destination ?? 'fuera'}: el lote sigue siendo igual al saldo`)
      assert.deepEqual(nivelAhora, saldoDeCubetas(cubetas), `${tipo}: y el saldo es lo que dice el dominio`)
      recorridos++
    }
  }
  assert.equal(recorridos, 13, 'los 13 traslados permitidos')
  // El efecto en SQL es el mismo del dominio para todo par de cubetas (sin salir ni entrar a la misma).
  const opciones: Array<InventoryBucket | null> = [null, ...BUCKETS]
  for (const origen of opciones) {
    for (const destino of opciones) {
      if (origen === destino) continue
      const [fila] = await prisma.$queryRaw<Array<{ e: number[] }>>`SELECT inventory_lot_efecto(${origen}::"InventoryBucket", ${destino}::"InventoryBucket", 7) AS e`
      const esperado = saldoDeCubetas(saldoDeMovimientos([{ sourceBucket: origen, destinationBucket: destino, quantity: 7 }]))
      assert.deepEqual(fila.e, [esperado.onHand, esperado.reserved, esperado.damaged], `${origen ?? 'fuera'}→${destino ?? 'fuera'}`)
    }
  }
})

test('9 · repartos, aperturas y lotes no se editan; la activación solo cambia «exige vencimiento»', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 5 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 5 }]))
  const venta = (await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes: { AVAILABLE: 5, RESERVED: 0, DAMAGED: 0 }, tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 1, reparto: [{ lotId: legado, cantidad: 1 }] })))
  const INMUTABLE = /inventory_lot_inmutable/

  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_movement_lots" SET "quantity" = 2 WHERE "movementId" = ${venta.movimientoId}`), INMUTABLE, 'reparto: UPDATE')
  assert.match(await rechazo(() => prisma.$executeRaw`DELETE FROM "inventory_movement_lots" WHERE "movementId" = ${venta.movimientoId}`), INMUTABLE, 'reparto: DELETE')
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_openings" SET "onHand" = 99 WHERE "inventoryLevelId" = ${n}`), INMUTABLE, 'apertura: UPDATE')
  assert.match(await rechazo(() => prisma.$executeRaw`DELETE FROM "inventory_lot_openings" WHERE "inventoryLevelId" = ${n}`), INMUTABLE, 'apertura con historial: DELETE')
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lots" SET "code" = 'OTRO' WHERE "id" = ${legado}`), INMUTABLE, 'lote: UPDATE')
  assert.match(await rechazo(() => prisma.$executeRaw`DELETE FROM "inventory_lots" WHERE "id" = ${legado}`), INMUTABLE, 'lote con historial: DELETE')
  assert.match(await rechazo(() => prisma.$executeRaw`DELETE FROM "inventory_lot_balances" WHERE "inventoryLevelId" = ${n}`), INMUTABLE, 'saldo por lote con historial: DELETE')
  assert.match(await rechazo(() => prisma.$executeRaw`DELETE FROM "inventory_lot_tracking" WHERE "catalogVariantId" = ${v}`), INMUTABLE, 'activación con historial: DELETE')
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_tracking" SET "activatedBy" = 'x' WHERE "catalogVariantId" = ${v}`), INMUTABLE, 'activación: quién la activó no cambia')
  assert.match(await rechazo(() => prisma.$executeRaw`UPDATE "inventory_lot_tracking" SET "catalogVariantId" = ${v} || 'x' WHERE "catalogVariantId" = ${v}`), INMUTABLE, 'ni de qué producto es')

  // TRUNCATE de cada tabla (el trigger lo rechaza antes de tocar nada).
  for (const tabla of ['inventory_movement_lots', 'inventory_lot_openings', 'inventory_lot_balances', 'inventory_lots', 'inventory_lot_tracking']) {
    assert.match(await rechazo(() => prisma.$executeRawUnsafe(`TRUNCATE "${tabla}" CASCADE`)), /inventory_lot_inmutable|TRUNCATE/, `TRUNCATE ${tabla}`)
  }

  // «Exige vencimiento» sí cambia: es una política del producto, no historia.
  await prisma.inventoryLotTracking.update({ where: { catalogVariantId: v }, data: { requiresExpiry: true } })
  assert.equal((await prisma.inventoryLotTracking.findUniqueOrThrow({ where: { catalogVariantId: v } })).requiresExpiry, true)

  assert.deepEqual(await saldoPorLote(n, legado), { onHand: 4, reserved: 0, damaged: 0 }, 'nada de esto tocó el saldo')
  assert.equal(await prisma.inventoryMovementLot.count({ where: { movementId: venta.movimientoId } }), 1)
})

test('10 · solo un producto SIN historial de movimientos se limpia (lo que hace el borrado de la variante)', async () => {
  const sin = await producto(ctx.a)
  const nSin = await nivel(ctx.a, sin, ctx.suc1, { onHand: 0 })
  await enTransaccion((tx) => activarEnTx(tx, ctx.a, sin, [{ id: nSin }]))
  await enTransaccion(async (tx) => {
    await tx.inventoryLotOpening.deleteMany({ where: { inventoryLevelId: nSin } })
    await tx.inventoryLotBalance.deleteMany({ where: { inventoryLevelId: nSin } })
    await tx.inventoryLot.deleteMany({ where: { catalogVariantId: sin } })
    await tx.inventoryLotTracking.deleteMany({ where: { catalogVariantId: sin } })
    await tx.inventoryLevel.delete({ where: { id: nSin } })
  })
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: sin } }), 0)
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: sin } }), 0)
  assert.equal(await prisma.inventoryLevel.count({ where: { id: nSin } }), 0)

  // Borrar los lotes pero dejar el producto «con lotes» a medias lo rechaza el cuadre; y con historial, ni empezar.
  const con = await producto(ctx.a)
  const nCon = await nivel(ctx.a, con, ctx.suc1, { onHand: 3 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, con, [{ id: nCon, onHand: 3 }]))
  await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: nCon, antes: { AVAILABLE: 3, RESERVED: 0, DAMAGED: 0 }, tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 1, reparto: [{ lotId: legado, cantidad: 1 }] }))
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        await tx.inventoryLotOpening.deleteMany({ where: { inventoryLevelId: nCon } })
      })
    ),
    /inventory_lot_inmutable/,
    'con historial no se limpia'
  )
})

test('11 · un saldo por lote nunca queda en negativo ni con más apartado que existencias, aunque los lotes sigan sumando lo que hay', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 10 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 10 }]))
  const vacio = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'VACIO' }, select: { id: true } })).id
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: vacio } })
  const antes: Cubetas = { AVAILABLE: 10, RESERVED: 0, DAMAGED: 0 }
  const CHECK = /inventory_lot_balances_saldos/
  // Una venta de 5 repartida SOLO al lote vacío: el saldo de la sucursal baja a 5 (válido) y la suma de los lotes (10 − 5 + 0… = 5)
  // sigue cuadrando, así que lo único que lo impide es que el lote no puede quedar en −5.
  assert.match(
    await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes, tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 5, reparto: [{ lotId: vacio, cantidad: 5 }] }))),
    CHECK,
    'un lote no se vende por debajo de cero'
  )
  // Apartar 5 del lote vacío: el saldo de la sucursal puede (10 hay, 5 apartados) pero el lote no (0 hay, 5 apartados).
  assert.match(
    await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes, tipo: 'RESERVATION', origen: 'AVAILABLE', destino: 'RESERVED', cantidad: 5, reparto: [{ lotId: vacio, cantidad: 5 }] }))),
    CHECK,
    'un lote no aparta más de lo que tiene'
  )
  // Y lo mismo con lo dañado: dañar 5 del lote vacío lo deja en −5 disponible.
  assert.match(
    await rechazo(() => enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes, tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: 5, reparto: [{ lotId: vacio, cantidad: 5 }] }))),
    CHECK,
    'un lote no daña lo que no tiene'
  )
  // Lo bueno sí pasa: lo mismo pero del lote que tiene.
  await enTransaccion((tx) => moverEnTx(tx, { companyId: ctx.a, nivelId: n, antes, tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 5, reparto: [{ lotId: legado, cantidad: 5 }] }))
  assert.deepEqual(await saldoPorLote(n, legado), { onHand: 5, reserved: 0, damaged: 0 })
  assert.deepEqual(await saldoPorLote(n, vacio), { onHand: 0, reserved: 0, damaged: 0 }, 'los rechazos no dejaron rastro')
})

test('12 · repartos añadidos DESPUÉS a movimientos viejos: aunque los saldos queden cuadrados, el reparto del movimiento deja de sumar y se rechaza', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 10 })
  const legado = await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n, onHand: 10 }]))
  const loteB = (await prisma.inventoryLot.create({ data: { companyId: ctx.a, catalogVariantId: v, code: 'L-B' }, select: { id: true } })).id
  await prisma.inventoryLotBalance.create({ data: { companyId: ctx.a, inventoryLevelId: n, catalogVariantId: v, lotId: loteB } })
  const base = { companyId: ctx.a, nivelId: n }
  // B tiene 6; luego se dañan 5 del legado y se recuperan 5 del legado (dos movimientos de efecto contrario).
  const e = await enTransaccion((tx) => moverEnTx(tx, { ...base, antes: { AVAILABLE: 10, RESERVED: 0, DAMAGED: 0 }, tipo: 'PURCHASE', origen: null, destino: 'AVAILABLE', cantidad: 6, reparto: [{ lotId: loteB, cantidad: 6 }] }))
  const dano = await enTransaccion((tx) => moverEnTx(tx, { ...base, antes: e.despues, tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: 5, reparto: [{ lotId: legado, cantidad: 5 }] }))
  const recupera = await enTransaccion((tx) => moverEnTx(tx, { ...base, antes: dano.despues, tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: 'AVAILABLE', cantidad: 5, reparto: [{ lotId: legado, cantidad: 5 }] }))
  const antes = { saldo: await saldoDe(n), b: await saldoPorLote(n, loteB), a: await saldoPorLote(n, legado) }

  // Tres unidades de B «de más» en CADA movimiento: lo que el primero le quita a B lo devuelve el segundo, así que los saldos por lote
  // siguen sumando el saldo de la sucursal y ninguna otra comprobación lo ve. Solo el reparto de cada movimiento (5 + 3 ≠ 5) lo delata.
  assert.match(
    await rechazo(() =>
      enTransaccion(async (tx) => {
        await tx.inventoryMovementLot.create({ data: { companyId: ctx.a, movementId: dano.movimientoId, inventoryLevelId: n, lotId: loteB, quantity: 3 } })
        await tx.inventoryMovementLot.create({ data: { companyId: ctx.a, movementId: recupera.movimientoId, inventoryLevelId: n, lotId: loteB, quantity: 3 } })
      })
    ),
    /inventory_lots_reparto/,
    'el reparto de un movimiento viejo no se puede ampliar'
  )
  assert.deepEqual({ saldo: await saldoDe(n), b: await saldoPorLote(n, loteB), a: await saldoPorLote(n, legado) }, antes, 'el rechazo no dejó rastro')
  assert.equal(await prisma.inventoryMovementLot.count({ where: { movementId: dano.movimientoId } }), 1)
})

test('13 · borrar solo la activación de un producto que aún tiene lotes se rechaza al cerrar; limpiarlo todo, en cualquier orden, no', async () => {
  const v = await producto(ctx.a)
  const n = await nivel(ctx.a, v, ctx.suc1, { onHand: 0 })
  await enTransaccion((tx) => activarEnTx(tx, ctx.a, v, [{ id: n }]))
  // Sin historial el borrado se permite, pero dejaría «SIN LOTE» y su saldo de un producto que ya no lleva lotes.
  assert.match(
    await rechazo(() => enTransaccion((tx) => tx.inventoryLotTracking.deleteMany({ where: { catalogVariantId: v } }))),
    /inventory_lots_sin_seguimiento/,
    'la activación no se borra dejando lotes'
  )
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 1, 'el rechazo no dejó rastro')
  // Limpiarlo TODO, empezando por la activación, sí: lo que importa es cómo queda al cerrar.
  await enTransaccion(async (tx) => {
    await tx.inventoryLotTracking.deleteMany({ where: { catalogVariantId: v } })
    await tx.inventoryLotOpening.deleteMany({ where: { inventoryLevelId: n } })
    await tx.inventoryLotBalance.deleteMany({ where: { inventoryLevelId: n } })
    await tx.inventoryLot.deleteMany({ where: { catalogVariantId: v } })
  })
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 0)
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0)
})
