import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import {
  abrirConteoEnTx,
  activarLotesEnTx,
  cancelarConteoEnTx,
  corregirVencimientoLoteEnTx,
  desactivarLotesEnTx,
  recibirEnTx,
  registrarConteoProductoEnTx,
  registrarEntradaMultipleEnTx,
  transferirEnTx,
} from '../../src/modules/inventory/service'
import { cambiosDeVencimientoEnTx, lotesDeVarianteEnTx, motivoParaNoDesactivarLotesEnTx } from '../../src/modules/inventory/lotes-queries'

/**
 * INV-5b5 · CORREGIR EL VENCIMIENTO DE UN LOTE y DESHACER LA ACTIVACIÓN DE LOTES contra PostgreSQL de verdad, con el servicio real.
 *
 *  · el vencimiento (y solo el vencimiento) de un lote se corrige con motivo y deja una fila de historia; la base no deja cambiarlo sin
 *    esa fila escrita en la misma transacción, ni tocar el código, ni el lote «SIN LOTE», ni editar la historia;
 *  · corregir no mueve ni un saldo, pero sí lo que depende de la fecha (orden FEFO, lo vencido);
 *  · la activación se deshace mientras ningún movimiento se haya repartido entre lotes (aunque el producto tenga movimientos de ANTES),
 *    y se rechaza en cuanto hay historia con lotes; las existencias no se tocan; se puede volver a activar;
 *  · la concurrencia (varias correcciones del mismo lote; deshacer contra una entrada con lotes).
 *
 * Las fechas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`). `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
const AHORA = new Date('2027-06-15T16:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
async function producto(nombre = 'Corrección'): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `CV-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
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
async function mensajeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ''
}

const activar = (v: string, exigirVencimiento = false) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, exigirVencimiento, ahora: AHORA }, como(ctx.usuario)))
const desactivar = (v: string) => enA((tx) => desactivarLotesEnTx(tx, ctx.a, { varianteId: v }, como(ctx.usuario)))
type LoteEntrante = { codigo: string; vencimiento?: string | null; cantidad: number }
const entrada = (v: string, lotes: LoteEntrante[], sucursalId = ctx.suc1) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId: v, cantidad: lotes.reduce((s, l) => s + l.cantidad, 0), lotes }], ahora: AHORA }, como(ctx.usuario)))
const entradaSuelta = (v: string, cantidad: number, sucursalId = ctx.suc1) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId, cantidad }, como(ctx.usuario)))
const corregir = (loteId: string, vencimiento: unknown, motivo: unknown = 'Se leyó mal el empaque', empresa: 'a' | 'b' = 'a') =>
  (empresa === 'a' ? enA : enB)((tx) => corregirVencimientoLoteEnTx(tx, empresa === 'a' ? ctx.a : ctx.b, { loteId, vencimiento, motivo }, como(ctx.usuario)))
const idsDeLotes = async (v: string): Promise<Record<string, string>> =>
  Object.fromEntries((await prisma.inventoryLot.findMany({ where: { catalogVariantId: v }, select: { id: true, code: true } })).map((l) => [l.code, l.id]))
const fechaDe = async (loteId: string) => (await prisma.$queryRaw<{ f: string | null }[]>`SELECT "expiresOn"::text AS f FROM "inventory_lots" WHERE "id" = ${loteId}`)[0].f
const historia = (loteId: string) =>
  prisma.$queryRaw<{ de: string | null; a: string | null; motivo: string }[]>`SELECT "previousExpiresOn"::text AS de, "newExpiresOn"::text AS a, "reason" AS motivo FROM "inventory_lot_expiry_changes" WHERE "lotId" = ${loteId} ORDER BY "createdAt", "id"`

async function productoConLotes(a = 6, b = 4, exigir = false): Promise<string> {
  const v = await producto('Con lotes')
  await activar(v, exigir)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-07-01', cantidad: a }, { codigo: 'B', vencimiento: '2027-09-01', cantidad: b }])
  return v
}

/** Los lotes suman el saldo de cada sucursal (la red de la base, vista desde fuera). */
async function verificarLotes(v: string): Promise<void> {
  const niveles = await prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, select: { id: true, onHand: true, reserved: true, damaged: true } })
  for (const n of niveles) {
    const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: n.id }, select: { onHand: true, reserved: true, damaged: true } })
    if (bs.length === 0) continue
    const suma = bs.reduce((t, b) => ({ onHand: t.onHand + b.onHand, reserved: t.reserved + b.reserved, damaged: t.damaged + b.damaged }), { onHand: 0, reserved: 0, damaged: 0 })
    assert.deepEqual(suma, { onHand: n.onHand, reserved: n.reserved, damaged: n.damaged }, 'los lotes suman el saldo de la sucursal')
  }
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Corrección lotes ${x} ${sufijo}`, slug: `correccion-lotes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-cor-${sufijo}`, email: `cor-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_lot_expiry_changes',
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_count_lines',
        'inventory_count_sessions',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_transfer_lines',
        'inventory_transfers',
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
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── Corregir el vencimiento ──────────────────────────────────────────────────

