import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import {
  activarLotesEnTx,
  cancelarTrasladoEnTx,
  enviarTrasladoEnTx,
  recibirEnTx,
  recibirTrasladoEnTx,
  registrarEntradaMultipleEnTx,
  transferirEnTx,
} from '../../src/modules/inventory/service'
import { trasladoDetalleEnTx } from '../../src/modules/inventory/queries'
import { lotesDeTrasladoEnTx } from '../../src/modules/inventory/lotes-queries'
import { trasladoToCsv } from '../../src/modules/inventory/exportacion'

/**
 * INV-5b4 · LOTES EN TRANSFERENCIAS contra PostgreSQL de verdad, con el servicio real.
 *
 * Una transferencia (directa o con envío) de un producto con lotes sale del origen lote por lote —el que antes vence, o los que se
 * elijan— y entra al destino en esos MISMOS lotes. El estado por lote de una transferencia (enviado, recibido, devuelto, en camino) NO
 * se guarda: sale del ledger, que es inmutable. Lo que solo se comprueba aquí:
 *
 *  · la transferencia directa y el envío reparten por FEFO o por lo elegido, y cada saldo por lote del origen y del destino cuadra;
 *  · que un lote al que le falta lo pedido, un lote de otro producto, lotes que no suman o lotes en un producto que no los lleva
 *    rechazan TODO el envío antes de mover nada (y sin gastar el número);
 *  · recibir por lote, en tandas; el tope por lote (no se recibe de un lote más de lo que de él sigue en camino); recibir sin decir el
 *    lote cuando hay duda; cerrar con faltante; cancelar devolviendo cada lote a su sitio;
 *  · que una clave repetida con los mismos lotes es un reintento y con otros lotes, no;
 *  · que dos recepciones o una recepción y una cancelación simultáneas no pasan de lo enviado de ningún lote;
 *  · que un producto sin lotes y uno con lotes viajan juntos en el mismo envío.
 *
 * Las fechas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`). `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
/** 12:00 en Santo Domingo del 15-jun-2027. */
const AHORA = new Date('2027-06-15T16:00:00.000Z')
/** Una semana después: lo que vence entre medias ya está vencido. */
const SEMANA_DESPUES = new Date('2027-06-22T16:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', otro: '', suc1: '', suc2: '', suc3: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
/** Un producto físico ACTIVO de la empresa A. Devuelve su variante. */
async function producto(nombre = 'Traslado'): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `TL-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
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

const activar = (v: string, exigirVencimiento = false) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, exigirVencimiento, ahora: AHORA }, como(ctx.usuario)))

type LoteEntrante = { codigo: string; vencimiento?: string | null; cantidad: number }
const entrada = (v: string, lotes: LoteEntrante[], sucursalId = ctx.suc1) =>
  enA((tx) =>
    registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId: v, cantidad: lotes.reduce((s, l) => s + l.cantidad, 0), lotes }], ahora: AHORA }, como(ctx.usuario))
  )
const entradaSuelta = (v: string, cantidad: number, sucursalId = ctx.suc1) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId, cantidad }, como(ctx.usuario)))

/** Un producto con lotes A (vence 2027-07-01) y B (2027-09-01) en la sucursal 1: el orden FEFO es A, luego B. */
async function productoConLotes(a = 6, b = 4, extra: LoteEntrante[] = []): Promise<string> {
  const v = await producto('Con lotes')
  await activar(v)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-07-01', cantidad: a }, { codigo: 'B', vencimiento: '2027-09-01', cantidad: b }, ...extra])
  return v
}

const idsDeLotes = async (v: string): Promise<Record<string, string>> =>
  Object.fromEntries((await prisma.inventoryLot.findMany({ where: { catalogVariantId: v }, select: { id: true, code: true } })).map((l) => [l.code, l.id]))

async function nivelDe(v: string, sucursalId = ctx.suc1) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
}
const existencia = async (v: string, sucursalId: string) => (await prisma.inventoryLevel.findUnique({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } }))?.onHand ?? 0

type Cubetas3 = { onHand: number; reserved: number; damaged: number }
/** Lo que hay de cada lote (por código) en una sucursal. */
async function lotesDe(v: string, sucursalId = ctx.suc1): Promise<Record<string, Cubetas3>> {
  const nivel = await prisma.inventoryLevel.findUnique({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
  if (!nivel) return {}
  const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: nivel.id }, select: { onHand: true, reserved: true, damaged: true, lot: { select: { code: true } } } })
  return Object.fromEntries(bs.map((b) => [b.lot.code, { onHand: b.onHand, reserved: b.reserved, damaged: b.damaged }]))
}
const enMano = (m: Record<string, Cubetas3>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.onHand]))

/** Los lotes suman el saldo de cada sucursal (las tres cubetas): la red de la base, vista desde fuera. */
async function verificarLotes(v: string): Promise<void> {
  const niveles = await prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, select: { id: true, onHand: true, reserved: true, damaged: true } })
  for (const n of niveles) {
    const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: n.id }, select: { onHand: true, reserved: true, damaged: true } })
    const suma = bs.reduce((t, b) => ({ onHand: t.onHand + b.onHand, reserved: t.reserved + b.reserved, damaged: t.damaged + b.damaged }), { onHand: 0, reserved: 0, damaged: 0 })
    assert.deepEqual(suma, { onHand: n.onHand, reserved: n.reserved, damaged: n.damaged }, 'los lotes suman el saldo de la sucursal')
  }
}

/** De qué lotes (por código) es cada movimiento de un saldo, en orden. */
async function repartosDe(v: string, sucursalId: string, tipo: 'TRANSFER_OUT' | 'TRANSFER_IN'): Promise<Array<{ cantidad: number; lotes: Record<string, number> }>> {
  const nivel = await nivelDe(v, sucursalId)
  const ms = await prisma.inventoryMovement.findMany({ where: { inventoryLevelId: nivel.id, type: tipo }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, quantity: true } })
  const out = []
  for (const m of ms) {
    const rs = await prisma.inventoryMovementLot.findMany({ where: { movementId: m.id }, select: { quantity: true, balance: { select: { lot: { select: { code: true } } } } } })
    out.push({ cantidad: m.quantity, lotes: Object.fromEntries(rs.map((r) => [r.balance.lot.code, r.quantity])) })
  }
  return out
}

type Linea = { varianteId: string; cantidad: number; lotes?: Array<{ loteId: string; cantidad: number }> }
const transferir = (v: string, cantidad: number, extra: { lotes?: unknown; clave?: string; origen?: string; destino?: string; ahora?: Date } = {}) =>
  enA((tx) =>
    transferirEnTx(
      tx,
      ctx.a,
      { varianteId: v, origenId: extra.origen ?? ctx.suc1, destinoId: extra.destino ?? ctx.suc2, cantidad, lotes: extra.lotes, idempotencyKey: extra.clave, ahora: extra.ahora ?? AHORA },
      como(ctx.usuario)
    )
  )
const enviar = (lineas: Linea[], extra: { clave?: string; origen?: string; destino?: string; ahora?: Date } = {}) =>
  enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: extra.origen ?? ctx.suc1, destinoId: extra.destino ?? ctx.suc2, lineas, idempotencyKey: extra.clave, ahora: extra.ahora ?? AHORA }, como(ctx.usuario)))
const recibir = (trasladoId: string, extra: Partial<Parameters<typeof recibirTrasladoEnTx>[2]> = {}) =>
  enA((tx) => recibirTrasladoEnTx(tx, ctx.a, { trasladoId, ahora: AHORA, ...extra }, como(ctx.otro)))
const cancelar = (trasladoId: string, motivo: string | null = null) => enA((tx) => cancelarTrasladoEnTx(tx, ctx.a, { trasladoId, motivo, ahora: AHORA }, como(ctx.usuario)))
const detalle = (id: string) => enA((tx) => trasladoDetalleEnTx(tx, ctx.a, id))
const lotesDeTraslado = (id: string) => enA((tx) => lotesDeTrasladoEnTx(tx, ctx.a, id))

/** Una foto de lo que NO debe cambiar cuando un envío o una recepción se rechaza. */
async function foto(vs: string[]) {
  return {
    movimientos: await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }),
    repartos: await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a } }),
    traslados: await prisma.inventoryTransfer.count({ where: { companyId: ctx.a } }),
    lotes: await prisma.inventoryLot.count({ where: { companyId: ctx.a } }),
    niveles: await prisma.inventoryLevel.findMany({ where: { catalogVariantId: { in: vs } }, orderBy: [{ catalogVariantId: 'asc' }, { locationId: 'asc' }], select: { onHand: true, reserved: true, damaged: true } }),
  }
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Traslado lotes ${x} ${sufijo}`, slug: `traslado-lotes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-trl-${sufijo}`, email: `trl-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.otro = (await prisma.user.create({ data: { supabaseId: `sb-trl2-${sufijo}`, email: `trl2-${sufijo}@prueba.test`, name: 'Recibe', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.suc3 = (await suc(ctx.a, 'Este')).id
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
  await prisma.user.deleteMany({ where: { id: { in: [ctx.usuario, ctx.otro] } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── La transferencia directa ─────────────────────────────────────────────────

test('1 · transferir DIRECTO sin elegir lotes saca el que antes vence (FEFO) y entra al destino en esos mismos lotes, con su vencimiento', async () => {
  const v = await productoConLotes(6, 4)
  await transferir(v, 8)
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 0, B: 2 }, 'del origen sale A entero y 2 de B')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 6, B: 2 }, 'al destino entran los mismos lotes')
  assert.equal(await existencia(v, ctx.suc1), 2)
  assert.equal(await existencia(v, ctx.suc2), 8)
  assert.deepEqual(await repartosDe(v, ctx.suc1, 'TRANSFER_OUT'), [{ cantidad: 8, lotes: { A: 6, B: 2 } }])
  assert.deepEqual(await repartosDe(v, ctx.suc2, 'TRANSFER_IN'), [{ cantidad: 8, lotes: { A: 6, B: 2 } }])
  // Es el MISMO lote del producto (no se crean lotes nuevos al transferir) y conserva su vencimiento.
  const lotes = await prisma.inventoryLot.findMany({ where: { catalogVariantId: v, code: { in: ['A', 'B'] } }, select: { code: true, expiresOn: true } })
  assert.equal(lotes.length, 2)
  assert.deepEqual(Object.fromEntries(lotes.map((l) => [l.code, l.expiresOn?.toISOString().slice(0, 10)])), { A: '2027-07-01', B: '2027-09-01' })
  await verificarLotes(v)
})

test('2 · transferir DIRECTO eligiendo los lotes: sale de los elegidos (aunque no sean los primeros en vencer) y se rechaza lo que no cuadra sin mover nada', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const otro = await productoConLotes(2, 2)
  const ajeno = (await idsDeLotes(otro)).A
  const antes = await foto([v, otro])
  // Un lote al que le falta lo pedido.
  assert.equal(await codigoDe(transferir(v, 5, { lotes: [{ loteId: id.B, cantidad: 5 }] })), 'STOCK_INSUFICIENTE')
  // Lotes que no suman la cantidad.
  assert.equal(await codigoDe(transferir(v, 5, { lotes: [{ loteId: id.A, cantidad: 3 }] })), 'LOTES_NO_CUADRAN')
  // Un lote que no es de este producto.
  assert.equal(await codigoDe(transferir(v, 1, { lotes: [{ loteId: ajeno, cantidad: 1 }] })), 'LOTE_NO_ENCONTRADO')
  assert.equal(await codigoDe(transferir(v, 1, { lotes: [{ loteId: 'no-existe', cantidad: 1 }] })), 'LOTE_NO_ENCONTRADO')
  // Mal armados.
  assert.equal(await codigoDe(transferir(v, 1, { lotes: 'A' })), 'LOTES_FALTAN', 'no es una lista de lotes (la misma regla que ya usan daño, ajuste y baja)')
  assert.equal(await codigoDe(enviar([{ varianteId: v, cantidad: 1, lotes: 'A' as unknown as Linea['lotes'] }])), 'LOTE_INVALIDO', 'en un envío lo rechaza antes la validación de las líneas')
  assert.equal(await codigoDe(transferir(v, 1, { lotes: [{ loteId: id.A, cantidad: 0 }] })), 'CANTIDAD_INVALIDA')
  assert.deepEqual(await foto([v, otro]), antes, 'lo rechazado no movió nada')
  // Lo elegido: 3 de B y 1 de A (FEFO habría sacado 4 de A).
  await transferir(v, 4, { lotes: [{ loteId: id.B, cantidad: 3 }, { loteId: id.A, cantidad: 1 }] })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 5, B: 1 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 1, B: 3 })
  await verificarLotes(v)
  await verificarLotes(otro)
})

test('3 · FEFO no toca lo vencido, y si lo vendible no alcanza se rechaza diciendo cuánto hay vencido', async () => {
  const v = await producto('Vencido')
  await activar(v)
  await entrada(v, [{ codigo: 'VIEJO', vencimiento: '2027-06-20', cantidad: 5 }, { codigo: 'NUEVO', vencimiento: '2027-12-01', cantidad: 3 }])
  // El 15-jun ambos están vigentes: FEFO saca VIEJO.
  await transferir(v, 2)
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { VIEJO: 2 })
  // El 22-jun VIEJO ya venció: solo hay 3 vendibles (NUEVO), y no se mueve lo vencido.
  assert.equal(await codigoDe(transferir(v, 4, { ahora: SEMANA_DESPUES, destino: ctx.suc3 })), 'STOCK_INSUFICIENTE')
  await transferir(v, 3, { ahora: SEMANA_DESPUES, destino: ctx.suc3 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc3)), { NUEVO: 3 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { VIEJO: 3, NUEVO: 0 }, 'lo vencido se queda en el origen')
  await verificarLotes(v)
})

test('4 · un producto SIN lotes no admite lotes y se transfiere como siempre; la clave repetida es un reintento solo con los mismos lotes', async () => {
  const sin = await producto('Sin lotes')
  await entradaSuelta(sin, 10)
  assert.equal(await codigoDe(transferir(sin, 2, { lotes: [{ loteId: 'x', cantidad: 2 }] })), 'LOTES_NO_APLICAN')
  await transferir(sin, 2)
  assert.equal(await existencia(sin, ctx.suc2), 2)
  assert.equal((await prisma.inventoryMovementLot.count({ where: { balance: { catalogVariantId: sin } } })) + (await prisma.inventoryLotBalance.count({ where: { catalogVariantId: sin } })), 0, 'sin repartos ni saldos por lote')

  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const clave = `trl-${sufijo}-d`
  const uno = await transferir(v, 3, { clave, lotes: [{ loteId: id.B, cantidad: 3 }] })
  assert.equal(uno.repetido, false)
  const dos = await transferir(v, 3, { clave, lotes: [{ loteId: id.B, cantidad: 3 }] })
  assert.equal(dos.repetido, true, 'mismos lotes = reintento')
  assert.equal(await codigoDe(transferir(v, 3, { clave, lotes: [{ loteId: id.A, cantidad: 3 }] })), 'CLAVE_REUTILIZADA', 'otros lotes con la misma clave no es un reintento')
  assert.equal((await transferir(v, 3, { clave })).repetido, true, 'sin decir lotes manda FEFO y reintentar devuelve lo de siempre')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { B: 3 }, 'solo se movió una vez')
  await verificarLotes(v)
})

// ── Enviar ───────────────────────────────────────────────────────────────────

test('5 · enviar saca el lote que antes vence (o los elegidos), deja lo enviado EN TRÁNSITO por lote y viaja junto a un producto sin lotes', async () => {
  const v = await productoConLotes(6, 4)
  const sin = await producto('Sin lotes')
  await entradaSuelta(sin, 10)
  const r = await enviar([
    { varianteId: v, cantidad: 8 },
    { varianteId: sin, cantidad: 3 },
  ])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 0, B: 2 })
  assert.deepEqual(await lotesDe(v, ctx.suc2), {}, 'al destino todavía no llegó nada')
  assert.equal(await existencia(sin, ctx.suc1), 7)
  assert.deepEqual(await repartosDe(v, ctx.suc1, 'TRANSFER_OUT'), [{ cantidad: 8, lotes: { A: 6, B: 2 } }])
  const porLote = (await lotesDeTraslado(r.trasladoId)).get(v)!
  assert.deepEqual(porLote.map((l) => [l.codigo, l.vencimiento, l.enviado, l.recibido, l.devuelto]), [['A', '2027-07-01', 6, 0, 0], ['B', '2027-09-01', 2, 0, 0]])
  assert.equal((await lotesDeTraslado(r.trasladoId)).has(sin), false, 'el producto sin lotes no aparece')
  const d = (await detalle(r.trasladoId))!
  assert.deepEqual(d.detalle.map((l) => [l.enviado, l.pendiente, l.lotes.map((x) => [x.codigo, x.enviado, x.pendiente])]), [[8, 8, [['A', 6, 6], ['B', 2, 2]]], [3, 3, []]])
  assert.equal(d.historial.length, 2)
  assert.deepEqual(d.historial.map((m) => m.lotes).filter(Boolean), ['A ×6, B ×2'], 'el historial dice de qué lotes salió; el producto sin lotes no dice nada')
  await verificarLotes(v)

  // Eligiendo los lotes de OTRO envío del mismo producto: sale de B aunque A tenga fecha anterior.
  const v2 = await productoConLotes(6, 4)
  const id2 = await idsDeLotes(v2)
  const r2 = await enviar([{ varianteId: v2, cantidad: 3, lotes: [{ loteId: id2.B, cantidad: 3 }] }])
  assert.deepEqual(enMano(await lotesDe(v2, ctx.suc1)), { A: 6, B: 1 })
  assert.deepEqual((await lotesDeTraslado(r2.trasladoId)).get(v2)!.map((l) => [l.codigo, l.enviado]), [['B', 3]])
  await verificarLotes(v2)
})

test('6 · TODO O NADA al enviar: un lote sin lo pedido, un lote ajeno, lotes que no suman o lotes en un producto sin lotes rechazan el envío ENTERO, sin mover nada ni gastar el número', async () => {
  const v = await productoConLotes(6, 4)
  const sin = await producto('Sin lotes')
  await entradaSuelta(sin, 10)
  const id = await idsDeLotes(v)
  const otro = await productoConLotes(2, 2)
  const antes = await foto([v, sin, otro])
  const buena: Linea = { varianteId: sin, cantidad: 2 }
  assert.equal(await codigoDe(enviar([buena, { varianteId: v, cantidad: 5, lotes: [{ loteId: id.B, cantidad: 5 }] }])), 'STOCK_INSUFICIENTE')
  assert.equal(await codigoDe(enviar([buena, { varianteId: v, cantidad: 2, lotes: [{ loteId: (await idsDeLotes(otro)).A, cantidad: 2 }] }])), 'LOTE_NO_ENCONTRADO')
  assert.equal(await codigoDe(enviar([buena, { varianteId: v, cantidad: 5, lotes: [{ loteId: id.A, cantidad: 3 }] }])), 'LOTES_NO_CUADRAN')
  assert.equal(await codigoDe(enviar([{ varianteId: sin, cantidad: 2, lotes: [{ loteId: id.A, cantidad: 2 }] }])), 'LOTES_NO_APLICAN')
  assert.equal(await codigoDe(enviar([buena, { varianteId: v, cantidad: 2, lotes: [{ loteId: id.A, cantidad: 2 }, { loteId: id.A, cantidad: 0 }] }])), 'CANTIDAD_INVALIDA')
  assert.deepEqual(await foto([v, sin, otro]), antes, 'nada cambió')
  // Y el número no se gastó: el siguiente envío bueno usa el que sigue al último de la empresa.
  const ultimo = await prisma.inventoryTransfer.findFirst({ where: { companyId: ctx.a }, orderBy: { number: 'desc' }, select: { number: true } })
  const ok = await enviar([buena])
  const n = (t: string | undefined) => Number((t ?? 'TRF-0-0').split('-')[2])
  assert.equal(n(ok.numero), n(ultimo?.number) + 1, 'sin huecos en la numeración')
})

// ── Recibir ──────────────────────────────────────────────────────────────────

test('7 · recibir por lote, en tandas: cada lote llega a su sitio, no se recibe de un lote más de lo que de él sigue en camino, y recibir lo último cierra', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 10 }]) // A 6 + B 4
  const tope = async () => (await lotesDeTraslado(r.trasladoId)).get(v)!.map((l) => [l.codigo, l.enviado, l.recibido, l.devuelto])
  const otro = await productoConLotes(2, 2)

  // Tanda 1: 2 de A y 1 de B.
  const t1 = await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.A, cantidad: 2 }, { loteId: id.B, cantidad: 1 }] }] })
  assert.deepEqual([t1.estado, t1.recibidas, t1.enTransito], ['PARTIAL', 3, 7])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 2, B: 1 })
  assert.deepEqual(await tope(), [['A', 6, 2, 0], ['B', 4, 1, 0]])

  const antes = await foto([v, otro])
  // El tope es POR LOTE: de A faltan 4; recibir 5 de A se rechaza aunque a la línea le falten 7.
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 5, lotes: [{ loteId: id.A, cantidad: 5 }] }] })), 'RECIBE_MAS_DE_LO_ENVIADO')
  // Un lote que no se envió en esta transferencia.
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 1, lotes: [{ loteId: (await idsDeLotes(otro)).A, cantidad: 1 }] }] })), 'LOTE_AJENO')
  // Con dos lotes en camino y una parte, no se sabe de cuál es: hay que decirlo.
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 2 }] })), 'LOTES_FALTAN')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 2, lotes: [{ loteId: id.A, cantidad: 1 }] }] })), 'LOTES_NO_CUADRAN')
  assert.deepEqual(await foto([v, otro]), antes, 'lo rechazado no movió nada')

  // Tanda 2: de B llegan los 3 que faltan.
  const t2 = await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.B, cantidad: 3 }] }] })
  assert.deepEqual([t2.estado, t2.enTransito], ['PARTIAL', 4])
  // Ahora solo A tiene algo en camino: sin decir el lote, no hay duda.
  const t3 = await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 1 }] })
  assert.equal(t3.enTransito, 3)
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 3, B: 4 })
  // «Todo lo pendiente» reparte lo que falta de cada lote.
  const t4 = await recibir(r.trasladoId, { todo: true })
  assert.deepEqual([t4.estado, t4.recibidas, t4.enTransito], ['RECEIVED', 3, 0])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 6, B: 4 })
  assert.deepEqual(await tope(), [['A', 6, 6, 0], ['B', 4, 4, 0]])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 0, B: 0 })
  // Cada recepción quedó repartida como se dijo.
  assert.deepEqual(await repartosDe(v, ctx.suc2, 'TRANSFER_IN'), [
    { cantidad: 3, lotes: { A: 2, B: 1 } },
    { cantidad: 3, lotes: { B: 3 } },
    { cantidad: 1, lotes: { A: 1 } },
    { cantidad: 3, lotes: { A: 3 } },
  ])
  const d = (await detalle(r.trasladoId))!
  assert.equal(d.estado, 'RECEIVED')
  assert.deepEqual(d.detalle[0].lotes.map((l) => [l.codigo, l.enviado, l.recibido, l.pendiente]), [['A', 6, 6, 0], ['B', 4, 4, 0]])
  assert.equal(d.historial.filter((m) => m.tipo === 'TRANSFER_IN').every((m) => m.lotes !== null), true)
  assert.equal(await codigoDe(recibir(r.trasladoId, { todo: true })), 'TRASLADO_CERRADO')
  await verificarLotes(v)
})

test('8 · recibir SIN decir los lotes: si llega todo lo pendiente, llega todo de cada lote; si queda un solo lote, no hay duda; con varios, se pide el lote', async () => {
  const v = await productoConLotes(6, 4)
  const r = await enviar([{ varianteId: v, cantidad: 10 }])
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 7 }] })), 'LOTES_FALTAN')
  // Llegan los 10 sin decir nada: A 6 y B 4.
  const t = await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 10 }] })
  assert.equal(t.estado, 'RECEIVED')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 6, B: 4 })
  await verificarLotes(v)

  // Un envío de UN solo lote: una recepción parcial sin lotes se asigna a ese lote.
  const w = await productoConLotes(6, 4)
  const id = await idsDeLotes(w)
  const s = await enviar([{ varianteId: w, cantidad: 5, lotes: [{ loteId: id.A, cantidad: 5 }] }])
  await recibir(s.trasladoId, { lineas: [{ varianteId: w, cantidad: 2 }] })
  assert.deepEqual(enMano(await lotesDe(w, ctx.suc2)), { A: 2 })
  await verificarLotes(w)
})

test('9 · cerrar con faltante: el motivo es obligatorio, lo que no llegó queda como perdido POR LOTE y el origen, el destino y lo perdido suman lo que había de cada lote', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 10 }])
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 4, lotes: [{ loteId: id.A, cantidad: 4 }] }], cerrarConFaltante: true })), 'MOTIVO_OBLIGATORIO')
  const c = await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 4, lotes: [{ loteId: id.A, cantidad: 4 }] }], cerrarConFaltante: true, motivo: 'Se mojaron las cajas' })
  assert.deepEqual([c.estado, c.recibidas, c.perdidas, c.enTransito], ['RECEIVED', 4, 6, 0])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 4 })
  const d = (await detalle(r.trasladoId))!
  assert.deepEqual([d.recibidas, d.perdidas], [4, 6])
  // De A faltan 2 y de B, los 4: cerrada, eso es lo PERDIDO (el detalle lo dice así).
  assert.deepEqual(d.detalle[0].lotes.map((l) => [l.codigo, l.enviado, l.recibido, l.pendiente]), [['A', 6, 4, 2], ['B', 4, 0, 4]])
  assert.equal(d.detalle[0].lotes.reduce((s, l) => s + l.pendiente, 0), d.detalle[0].perdido, 'lo que quedó de los lotes es exactamente lo perdido de la línea')
  // Conservación por lote: origen + destino + perdido = lo que había.
  const origen = enMano(await lotesDe(v, ctx.suc1))
  const destino = enMano(await lotesDe(v, ctx.suc2))
  const perdido = Object.fromEntries(d.detalle[0].lotes.map((l) => [l.codigo, l.pendiente]))
  assert.deepEqual({ A: origen.A + destino.A + perdido.A, B: origen.B + (destino.B ?? 0) + perdido.B }, { A: 6, B: 4 })
  // El archivo lo cuenta bien.
  const csv = trasladoToCsv(d, ZONA)
  assert.ok(csv.includes('Lotes\n') || csv.includes('Lotes\r\n'))
  assert.ok(csv.includes(';A;2027-07-01;6;4;0;2') && csv.includes(';B;2027-09-01;4;0;0;4'))
  await verificarLotes(v)
})

test('10 · cancelar devuelve al origen, LOTE POR LOTE, lo que sigue en camino (lo ya recibido se queda en el destino)', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 9, lotes: [{ loteId: id.A, cantidad: 5 }, { loteId: id.B, cantidad: 4 }] }])
  await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.A, cantidad: 2 }, { loteId: id.B, cantidad: 1 }] }] })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 1, B: 0 })
  const c = await cancelar(r.trasladoId, 'El destino ya no lo necesita')
  assert.equal(c.devueltas, 6)
  // Volvieron 3 de A y 3 de B; en el destino se quedan 2 de A y 1 de B.
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 4, B: 3 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 2, B: 1 })
  assert.deepEqual(await repartosDe(v, ctx.suc1, 'TRANSFER_IN'), [{ cantidad: 6, lotes: { A: 3, B: 3 } }])
  const d = (await detalle(r.trasladoId))!
  assert.equal(d.estado, 'CANCELLED')
  assert.deepEqual(d.detalle[0].lotes.map((l) => [l.codigo, l.enviado, l.recibido, l.devuelto, l.pendiente]), [['A', 5, 2, 3, 0], ['B', 4, 1, 3, 0]])
  assert.equal((await cancelar(r.trasladoId)).repetido, true)
  assert.equal(await codigoDe(recibir(r.trasladoId, { todo: true })), 'TRASLADO_CERRADO')
  await verificarLotes(v)
})

test('10b · cancelar solo devuelve los lotes que todavía tienen algo en camino: uno que ya llegó entero no vuelve ni deja un renglón vacío', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 10 }]) // A 6 + B 4
  // B llega entero y de A llegan 2.
  await recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 6, lotes: [{ loteId: id.B, cantidad: 4 }, { loteId: id.A, cantidad: 2 }] }] })
  const c = await cancelar(r.trasladoId)
  assert.equal(c.devueltas, 4)
  assert.deepEqual(await repartosDe(v, ctx.suc1, 'TRANSFER_IN'), [{ cantidad: 4, lotes: { A: 4 } }], 'solo A vuelve, y vuelve lo que le faltaba')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 4, B: 0 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 2, B: 4 })
  await verificarLotes(v)
})

test('11 · una recepción con la misma clave es un reintento si dice los mismos lotes (aunque la transferencia ya esté cerrada) y se rechaza si dice otros', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 10 }])
  const clave = `rec-${sufijo}`
  const lineas = [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.A, cantidad: 2 }, { loteId: id.B, cantidad: 1 }] }]
  const uno = await recibir(r.trasladoId, { lineas, idempotencyKey: clave })
  assert.equal(uno.repetido, false)
  const dos = await recibir(r.trasladoId, { lineas, idempotencyKey: clave })
  assert.equal(dos.repetido, true)
  assert.equal(dos.recibidas, 3)
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.A, cantidad: 3 }] }], idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'otros lotes con la misma clave')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 2, B: 1 }, 'solo entró una vez')
  await recibir(r.trasladoId, { todo: true })
  assert.equal((await recibir(r.trasladoId, { lineas, idempotencyKey: clave })).repetido, true, 'cerrada y aun así reintento')
  await verificarLotes(v)
})

test('12 · el mismo envío (misma clave) con los mismos lotes es UN traslado; con otros lotes se rechaza', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const clave = `env-${sufijo}`
  const lineas = (a: number, b: number): Linea[] => [{ varianteId: v, cantidad: a + b, lotes: [{ loteId: id.A, cantidad: a }, { loteId: id.B, cantidad: b }] }]
  const [r1, r2] = await Promise.all([enviar(lineas(2, 1), { clave }), enviar(lineas(2, 1), { clave })])
  assert.equal(r1.trasladoId, r2.trasladoId)
  assert.equal([r1, r2].filter((r) => r.repetido).length, 1)
  assert.equal(await codigoDe(enviar([{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.A, cantidad: 3 }] }], { clave })), 'CLAVE_REUTILIZADA', 'otros lotes con la misma cantidad total')
  assert.equal(await codigoDe(enviar(lineas(1, 2), { clave })), 'CLAVE_REUTILIZADA', 'mismos lotes con otras cantidades')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 4, B: 3 }, 'solo salió una vez')
  await verificarLotes(v)
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('13 · dos recepciones simultáneas del MISMO lote se turnan: el lote nunca llega más de lo enviado, y lo que sobra se rechaza', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const r = await enviar([{ varianteId: v, cantidad: 10 }])
  const pide = (n: number) => recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: n, lotes: [{ loteId: id.A, cantidad: n }] }] })
  const rs = await Promise.allSettled([pide(4), pide(4), pide(4)])
  const ok = rs.filter((x) => x.status === 'fulfilled')
  assert.equal(ok.length, 1, 'de A llegan 4 una vez; la segunda pide 4 de los 2 que faltan')
  for (const x of rs) {
    if (x.status === 'rejected') assert.equal((x.reason as { codigo?: string }).codigo, 'RECIBE_MAS_DE_LO_ENVIADO', String(x.reason))
  }
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 4 })
  const final = await Promise.allSettled([pide(2), recibir(r.trasladoId, { todo: true })])
  assert.equal(final.filter((x) => x.status === 'fulfilled').length >= 1, true)
  const d = (await detalle(r.trasladoId))!
  assert.equal(d.detalle[0].lotes.every((l) => l.recibido <= l.enviado), true, 'ningún lote pasó de lo enviado')
  assert.equal(enMano(await lotesDe(v, ctx.suc2)).A <= 6, true)
  await verificarLotes(v)
})

test('14 · recibir y cancelar a la vez: o llega o vuelve, nunca las dos cosas ni ninguna, y cada lote se conserva', async () => {
  const v = await productoConLotes(30, 30)
  const total = { A: 30, B: 30 }
  for (let ronda = 0; ronda < 4; ronda++) {
    const r = await enviar([{ varianteId: v, cantidad: 8 }])
    const rs = await Promise.allSettled(ronda % 2 ? [recibir(r.trasladoId, { todo: true }), cancelar(r.trasladoId)] : [cancelar(r.trasladoId), recibir(r.trasladoId, { todo: true })])
    assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1, `ronda ${ronda}`)
    for (const x of rs) if (x.status === 'rejected') assert.equal((x.reason as { codigo?: string }).codigo, 'TRASLADO_CERRADO')
    const o = enMano(await lotesDe(v, ctx.suc1))
    const d = enMano(await lotesDe(v, ctx.suc2))
    assert.deepEqual({ A: o.A + (d.A ?? 0), B: o.B + (d.B ?? 0) }, total, `ronda ${ronda}: cada lote se conserva`)
  }
  await verificarLotes(v)
})

test('15 · dos salidas simultáneas del último lote: una gana y la otra se rechaza (el lote nunca queda en negativo)', async () => {
  const v = await producto('Último lote')
  await activar(v)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-07-01', cantidad: 6 }])
  const id = await idsDeLotes(v)
  const rs = await Promise.allSettled([
    transferir(v, 4, { lotes: [{ loteId: id.A, cantidad: 4 }], destino: ctx.suc2 }),
    enviar([{ varianteId: v, cantidad: 4, lotes: [{ loteId: id.A, cantidad: 4 }] }], { destino: ctx.suc3 }),
    transferir(v, 4, { destino: ctx.suc3 }),
  ])
  assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1)
  for (const x of rs) if (x.status === 'rejected') assert.equal((x.reason as { codigo?: string }).codigo, 'STOCK_INSUFICIENTE', String(x.reason))
  assert.equal(enMano(await lotesDe(v, ctx.suc1)).A, 2)
  await verificarLotes(v)
})

// ── Lo que cambia con el tiempo y las otras operaciones ──────────────────────

test('16 · un lote que vence MIENTRAS va en camino llega igual (la mercancía llegó) y en el destino ya figura vencido; el barrido lo trata como cualquier lote vencido', async () => {
  const v = await producto('Vence en camino')
  await activar(v)
  await entrada(v, [{ codigo: 'CORTO', vencimiento: '2027-06-20', cantidad: 5 }])
  const r = await enviar([{ varianteId: v, cantidad: 5 }])
  const t = await recibir(r.trasladoId, { todo: true, ahora: SEMANA_DESPUES })
  assert.equal(t.estado, 'RECEIVED')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { CORTO: 5 })
  // En el destino no se puede vender (FEFO no toca lo vencido) ni transferir por FEFO.
  assert.equal(await codigoDe(transferir(v, 1, { origen: ctx.suc2, destino: ctx.suc3, ahora: SEMANA_DESPUES })), 'STOCK_INSUFICIENTE')
  await verificarLotes(v)
})

test('17 · activar lotes sigue vetado mientras el producto va en camino y se permite en cuanto la transferencia se cierra; lo que ya iba sin lotes se recibe sin lotes', async () => {
  const v = await producto('Activa en camino')
  await entradaSuelta(v, 10)
  const r = await enviar([{ varianteId: v, cantidad: 4 }])
  assert.equal(await codigoDe(activar(v)), 'ACTIVAR_CON_TRANSFERENCIA')
  await recibir(r.trasladoId, { todo: true })
  assert.equal(await existencia(v, ctx.suc2), 4)
  await activar(v)
  // Ya con lotes: lo que había (en las dos sucursales) está en «SIN LOTE» y se transfiere de ahí.
  await transferir(v, 3)
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'SIN LOTE': 7 })
  await verificarLotes(v)
})

test('18 · un producto puede pasar por varias sucursales y sus lotes siguen siendo los mismos: ida y vuelta conserva cada lote', async () => {
  const v = await productoConLotes(6, 4)
  await transferir(v, 7) // suc1 → suc2: A 6, B 1
  await transferir(v, 5, { origen: ctx.suc2, destino: ctx.suc3 }) // suc2 → suc3 por FEFO: A 5
  await transferir(v, 3, { origen: ctx.suc3, destino: ctx.suc1 }) // suc3 → suc1: A 3
  const s1 = enMano(await lotesDe(v, ctx.suc1))
  const s2 = enMano(await lotesDe(v, ctx.suc2))
  const s3 = enMano(await lotesDe(v, ctx.suc3))
  assert.deepEqual({ A: s1.A + s2.A + (s3.A ?? 0), B: s1.B + s2.B + (s3.B ?? 0) }, { A: 6, B: 4 })
  assert.deepEqual([s1, s2, s3], [{ A: 3, B: 3 }, { A: 1, B: 1 }, { A: 2 }])
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 3, 'no nacieron lotes nuevos (A, B y «SIN LOTE»)')
  await verificarLotes(v)
})

test('19 · si el ledger y las líneas no cuadran (alguien escribió por fuera), recibir y cancelar se niegan a repartir a ciegas; y un producto sin lotes no admite lotes al recibir', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const sin = await producto('Sin lotes')
  await entradaSuelta(sin, 10)
  const r = await enviar([{ varianteId: v, cantidad: 10 }, { varianteId: sin, cantidad: 4 }])
  // Un producto sin lotes al que se le dicen lotes al recibir.
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: sin, cantidad: 2, lotes: [{ loteId: id.A, cantidad: 2 }] }] })), 'LOTES_NO_APLICAN')
  // Otra empresa no lee los lotes de una transferencia ajena.
  assert.equal((await conEmpresa(ctx.b, (tx) => lotesDeTrasladoEnTx(tx, ctx.b, r.trasladoId))).size, 0, 'la lectura por lote es de la empresa')
  assert.equal((await lotesDeTraslado(r.trasladoId)).size, 1, 'la dueña sí')

  // Se descuadra la línea (dice que ya llegaron 3 que el ledger no vio): recibir y cancelar no reparten a ciegas.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 3 WHERE "transferId" = ${r.trasladoId} AND "catalogVariantId" = ${v}`
  })
  const antes = await foto([v, sin])
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: v, cantidad: 2, lotes: [{ loteId: id.A, cantidad: 2 }] }] })), 'TRASLADO_DESCUADRADO')
  assert.equal(await codigoDe(cancelar(r.trasladoId)), 'TRASLADO_DESCUADRADO')
  assert.deepEqual(await foto([v, sin]), antes, 'no se movió nada')
  // Se deja la línea como estaba para que la limpieza final no tropiece.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 0 WHERE "transferId" = ${r.trasladoId} AND "catalogVariantId" = ${v}`
  })
})

