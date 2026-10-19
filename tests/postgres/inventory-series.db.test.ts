import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import {
  activarLotesEnTx,
  ajustarEnTx,
  asignarSeriesEnTx,
  corregirVencimientoLoteEnTx,
  danarEnTx,
  desactivarLotesEnTx,
  moverEntreLotesEnTx,
  recibirEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  transferirEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import { cancelarOrdenEnTx, crearProveedorEnTx, guardarOrdenEnTx, pedirOrdenEnTx, recibirOrdenEnTx } from '../../src/modules/inventory/compras-service'
import { lotesDeVarianteEnTx } from '../../src/modules/inventory/lotes-queries'
import { buscarSeriesEnTx } from '../../src/modules/inventory/series-queries'

/**
 * INV-5c · SERIES contra PostgreSQL de verdad, con el servicio real. Una serie es UN lote de UNA unidad:
 *
 *  · activar con series (sin vencimiento; la bandera no cambia después) y lo que había queda en el «SIN LOTE» legado;
 *  · las entradas (entrada de mercancía, orden de compra, sobrante) traen un número de serie por unidad, sin repetir, sin vencimiento;
 *  · UNA SERIE, UNA UNIDAD: no puede estar con unidades en dos sitios (ni en dos sucursales, ni dos veces) y la base lo vigila aun si
 *    dos entradas llegan a la vez; una serie que ya salió (vendida) puede volver a entrar;
 *  · se vende primero lo «SIN SERIE» y luego la serie más antigua; dañar / transferir / apartar por serie;
 *  · «Asignar series» le pone número a lo que ya había (dos ajustes por reasignación, el total no cambia);
 *  · una serie no se mueve entre lotes ni se le corrige un vencimiento que no tiene;
 *  · la búsqueda de una serie dice de qué producto es, dónde está y su historia (y solo de SU empresa).
 *
 * Las fechas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`). `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
const AHORA = new Date('2027-06-15T16:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', proveedor: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
async function producto(nombre = 'Serie'): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `SE-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
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

const activarSeries = (v: string) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, series: true, ahora: AHORA }, como(ctx.usuario)))
const activarLotes = (v: string) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, ahora: AHORA }, como(ctx.usuario)))
type LoteForm = { codigo: string; vencimiento?: string | null; cantidad: number }
const serie = (codigo: string): LoteForm => ({ codigo, cantidad: 1 })
const entradaSeries = (v: string, series: string[], sucursalId = ctx.suc1, extra: { cantidad?: number; clave?: string } = {}) =>
  enA((tx) =>
    registrarEntradaMultipleEnTx(
      tx,
      ctx.a,
      { sucursalId, lineas: [{ varianteId: v, cantidad: extra.cantidad ?? series.length, lotes: series.map(serie) }], idempotencyKey: extra.clave, ahora: AHORA },
      como(ctx.usuario)
    )
  )
const entradaSuelta = (v: string, cantidad: number, sucursalId = ctx.suc1) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId, cantidad }, como(ctx.usuario)))
const vender = (v: string, cantidad: number, sucursalId = ctx.suc1, lotesSalida?: unknown) =>
  enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId, cantidad, ahora: AHORA, lotesSalida }, como(ctx.usuario)))
const asignar = (v: string, series: unknown[], extra: { sucursalId?: string; clave?: string } = {}) =>
  enA((tx) => asignarSeriesEnTx(tx, ctx.a, { varianteId: v, sucursalId: extra.sucursalId ?? ctx.suc1, series: series as string[], idempotencyKey: extra.clave, ahora: AHORA }, como(ctx.usuario)))

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
const idDeLote = async (v: string, codigo: string) => (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: codigo }, select: { id: true } })).id
/** Las unidades de una serie en TODAS las sucursales (vendibles + dañadas): nunca más de una. */
async function unidadesDe(v: string, codigo: string): Promise<number> {
  const bs = await prisma.inventoryLotBalance.findMany({ where: { lot: { catalogVariantId: v, code: codigo } }, select: { onHand: true, damaged: true } })
  return bs.reduce((s, b) => s + b.onHand + b.damaged, 0)
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
  const mk = (x: string) => prisma.company.create({ data: { name: `Series ${x} ${sufijo}`, slug: `series-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-ser-${sufijo}`, email: `ser-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
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
        'inventory_purchase_order_lines',
        'inventory_purchase_orders',
        'inventory_variant_suppliers',
        'inventory_suppliers',
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

// ── Activar con series ───────────────────────────────────────────────────────

test('1 · activar con series: la bandera queda, lo que había pasa al legado, no se pide vencimiento y la bandera no cambia después', async () => {
  const v = await producto('Activar')
  await entradaSuelta(v, 5)
  assert.equal(await codigoDe(enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, series: true, exigirVencimiento: true, ahora: AHORA }, como(ctx.usuario)))), 'SERIES_SIN_VENCIMIENTO')
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0, 'lo rechazado no activó nada')

  const r = await activarSeries(v)
  assert.equal(r.repetido, false)
  assert.equal(r.unidades, 5)
  const t = await prisma.inventoryLotTracking.findFirstOrThrow({ where: { catalogVariantId: v } })
  assert.equal(t.tracksSerials, true)
  assert.equal(t.requiresExpiry, false)
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 5 })
  const vista = await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, v, AHORA))
  assert.equal(vista.series, true)
  assert.equal(vista.lleva, true)

  // La base misma: una serie no exige vencimiento y la bandera es inmutable.
  assert.match(await mensajeDe(prisma.$executeRaw`UPDATE "inventory_lot_tracking" SET "requiresExpiry" = true WHERE "id" = ${t.id}`), /serie|check|inventory_lot_tracking/i)
  assert.match(await mensajeDe(prisma.$executeRaw`UPDATE "inventory_lot_tracking" SET "tracksSerials" = false WHERE "id" = ${t.id}`), /tracksSerials|inmutable|immutable|solo|series/i)
  const despues = await prisma.inventoryLotTracking.findFirstOrThrow({ where: { catalogVariantId: v } })
  assert.equal(despues.tracksSerials, true)
  assert.equal(despues.requiresExpiry, false)

  // Un producto con lotes (no series) sigue como siempre.
  const w = await producto('Lotes')
  await activarLotes(w)
  assert.equal((await prisma.inventoryLotTracking.findFirstOrThrow({ where: { catalogVariantId: w } })).tracksSerials, false)
})

// ── Entradas con series ──────────────────────────────────────────────────────

test('2 · una entrada con series crea un lote de UNA unidad por serie, y se rechaza lo que no es una serie', async () => {
  const v = await producto('Entrada')
  await activarSeries(v)
  const r = await entradaSeries(v, ['sn-001', 'SN-002', ' sn-003 '])
  assert.ok(r)
  assert.deepEqual(enMano(await lotesDe(v)), { 'SN-001': 1, 'SN-002': 1, 'SN-003': 1 })
  assert.equal((await nivelDe(v)).onHand, 3)
  await verificarLotes(v)
  for (const c of ['SN-001', 'SN-002', 'SN-003']) assert.equal(await unidadesDe(v, c), 1)
  const lote = await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'SN-001' } })
  assert.equal(lote.expiresOn, null)
  assert.equal(lote.legacy, false)

  const linea = (lotes: LoteForm[], cantidad: number) => enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad, lotes }], ahora: AHORA }, como(ctx.usuario)))
  assert.equal(await codigoDe(linea([serie('X-1'), serie('X-1')], 2)), 'SERIE_REPETIDA')
  assert.equal(await codigoDe(linea([serie('X-2'), serie('X-3')], 3)), 'LOTES_NO_CUADRAN')
  assert.equal(await codigoDe(linea([{ codigo: 'SIN LOTE', cantidad: 1 }], 1)), 'SERIE_REQUERIDA')
  assert.equal(await codigoDe(linea([{ codigo: 'X-4', cantidad: 2 }], 2)), 'SERIE_NO_ES_UNA')
  assert.equal(await codigoDe(linea([{ codigo: 'X-5', cantidad: 1, vencimiento: '2027-12-01' }], 1)), 'SERIE_CON_VENCIMIENTO')
  assert.equal(await codigoDe(linea([{ codigo: 'X,6', cantidad: 1 }], 1)), 'SERIE_INVALIDA')
  assert.equal(await codigoDe(linea([], 1)), 'SERIES_FALTAN')
  assert.equal(await codigoDe(enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 2 }], ahora: AHORA }, como(ctx.usuario)))), 'SERIES_FALTAN')
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v, code: { startsWith: 'X' } } }), 0, 'lo rechazado no dejó series a medias')
  assert.equal((await nivelDe(v)).onHand, 3)
})

test('3 · una serie es UNA unidad: no entra dos veces ni en dos sucursales; si ya salió, puede volver', async () => {
  const v = await producto('Unica')
  await activarSeries(v)
  await entradaSeries(v, ['U-1', 'U-2'])
  assert.equal(await codigoDe(entradaSeries(v, ['U-1'])), 'SERIE_YA_EXISTE', 'la misma serie otra vez, en la misma sucursal')
  const msg = await mensajeDe(entradaSeries(v, ['U-2'], ctx.suc2))
  assert.match(msg, /U-2/)
  assert.match(msg, /Principal/, 'dice dónde está')
  assert.equal(await codigoDe(entradaSeries(v, ['U-2'], ctx.suc2)), 'SERIE_YA_EXISTE', 'la misma serie en otra sucursal')
  // También por un sobrante / una entrada suelta con lote.
  assert.equal(await codigoDe(enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc2, cambio: 1, lotes: [serie('U-1')], motivo: 'Apareció' }, como(ctx.usuario)))), 'SERIE_YA_EXISTE')
  assert.equal(await unidadesDe(v, 'U-1'), 1)
  assert.equal(await unidadesDe(v, 'U-2'), 1)

  // Una serie dañada sigue siendo una unidad que está en el inventario.
  const idU1 = await idDeLote(v, 'U-1')
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, motivo: 'Se cayó', lotesSalida: [{ loteId: idU1, cantidad: 1 }] }, como(ctx.usuario)))
  assert.equal((await lotesDe(v))['U-1'].damaged, 1)
  assert.equal(await codigoDe(entradaSeries(v, ['U-1'], ctx.suc2)), 'SERIE_YA_EXISTE', 'dañada también cuenta')

  // Vendida (ya no está): puede volver a entrar (una devolución del cliente, un arreglo).
  await vender(v, 1, ctx.suc1, [{ loteId: await idDeLote(v, 'U-2'), cantidad: 1 }])
  assert.equal(await unidadesDe(v, 'U-2'), 0)
  await entradaSeries(v, ['U-2'], ctx.suc2)
  assert.equal(await unidadesDe(v, 'U-2'), 1)
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'U-2': 1 })
  await verificarLotes(v)
})

test('4 · la BASE vigila «una serie, una unidad» aunque dos entradas lleguen a la vez', async () => {
  const v = await producto('Carrera')
  await activarSeries(v)
  const resultados = await Promise.allSettled([entradaSeries(v, ['RACE-1'], ctx.suc1), entradaSeries(v, ['RACE-1'], ctx.suc2)])
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1, 'solo una de las dos entra')
  assert.equal(await unidadesDe(v, 'RACE-1'), 1)
  await verificarLotes(v)

  // Y directo en la base: con dos unidades escritas a mano (sin disparadores), la regla de la serie las rechaza; con una, no dice nada.
  const id = await idDeLote(v, 'RACE-1')
  const saldo = await prisma.inventoryLotBalance.findFirstOrThrow({ where: { lotId: id, onHand: 1 }, select: { id: true } })
  await prisma.$queryRaw`SELECT inventory_serial_comprobar(${id})::text AS r`
  const msg = await mensajeDe(
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRaw`UPDATE "inventory_lot_balances" SET "onHand" = 2 WHERE "id" = ${saldo.id}`
      await tx.$queryRaw`SELECT inventory_serial_comprobar(${id})::text AS r`
    })
  )
  assert.match(msg, /inventory_serials_unica/)
  assert.equal(await unidadesDe(v, 'RACE-1'), 1, 'la transacción se deshizo: la serie sigue siendo una unidad')
})

// ── Vender, apartar, dañar, transferir ───────────────────────────────────────

test('5 · se vende primero lo «SIN LOTE» y luego la serie más antigua; se puede elegir una serie', async () => {
  const v = await producto('Orden')
  await entradaSuelta(v, 2)
  await activarSeries(v)
  await entradaSeries(v, ['O-A'])
  await new Promise((r) => setTimeout(r, 15))
  await entradaSeries(v, ['O-B'])
  await new Promise((r) => setTimeout(r, 15))
  await entradaSeries(v, ['O-C'])
  await vender(v, 3)
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 0, 'O-A': 0, 'O-B': 1, 'O-C': 1 }, 'primero el legado, luego la más antigua')
  // Elegir una serie concreta.
  await vender(v, 1, ctx.suc1, [{ loteId: await idDeLote(v, 'O-C'), cantidad: 1 }])
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 0, 'O-A': 0, 'O-B': 1, 'O-C': 0 })
  // Pedir dos unidades de una serie no se puede (ni siquiera hay dos).
  assert.notEqual(await codigoDe(vender(v, 2, ctx.suc1, [{ loteId: await idDeLote(v, 'O-B'), cantidad: 2 }])), 'SIN_ERROR')
  await verificarLotes(v)
})

test('6 · apartar una unidad aparta la serie más antigua y la deja sin vender', async () => {
  const v = await producto('Apartar')
  await activarSeries(v)
  await entradaSeries(v, ['AP-1', 'AP-2'])
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, ahora: AHORA }, como(ctx.usuario)))
  assert.ok(r.reservaId)
  const lotes = await lotesDe(v)
  const apartada = Object.entries(lotes).filter(([, x]) => x.reserved === 1).map(([c]) => c)
  assert.equal(apartada.length, 1)
  // Lo apartado no se vende: solo queda la otra serie.
  await vender(v, 1)
  assert.equal(await codigoDe(vender(v, 1)), 'STOCK_INSUFICIENTE')
  await verificarLotes(v)
})

test('7 · transferir una serie la lleva a la otra sucursal y sigue siendo una sola unidad', async () => {
  const v = await producto('Transferir')
  await activarSeries(v)
  await entradaSeries(v, ['TR-1', 'TR-2'])
  const id = await idDeLote(v, 'TR-2')
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 1, lotes: [{ loteId: id, cantidad: 1 }], ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { 'TR-1': 1, 'TR-2': 0 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'TR-2': 1 })
  assert.equal(await unidadesDe(v, 'TR-2'), 1)
  // Una transferencia sin elegir saca la más antigua.
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 1, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'TR-1': 1, 'TR-2': 1 })
  await verificarLotes(v)
})

// ── Asignar series a lo que ya había ─────────────────────────────────────────

test('8 · asignar series: salen del «SIN LOTE» de la sucursal, el total no cambia y deja dos ajustes de reasignación', async () => {
  const v = await producto('Asignar')
  await entradaSuelta(v, 5)
  await entradaSuelta(v, 2, ctx.suc2)
  await activarSeries(v)
  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const r = await asignar(v, ['AS-1', 'as-2', 'AS-3'])
  assert.equal(r.asignadas, 3)
  assert.equal(r.repetido, false)
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 2, 'AS-1': 1, 'AS-2': 1, 'AS-3': 1 })
  assert.equal((await nivelDe(v)).onHand, 5, 'el total de la sucursal no cambió')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'SIN LOTE': 2 }, 'la otra sucursal no se tocó')
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }) - antes, 2, 'un par de ajustes, no uno por serie')
  const movs = await prisma.inventoryMovement.findMany({ where: { id: { in: [r.salidaId, r.entradaId] } }, select: { type: true, reasonCode: true, quantity: true, sourceBucket: true, destinationBucket: true } })
  assert.equal(movs.length, 2)
  for (const m of movs) {
    assert.equal(m.type, 'ADJUSTMENT')
    assert.equal(m.quantity, 3)
    assert.equal(m.reasonCode, 'LOT_REASSIGN')
  }
  await verificarLotes(v)
  const nivel8 = await nivelDe(v)
  const bitacora = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: nivel8.id, accion: 'INVENTORY_STOCK_CHANGED' } })
  assert.equal(bitacora.filter((l) => (l.payload as { tipo?: string; cantidad?: number } | null)?.tipo === 'SERIES_ASSIGN').length, 1, 'asignar series deja rastro en la bitácora')
  // La misma operación con la misma clave devuelve lo mismo; con otras series, es otra operación.
  const c1 = await asignar(v, ['AS-4'], { clave: `asig-${sufijo}-1` })
  const c2 = await asignar(v, ['AS-4'], { clave: `asig-${sufijo}-1` })
  assert.equal(c1.repetido, false)
  assert.equal(c2.repetido, true)
  assert.equal(c2.entradaId, c1.entradaId)
  assert.equal(await codigoDe(asignar(v, ['AS-5'], { clave: `asig-${sufijo}-1` })), 'CLAVE_REUTILIZADA')
  assert.deepEqual(enMano(await lotesDe(v)), { 'SIN LOTE': 1, 'AS-1': 1, 'AS-2': 1, 'AS-3': 1, 'AS-4': 1 })
  await verificarLotes(v)
})

test('9 · asignar series rechaza lo que no se puede, sin dejar nada a medias', async () => {
  const v = await producto('AsignarMal')
  await entradaSuelta(v, 2)
  await activarSeries(v)
  await entradaSeries(v, ['AM-1'])
  const foto = async () => ({ movs: await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), lotes: await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), mano: enMano(await lotesDe(v)) })
  const f0 = await foto()
  assert.equal(await codigoDe(asignar(v, ['AM-9', 'AM-8', 'AM-7'])), 'STOCK_INSUFICIENTE', 'solo hay 2 sin serie')
  assert.equal(await codigoDe(asignar(v, ['AM-1'])), 'SERIE_YA_EXISTE')
  assert.equal(await codigoDe(asignar(v, ['AM-6', 'am-6'])), 'SERIE_REPETIDA')
  assert.equal(await codigoDe(asignar(v, [])), 'SERIES_FALTAN')
  assert.equal(await codigoDe(asignar(v, ['SIN LOTE'])), 'SERIE_REQUERIDA')
  assert.equal(await codigoDe(asignar(v, ['A,B'])), 'SERIE_INVALIDA')
  assert.equal(await codigoDe(asignar(v, Array.from({ length: 201 }, (_, i) => `BIG-${i}`))), 'DEMASIADAS_SERIES')
  assert.equal(await codigoDe(asignar(v, ['AM-5'], { sucursalId: ctx.suc2 })), 'STOCK_INSUFICIENTE', 'en la otra sucursal no hay nada sin serie')
  assert.deepEqual(await foto(), f0, 'nada cambió')

  // Un producto sin series, o con lotes, no asigna series.
  const sinNada = await producto('SinNada')
  await entradaSuelta(sinNada, 2)
  assert.equal(await codigoDe(asignar(sinNada, ['Z-1'])), 'SERIES_NO_APLICAN')
  const conLotes = await producto('ConLotes')
  await entradaSuelta(conLotes, 2)
  await activarLotes(conLotes)
  assert.equal(await codigoDe(asignar(conLotes, ['Z-2'])), 'SERIES_NO_APLICAN')
  // Lo apartado no se asigna: solo lo disponible.
  const w = await producto('Apartado')
  await entradaSuelta(w, 2)
  await activarSeries(w)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: w, sucursalId: ctx.suc1, cantidad: 2, ahora: AHORA }, como(ctx.usuario)))
  assert.equal(await codigoDe(asignar(w, ['W-1'])), 'STOCK_INSUFICIENTE')
})

// ── Lo que una serie no puede hacer ──────────────────────────────────────────

test('10 · una serie no se mueve entre lotes ni tiene vencimiento que corregir', async () => {
  const v = await producto('NoMover')
  await entradaSuelta(v, 2)
  await activarSeries(v)
  await entradaSeries(v, ['NM-1', 'NM-2'])
  const a = await idDeLote(v, 'NM-1')
  const b = await idDeLote(v, 'NM-2')
  assert.equal(await codigoDe(enA((tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, deLoteId: a, aLoteId: b, cantidad: 1 }, como(ctx.usuario)))), 'SERIES_NO_SE_MUEVEN')
  assert.equal(await codigoDe(enA((tx) => corregirVencimientoLoteEnTx(tx, ctx.a, { loteId: a, vencimiento: '2027-12-01', motivo: 'Probar' }, como(ctx.usuario)))), 'SERIE_NO_VENCE')
  assert.equal((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: a } })).expiresOn, null)
  // Y la base tampoco deja ponerle fecha.
  assert.match(await mensajeDe(prisma.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = '2027-12-01' WHERE "id" = ${a}`), /serie|vencimiento|expiresOn|inventory_/i)
  assert.equal((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: a } })).expiresOn, null)
})