test('1 · corregir el vencimiento cambia SOLO la fecha, deja su historia y una bitácora, y no mueve ni un saldo ni un movimiento', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const antes = { movs: await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), repartos: await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a } }), saldos: await prisma.inventoryLotBalance.findMany({ where: { catalogVariantId: v }, orderBy: { lotId: 'asc' }, select: { onHand: true, reserved: true, damaged: true } }) }
  const r = await corregir(id.A, '2027-10-20', ' Se leyó mal  el empaque ')
  assert.deepEqual([r.codigo, r.anterior, r.nuevo, r.repetido], ['A', '2027-07-01', '2027-10-20', false])
  assert.equal(await fechaDe(id.A), '2027-10-20')
  assert.deepEqual(await historia(id.A), [{ de: '2027-07-01', a: '2027-10-20', motivo: 'Se leyó mal el empaque' }], 'el motivo se normaliza')
  const fila = await prisma.inventoryLotExpiryChange.findFirstOrThrow({ where: { lotId: id.A } })
  assert.equal(fila.changedBy, ctx.usuario)
  assert.equal(fila.companyId, ctx.a)
  assert.deepEqual(
    { movs: await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), repartos: await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a } }), saldos: await prisma.inventoryLotBalance.findMany({ where: { catalogVariantId: v }, orderBy: { lotId: 'asc' }, select: { onHand: true, reserved: true, damaged: true } }) },
    antes,
    'ni movimientos, ni repartos, ni saldos'
  )
  const log = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: v, accion: 'INVENTORY_CONFIGURED' } })
  assert.equal(log.filter((l) => (l.payload as { tipo?: string } | null)?.tipo === 'LOTE_VENCIMIENTO').length, 1, 'queda en la bitácora')
  // Lo que depende de la fecha: el orden FEFO. Ahora B (2027-09-01) vence antes que A (2027-10-20).
  const lotes = await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, v, AHORA))
  assert.deepEqual(lotes.porSucursal[ctx.suc1].map((l) => [l.codigo, l.vencimiento]), [['B', '2027-09-01'], ['A', '2027-10-20']])
  await verificarLotes(v)
})

test('2 · corregir hacia el pasado deja el lote vencido: FEFO ya no lo toca; corregir hacia el futuro lo rescata; quitar la fecha a un lote que no la exige', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  await corregir(id.A, '2027-06-01') // hoy es 2027-06-15
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 3, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(Object.fromEntries((await prisma.inventoryLotBalance.findMany({ where: { catalogVariantId: v, level: { locationId: ctx.suc2 } }, select: { onHand: true, lot: { select: { code: true } } } })).map((b) => [b.lot.code, b.onHand])), { B: 3 }, 'A está vencido: sale de B')
  await corregir(id.A, '2028-01-31', 'La fecha buena es la de la caja')
  // Con la fecha nueva A vence después que B (queda 1): salen 1 de B y 3 de A.
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 4, ahora: AHORA }, como(ctx.usuario)))
  assert.equal((await prisma.inventoryLotBalance.findFirstOrThrow({ where: { lotId: id.A, level: { locationId: ctx.suc2 } } })).onHand, 3, 'corregido hacia el futuro vuelve a venderse, detrás de B')
  assert.deepEqual((await historia(id.A)).map((h) => [h.de, h.a]), [['2027-07-01', '2027-06-01'], ['2027-06-01', '2028-01-31']], 'la historia es una cadena')
  // Quitar la fecha (no vence) y volver a ponerla.
  const sin = await corregir(id.B, '', 'Resultó no llevar fecha')
  assert.equal(sin.nuevo, null)
  assert.equal(await fechaDe(id.B), null)
  await corregir(id.B, '2027-12-12', 'Sí llevaba fecha')
  assert.deepEqual((await historia(id.B)).map((h) => [h.de, h.a]), [['2027-09-01', null], [null, '2027-12-12']])
  await verificarLotes(v)
})