test('20 · dos transferencias del MISMO producto entre las MISMAS sucursales, a la vez en camino, no se mezclan: cada una cuenta solo sus movimientos', async () => {
  const v = await productoConLotes(6, 4)
  const id = await idsDeLotes(v)
  const t1 = await enviar([{ varianteId: v, cantidad: 4, lotes: [{ loteId: id.A, cantidad: 4 }] }])
  const t2 = await enviar([{ varianteId: v, cantidad: 5, lotes: [{ loteId: id.A, cantidad: 2 }, { loteId: id.B, cantidad: 3 }] }])
  const resumen = async (trasladoId: string) => (await lotesDeTraslado(trasladoId)).get(v)!.map((l) => [l.codigo, l.enviado, l.recibido, l.devuelto])
  assert.deepEqual(await resumen(t1.trasladoId), [['A', 4, 0, 0]])
  assert.deepEqual(await resumen(t2.trasladoId), [['A', 2, 0, 0], ['B', 3, 0, 0]])
  // Recibir en una no toca la otra, ni en lo que cuenta ni en lo que permite.
  await recibir(t2.trasladoId, { lineas: [{ varianteId: v, cantidad: 3, lotes: [{ loteId: id.B, cantidad: 3 }] }] })
  assert.deepEqual(await resumen(t1.trasladoId), [['A', 4, 0, 0]], 'la primera sigue igual')
  assert.deepEqual(await resumen(t2.trasladoId), [['A', 2, 0, 0], ['B', 3, 3, 0]])
  assert.equal(await codigoDe(recibir(t1.trasladoId, { lineas: [{ varianteId: v, cantidad: 5, lotes: [{ loteId: id.A, cantidad: 5 }] }] })), 'RECIBE_MAS_DE_LO_ENVIADO', 'de A en la primera solo van 4, aunque en total salieron 6')
  const c = await cancelar(t1.trasladoId)
  assert.equal(c.devueltas, 4, 'cancelar la primera devuelve SOLO lo suyo')
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc1)), { A: 4, B: 1 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { B: 3 })
  await recibir(t2.trasladoId, { todo: true })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { A: 2, B: 3 })
  await verificarLotes(v)
})