// ── Órdenes de compra ────────────────────────────────────────────────────────

test('11 · una orden de compra de un producto con series se recibe con un número de serie por unidad', async () => {
  const v = await producto('Compra')
  await activarSeries(v)
  const o = await enA((tx) => guardarOrdenEnTx(tx, ctx.a, { cabecera: { proveedorId: ctx.proveedor, sucursalId: ctx.suc1 }, lineas: [{ varianteId: v, cantidad: 4, costo: '5' }], ahora: AHORA }, como(ctx.usuario)))
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, ahora: AHORA }, como(ctx.usuario)))
  const recibir = (lotes: LoteForm[], cantidad: number) => enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, ahora: AHORA, lineas: [{ varianteId: v, cantidad, lotes }] }, como(ctx.usuario)))
  assert.equal(await codigoDe(recibir([{ codigo: 'PO-1', cantidad: 2 }], 2)), 'SERIE_NO_ES_UNA')
  assert.equal(await codigoDe(recibir([serie('PO-1'), serie('PO-2')], 3)), 'LOTES_NO_CUADRAN')
  assert.equal((await nivelDe(v).catch(() => null))?.onHand ?? 0, 0, 'lo rechazado no recibió nada')
  await recibir([serie('PO-1'), serie('PO-2')], 2)
  assert.deepEqual(enMano(await lotesDe(v)), { 'PO-1': 1, 'PO-2': 1 })
  assert.equal(await codigoDe(recibir([serie('PO-2'), serie('PO-3')], 2)), 'SERIE_YA_EXISTE', 'una serie ya recibida no se recibe otra vez')
  await recibir([serie('PO-3'), serie('PO-4')], 2)
  assert.deepEqual(enMano(await lotesDe(v)), { 'PO-1': 1, 'PO-2': 1, 'PO-3': 1, 'PO-4': 1 })
  await verificarLotes(v)
  await enA((tx) => cancelarOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, ahora: AHORA }, como(ctx.usuario))).catch(() => undefined)
})