test('3 · lo que se rechaza no cambia nada: sin motivo, fecha mala, el «SIN LOTE», un lote ajeno o inexistente, quitar la fecha donde se exige', async () => {
  const v = await productoConLotes(6, 4, true)
  const id = await idsDeLotes(v)
  const legado = id['SIN LOTE']
  const otro = await productoConLotes(2, 2)
  const ajeno = (await idsDeLotes(otro)).A
  const antes = await prisma.inventoryLotExpiryChange.count({ where: { companyId: ctx.a } })
  assert.equal(await codigoDe(corregir(id.A, '2027-12-01', null)), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(corregir(id.A, '2027-12-01', '   ')), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(corregir(id.A, '2027-12-01', 'x'.repeat(301))), 'MOTIVO_INVALIDO')
  assert.equal(await codigoDe(corregir(id.A, '2027-02-30')), 'VENCIMIENTO_INVALIDO')
  assert.equal(await codigoDe(corregir(id.A, '0225-01-01')), 'VENCIMIENTO_INVALIDO')
  assert.equal(await codigoDe(corregir(id.A, 20271201)), 'VENCIMIENTO_INVALIDO')
  assert.equal(await codigoDe(corregir(id.A, '')), 'VENCIMIENTO_REQUERIDO', 'este producto exige fecha en cada lote')
  assert.equal(await codigoDe(corregir(id.A, null)), 'VENCIMIENTO_REQUERIDO')
  assert.equal(await codigoDe(corregir(legado, '2027-12-01')), 'LOTE_LEGADO')
  assert.equal(await codigoDe(corregir('no-existe', '2027-12-01')), 'LOTE_NO_ENCONTRADO')
  assert.equal(await codigoDe(corregir(ajeno, '2027-12-01', 'x', 'b')), 'LOTE_NO_ENCONTRADO', 'otra empresa no corrige lotes ajenos')
  assert.equal(await prisma.inventoryLotExpiryChange.count({ where: { companyId: ctx.a } }), antes, 'sin filas de historia')
  assert.equal(await fechaDe(id.A), '2027-07-01')
  assert.equal(await fechaDe(ajeno), '2027-07-01')
})

test('4 · poner la fecha que ya tenía no cambia nada (un reintento no deja una segunda fila de historia)', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const uno = await corregir(id.A, '2027-08-08')
  const dos = await corregir(id.A, '2027-08-08')
  assert.deepEqual([uno.repetido, dos.repetido], [false, true])
  assert.equal((await historia(id.A)).length, 1)
  assert.equal((await corregir(id.B, '2027-09-01')).repetido, true, 'ni siquiera la que traía de origen')
  assert.equal((await historia(id.B)).length, 0)
})

