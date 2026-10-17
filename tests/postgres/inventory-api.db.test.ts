import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { configurarUmbralEnTx, recibirEnTx, reservarEnTx } from '../../src/modules/inventory/service'
import { listarMovimientos, listarNiveles, registrarAjustePorApi, registrarEntradaPorApi } from '../../src/modules/plataforma/inventario'
import { clasificarErrorDeInventario } from '../../src/modules/plataforma/inventario-dto'

/**
 * INV-5e · la API v1 de inventario contra PostgreSQL de verdad, con el servicio real del inventario:
 *
 *  · una entrada y un ajuste mueven el saldo, dejan su movimiento atribuido a la clave y devuelven el saldo resultante;
 *  · repetir la misma `Idempotency-Key` no suma dos veces; la misma clave con OTRA operación se rechaza;
 *  · el ajuste exige el código de motivo del catálogo; un faltante no baja de cero;
 *  · las lecturas paginan, filtran y no enseñan datos de otra empresa;
 *  · nada de costos sale ni entra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ctx = { a: '', b: '', usuario: '', admin: '', suc1: '', suc2: '', sucB: '' }
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const clave = { id: 'clave-prueba-1', prefijo: 'mbk_test' }

let contador = 0
async function crearProducto(empresaId = ctx.a): Promise<string> {
  const n = ++contador
  const r = await conEmpresa(empresaId, (tx) => crearItemEnTx(tx, empresaId, { name: `Api ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `API-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  await conEmpresa(empresaId, (tx) => cambiarEstadoItemEnTx(tx, empresaId, r.id, 'ACTIVE', como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

const entrada = (v: string, cantidad: unknown, k: string, sucursalId = ctx.suc1, extra: { nota?: string | null; lotes?: unknown } = {}) =>
  registrarEntradaPorApi(ctx.a, clave, `api:${k}`, { varianteId: v, sucursalId, cantidad, nota: extra.nota ?? null, lotes: extra.lotes })
const ajuste = (v: string, cambio: unknown, k: string, motivoCodigo = 'OTHER', nota: string | null = 'Conteo de la mañana', sucursalId = ctx.suc1) =>
  registrarAjustePorApi(ctx.a, clave, `api:${k}`, { varianteId: v, sucursalId, cambio, motivoCodigo, nota, lotes: undefined, lotesSalida: undefined })

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return clasificarErrorDeInventario(e)?.reason ?? `OTRO: ${e instanceof Error ? e.message : String(e)}`
  }
  return 'SIN_ERROR'
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Api ${x} ${sufijo}`, slug: `api-inv-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-api-${sufijo}`, email: `api-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.admin = (await prisma.user.create({ data: { supabaseId: `sb-api-adm-${sufijo}`, email: `api-adm-${sufijo}@prueba.test`, name: 'Administradora', role: 'ADMINISTRADOR', companyId: ctx.a }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucB = (await suc(ctx.b, 'Ajena')).id
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of ['inventory_movement_lots', 'inventory_lot_openings', 'inventory_lot_balances', 'inventory_lots', 'inventory_lot_tracking', 'inventory_variant_costs', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(`"${tabla}"`)} WHERE "companyId" IN (${Prisma.join(ids)})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.notificacion.deleteMany({ where: { userId: ctx.admin } })
  await prisma.auditLog.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: [ctx.usuario, ctx.admin] } } })
  await prisma.$disconnect()
})

test('una entrada suma, devuelve el saldo y deja el movimiento atribuido a la clave', async () => {
  const v = await crearProducto()
  const r = await entrada(v, 12, 'e1', ctx.suc1, { nota: 'Pedido del proveedor' })
  assert.equal(r.repeated, false)
  assert.deepEqual(r.level, { available: 12, onHand: 12, reserved: 0, damaged: 0 })
  const m = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: r.movementId } })
  assert.equal(m.type, 'PURCHASE')
  assert.equal(m.quantity, 12)
  assert.equal(m.referenceType, 'API')
  assert.equal(m.referenceId, clave.id)
  assert.equal(m.reason, 'Pedido del proveedor')
  assert.equal(m.idempotencyKey, 'api:e1')
  assert.equal(m.unitCost, null, 'la API no escribe costos')
  assert.equal(m.userId, null)
})

test('sin nota, el movimiento dice de qué clave vino', async () => {
  const v = await crearProducto()
  const r = await entrada(v, 1, 'sin-nota')
  assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: r.movementId } })).reason, 'API mbk_test')
})

test('repetir la misma Idempotency-Key no suma dos veces; con otra operación se rechaza', async () => {
  const v = await crearProducto()
  const primera = await entrada(v, 5, 'rep')
  const segunda = await entrada(v, 5, 'rep')
  assert.equal(segunda.repeated, true)
  assert.equal(segunda.movementId, primera.movementId)
  assert.equal(segunda.level.onHand, 5)
  assert.equal(await codigoDe(entrada(v, 9, 'rep')), 'idempotency_key_reused')
  assert.equal((await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: v, locationId: ctx.suc1 } })).onHand, 5)
})

test('un ajuste sube con sobrante y baja con faltante; el motivo del catálogo es obligatorio', async () => {
  const v = await crearProducto()
  await entrada(v, 10, 'a0')
  const baja = await ajuste(v, -3, 'a1', 'LOST')
  assert.equal(baja.level.onHand, 7)
  const sube = await ajuste(v, 2, 'a2', 'FOUND')
  assert.equal(sube.level.onHand, 9)
  const m = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: baja.movementId } })
  assert.equal(m.type, 'ADJUSTMENT')
  assert.equal(m.reasonCode, 'LOST')
  assert.equal(m.referenceType, 'API')
  const repetido = await ajuste(v, -3, 'a1', 'LOST')
  assert.equal(repetido.repeated, true, 'el mismo ajuste con la misma clave es un reintento')
  assert.equal(repetido.movementId, baja.movementId)
  assert.equal(repetido.level.onHand, 9, 'y no vuelve a restar: 10 − 3 + 2, el saldo de ahora')
  assert.equal(await codigoDe(ajuste(v, -1, 'a3', 'FOUND')), 'motivo_invalido', 'FOUND es de sobrantes: no vale para un faltante')
  assert.equal(await codigoDe(ajuste(v, -1, 'a4', 'NO_EXISTE')), 'motivo_invalido')
  assert.equal(await codigoDe(ajuste(v, -1, 'a7', 'OTHER', null)), 'motivo_obligatorio', '«Otro» sin explicación no vale')
  assert.equal(await codigoDe(ajuste(v, -1, 'a8', 'OTHER', '   ')), 'motivo_obligatorio')
  assert.equal(await codigoDe(ajuste(v, 0, 'a5')), 'cantidad_invalida')
  assert.equal(await codigoDe(ajuste(v, 1.5, 'a6')), 'cantidad_invalida')
})

test('un faltante no baja de cero y no deja rastro', async () => {
  const v = await crearProducto()
  await entrada(v, 2, 'z0')
  assert.equal(await codigoDe(ajuste(v, -3, 'z1', 'LOST')), 'insufficient_stock')
  assert.equal((await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: v, locationId: ctx.suc1 } })).onHand, 2)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a, idempotencyKey: 'api:z1' } }), 0)
})

test('producto o sucursal de otra empresa o inexistente: no encontrado; cantidades malas: rechazadas', async () => {
  const v = await crearProducto()
  assert.equal(await codigoDe(entrada('no-existe', 1, 'n1')), 'variante_no_encontrada')
  assert.equal(await codigoDe(entrada(v, 1, 'n2', ctx.sucB)), 'sucursal_no_encontrada')
  const ajena = await crearProducto(ctx.b)
  assert.equal(await codigoDe(entrada(ajena, 1, 'n3')), 'variante_no_encontrada')
  for (const [i, malo] of [0, -1, 1.5, '3', null, 10_000_000_000].entries()) assert.equal(await codigoDe(entrada(v, malo, `m${i}`)), 'cantidad_invalida', String(malo))
})

test('las lecturas filtran por sucursal y producto, paginan y no cruzan empresas', async () => {
  const v = await crearProducto()
  await entrada(v, 4, 'l1', ctx.suc1)
  await entrada(v, 6, 'l2', ctx.suc2)
  const ajeno = await crearProducto(ctx.b)
  await conEmpresa(ctx.b, (tx) => import('../../src/modules/inventory/service').then((s) => s.recibirEnTx(tx, ctx.b, { varianteId: ajeno, sucursalId: ctx.sucB, cantidad: 99, motivo: 'ajeno' }, como(ctx.usuario))))

  const todos = await listarNiveles(ctx.a, { take: 50, cursor: {}, variantId: v })
  assert.deepEqual(todos.map((n) => [n.branchName, n.onHand, n.available]).sort(), [['Norte', 6, 6], ['Principal', 4, 4]])
  const norte = await listarNiveles(ctx.a, { take: 50, cursor: {}, variantId: v, branchId: ctx.suc2 })
  assert.equal(norte.length, 1)
  assert.equal(norte[0].branchId, ctx.suc2)
  assert.ok(!(await listarNiveles(ctx.a, { take: 500, cursor: {} })).some((n) => n.variantId === ajeno), 'no se ve la existencia de otra empresa')
  assert.equal((await listarNiveles(ctx.a, { take: 1, cursor: {}, variantId: v })).length, 1)
  assert.ok(!JSON.stringify(todos).toLowerCase().includes('cost'))

  const movs = await listarMovimientos(ctx.a, { take: 50, cursor: {}, variantId: v })
  assert.equal(movs.length, 2)
  assert.ok(movs.every((m) => m.variantId === v && m.type === 'PURCHASE' && m.reference?.type === 'API'))
  assert.ok(!JSON.stringify(movs).toLowerCase().includes('cost'))
  assert.equal((await listarMovimientos(ctx.a, { take: 50, cursor: {}, variantId: v, branchId: ctx.suc1 })).length, 1)
})

test('la entrada admite lotes igual que en el panel', async () => {
  const v = await crearProducto()
  const { activarLotesEnTx } = await import('../../src/modules/inventory/service')
  await conEmpresa(ctx.a, (tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, exigirVencimiento: false }, como(ctx.usuario)))
  const r = await entrada(v, 5, 'lot1', ctx.suc1, { lotes: [{ codigo: 'L-1', vencimiento: null, cantidad: 5 }] })
  assert.equal(r.level.onHand, 5)
  const lote = await prisma.inventoryLot.findFirstOrThrow({ where: { companyId: ctx.a, catalogVariantId: v, code: 'L-1' } })
  assert.ok(lote)
  assert.equal(await codigoDe(entrada(v, 5, 'lot2', ctx.suc1, { lotes: [{ codigo: 'L-2', vencimiento: null, cantidad: 4 }] })), 'lotes_no_cuadran')
})

test('lo vendible que devuelve la API ya descuenta lo apartado', async () => {
  const v = await crearProducto()
  await entrada(v, 10, 'r0')
  await conEmpresa(ctx.a, (tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 4 }, como(ctx.usuario)))
  const r = await entrada(v, 1, 'r1')
  assert.deepEqual(r.level, { available: 7, onHand: 11, reserved: 4, damaged: 0 })
  const [n] = await listarNiveles(ctx.a, { take: 5, cursor: {}, variantId: v })
  assert.equal(n.available, 7)
  assert.equal(n.reserved, 4)
})

test('un faltante por la API que deja el producto bajo su umbral avisa a los administradores, igual que el panel', async () => {
  const v = await crearProducto()
  await entrada(v, 8, 'u0')
  await conEmpresa(ctx.a, (tx) => configurarUmbralEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, umbral: 5 }, como(ctx.usuario)))
  await ajuste(v, -1, 'u1', 'LOST')
  assert.equal(await prisma.notificacion.count({ where: { userId: ctx.admin, dedupeKey: { startsWith: 'stock-bajo:' } } }), 0, 'con 7 todavía no avisa')
  await ajuste(v, -3, 'u2', 'LOST')
  const avisos = await prisma.notificacion.findMany({ where: { userId: ctx.admin, dedupeKey: { startsWith: 'stock-bajo:' } }, select: { titulo: true } })
  assert.deepEqual(avisos.map((a) => a.titulo), ['Stock bajo'])
})

test('el libro de movimientos no trae los de otra empresa', async () => {
  const ajeno = await crearProducto(ctx.b)
  const m = await conEmpresa(ctx.b, (tx) => recibirEnTx(tx, ctx.b, { varianteId: ajeno, sucursalId: ctx.sucB, cantidad: 3, motivo: 'ajeno' }, como(ctx.usuario)))
  const propios = await listarMovimientos(ctx.a, { take: 500, cursor: {} })
  assert.ok(propios.length > 0)
  assert.ok(!propios.some((x) => x.id === m.movimientoId))
})