// ── Deshacer la activación ───────────────────────────────────────────────────

test('12 · se puede deshacer la activación de series mientras no haya movimientos con series, y volver a activar como lotes', async () => {
  const v = await producto('Deshacer')
  await entradaSuelta(v, 3)
  await activarSeries(v)
  const r = await enA((tx) => desactivarLotesEnTx(tx, ctx.a, { varianteId: v }, como(ctx.usuario)))
  assert.equal(r.repetido, false)
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: v } }), 0)
  assert.equal((await nivelDe(v)).onHand, 3)
  await activarLotes(v)
  assert.equal((await prisma.inventoryLotTracking.findFirstOrThrow({ where: { catalogVariantId: v } })).tracksSerials, false)

  // Con una serie ya recibida, no.
  const w = await producto('NoDeshacer')
  await activarSeries(w)
  await entradaSeries(w, ['ND-1'])
  assert.equal(await codigoDe(enA((tx) => desactivarLotesEnTx(tx, ctx.a, { varianteId: w }, como(ctx.usuario)))), 'DESACTIVAR_CON_HISTORIAL')
})

// ── Buscar una serie ─────────────────────────────────────────────────────────

test('13 · buscar una serie dice de qué producto es, dónde está y su historia, y solo de SU empresa', async () => {
  const v = await producto('Buscar')
  await activarSeries(v)
  await entradaSeries(v, ['BUS-100', 'BUS-200'])
  const id = await idDeLote(v, 'BUS-100')
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 1, lotes: [{ loteId: id, cantidad: 1 }], ahora: AHORA }, como(ctx.usuario)))
  await vender(v, 1, ctx.suc1)

  const exacta = await enA((tx) => buscarSeriesEnTx(tx, ctx.a, 'bus-100'))
  assert.equal(exacta.consulta, 'BUS-100')
  assert.equal(exacta.series.length, 1)
  const s = exacta.series[0]
  assert.equal(s.varianteId, v)
  assert.deepEqual(s.ubicaciones.map((u) => [u.sucursal, u.disponible, u.danada]), [['Norte', 1, 0]])
  // Historia: entró (compra), salió del origen (transferencia) y entró al destino.
  assert.deepEqual(s.historia.map((p) => p.tipo).sort(), ['PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT'])
  assert.ok(s.historia.every((p, i, todos) => i === 0 || todos[i - 1].fecha >= p.fecha), 'de lo más reciente a lo más antiguo')

  // Por parte del número, y la vendida ya no está en ningún sitio pero conserva su historia.
  const parcial = await enA((tx) => buscarSeriesEnTx(tx, ctx.a, 'BUS-'))
  assert.deepEqual(parcial.series.map((x) => x.serie).sort(), ['BUS-100', 'BUS-200'])
  const vendida = parcial.series.find((x) => x.ubicaciones.length === 0)
  assert.ok(vendida, 'una de las dos se vendió')
  assert.ok(vendida.historia.some((p) => p.tipo === 'SALE'))

  // Una serie dañada sigue en la sucursal (como dañada); y la que coincide exactamente va primero aunque otra se ordene antes.
  await entradaSeries(v, ['AX-5', 'X-5', 'BUS-300'])
  const idDanada = await idDeLote(v, 'BUS-300')
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, motivo: 'Se cayó', lotesSalida: [{ loteId: idDanada, cantidad: 1 }] }, como(ctx.usuario)))
  const bus300 = (await enA((tx) => buscarSeriesEnTx(tx, ctx.a, 'BUS-300'))).series[0]
  assert.deepEqual(bus300.ubicaciones.map((u) => [u.sucursal, u.disponible, u.danada]), [['Principal', 0, 1]], 'dañada sigue en la sucursal')
  assert.deepEqual((await enA((tx) => buscarSeriesEnTx(tx, ctx.a, 'x-5'))).series.map((x) => x.serie), ['X-5', 'AX-5'], 'la exacta primero')

  // Otra empresa no la ve; y sin texto no devuelve nada.
  assert.equal((await enB((tx) => buscarSeriesEnTx(tx, ctx.b, 'BUS-'))).series.length, 0)
  assert.equal((await enA((tx) => buscarSeriesEnTx(tx, ctx.a, '  '))).series.length, 0)
  // Un producto con LOTES no aparece aunque su lote se parezca.
  const w = await producto('BuscarLotes')
  await activarLotes(w)
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: w, cantidad: 2, lotes: [{ codigo: 'BUS-LOTE', cantidad: 2 }] }], ahora: AHORA }, como(ctx.usuario)))
  assert.equal((await enA((tx) => buscarSeriesEnTx(tx, ctx.a, 'BUS-LOTE'))).series.length, 0)
})