test('5 · la base: el vencimiento no cambia sin una fila de historia de la MISMA transacción que diga ese cambio; el código, el legado y la historia no se editan', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const sql = (p: Promise<unknown>) => mensajeDe(p)
  // Sin historia.
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-12-31' WHERE "id" = ${id.A}`), /inventory_lot_inmutable.*historia/)
  // Con una historia que dice OTRA cosa.
  assert.match(
    await sql(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('h-otra-1', ${ctx.a}, ${v}, ${id.A}, DATE '2027-07-01', DATE '2027-11-11', 'dice otra fecha')`
        await tx.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-12-31' WHERE "id" = ${id.A}`
      })
    ),
    /inventory_lot_inmutable.*historia/
  )
  // Con una historia que parte de OTRA fecha anterior (aunque la nueva sea la buena).
  assert.match(
    await sql(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('h-otra-2', ${ctx.a}, ${v}, ${id.A}, DATE '2027-01-01', DATE '2027-12-31', 'parte de otra fecha')`
        await tx.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-12-31' WHERE "id" = ${id.A}`
      })
    ),
    /inventory_lot_inmutable.*historia/
  )
  // Con una historia escrita en OTRA transacción (aunque diga exactamente el cambio).
  await prisma.$executeRaw`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('h-vieja-1', ${ctx.a}, ${v}, ${id.A}, DATE '2027-07-01', DATE '2027-12-31', 'escrita antes')`
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-12-31' WHERE "id" = ${id.A}`), /inventory_lot_inmutable.*historia/)
  assert.equal(await fechaDe(id.A), '2027-07-01')
  // Con la historia correcta en la misma transacción SÍ se puede (es lo que hace el servicio).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('h-buena-1', ${ctx.a}, ${v}, ${id.B}, DATE '2027-09-01', DATE '2027-09-09', 'a mano pero con historia')`
    await tx.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-09-09' WHERE "id" = ${id.B}`
  })
  assert.equal(await fechaDe(id.B), '2027-09-09')
  // Lo demás del lote no se toca nunca, ni con historia.
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lots" SET "code" = 'OTRO' WHERE "id" = ${id.A}`), /de un lote solo puede cambiar su vencimiento/)
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lots" SET "createdBy" = 'x' WHERE "id" = ${id.A}`), /de un lote solo puede cambiar su vencimiento/)
  assert.match(await sql(prisma.$executeRaw`DELETE FROM "inventory_lots" WHERE "id" = ${id.A}`), /inventory_lot_inmutable|violates foreign key|historial/)
  // El legado no vence.
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = DATE '2027-12-31' WHERE "code" = 'SIN LOTE' AND "catalogVariantId" = ${v}`), /inventory_lot_inmutable|inventory_lots_legado/)
  // La historia no se edita ni se borra.
  assert.match(await sql(prisma.$executeRaw`UPDATE "inventory_lot_expiry_changes" SET "reason" = 'reescrita' WHERE "id" = 'h-buena-1'`), /inventory_lot_inmutable/)
  assert.match(await sql(prisma.$executeRaw`DELETE FROM "inventory_lot_expiry_changes" WHERE "id" = 'h-buena-1'`), /inventory_lot_inmutable/)
  assert.match(await sql(prisma.$executeRawUnsafe('TRUNCATE "inventory_lot_expiry_changes"')), /inventory_lot_inmutable/)
  // Formas imposibles.
  const fila = (id2: string, prev: string | null, nuevo: string | null, motivo: string) =>
    prisma.$executeRawUnsafe(`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('${id2}', '${ctx.a}', '${v}', '${id.A}', ${prev ? `DATE '${prev}'` : 'NULL'}, ${nuevo ? `DATE '${nuevo}'` : 'NULL'}, '${motivo}')`)
  assert.match(await sql(fila('h-mala-1', '2027-07-01', '2027-07-01', 'igual')), /inventory_lot_expiry_changes_cambio/)
  assert.match(await sql(fila('h-mala-2', '2027-07-01', '2027-08-01', '   ')), /inventory_lot_expiry_changes_cambio/)
  assert.match(await sql(fila('h-mala-3', '2027-07-01', '1999-01-01', 'muy vieja')), /inventory_lot_expiry_changes_cambio/)
  // El lote tiene que ser de ese producto y de esa empresa.
  const otro = await productoConLotes(2, 2)
  assert.match(await sql(prisma.$executeRaw`INSERT INTO "inventory_lot_expiry_changes" ("id","companyId","catalogVariantId","lotId","previousExpiresOn","newExpiresOn","reason") VALUES ('h-mala-4', ${ctx.a}, ${otro}, ${id.A}, DATE '2027-07-01', DATE '2027-08-01', 'lote de otro producto')`), /foreign key|lot_variant_company/)
  await verificarLotes(v)
})

test('6 · dos, cuatro o diez correcciones del MISMO lote a la vez se turnan: la historia es una cadena sin huecos y la fecha final es la de la última', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const fechas = ['2027-08-01', '2027-08-02', '2027-08-03', '2027-08-04', '2027-08-05', '2027-08-06']
  const rs = await Promise.allSettled(fechas.map((f) => corregir(id.A, f, `a ${f}`)))
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, fechas.length, rs.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok')).join('; '))
  const h = await historia(id.A)
  assert.equal(h.length, fechas.length)
  assert.equal(h[0].de, '2027-07-01')
  for (let i = 1; i < h.length; i++) assert.equal(h[i].de, h[i - 1].a, `la corrección ${i} parte de donde terminó la anterior`)
  assert.equal(await fechaDe(id.A), h[h.length - 1].a)
})

test('7 · corregir un lote mientras se vende de él a la vez no estropea los saldos', async () => {
  const v = await productoConLotes(20, 4)
  const id = await idsDeLotes(v)
  const mover = (n: number) => enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: n, ahora: AHORA }, como(ctx.usuario)))
  const rs = await Promise.allSettled([corregir(id.A, '2027-12-01'), mover(2), corregir(id.A, '2027-12-02'), mover(3), mover(1)])
  assert.equal(rs.filter((r) => r.status === 'rejected').length, 0, rs.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok')).join('; '))
  assert.equal((await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: v, locationId: ctx.suc2 } })).onHand, 6)
  await verificarLotes(v)
})

// ── Deshacer la activación ───────────────────────────────────────────────────

test('8 · deshacer la activación de un producto que ya tenía existencias y movimientos de ANTES: vuelve a ser un producto sin lotes, las existencias no se tocan y se puede activar otra vez', async () => {
  const v = await producto('Activado por error')
  await entradaSuelta(v, 10)
  await entradaSuelta(v, 5, ctx.suc2)
  const nivel1 = async () => prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, orderBy: { locationId: 'asc' }, select: { locationId: true, onHand: true, reserved: true, damaged: true } })
  const antes = await nivel1()
  const movs = await prisma.inventoryMovement.count({ where: { catalogVariantId: v } as never }).catch(() => -1)
  void movs
  const movimientos = () => prisma.inventoryMovement.count({ where: { level: { catalogVariantId: v } } })
  const nMovs = await movimientos()
  await activar(v)
  assert.equal(await enA((tx) => motivoParaNoDesactivarLotesEnTx(tx, ctx.a, v)), null, 'se puede deshacer: nada se movió con lotes')
  const r = await desactivar(v)
  assert.deepEqual([r.repetido, r.sucursales], [false, 2])
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0)
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 0)
  assert.equal(await prisma.inventoryLotBalance.count({ where: { catalogVariantId: v } }), 0)
  assert.equal(await prisma.inventoryLotOpening.count({ where: { level: { catalogVariantId: v } } }), 0)
  assert.deepEqual(await nivel1(), antes, 'las existencias no se tocaron')
  assert.equal(await movimientos(), nMovs, 'ni el ledger')
  // Otra vez producto normal: una entrada sin lotes funciona y una con lotes se rechaza.
  await entradaSuelta(v, 3)
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'X', cantidad: 1 }])), 'LOTES_NO_APLICAN')
  // Y se puede volver a activar: la apertura vuelve a copiar lo que hay AHORA.
  const otra = await activar(v)
  assert.deepEqual([otra.repetido, otra.unidades], [false, 18])
  assert.equal((await desactivar(v)).repetido, false)
  // Un producto que ya no lleva lotes: deshacer otra vez no hace nada.
  assert.equal((await desactivar(v)).repetido, true)
  await verificarLotes(v)
})

test('9 · no se deshace en cuanto hay historia con lotes: una entrada, una venta/transferencia, un conteo por lote o una corrección de vencimiento; nada se pierde', async () => {
  // Una entrada con lotes.
  const v1 = await productoConLotes(6, 4)
  const antes = { lotes: await prisma.inventoryLot.count({ where: { catalogVariantId: v1 } }), repartos: await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a } }) }
  assert.equal(await codigoDe(desactivar(v1)), 'DESACTIVAR_CON_HISTORIAL')
  assert.deepEqual({ lotes: await prisma.inventoryLot.count({ where: { catalogVariantId: v1 } }), repartos: await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a } }) }, antes)
  const porQue = await enA((tx) => motivoParaNoDesactivarLotesEnTx(tx, ctx.a, v1))
  assert.match(porQue?.error ?? '', /ya se movió con lotes/)
  // Un producto activado SIN lotes propios, al que solo se le transfiere lo que tenía (sale del «SIN LOTE»): ya hay reparto.
  const v2 = await producto('Transferido')
  await entradaSuelta(v2, 10)
  await activar(v2)
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v2, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 2, ahora: AHORA }, como(ctx.usuario)))
  assert.equal(await codigoDe(desactivar(v2)), 'DESACTIVAR_CON_HISTORIAL')
  // Una línea de conteo con lote (aunque el conteo se cancele).
  const v3 = await producto('Contado')
  await entradaSuelta(v3, 4)
  await activar(v3)
  const legado = (await idsDeLotes(v3))['SIN LOTE']
  const conteo = await enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId: ctx.suc1, ahora: AHORA }, como(ctx.usuario)))
  await enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: conteo.conteoId, varianteId: v3, loteId: legado, cantidad: 4, modo: 'FIJAR' } as never, como(ctx.usuario)))
  assert.equal(await codigoDe(desactivar(v3)), 'DESACTIVAR_CON_CONTEO', 'con el conteo abierto')
  await enA((tx) => cancelarConteoEnTx(tx, ctx.a, { conteoId: conteo.conteoId, ahora: AHORA }, como(ctx.usuario)))
  assert.equal(await codigoDe(desactivar(v3)), 'DESACTIVAR_CON_CONTEO', 'y con el conteo ya cancelado: la línea sigue ahí')
  // Todo siguió en pie.
  for (const v of [v1, v2, v3]) {
    assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 1)
    await verificarLotes(v)
  }
})

test('10 · deshacer contra una entrada con lotes a la vez (con y sin existencias previas): o el producto queda sin lotes y la entrada se rechaza, o la entrada entra y deshacer se rechaza; nunca queda a medias', async () => {
  for (let ronda = 0; ronda < 8; ronda++) {
    const conStock = ronda % 2 === 0
    const v = await producto('Carrera')
    if (conStock) await entradaSuelta(v, 5)
    await activar(v)
    const [d, e] = await Promise.allSettled([desactivar(v), entrada(v, [{ codigo: `R${ronda}`, vencimiento: '2027-09-09', cantidad: 2 }])])
    const lleva = (await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } })) === 1
    if (d.status === 'fulfilled') {
      assert.equal(lleva, false, `ronda ${ronda}: deshizo`)
      assert.equal(e.status, 'rejected', `ronda ${ronda}: la entrada con lotes no cabe en un producto sin lotes`)
      assert.equal((e as PromiseRejectedResult).reason.codigo, 'LOTES_NO_APLICAN')
      assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 0)
    } else {
      assert.equal((d.reason as { codigo?: string }).codigo, 'DESACTIVAR_CON_HISTORIAL', `ronda ${ronda}: ${String(d.reason)}`)
      assert.equal(e.status, 'fulfilled', `ronda ${ronda}`)
      assert.equal(lleva, true)
    }
    const nivel = await prisma.inventoryLevel.findFirst({ where: { catalogVariantId: v, locationId: ctx.suc1 } })
    assert.equal(nivel?.onHand ?? 0, (conStock ? 5 : 0) + (d.status === 'fulfilled' ? 0 : 2))
    await verificarLotes(v)
  }
})

test('11 · un producto que nunca llevó lotes: deshacer no hace nada; uno de otra empresa no se toca', async () => {
  const v = await producto('Sin lotes')
  await entradaSuelta(v, 3)
  assert.equal((await desactivar(v)).repetido, true)
  const w = await productoConLotes(2, 2)
  await assert.rejects(enB((tx) => desactivarLotesEnTx(tx, ctx.b, { varianteId: w }, como(ctx.usuario))), (e: unknown) => (e as { codigo?: string }).codigo === 'VARIANTE_NO_ENCONTRADA' || /no existe|no encontr/i.test(String((e as Error).message)))
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: w } }), 1)
})

test('12 · la lectura de la historia de un producto: solo la suya, de la más reciente a la más antigua, con quién la hizo', async () => {
  const v = await productoConLotes(6, 4)
  const w = await productoConLotes(3, 3)
  const id = await idsDeLotes(v)
  const idw = await idsDeLotes(w)
  await corregir(id.A, '2027-08-01', 'primera')
  await corregir(idw.A, '2027-08-02', 'de otro producto')
  await corregir(id.B, '2027-10-10', 'segunda')
  await corregir(id.A, '2027-08-03', 'tercera')
  const cambios = await enA((tx) => cambiosDeVencimientoEnTx(tx, ctx.a, v))
  assert.deepEqual(cambios.map((c) => [c.loteCodigo, c.motivo, c.anterior, c.nuevo]), [['A', 'tercera', '2027-08-01', '2027-08-03'], ['B', 'segunda', '2027-09-01', '2027-10-10'], ['A', 'primera', '2027-07-01', '2027-08-01']])
  assert.ok(cambios.every((c) => c.usuarioNombre === 'Encargado'))
  assert.deepEqual((await enA((tx) => cambiosDeVencimientoEnTx(tx, ctx.a, w))).map((c) => c.motivo), ['de otro producto'])
  assert.deepEqual(await enB((tx) => cambiosDeVencimientoEnTx(tx, ctx.b, v)), [], 'otra empresa no lee la historia ajena')
})