test('14 · la regla de la base por dentro: cuenta lo dañado, rechaza el vencimiento, se turna por serie y vive en disparadores diferidos', async () => {
  const v = await producto('Regla')
  await activarSeries(v)
  await entradaSeries(v, ['RG-1'])
  const id = await idDeLote(v, 'RG-1')
  const saldo = await prisma.inventoryLotBalance.findFirstOrThrow({ where: { lotId: id, onHand: 1 }, select: { id: true } })
  const comprobar = (tx: Transaccion) => tx.$queryRaw`SELECT inventory_serial_comprobar(${id})::text AS r`

  // Una unidad vendible MÁS una dañada de la misma serie son dos unidades (la dañada sigue en el inventario).
  const danada = await mensajeDe(
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRaw`UPDATE "inventory_lot_balances" SET "damaged" = 1 WHERE "id" = ${saldo.id}`
      await comprobar(tx)
    })
  )
  assert.match(danada, /inventory_serials_unica/)
  // Una serie con fecha de vencimiento no vale (aunque tenga una sola unidad).
  const vence = await mensajeDe(
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRaw`UPDATE "inventory_lots" SET "expiresOn" = '2027-12-01' WHERE "id" = ${id}`
      await comprobar(tx)
    })
  )
  assert.match(vence, /inventory_serials_vencimiento/)
  assert.equal(await unidadesDe(v, 'RG-1'), 1)
  assert.equal((await prisma.inventoryLot.findUniqueOrThrow({ where: { id } })).expiresOn, null, 'las dos pruebas se deshicieron')

  // Se turnan por serie: mientras otra transacción tiene el candado de ESA serie, comprobarla espera (y de otra serie, no).
  const otra = await idDeLote(v, 'RG-1')
  const candado = await mensajeDe(
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'inventory_serial:' + id}, 0))::text AS r`
        // Otra conexión intenta comprobar la misma serie y no puede avanzar mientras esta tiene el candado.
        await prisma.$transaction(async (t2) => {
          await t2.$executeRawUnsafe("SET LOCAL statement_timeout = '400ms'")
          await t2.$queryRaw`SELECT inventory_serial_comprobar(${otra})::text AS r`
        })
      },
      { timeout: 20_000 }
    )
  )
  assert.match(candado, /statement timeout|canceling statement|timeout/i, 'comprobar una serie espera al candado de esa serie')

  // La regla vive en disparadores DIFERIDOS que miran los saldos (al insertar y al cambiar lo vendible o lo dañado) y los lotes.
  const defs = await prisma.$queryRaw<{ nombre: string; def: string }[]>`
    SELECT tgname AS nombre, pg_get_triggerdef(oid) AS def FROM pg_trigger
     WHERE tgname IN ('inventory_lot_balances_serie_unica', 'inventory_lots_serie_unica') AND NOT tgisinternal ORDER BY tgname`
  assert.equal(defs.length, 2)
  const saldos = defs.find((d) => d.nombre === 'inventory_lot_balances_serie_unica')!.def
  assert.match(saldos, /AFTER INSERT OR UPDATE OF "onHand", damaged ON (public\.)?inventory_lot_balances/)
  assert.match(saldos, /DEFERRABLE INITIALLY DEFERRED/)
  const lotes = defs.find((d) => d.nombre === 'inventory_lots_serie_unica')!.def
  assert.match(lotes, /AFTER INSERT OR UPDATE OF "expiresOn" ON (public\.)?inventory_lots/)
  assert.match(lotes, /DEFERRABLE INITIALLY DEFERRED/)
})
