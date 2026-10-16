import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { agregarVarianteEnTx, cambiarEstadoItemEnTx, crearItemEnTx, eliminarVarianteEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import {
  activarLotesEnTx,
  ajustarEnTx,
  consumirReservaEnTx,
  contarEnTx,
  danarEnTx,
  devolverEnTx,
  enviarTrasladoEnTx,
  liberarReservaEnTx,
  moverEntreLotesEnTx,
  recibirEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  vencerLotesEnTx,
  venderEnTx,
  abrirConteoEnTx,
  registrarConteoProductoEnTx,
} from '../../src/modules/inventory/service'
import { mermasEnTx } from '../../src/modules/inventory/mermas-queries'
import { barridoInventario } from '../../src/modules/inventory/barrido'
import { lotesDeVarianteEnTx } from '../../src/modules/inventory/lotes-queries'
import { repartirFefo } from '../../src/modules/inventory/lotes'
import { diaLocal } from '../../src/modules/reportes/rango'
import { buscarVariantesParaEntradaEnTx, entradaDetalleEnTx, historialDeVarianteEnTx } from '../../src/modules/inventory/queries'
import { completarPorQrEnTx, crearPedidoEnTx, marcarListoEnTx, reembolsarPedidoEnTx, type ContextoPedido } from '../../src/modules/orders/service'

/**
 * INV-5a · LOTES Y VENCIMIENTO con el SERVICIO real contra PostgreSQL: activar, recibir con lotes, vender / apartar / liberar /
 * cobrar por FEFO, devoluciones que vuelven a su lote, daño / ajuste / baja por lote, mover entre lotes, el barrido de vencimientos,
 * lo que todavía no admite lotes, el flujo real de pedidos y las invariantes (los lotes suman el saldo y cada saldo por lote es su
 * apertura más el efecto de sus movimientos), también bajo concurrencia.
 *
 * Las fechas de las pruebas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`): se pasa en cada operación, así que nada depende
 * del reloj del día en que se corra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
/** 12:00 en Santo Domingo del 15-jun-2027. */
const AHORA = new Date('2027-06-15T16:00:00.000Z')
/** El 22-jun-2027, 06:00 en Santo Domingo. */
const SEMANA_DESPUES = new Date('2027-06-22T10:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', sucB: '', cli: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const empresaPedido = (actorId: string | null): ContextoPedido => ({ actor: 'EMPRESA', actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const clientePedido: ContextoPedido = { actor: 'CLIENTE', actorId: null, ipAddress: '127.0.0.1', userAgent: 'test' }

let contador = 0
/** Un producto físico ACTIVO de la empresa A. Devuelve su variante. */
async function producto(nombre = 'Lote', precio = 10, empresaId = ctx.a): Promise<string> {
  const n = ++contador
  const r = await conEmpresa(empresaId, (tx) =>
    crearItemEnTx(tx, empresaId, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: precio, sku: `LT-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario))
  )
  await conEmpresa(empresaId, (tx) => cambiarEstadoItemEnTx(tx, empresaId, r.id, 'ACTIVE', como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

/** El código con que el servicio rechazó `p`; `SIN_ERROR` si no lo rechazó. */
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    // Los errores de dominio (del inventario y del catálogo) llevan un `codigo`.
    const codigo = (e as { codigo?: unknown } | null)?.codigo
    return typeof codigo === 'string' ? codigo : `OTRO: ${e instanceof Error ? e.message : String(e)}`
  }
  return 'SIN_ERROR'
}

interface LoteEntrante {
  codigo: string
  vencimiento?: string | null
  cantidad: number
}

const activar = (v: string, exigirVencimiento = false) => enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, exigirVencimiento, ahora: AHORA }, como(ctx.usuario)))

/** Una entrada de UN producto con sus lotes. */
const entrada = (v: string, lotes: LoteEntrante[], o: { sucursalId?: string; clave?: string; costo?: string } = {}) =>
  enA((tx) =>
    registrarEntradaMultipleEnTx(
      tx,
      ctx.a,
      { sucursalId: o.sucursalId ?? ctx.suc1, lineas: [{ varianteId: v, cantidad: lotes.reduce((s, l) => s + l.cantidad, 0), lotes, ...(o.costo ? { costo: o.costo } : {}) }], idempotencyKey: o.clave, ahora: AHORA },
      como(ctx.usuario)
    )
  )

const vender = (v: string, cantidad: number, o: { sucursalId?: string; ahora?: Date; referencia?: { tipo: string; id: string }; lotesSalida?: unknown; clave?: string } = {}) =>
  enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId: o.sucursalId ?? ctx.suc1, cantidad, ahora: o.ahora ?? AHORA, referencia: o.referencia, lotesSalida: o.lotesSalida, idempotencyKey: o.clave }, como(ctx.usuario)))

const reservar = (v: string, cantidad: number, o: { ttlMinutos?: number; ahora?: Date; sucursalId?: string; referencia?: { tipo: string; id: string } } = {}) =>
  enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: o.sucursalId ?? ctx.suc1, cantidad, ttlMinutos: o.ttlMinutos ?? 60, ahora: o.ahora ?? AHORA, referencia: o.referencia }, como(ctx.usuario)))

async function nivelDe(v: string, sucursalId = ctx.suc1) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
}

type Cubetas3 = { onHand: number; reserved: number; damaged: number }
/** Lo que hay de cada lote (por código) en una sucursal; los lotes sin nada no aparecen salvo que tengan un saldo por lote. */
async function lotesDe(v: string, sucursalId = ctx.suc1): Promise<Record<string, Cubetas3>> {
  const nivel = await nivelDe(v, sucursalId)
  const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: nivel.id }, select: { onHand: true, reserved: true, damaged: true, lot: { select: { code: true } } } })
  return Object.fromEntries(bs.map((b) => [b.lot.code, { onHand: b.onHand, reserved: b.reserved, damaged: b.damaged }]))
}

/** Solo lo vendible-más-apartado por lote: la forma corta de comparar. */
const enMano = (m: Record<string, Cubetas3>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.onHand]))

/** El reparto de los movimientos de una referencia: tipo → [código de lote, cantidad], en el orden del ledger. */
async function repartosDe(referenceType: string, referenceId: string) {
  const movs = await prisma.inventoryMovement.findMany({
    where: { companyId: ctx.a, referenceType, referenceId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, quantity: true, sourceBucket: true, destinationBucket: true, reasonCode: true, lotSplits: { select: { quantity: true, balance: { select: { lot: { select: { code: true } } } } } } },
  })
  return movs.map((m) => ({
    tipo: m.type,
    cantidad: m.quantity,
    motivo: m.reasonCode,
    lotes: Object.fromEntries(m.lotSplits.map((x) => [x.balance.lot.code, x.quantity])),
  }))
}

/**
 * LAS INVARIANTES de un producto con lotes, en todas sus sucursales:
 *  · los lotes suman el saldo de la sucursal (las tres cubetas);
 *  · cada saldo por lote es su APERTURA más el efecto de los repartos de sus movimientos (nada lo movió por fuera);
 *  · cada movimiento posterior a la activación está repartido por completo;
 *  · lo apartado de la sucursal es la suma de sus reservas vivas.
 */
async function verificarLotes(v: string): Promise<void> {
  const filas = await prisma.$queryRaw<Array<{ nivel: string; lote: string; onHand: number; reserved: number; damaged: number; eOn: number; eRes: number; eDam: number }>>`
    SELECT b."inventoryLevelId" AS "nivel", b."lotId" AS "lote", b."onHand", b."reserved", b."damaged",
           (COALESCE(o."onHand", 0) + COALESCE(x."on", 0))::int AS "eOn",
           (COALESCE(o."reserved", 0) + COALESCE(x."res", 0))::int AS "eRes",
           (COALESCE(o."damaged", 0) + COALESCE(x."dam", 0))::int AS "eDam"
      FROM "inventory_lot_balances" b
      LEFT JOIN "inventory_lot_openings" o ON o."inventoryLevelId" = b."inventoryLevelId" AND o."lotId" = b."lotId"
      LEFT JOIN LATERAL (
        SELECT SUM((z."e")[1]) AS "on", SUM((z."e")[2]) AS "res", SUM((z."e")[3]) AS "dam"
          FROM (SELECT inventory_lot_efecto(m."sourceBucket", m."destinationBucket", ml."quantity") AS "e"
                  FROM "inventory_movement_lots" ml JOIN "inventory_movements" m ON m."id" = ml."movementId"
                 WHERE ml."inventoryLevelId" = b."inventoryLevelId" AND ml."lotId" = b."lotId") z
      ) x ON true
     WHERE b."catalogVariantId" = ${v}`
  for (const f of filas) {
    assert.deepEqual([f.onHand, f.reserved, f.damaged], [f.eOn, f.eRes, f.eDam], `saldo por lote ${f.lote}: es su apertura más el efecto de sus movimientos`)
  }
  const niveles = await prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, select: { id: true, onHand: true, reserved: true, damaged: true } })
  for (const n of niveles) {
    const suma = filas.filter((f) => f.nivel === n.id).reduce((t, f) => ({ onHand: t.onHand + f.onHand, reserved: t.reserved + f.reserved, damaged: t.damaged + f.damaged }), { onHand: 0, reserved: 0, damaged: 0 })
    assert.deepEqual(suma, { onHand: n.onHand, reserved: n.reserved, damaged: n.damaged }, 'los lotes suman el saldo de la sucursal')
    const vivas = await prisma.inventoryReservation.aggregate({ where: { inventoryLevelId: n.id, status: 'ACTIVE' }, _sum: { quantity: true } })
    assert.equal(n.reserved, vivas._sum.quantity ?? 0, 'lo apartado son las reservas vivas')
    assert.ok(filas.filter((f) => f.nivel === n.id).every((f) => f.onHand >= f.reserved && f.reserved >= 0 && f.damaged >= 0))
  }
}

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Lotes ${x} ${sufijo}`, slug: `lotes-svc-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-lotsvc-${sufijo}`, email: `lotsvc-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } })
  ctx.suc1 = (await suc(ctx.a, 'Principal')).id
  ctx.suc2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  ctx.cli = (await prisma.cliente.create({ data: { companyId: ctx.a, supabaseId: `sb-lotsvc-cli-${sufijo}`, nombre: 'Cliente', email: `lotsvc-cli-${sufijo}@prueba.test` }, select: { id: true } })).id
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
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_count_lines',
        'inventory_count_sessions',
        'inventory_transfer_lines',
        'inventory_transfers',
        'inventory_purchase_order_lines',
        'inventory_purchase_orders',
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
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── Activar ──────────────────────────────────────────────────────────────────

test('1 · activar: lo que había (en todas las sucursales y las tres cubetas) pasa a «SIN LOTE» como apertura, y el producto sigue cuadrando', async () => {
  const v = await producto()
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 20 }] }, como(ctx.usuario)))
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc2, lineas: [{ varianteId: v, cantidad: 8 }] }, como(ctx.usuario)))
  const r = await reservar(v, 5)
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2, motivoCodigo: 'HANDLING', exigirMotivoCodificado: true }, como(ctx.usuario)))

  const a = await activar(v, true)
  assert.equal(a.repetido, false)
  assert.equal(a.sucursales, 2)
  assert.equal(a.unidades, 20 + 8, 'vendible + apartado + dañado de las dos sucursales')
  assert.deepEqual(await lotesDe(v, ctx.suc1), { 'SIN LOTE': { onHand: 18, reserved: 5, damaged: 2 } }, 'las tres cubetas, tal cual')
  assert.deepEqual(await lotesDe(v, ctx.suc2), { 'SIN LOTE': { onHand: 8, reserved: 0, damaged: 0 } })
  const t = await prisma.inventoryLotTracking.findUniqueOrThrow({ where: { catalogVariantId: v } })
  assert.equal(t.requiresExpiry, true)
  assert.equal(await prisma.inventoryLotOpening.count({ where: { lotId: a.legadoId } }), 2)
  await verificarLotes(v)

  // Activar otra vez no hace nada.
  const otra = await activar(v)
  assert.equal(otra.repetido, true)
  assert.equal(otra.legadoId, a.legadoId)
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v } }), 1)

  // La reserva de antes de activar se libera y se cobra con normalidad: su lote es el legado.
  const lib = await enA((tx) => liberarReservaEnTx(tx, ctx.a, r.reservaId, { ahora: AHORA }, como(ctx.usuario)))
  assert.equal(lib.estado, 'RELEASED')
  assert.deepEqual(await lotesDe(v, ctx.suc1), { 'SIN LOTE': { onHand: 18, reserved: 0, damaged: 2 } })
  await verificarLotes(v)
})

test('2 · no se activa con trabajo a medias que no sabe de lotes, ni con lo apartado descuadrado; un producto de otra empresa no se toca', async () => {
  // Conteo abierto.
  const c = await producto()
  await entrada0(c, 5)
  const conteo = await enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId: ctx.suc1 }, como(ctx.usuario)))
  await enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: conteo.conteoId, varianteId: c, cantidad: 4, modo: 'FIJAR' }, como(ctx.usuario)))
  assert.equal(await codigoDe(activar(c)), 'ACTIVAR_CON_CONTEO_ABIERTO')

  // Transferencia en tránsito.
  const t = await producto()
  await entrada0(t, 5)
  await enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: ctx.suc1, destinoId: ctx.suc2, lineas: [{ varianteId: t, cantidad: 2 }], ahora: AHORA }, como(ctx.usuario)))
  assert.equal(await codigoDe(activar(t)), 'ACTIVAR_CON_TRANSFERENCIA')

  // Lo apartado no coincide con las reservas vivas (una reserva sin su movimiento).
  const d = await producto()
  await entrada0(d, 5)
  const nivel = await nivelDe(d)
  await prisma.inventoryReservation.create({ data: { companyId: ctx.a, inventoryLevelId: nivel.id, quantity: 3, expiresAt: new Date('2099-01-01T00:00:00Z') } })
  assert.equal(await codigoDe(activar(d)), 'ACTIVAR_RESERVAS_DESCUADRADAS')

  // Nada quedó activado.
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: { in: [c, t, d] } } }), 0)
  // Otra empresa no ve el producto.
  const ajeno = await producto()
  assert.equal(await codigoDe(enB((tx) => activarLotesEnTx(tx, ctx.b, { varianteId: ajeno }, como(ctx.usuario)))), 'VARIANTE_NO_ENCONTRADA')
})

/** Una entrada sin lotes de un producto que todavía no los lleva. */
const entrada0 = (v: string, cantidad: number, sucursalId = ctx.suc1) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId: v, cantidad }] }, como(ctx.usuario)))

// ── Recibir con lotes ────────────────────────────────────────────────────────

test('3 · una entrada con lotes crea los lotes que faltan, los reparte y no admite lo que no cuadra', async () => {
  const v = await producto()
  await activar(v)
  const e = await entrada(v, [{ codigo: 'a-1', vencimiento: '2027-07-01', cantidad: 6 }, { codigo: 'B-2', cantidad: 4 }])
  assert.equal(e.unidades, 10)
  assert.deepEqual(enMano(await lotesDe(v)), { 'A-1': 6, 'B-2': 4 })
  const lote = await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'A-1' }, select: { expiresOn: true, legacy: true } })
  assert.equal(lote.expiresOn?.toISOString().slice(0, 10), '2027-07-01')
  assert.equal(lote.legacy, false)
  await verificarLotes(v)

  // Otra entrada del mismo lote suma; en otra sucursal es un saldo por lote distinto del MISMO lote.
  await entrada(v, [{ codigo: 'A-1', vencimiento: '2027-07-01', cantidad: 2 }])
  await entrada(v, [{ codigo: 'A-1', vencimiento: '2027-07-01', cantidad: 3 }], { sucursalId: ctx.suc2 })
  assert.deepEqual(enMano(await lotesDe(v)), { 'A-1': 8, 'B-2': 4 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'A-1': 3 })
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v, code: 'A-1' } }), 1, 'un solo lote A-1')

  // «SIN LOTE» recibe lo que llega sin etiquetar.
  await entrada(v, [{ codigo: 'sin lote', cantidad: 5 }])
  assert.equal((await lotesDe(v))['SIN LOTE'].onHand, 5)

  // Lo que se rechaza, y no deja nada.
  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'A-1', vencimiento: '2027-08-01', cantidad: 1 }])), 'LOTE_VENCIMIENTO_DISTINTO', 'un lote tiene un vencimiento')
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'A-1', cantidad: 1 }])), 'LOTE_VENCIMIENTO_DISTINTO', 'ni quitárselo')
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'C 3', vencimiento: '2027-02-30', cantidad: 1 }])), 'VENCIMIENTO_INVALIDO')
  assert.equal(await codigoDe(enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 3 }] }, como(ctx.usuario)))), 'LOTES_FALTAN', 'un producto con lotes dice de qué lote')
  assert.equal(await codigoDe(enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 3, lotes: [{ codigo: 'X', cantidad: 2 }] }] }, como(ctx.usuario)))), 'LOTES_NO_CUADRAN')
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), antes, 'todo o nada')
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v, code: 'X' } }), 0, 'ni un lote a medias')
  await verificarLotes(v)

  // Un producto SIN lotes no puede traerlos.
  const sin = await producto()
  assert.equal(await codigoDe(enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: sin, cantidad: 2, lotes: [{ codigo: 'L', cantidad: 2 }] }] }, como(ctx.usuario)))), 'LOTES_NO_APLICAN')
})

test('4 · si el producto exige vencimiento, todo lote con código lo trae', async () => {
  const v = await producto()
  await activar(v, true)
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'SIN-FECHA', cantidad: 2 }])), 'VENCIMIENTO_OBLIGATORIO')
  await entrada(v, [{ codigo: 'CON-FECHA', vencimiento: '2027-12-31', cantidad: 2 }, { codigo: 'SIN LOTE', cantidad: 1 }])
  assert.deepEqual(enMano(await lotesDe(v)), { 'CON-FECHA': 2, 'SIN LOTE': 1 })
})

test('5 · la entrada es idempotente también en sus lotes: la misma clave repite lo mismo; con otros lotes, es otra operación', async () => {
  const v = await producto()
  await activar(v)
  const lotes = [{ codigo: 'K-1', vencimiento: '2027-09-01', cantidad: 4 }, { codigo: 'K-2', cantidad: 1 }]
  const a = await entrada(v, lotes, { clave: `lotes-${sufijo}-1` })
  const b = await entrada(v, [lotes[1], lotes[0]], { clave: `lotes-${sufijo}-1` })
  assert.equal(b.repetido, true)
  assert.equal(b.entradaId, a.entradaId)
  assert.deepEqual(enMano(await lotesDe(v)), { 'K-1': 4, 'K-2': 1 }, 'no se duplicó')
  assert.equal(await codigoDe(entrada(v, [{ codigo: 'K-1', vencimiento: '2027-09-01', cantidad: 3 }, { codigo: 'K-2', cantidad: 2 }], { clave: `lotes-${sufijo}-1` })), 'CLAVE_REUTILIZADA', 'mismas unidades, otro reparto')
  await verificarLotes(v)
})

// ── Vender por FEFO ──────────────────────────────────────────────────────────

/** El producto de los casos de FEFO: A vence el 1-jul (5), B el 20-jun (4), C no vence (10) y D ya venció el 1-jun (7). */
async function productoFefo(): Promise<string> {
  const v = await producto('Fefo')
  await activar(v)
  await entrada(v, [
    { codigo: 'A', vencimiento: '2027-07-01', cantidad: 5 },
    { codigo: 'B', vencimiento: '2027-06-20', cantidad: 4 },
    { codigo: 'C', cantidad: 10 },
    { codigo: 'D', vencimiento: '2027-06-01', cantidad: 7 },
  ])
  return v
}

test('6 · vender sale por FEFO: primero lo que antes vence, después lo que no vence, y nunca lo vencido', async () => {
  const v = await productoFefo()
  const ref = { tipo: 'ORDER', id: `fefo-${sufijo}-1` }
  await vender(v, 6, { referencia: ref })
  assert.deepEqual(enMano(await lotesDe(v)), { A: 3, B: 0, C: 10, D: 7 }, 'B (20-jun) entero y 2 de A (1-jul)')
  assert.deepEqual(await repartosDe(ref.tipo, ref.id), [{ tipo: 'SALE', cantidad: 6, motivo: null, lotes: { B: 4, A: 2 } }])

  await vender(v, 3)
  assert.deepEqual(enMano(await lotesDe(v)), { A: 0, B: 0, C: 10, D: 7 })
  await vender(v, 4)
  assert.deepEqual(enMano(await lotesDe(v)), { A: 0, B: 0, C: 6, D: 7 }, 'los que no vencen, después de los que sí')

  // Lo vencido no se vende aunque esté en el saldo: hay 13 en total pero solo 6 se pueden vender.
  assert.equal((await nivelDe(v)).onHand, 13)
  const e = await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 7, ahora: AHORA }, como(ctx.usuario))).catch((x: unknown) => x)
  assert.ok(e instanceof InventarioError && e.codigo === 'STOCK_INSUFICIENTE')
  assert.match((e as Error).message, /hay 6 disponible\(s\) para vender.*otras 7 están vencidas/)
  await vender(v, 6)
  assert.deepEqual(enMano(await lotesDe(v)), { A: 0, B: 0, C: 0, D: 7 })
  assert.equal(await codigoDe(vender(v, 1)), 'STOCK_INSUFICIENTE', 'solo queda lo vencido')

  // El último día del lote todavía se vende; al día siguiente, no.
  const w = await producto()
  await activar(w)
  await entrada(w, [{ codigo: 'HOY', vencimiento: '2027-06-15', cantidad: 3 }])
  await vender(w, 1)
  assert.equal(await codigoDe(vender(w, 1, { ahora: new Date('2027-06-16T16:00:00Z') })), 'STOCK_INSUFICIENTE', 'el 16 ya venció')
  await verificarLotes(v)
  await verificarLotes(w)
})

test('7 · vender de un lote elegido (aunque esté vencido) y la misma clave con otro lote es otra operación', async () => {
  const v = await productoFefo()
  const idD = (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'D' }, select: { id: true } })).id
  const idC = (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'C' }, select: { id: true } })).id
  await vender(v, 2, { lotesSalida: [{ loteId: idD, cantidad: 2 }], clave: `elegido-${sufijo}` })
  assert.deepEqual(enMano(await lotesDe(v)), { A: 5, B: 4, C: 10, D: 5 })
  const repetida = await vender(v, 2, { lotesSalida: [{ loteId: idD, cantidad: 2 }], clave: `elegido-${sufijo}` })
  assert.equal(repetida.repetido, true)
  assert.equal(await codigoDe(vender(v, 2, { lotesSalida: [{ loteId: idC, cantidad: 2 }], clave: `elegido-${sufijo}` })), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(vender(v, 6, { lotesSalida: [{ loteId: idD, cantidad: 6 }] })), 'STOCK_INSUFICIENTE', 'el lote D solo tiene 5')
  assert.equal(await codigoDe(vender(v, 3, { lotesSalida: [{ loteId: idD, cantidad: 2 }] })), 'LOTES_NO_CUADRAN')
  assert.equal(await codigoDe(vender(v, 1, { lotesSalida: [{ loteId: 'no-existe', cantidad: 1 }] })), 'LOTE_NO_ENCONTRADO')
  assert.equal(await codigoDe(vender(v, 1, { lotesSalida: [] })) === 'SIN_ERROR', true, 'sin lotes indicados, sale por FEFO')
  // Un lote de otra empresa no sirve.
  const ajeno = await producto('Ajeno', 10, ctx.b)
  await enB((tx) => activarLotesEnTx(tx, ctx.b, { varianteId: ajeno }, como(ctx.usuario)))
  await enB((tx) => registrarEntradaMultipleEnTx(tx, ctx.b, { sucursalId: ctx.sucB, lineas: [{ varianteId: ajeno, cantidad: 1, lotes: [{ codigo: 'AJ', cantidad: 1 }] }] }, como(ctx.usuario)))
  const idAjeno = (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: ajeno, code: 'AJ' }, select: { id: true } })).id
  assert.equal(await codigoDe(vender(v, 1, { lotesSalida: [{ loteId: idAjeno, cantidad: 1 }] })), 'LOTE_NO_ENCONTRADO')
  await verificarLotes(v)
})

// ── Apartar, liberar y cobrar ────────────────────────────────────────────────

test('8 · apartar toma por FEFO; liberar (o vencer la reserva) devuelve a los MISMOS lotes; cobrar vende de donde se apartó', async () => {
  const v = await productoFefo()
  const r1 = await reservar(v, 6, { referencia: { tipo: 'ORDER', id: `res-${sufijo}-1` } })
  assert.deepEqual(await lotesDe(v), { A: { onHand: 5, reserved: 2, damaged: 0 }, B: { onHand: 4, reserved: 4, damaged: 0 }, C: { onHand: 10, reserved: 0, damaged: 0 }, D: { onHand: 7, reserved: 0, damaged: 0 } })
  assert.deepEqual(await repartosDe('RESERVATION', r1.reservaId), [{ tipo: 'RESERVATION', cantidad: 6, motivo: null, lotes: { B: 4, A: 2 } }])
  await verificarLotes(v)

  // Lo apartado ya no está disponible para otra venta: quedan A 3 + C 10 = 13 vendibles.
  assert.equal(await codigoDe(vender(v, 14)), 'STOCK_INSUFICIENTE')

  const lib = await enA((tx) => liberarReservaEnTx(tx, ctx.a, r1.reservaId, { ahora: AHORA }, como(ctx.usuario)))
  assert.equal(lib.estado, 'RELEASED')
  assert.deepEqual(enMano(await lotesDe(v)), { A: 5, B: 4, C: 10, D: 7 })
  assert.deepEqual((await repartosDe('RESERVATION', r1.reservaId)).map((m) => [m.tipo, m.lotes]), [['RESERVATION', { B: 4, A: 2 }], ['RESERVATION_RELEASE', { B: 4, A: 2 }]], 'vuelve a los mismos lotes')
  await verificarLotes(v)

  // Cobrar una reserva: sale de los lotes en que se apartó.
  const r2 = await reservar(v, 6, { referencia: { tipo: 'ORDER', id: `res-${sufijo}-2` } })
  const cobro = await enA((tx) => consumirReservaEnTx(tx, ctx.a, r2.reservaId, { referencia: { tipo: 'ORDER', id: `res-${sufijo}-2` }, ahora: AHORA }, como(ctx.usuario)))
  assert.equal(cobro.repetido, false)
  assert.deepEqual(enMano(await lotesDe(v)), { A: 3, B: 0, C: 10, D: 7 })
  assert.deepEqual((await repartosDe('ORDER', `res-${sufijo}-2`)).map((m) => [m.tipo, m.lotes]), [['SALE', { B: 4, A: 2 }]])

  // Una reserva que vence sola devuelve a su lote.
  const r3 = await reservar(v, 3, { ttlMinutos: 1 })
  assert.deepEqual((await lotesDe(v)).A, { onHand: 3, reserved: 3, damaged: 0 })
  await enA((tx) => liberarReservaEnTx(tx, ctx.a, 'no-existe', {}, como(ctx.usuario))).catch(() => undefined)
  const despues = new Date(AHORA.getTime() + 5 * 60_000)
  await vender(v, 1, { ahora: despues, lotesSalida: [{ loteId: (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'C' }, select: { id: true } })).id, cantidad: 1 }] })
  const viva = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: r3.reservaId } })
  assert.equal(viva.status, 'EXPIRED', 'toda operación sobre el saldo vence antes las caducadas')
  assert.deepEqual((await lotesDe(v)).A, { onHand: 3, reserved: 0, damaged: 0 }, 'volvió a A, que es de donde salió')
  await verificarLotes(v)
})

test('9 · si el lote de lo apartado venció antes de cobrar, no se entrega vencido: se repone con el siguiente lote que se vende', async () => {
  const v = await producto('Swap')
  await activar(v)
  await entrada(v, [{ codigo: 'B', vencimiento: '2027-06-20', cantidad: 4 }, { codigo: 'A', vencimiento: '2027-07-01', cantidad: 5 }])
  const ref = { tipo: 'ORDER', id: `swap-${sufijo}` }
  const r = await reservar(v, 5, { ttlMinutos: 7 * 24 * 60, referencia: ref })
  assert.deepEqual((await repartosDe('RESERVATION', r.reservaId))[0].lotes, { B: 4, A: 1 })

  // Una semana después B ya venció (20-jun) y la reserva sigue viva (vence el 22-jun a las 12:00).
  await enA((tx) => consumirReservaEnTx(tx, ctx.a, r.reservaId, { referencia: ref, ahora: SEMANA_DESPUES }, como(ctx.usuario)))
  assert.deepEqual(await lotesDe(v), { B: { onHand: 4, reserved: 0, damaged: 0 }, A: { onHand: 0, reserved: 0, damaged: 0 } }, 'B queda disponible-vencido; se vendió todo de A')
  assert.deepEqual((await repartosDe('RESERVATION', r.reservaId)).map((m) => [m.tipo, m.lotes]), [
    ['RESERVATION', { B: 4, A: 1 }],
    ['RESERVATION_RELEASE', { B: 4 }],
    ['RESERVATION', { A: 4 }],
  ])
  assert.deepEqual((await repartosDe(ref.tipo, ref.id)).map((m) => [m.tipo, m.lotes]), [['SALE', { A: 5 }]])
  assert.equal((await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: r.reservaId } })).status, 'CONSUMED')
  await verificarLotes(v)

  // Sin con qué reponer, la venta no se puede completar y no queda nada a medias.
  const w = await producto('SwapSin')
  await activar(w)
  await entrada(w, [{ codigo: 'B', vencimiento: '2027-06-20', cantidad: 4 }])
  const rw = await reservar(w, 3, { ttlMinutos: 7 * 24 * 60 })
  assert.equal(await codigoDe(enA((tx) => consumirReservaEnTx(tx, ctx.a, rw.reservaId, { ahora: SEMANA_DESPUES }, como(ctx.usuario)))), 'LOTES_VENCIDOS')
  assert.equal((await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: rw.reservaId } })).status, 'ACTIVE')
  assert.deepEqual(await lotesDe(w), { B: { onHand: 4, reserved: 3, damaged: 0 } })
  await verificarLotes(w)
})

// ── Devoluciones ─────────────────────────────────────────────────────────────

test('10 · devolver vuelve a los lotes de que salió el pedido; lo que no explica va a «SIN LOTE»; una devolución suelta, también', async () => {
  const v = await producto('Devol')
  await activar(v)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-07-01', cantidad: 5 }, { codigo: 'B', vencimiento: '2027-06-20', cantidad: 4 }])
  const ref = { tipo: 'ORDER', id: `dev-${sufijo}` }
  await vender(v, 6, { referencia: ref })
  assert.deepEqual(enMano(await lotesDe(v)), { A: 3, B: 0 })

  const devolver = (cantidad: number, referencia: { tipo: string; id: string } | undefined = ref, lotes?: unknown) =>
    enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad, referencia, lotes, ahora: AHORA }, como(ctx.usuario)))
  await devolver(5)
  assert.deepEqual(enMano(await lotesDe(v)), { A: 4, B: 4 }, 'primero el lote que FEFO tocó primero (B), después A')
  assert.deepEqual((await repartosDe(ref.tipo, ref.id)).map((m) => [m.tipo, m.lotes]), [['SALE', { B: 4, A: 2 }], ['RETURN', { B: 4, A: 1 }]])

  await devolver(2) // quedaba 1 por volver a A; el otro no lo explica ninguna venta de este pedido
  assert.deepEqual(enMano(await lotesDe(v)), { A: 5, B: 4, 'SIN LOTE': 1 })

  await devolver(3, undefined) // sin pedido: al legado
  assert.equal((await lotesDe(v))['SIN LOTE'].onHand, 4)
  await devolver(2, undefined, [{ codigo: 'B', vencimiento: '2027-06-20', cantidad: 2 }]) // o al lote que se diga
  assert.equal((await lotesDe(v)).B.onHand, 6)
  await verificarLotes(v)
})

test('11 · el flujo REAL de pedidos con un producto con lotes: reservar, cobrar por QR y reembolsar devolviendo al inventario', async () => {
  const v = await producto('Pedido', 100)
  await activar(v)
  await entrada(v, [{ codigo: 'VIEJO', vencimiento: '2027-06-30', cantidad: 3 }, { codigo: 'NUEVO', vencimiento: '2028-01-31', cantidad: 10 }])
  const pedido = await enA((tx) =>
    crearPedidoEnTx(tx, ctx.a, { customerId: ctx.cli, locationId: ctx.suc1, origin: 'MARKETPLACE', atribucion: { channel: 'MARKETPLACE_BROWSE' }, lineas: [{ varianteId: v, cantidad: 5 }] }, clientePedido)
  )
  // Se reservó por FEFO: el viejo entero y dos del nuevo.
  const apartado = await lotesDe(v)
  assert.deepEqual([apartado.VIEJO.reserved, apartado.NUEVO.reserved], [3, 2])
  await verificarLotes(v)

  const listo = await enA((tx) => marcarListoEnTx(tx, ctx.a, pedido.pedidoId, empresaPedido(ctx.usuario)))
  await enA((tx) => completarPorQrEnTx(tx, ctx.a, listo.qrToken as string, empresaPedido(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v)), { VIEJO: 0, NUEVO: 8 })
  await verificarLotes(v)

  await enA((tx) => reembolsarPedidoEnTx(tx, ctx.a, pedido.pedidoId, { motivo: 'Prueba', devolverAlInventario: true }, empresaPedido(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v)), { VIEJO: 3, NUEVO: 10 }, 'cada unidad volvió a su lote')
  await verificarLotes(v)
  const ventas = (await repartosDe('ORDER', pedido.pedidoId)).map((m) => [m.tipo, m.lotes])
  assert.deepEqual(ventas, [['SALE', { VIEJO: 3, NUEVO: 2 }], ['RETURN', { VIEJO: 3, NUEVO: 2 }]])
})

// ── Daño, ajuste, baja, recuperar ────────────────────────────────────────────

test('12 · dañar, ajustar, dar de baja y recuperar trabajan por lote (el elegido o, si no, FEFO)', async () => {
  const v = await producto('Mermas')
  await activar(v)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-07-01', cantidad: 6 }, { codigo: 'B', vencimiento: '2027-06-20', cantidad: 5 }, { codigo: 'C', cantidad: 4 }])
  const idDe = async (codigo: string) => (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: codigo }, select: { id: true } })).id

  // Dañar sin decir el lote: FEFO. Eligiendo el lote: ese.
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2, motivoCodigo: 'HANDLING', exigirMotivoCodificado: true, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(await lotesDe(v), { A: { onHand: 6, reserved: 0, damaged: 0 }, B: { onHand: 3, reserved: 0, damaged: 2 }, C: { onHand: 4, reserved: 0, damaged: 0 } })
  const idC = await idDe('C')
  const idA = await idDe('A')
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, motivoCodigo: 'STORAGE', exigirMotivoCodificado: true, lotesSalida: [{ loteId: idC, cantidad: 1 }], ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual((await lotesDe(v)).C, { onHand: 3, reserved: 0, damaged: 1 })

  // Un faltante de un lote elegido y un sobrante en un lote NUEVO.
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cambio: -2, motivoCodigo: 'LOST', exigirMotivoCodificado: true, lotesSalida: [{ loteId: idA, cantidad: 2 }], ahora: AHORA }, como(ctx.usuario)))
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cambio: 3, motivoCodigo: 'FOUND', exigirMotivoCodificado: true, lotes: [{ codigo: 'HALLADO', vencimiento: '2027-08-15', cantidad: 3 }], ahora: AHORA }, como(ctx.usuario)))
  // Un sobrante sin decir el lote va a «SIN LOTE».
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cambio: 1, motivoCodigo: 'FOUND', exigirMotivoCodificado: true, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v)), { A: 4, B: 3, C: 3, HALLADO: 3, 'SIN LOTE': 1 })

  // Lo dañado: se da de baja (sin decir el lote sale de donde antes vence) o se recupera (eligiendo).
  await enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, destino: 'BAJA', motivoCodigo: 'HANDLING', exigirMotivoCodificado: true, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual({ B: (await lotesDe(v)).B.damaged, C: (await lotesDe(v)).C.damaged }, { B: 1, C: 1 }, 'la baja salió de B, el que antes vence')
  await enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, destino: 'VENDIBLE', lotesSalida: [{ loteId: idC, cantidad: 1 }], motivo: 'Estaba bien', ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual((await lotesDe(v)).C, { onHand: 4, reserved: 0, damaged: 0 })
  assert.equal(await codigoDe(enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 5, destino: 'BAJA', motivoCodigo: 'HANDLING', exigirMotivoCodificado: true, ahora: AHORA }, como(ctx.usuario)))), 'STOCK_INSUFICIENTE')
  await verificarLotes(v)
})

test('13 · mover unidades de un lote a otro corrige un lote mal capturado, deja rastro y NO cuenta como merma', async () => {
  const v = await producto('Reasigna')
  await activar(v)
  await entrada(v, [{ codigo: 'MAL', vencimiento: '2027-07-01', cantidad: 8 }, { codigo: 'BIEN', vencimiento: '2027-07-09', cantidad: 2 }])
  const id = async (codigo: string) => (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: codigo }, select: { id: true } })).id
  const mover = (cantidad: number, de: string, a: string, clave?: string) =>
    enA(async (tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, deLoteId: await id(de), aLoteId: await id(a), cantidad, idempotencyKey: clave, ahora: AHORA }, como(ctx.usuario)))

  const perdido = async () => (await enA((tx) => mermasEnTx(tx, ctx.a, { pagina: 1, motivo: undefined, q: v ? undefined : undefined }, { zonaHoraria: ZONA, conCostos: false, todas: true }))).grupos.PERDIDA.total.unidades
  const antes = await perdido()
  const r = await mover(5, 'MAL', 'BIEN', `mover-${sufijo}`)
  assert.equal(r.repetido, false)
  assert.deepEqual(enMano(await lotesDe(v)), { MAL: 3, BIEN: 7 })
  assert.equal((await nivelDe(v)).onHand, 10, 'el saldo de la sucursal no cambió')
  const ref = (await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: r.salidaId } })).referenceId!
  assert.deepEqual((await repartosDe('LOT_REASSIGN', ref)).map((m) => [m.tipo, m.motivo, m.lotes]), [['ADJUSTMENT', 'LOT_REASSIGN', { MAL: 5 }], ['ADJUSTMENT', 'LOT_REASSIGN', { BIEN: 5 }]])
  assert.equal(await perdido(), antes, 'una reasignación no es una pérdida')

  const otra = await mover(5, 'MAL', 'BIEN', `mover-${sufijo}`)
  assert.equal(otra.repetido, true)
  assert.equal((await lotesDe(v)).MAL.onHand, 3, 'la misma clave no lo repite')
  assert.equal(await codigoDe(mover(2, 'MAL', 'BIEN', `mover-${sufijo}`)), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(mover(4, 'MAL', 'BIEN')), 'MOVIMIENTO_INVALIDO', 'solo tiene 3')
  assert.equal(await codigoDe(mover(1, 'MAL', 'MAL')), 'MOVIMIENTO_INVALIDO')
  assert.equal(await codigoDe(enA(async (tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, deLoteId: await id('MAL'), aLoteId: 'otro', cantidad: 1 }, como(ctx.usuario)))), 'LOTE_NO_ENCONTRADO')
  const sinLotes = await producto()
  assert.equal(await codigoDe(enA((tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: sinLotes, sucursalId: ctx.suc1, deLoteId: 'x', aLoteId: 'y', cantidad: 1 }, como(ctx.usuario)))), 'LOTES_NO_APLICAN')
  await verificarLotes(v)
})

// ── Barrido de vencimientos ──────────────────────────────────────────────────

test('14 · el barrido saca de lo vendible lo disponible de los lotes vencidos (a dañado, motivo «Vencido») y es idempotente', async () => {
  const v = await productoFefo()
  // Aparta 3 de B (vence el 20-jun) con una reserva que sigue viva el 22-jun (si venciera, soltaría sus 3 y el barrido también las sacaría).
  await reservar(v, 3, { ttlMinutos: 7 * 24 * 60 })
  // El 22-jun B (20-jun) y D (1-jun) están vencidos: D tiene 7 disponibles; B, 1 disponible y 3 apartados.
  const r1 = await enA((tx) => vencerLotesEnTx(tx, ctx.a, SEMANA_DESPUES))
  assert.equal(r1.lotes >= 1, true)
  const lotes = await lotesDe(v)
  assert.equal(lotes.D.onHand, 0, 'D estaba vencido: sus 7 pasaron a dañado')
  assert.equal(lotes.D.damaged, 7)
  assert.equal(lotes.B.damaged, 1, 'de B solo lo disponible (1)')
  assert.equal(lotes.B.reserved, 3, 'lo apartado no se toca aquí')
  const danos = await repartosDe('LOT_EXPIRY', (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: 'D' }, select: { id: true } })).id)
  assert.deepEqual(danos.map((d) => [d.tipo, d.motivo, d.lotes]), [['DAMAGE', 'EXPIRED', { D: 7 }]])
  await verificarLotes(v)

  const r2 = await enA((tx) => vencerLotesEnTx(tx, ctx.a, SEMANA_DESPUES))
  assert.equal(r2.unidades, 0, 'una segunda pasada no encuentra nada')
  // Lo vendible sigue intacto: A y C.
  assert.deepEqual({ A: lotes.A.onHand, C: lotes.C.onHand }, { A: 5, C: 10 })
})

// ── Lo que todavía no admite lotes ───────────────────────────────────────────

test('15 · conteo y transferencia se niegan, con un mensaje claro, a tocar un producto con lotes', async () => {
  const v = await producto('Bloqueado')
  await activar(v)
  await entrada(v, [{ codigo: 'L', cantidad: 5 }])
  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const sin = (p: Promise<unknown>) => codigoDe(p)
  assert.equal(await sin(enA((tx) => contarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, conteo: 3 }, como(ctx.usuario)))), 'LOTES_NO_SOPORTADO')
  assert.equal(await sin(enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 1 }, como(ctx.usuario)))), 'LOTES_NO_SOPORTADO')
  assert.equal(await sin(enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: ctx.suc1, destinoId: ctx.suc2, lineas: [{ varianteId: v, cantidad: 1 }] }, como(ctx.usuario)))), 'LOTES_NO_SOPORTADO')
  const conteo = await enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId: ctx.suc2 }, como(ctx.usuario)))
  assert.equal(await sin(enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: conteo.conteoId, varianteId: v, cantidad: 1, modo: 'FIJAR' }, como(ctx.usuario)))), 'LOTES_NO_SOPORTADO')
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), antes, 'nada se movió')
  await verificarLotes(v)
  // Recibir suelto (una compra) pide el lote.
  assert.equal(await sin(enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2 }, como(ctx.usuario)))), 'LOTES_FALTAN')
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2, lotes: [{ codigo: 'SUELTO', vencimiento: '2027-10-10', cantidad: 2 }], ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v)), { L: 5, SUELTO: 2 })
})

// ── Un producto sin historial se borra con sus lotes ─────────────────────────

test('16 · un producto con lotes pero sin movimientos se borra con ellos; con movimientos, no', async () => {
  // Un ítem con tres variantes (una variante no se borra si es la última).
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `Con variantes ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `CV-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'Mediana', price: 20 }, como(ctx.usuario)))
  await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'Grande', price: 30 }, como(ctx.usuario)))
  const variantes = await prisma.catalogVariant.findMany({ where: { catalogItemId: r.id }, select: { id: true }, orderBy: { id: 'asc' } })
  const [libre, usado] = variantes.map((x) => x.id)

  await activar(libre)
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: libre } }), 1)
  await enA((tx) => eliminarVarianteEnTx(tx, ctx.a, libre, como(ctx.usuario)))
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: libre } }), 0)
  assert.equal(await prisma.inventoryLotTracking.count({ where: { catalogVariantId: libre } }), 0)
  assert.equal(await prisma.catalogVariant.count({ where: { id: libre } }), 0)

  await activar(usado)
  await entrada(usado, [{ codigo: 'L', cantidad: 1 }])
  assert.equal(await codigoDe(enA((tx) => eliminarVarianteEnTx(tx, ctx.a, usado, como(ctx.usuario)))), 'VARIANTE_CON_INVENTARIO')
})

// ── Las lecturas de lotes ────────────────────────────────────────────────────

test('17 · las lecturas: lotes por sucursal en orden FEFO con su estado, el texto de los lotes de cada movimiento y la búsqueda de productos', async () => {
  const v = await producto('Lecturas')
  const sin = await producto('SinLotes')
  await activar(v, true)
  await entrada(v, [
    { codigo: 'LEJANO', vencimiento: '2027-12-31', cantidad: 3 },
    { codigo: 'VENCIDO', vencimiento: '2027-06-01', cantidad: 2 },
    { codigo: 'PRONTO', vencimiento: '2027-06-20', cantidad: 4 },
    { codigo: 'SIN LOTE', cantidad: 1 },
  ])
  await entrada(v, [{ codigo: 'PRONTO', vencimiento: '2027-06-20', cantidad: 2 }], { sucursalId: ctx.suc2 })

  const r = await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, v, AHORA))
  assert.equal(r.lleva, true)
  assert.equal(r.exigeVencimiento, true)
  assert.equal(r.hoy, '2027-06-15')
  assert.deepEqual(r.porSucursal[ctx.suc1].map((l) => [l.codigo, l.estado, l.disponible]), [
    ['VENCIDO', 'VENCIDO', 2],
    ['PRONTO', 'POR_VENCER', 4],
    ['LEJANO', 'VIGENTE', 3],
    ['SIN LOTE', 'SIN_VENCIMIENTO', 1],
  ])
  assert.equal(r.porSucursal[ctx.suc1][1].textoVencimiento, 'Vence en 5 días')
  assert.equal(r.porSucursal[ctx.suc1][0].textoVencimiento, 'Venció hace 14 días')
  assert.deepEqual(r.porSucursal[ctx.suc2].map((l) => l.codigo), ['PRONTO'])
  assert.equal(r.catalogo.length, 4, 'el catálogo trae todos los lotes, también los que no tienen existencias en la sucursal')
  const noLleva = await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, sin, AHORA))
  assert.deepEqual(noLleva, { lleva: false, exigeVencimiento: false, hoy: '2027-06-15', catalogo: [], porSucursal: {} })
  // Un lote agotado no sale en la sucursal, pero sí en el catálogo.
  await vender(v, 4, { lotesSalida: [{ loteId: r.catalogo.find((l) => l.codigo === 'PRONTO')!.loteId, cantidad: 4 }] })
  const despues = await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, v, AHORA))
  assert.deepEqual(despues.porSucursal[ctx.suc1].map((l) => l.codigo), ['VENCIDO', 'LEJANO', 'SIN LOTE'])
  assert.equal(despues.catalogo.length, 4)

  // El historial y la búsqueda saben de los lotes.
  const hist = await enA((tx) => historialDeVarianteEnTx(tx, ctx.a, v))
  const venta = hist.filas.find((f) => f.tipo === 'SALE')!
  assert.equal(venta.lotes, 'PRONTO ×4')
  assert.equal(hist.filas.find((f) => f.tipo === 'PURCHASE' && f.cantidad === 10)?.lotes?.split(', ').length, 4, 'la entrada de 10 se repartió en 4 lotes')
  const busca = await enA((tx) => buscarVariantesParaEntradaEnTx(tx, ctx.a, 'Lecturas', ctx.suc1))
  assert.deepEqual(busca.filter((b) => b.id === v).map((b) => [b.llevaLotes, b.exigeVencimiento]), [[true, true]])
  const buscaSin = await enA((tx) => buscarVariantesParaEntradaEnTx(tx, ctx.a, 'SinLotes', ctx.suc1))
  assert.deepEqual(buscaSin.filter((b) => b.id === sin).map((b) => [b.llevaLotes, b.exigeVencimiento]), [[false, false]])
  // Y el detalle de una entrada dice de qué lotes llegó cada línea.
  const e = await entrada(v, [{ codigo: 'LEJANO', vencimiento: '2027-12-31', cantidad: 2 }, { codigo: 'NUEVO', vencimiento: '2028-03-01', cantidad: 1 }])
  const detalle = await enA((tx) => entradaDetalleEnTx(tx, ctx.a, e.entradaId))
  assert.equal(detalle?.detalle[0].lotes, 'LEJANO ×2, NUEVO ×1')
})

// ── Invariantes bajo operaciones al azar ─────────────────────────────────────

test('18 · después de CUALQUIER secuencia de operaciones, los lotes suman el saldo y cada saldo por lote es su apertura más sus movimientos; y las ventas por FEFO son exactamente el plan puro', async () => {
  let semilla = 20270615
  const azar = (max: number) => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla % max
  }
  const v = await producto('Azar')
  // Con existencias de antes de activar (para que haya apertura) en las dos sucursales.
  await entrada0(v, 12)
  await entrada0(v, 7, ctx.suc2)
  await activar(v)
  const fechas: Array<string | undefined> = [undefined, '2027-06-10', '2027-06-20', '2027-07-15', '2027-12-31']
  let operaciones = 0
  let fallidas = 0
  let hoy = AHORA

  const idDeLote = async (codigo: string) => (await prisma.inventoryLot.findFirst({ where: { catalogVariantId: v, code: codigo }, select: { id: true } }))?.id ?? null
  const intentar = async (fn: () => Promise<unknown>) => {
    operaciones++
    try {
      await fn()
    } catch (e) {
      // Solo se aceptan los rechazos de negocio; cualquier otro error es un defecto.
      const codigo = (e as { codigo?: string } | null)?.codigo
      assert.ok(codigo && ['STOCK_INSUFICIENTE', 'MOVIMIENTO_INVALIDO', 'LOTE_NO_ENCONTRADO', 'LOTES_VENCIDOS', 'LOTE_VENCIMIENTO_DISTINTO'].includes(codigo), `rechazo inesperado: ${codigo ?? e}`)
      fallidas++
    }
  }

  for (let paso = 0; paso < 70; paso++) {
    const suc = azar(2) === 0 ? ctx.suc1 : ctx.suc2
    const cantidad = 1 + azar(6)
    const lotes = ['L1', 'L2', 'L3', 'L4']
    const codigo = lotes[azar(lotes.length)]
    switch (azar(10)) {
      case 0:
      case 1: {
        // Cada código tiene SIEMPRE el mismo vencimiento (un lote tiene uno solo).
        const vence = fechas[lotes.indexOf(codigo) % fechas.length] ?? undefined
        await intentar(() => entrada(v, [{ codigo, ...(vence ? { vencimiento: vence } : {}), cantidad }], { sucursalId: suc }))
        break
      }
      case 2:
      case 3: {
        // La venta sale EXACTAMENTE como la reparte el plan puro de FEFO sobre lo que había en la base justo antes.
        const vistos = (await enA((tx) => lotesDeVarianteEnTx(tx, ctx.a, v, hoy))).porSucursal[suc] ?? []
        const plan = repartirFefo(
          vistos.map((x) => ({ loteId: x.loteId, codigo: x.codigo, vencimiento: x.vencimiento, legado: x.legado, creadoEn: 0, onHand: x.onHand, reserved: x.reserved, damaged: x.damaged })),
          cantidad,
          diaLocal(hoy, ZONA)
        )
        const fallidasAntes = fallidas
        await intentar(() => vender(v, cantidad, { sucursalId: suc, ahora: hoy }))
        const despuesDeVender = await lotesDe(v, suc)
        if (plan.ok) {
          assert.equal(fallidas, fallidasAntes, 'si el plan puro alcanza, la venta no se rechaza')
          const sale = new Map(plan.reparto.map((r) => [vistos.find((x) => x.loteId === r.loteId)!.codigo, r.cantidad]))
          for (const x of vistos) assert.equal(despuesDeVender[x.codigo].onHand, x.onHand - (sale.get(x.codigo) ?? 0), `FEFO: lote ${x.codigo}`)
        } else {
          assert.equal(fallidas, fallidasAntes + 1, 'si el plan puro no alcanza, la venta se rechaza')
          for (const x of vistos) assert.equal(despuesDeVender[x.codigo].onHand, x.onHand, `un rechazo no mueve nada (${x.codigo})`)
        }
        break
      }
      case 4: {
        const r = await reservar(v, cantidad, { sucursalId: suc, ttlMinutos: 7 * 24 * 60, ahora: hoy }).catch((e: unknown) => e)
        operaciones++
        if (r && typeof r === 'object' && 'reservaId' in r) {
          // Se cobra o se libera, a la suerte.
          await intentar(() =>
            azar(2) === 0
              ? enA((tx) => consumirReservaEnTx(tx, ctx.a, (r as { reservaId: string }).reservaId, { ahora: hoy }, como(ctx.usuario)))
              : enA((tx) => liberarReservaEnTx(tx, ctx.a, (r as { reservaId: string }).reservaId, { ahora: hoy }, como(ctx.usuario)))
          )
        }
        break
      }
      case 5:
        await intentar(() => enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: suc, cantidad, motivoCodigo: 'HANDLING', exigirMotivoCodificado: true, ahora: hoy }, como(ctx.usuario))))
        break
      case 6:
        await intentar(() => enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: suc, cambio: azar(2) === 0 ? cantidad : -cantidad, motivoCodigo: 'FOUND', exigirMotivoCodificado: true, ahora: hoy }, { ...como(ctx.usuario) })))
        break
      case 7:
        await intentar(() => enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: suc, cantidad, destino: azar(2) === 0 ? 'BAJA' : 'VENDIBLE', motivoCodigo: 'HANDLING', exigirMotivoCodificado: true, motivo: 'a', ahora: hoy }, como(ctx.usuario))))
        break
      case 8: {
        const de = await idDeLote(codigo)
        const a = await idDeLote(lotes[(lotes.indexOf(codigo) + 1) % lotes.length])
        if (de && a) await intentar(() => enA((tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: v, sucursalId: suc, deLoteId: de, aLoteId: a, cantidad, ahora: hoy }, como(ctx.usuario))))
        break
      }
      default:
        // El tiempo pasa: unos días después, vence más y el barrido saca lo vencido.
        hoy = new Date(hoy.getTime() + (1 + azar(5)) * 86_400_000)
        await intentar(() => enA((tx) => vencerLotesEnTx(tx, ctx.a, hoy)))
    }
    await verificarLotes(v)
  }
  assert.ok(operaciones >= 70)
  assert.ok(fallidas < operaciones, 'no todo fue rechazado')
  const total = await prisma.inventoryMovementLot.count({ where: { companyId: ctx.a, balance: { catalogVariantId: v } } })
  assert.ok(total > 30, 'se movieron muchos lotes de verdad')
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('19 · varias ventas a la vez de la última unidad: ganan las que hay, el resto se rechaza, y los lotes siguen cuadrando', async () => {
  const v = await producto('Carrera')
  await activar(v)
  await entrada(v, [{ codigo: 'A', vencimiento: '2027-08-01', cantidad: 3 }, { codigo: 'B', vencimiento: '2027-09-01', cantidad: 2 }])
  const resultados = await Promise.allSettled(Array.from({ length: 9 }, () => vender(v, 1)))
  const bien = resultados.filter((r) => r.status === 'fulfilled').length
  const mal = resultados.filter((r) => r.status === 'rejected')
  assert.equal(bien, 5)
  assert.ok(mal.every((r) => (r.reason as { codigo?: string }).codigo === 'STOCK_INSUFICIENTE'), 'las demás, por falta de stock y nada más')
  assert.deepEqual(enMano(await lotesDe(v)), { A: 0, B: 0 })
  await verificarLotes(v)
})

test('20 · activar los lotes mientras se vende: ninguna venta falla ni descuadra, antes o después de activar', async () => {
  for (let ronda = 0; ronda < 4; ronda++) {
    const v = await producto('Activar y vender')
    await entrada0(v, 30)
    await entrada0(v, 10, ctx.suc2)
    const [act, ...ventas] = await Promise.allSettled([
      activar(v),
      ...Array.from({ length: 8 }, (_, i) => vender(v, 1, { sucursalId: i % 2 === 0 ? ctx.suc1 : ctx.suc2 })),
      enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 2 }] }, como(ctx.usuario))),
    ])
    assert.equal(act.status, 'fulfilled', act.status === 'rejected' ? String(act.reason) : '')
    // Una entrada sin lotes que cae DESPUÉS de activar se rechaza por falta de lote (no hay forma de saber de cuál es); las ventas, nunca.
    for (const r of ventas.slice(0, 8)) assert.equal(r.status, 'fulfilled', r.status === 'rejected' ? String((r.reason as Error).message) : '')
    const entrada0Resultado = ventas[8]
    if (entrada0Resultado.status === 'rejected') assert.equal((entrada0Resultado.reason as { codigo?: string }).codigo, 'LOTES_FALTAN')
    await verificarLotes(v)
    assert.ok(await prisma.inventoryLotTracking.findUnique({ where: { catalogVariantId: v } }))
  }
})

test('21 · dos entradas simultáneas del MISMO lote nuevo no chocan; con otro vencimiento, una se rechaza', async () => {
  const v = await producto('Mismo lote')
  await activar(v)
  const [a, b] = await Promise.allSettled([
    entrada(v, [{ codigo: 'NUEVO', vencimiento: '2027-10-01', cantidad: 3 }], { sucursalId: ctx.suc1 }),
    entrada(v, [{ codigo: 'NUEVO', vencimiento: '2027-10-01', cantidad: 4 }], { sucursalId: ctx.suc2 }),
  ])
  assert.equal(a.status, 'fulfilled')
  assert.equal(b.status, 'fulfilled')
  assert.equal(await prisma.inventoryLot.count({ where: { catalogVariantId: v, code: 'NUEVO' } }), 1)
  const w = await producto('Otro vencimiento')
  await activar(w)
  const dos = await Promise.allSettled([
    entrada(w, [{ codigo: 'X', vencimiento: '2027-10-01', cantidad: 1 }], { sucursalId: ctx.suc1 }),
    entrada(w, [{ codigo: 'X', vencimiento: '2027-11-01', cantidad: 1 }], { sucursalId: ctx.suc2 }),
  ])
  assert.deepEqual(dos.map((d) => d.status).sort(), ['fulfilled', 'rejected'])
  const rechazo = dos.find((d) => d.status === 'rejected') as PromiseRejectedResult
  assert.equal((rechazo.reason as { codigo?: string }).codigo, 'LOTE_VENCIMIENTO_DISTINTO')
  await verificarLotes(v)
  await verificarLotes(w)
})

// ── El barrido del cron ──────────────────────────────────────────────────────

test('22 · el barrido del cron vence reservas y lotes de la empresa, y una segunda pasada no repite nada', async () => {
  const v = await producto('Cron')
  await activar(v)
  await entrada(v, [{ codigo: 'PASADO', vencimiento: '2027-06-10', cantidad: 6 }, { codigo: 'FUTURO', vencimiento: '2027-12-31', cantidad: 6 }])
  const r1 = await barridoInventario(SEMANA_DESPUES)
  assert.ok(r1.lotesVencidos >= 1 && r1.unidadesVencidas >= 6)
  assert.equal(r1.empresasConError, 0)
  assert.deepEqual(await lotesDe(v), { PASADO: { onHand: 0, reserved: 0, damaged: 6 }, FUTURO: { onHand: 6, reserved: 0, damaged: 0 } })
  const r2 = await barridoInventario(SEMANA_DESPUES)
  assert.equal(r2.unidadesVencidas, 0)
  await verificarLotes(v)
})

test('23 · «hoy» es el día de la EMPRESA, no el del servidor: de noche en Santo Domingo ya es otro día en UTC', async () => {
  const v = await producto('Zona horaria')
  await activar(v)
  await entrada(v, [{ codigo: 'HOY', vencimiento: '2027-06-15', cantidad: 3 }])
  // 02:00 UTC del 16-jun son las 22:00 del 15-jun en Santo Domingo: el lote que vence el 15 todavía se vende…
  await vender(v, 1, { ahora: new Date('2027-06-16T02:00:00Z') })
  // …y a las 05:00 UTC (01:00 del 16-jun allá) ya no.
  assert.equal(await codigoDe(vender(v, 1, { ahora: new Date('2027-06-16T05:00:00Z') })), 'STOCK_INSUFICIENTE')
  // El barrido sigue la misma regla.
  assert.equal((await enA((tx) => vencerLotesEnTx(tx, ctx.a, new Date('2027-06-16T02:00:00Z')))).unidades, 0)
  assert.equal((await enA((tx) => vencerLotesEnTx(tx, ctx.a, new Date('2027-06-16T05:00:00Z')))).unidades >= 2, true)
  assert.equal((await lotesDe(v)).HOY.damaged, 2)
  await verificarLotes(v)
})

test('24 · una entrada con un producto con lotes y otro sin ellos: cada uno por su camino, en la misma transacción', async () => {
  const con = await producto('Mixto con lotes')
  const sin = await producto('Mixto sin lotes')
  await activar(con)
  const r = await enA((tx) =>
    registrarEntradaMultipleEnTx(
      tx,
      ctx.a,
      { sucursalId: ctx.suc1, lineas: [{ varianteId: con, cantidad: 5, lotes: [{ codigo: 'M-1', vencimiento: '2027-09-09', cantidad: 5 }] }, { varianteId: sin, cantidad: 7 }], ahora: AHORA },
      como(ctx.usuario)
    )
  )
  assert.equal(r.unidades, 12)
  assert.deepEqual(enMano(await lotesDe(con)), { 'M-1': 5 })
  assert.equal((await nivelDe(sin)).onHand, 7)
  assert.equal(await prisma.inventoryLotBalance.count({ where: { catalogVariantId: sin } }), 0, 'el producto sin lotes no tiene saldos por lote')
  await verificarLotes(con)
})

test('25 · lo que se recuerda de «lleva lotes» vive y muere con su transacción: no se filtra a la siguiente', async () => {
  const v = await producto('Memoria')
  const vistos = new Set<unknown>()
  await enA(async (tx) => {
    vistos.add(tx)
  })
  await enA(async (tx) => {
    vistos.add(tx)
  })
  assert.equal(vistos.size, 2, 'cada transacción es un objeto distinto')
  // En la práctica: se opera sin lotes (y esa transacción lo recuerda), se activan, y la SIGUIENTE ya sabe que el producto los lleva.
  await entrada0(v, 3)
  await activar(v)
  assert.equal(await codigoDe(enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: v, cantidad: 1 }] }, como(ctx.usuario)))), 'LOTES_FALTAN')
  // Y dentro de UNA transacción: operar, activar y volver a operar ve el cambio (la activación olvida lo recordado).
  const w = await producto('Memoria interna')
  await entrada0(w, 2)
  const codigo = await enA(async (tx) => {
    // Una venta imposible (no escribe nada) hace que esta transacción vea y recuerde que el producto NO lleva lotes…
    await venderEnTx(tx, ctx.a, { varianteId: w, sucursalId: ctx.suc1, cantidad: 99, ahora: AHORA }, como(ctx.usuario)).catch(() => undefined)
    // …se activan los lotes en ella…
    await activarLotesEnTx(tx, ctx.a, { varianteId: w, ahora: AHORA }, como(ctx.usuario))
    // …y lo recordado se olvidó: la entrada ve que ahora sí los lleva.
    try {
      await registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.suc1, lineas: [{ varianteId: w, cantidad: 1 }] }, como(ctx.usuario))
      return 'SIN_ERROR'
    } catch (e) {
      return (e as { codigo?: string }).codigo ?? 'OTRO'
    }
  })
  assert.equal(codigo, 'LOTES_FALTAN', 'ya llevaba lotes aunque lo habían visto sin ellos antes de activar')
})

// ── Lo que las mutaciones dejaron ver: pruebas de comportamiento para lo que sólo una guardia de texto cubría ──────────────────────

test('26 · mover entre lotes: la misma clave con otro lote de origen o de destino es otra operación, no un reintento', async () => {
  const v = await producto('ReasignaClave')
  await activar(v)
  await entrada(v, [{ codigo: 'L-1', vencimiento: '2027-07-01', cantidad: 8 }, { codigo: 'L-2', vencimiento: '2027-07-09', cantidad: 8 }, { codigo: 'L-3', vencimiento: '2027-07-20', cantidad: 8 }])
  const id = async (codigo: string) => (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: codigo }, select: { id: true } })).id
  const mover = (cantidad: number, de: string, a: string, clave: string) =>
    enA(async (tx) => moverEntreLotesEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, deLoteId: await id(de), aLoteId: await id(a), cantidad, idempotencyKey: clave, ahora: AHORA }, como(ctx.usuario)))
  const clave = `mc-${sufijo}`
  assert.equal((await mover(3, 'L-1', 'L-2', clave)).repetido, false)
  assert.equal((await mover(3, 'L-1', 'L-2', clave)).repetido, true, 'lo mismo con la misma clave es un reintento')
  assert.equal(await codigoDe(mover(3, 'L-3', 'L-2', clave)), 'CLAVE_REUTILIZADA', 'mismo destino y cantidad, otro origen')
  assert.equal(await codigoDe(mover(3, 'L-1', 'L-3', clave)), 'CLAVE_REUTILIZADA', 'mismo origen y cantidad, otro destino')
  assert.equal(await codigoDe(mover(3, 'L-2', 'L-1', clave)), 'CLAVE_REUTILIZADA', 'origen y destino intercambiados')
  assert.deepEqual(enMano(await lotesDe(v)), { 'L-1': 5, 'L-2': 11, 'L-3': 8 }, 'ni el reintento ni los rechazos movieron nada más')
  await verificarLotes(v)
})

test('27 · devolver vuelve primero al lote de que antes salió (FEFO), sin depender de cómo se llamen ni de cuándo se crearon los lotes', async () => {
  // Dos productos con los lotes en el orden contrario de código (y, por lo tanto, de creación): el id del lote que vence antes es
  // el menor en uno y el mayor en el otro. Un desempate por id —o por llegada— acertaría en uno y fallaría en el otro.
  for (const [temprano, tardio] of [['E-TEMPRANO', 'F-TARDIO'], ['Z-TEMPRANO', 'A-TARDIO']]) {
    const v = await producto('Devol orden')
    await activar(v)
    await entrada(v, [{ codigo: temprano, vencimiento: '2027-07-01', cantidad: 3 }, { codigo: tardio, vencimiento: '2027-09-01', cantidad: 3 }])
    const ref = { tipo: 'ORDER', id: `dev-orden-${temprano}-${sufijo}` }
    await vender(v, 5, { referencia: ref })
    assert.deepEqual(enMano(await lotesDe(v)), { [temprano]: 0, [tardio]: 1 })
    await enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2, referencia: ref, ahora: AHORA }, como(ctx.usuario)))
    assert.deepEqual(enMano(await lotesDe(v)), { [temprano]: 2, [tardio]: 1 }, `${temprano}: las 2 unidades vuelven al lote que salió primero`)
    await verificarLotes(v)
  }
})

test('28 · el barrido vence antes las reservas caducadas de un saldo: lo apartado vuelve a disponible y sale con el lote vencido', async () => {
  const v = await producto('Barrido reservas')
  await activar(v)
  await entrada(v, [{ codigo: 'PASA', vencimiento: '2027-06-20', cantidad: 6 }])
  // Aparta 3 con una reserva de una hora (vence mucho antes de la semana siguiente, cuando el lote ya venció).
  const r = await reservar(v, 3, { ttlMinutos: 60 })
  assert.deepEqual(await lotesDe(v), { PASA: { onHand: 6, reserved: 3, damaged: 0 } })
  const barrido = await enA((tx) => vencerLotesEnTx(tx, ctx.a, SEMANA_DESPUES))
  assert.equal(barrido.unidades, 6, 'las 3 disponibles y las 3 que dejó libres la reserva caducada')
  assert.deepEqual(await lotesDe(v), { PASA: { onHand: 0, reserved: 0, damaged: 6 } })
  assert.equal((await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: r.reservaId } })).status, 'EXPIRED')
  await verificarLotes(v)
})

test('29 · un producto sin lotes no admite que se le indiquen lotes de salida', async () => {
  const sin = await producto('Sin lotes salida')
  await entrada0(sin, 5)
  assert.equal(await codigoDe(vender(sin, 1, { lotesSalida: [{ loteId: 'cualquiera', cantidad: 1 }] })), 'LOTES_NO_APLICAN')
  assert.equal((await nivelDe(sin)).onHand, 5, 'el rechazo no movió nada')
  await vender(sin, 1) // sin indicar lotes, sí
  assert.equal((await nivelDe(sin)).onHand, 4)
})

// ── El candado de empresa, con compuertas (sin depender de la suerte de las carreras) ─────────────────────────────────────────────

/** Una compuerta: lo que espera `pasa` sigue cuando alguien llama a `abrir()`. */
function compuerta(): { pasa: Promise<void>; abrir: () => void } {
  let abrir = () => {}
  const pasa = new Promise<void>((resolver) => {
    abrir = resolver
  })
  return { pasa, abrir }
}
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))

test('30 · el candado de empresa: activar espera a una operación en curso de OTRO producto; y una operación espera a una activación en curso', async () => {
  // (a) Una venta de W sigue abierta (tiene el candado compartido de la empresa); activar V —otro producto, sin saldos en común— espera.
  const w = await producto('Candado W')
  await entrada0(w, 5)
  const v = await producto('Candado V')
  const abierta = compuerta()
  const dentro = compuerta()
  const enCurso = enA(async (tx) => {
    await venderEnTx(tx, ctx.a, { varianteId: w, sucursalId: ctx.suc1, cantidad: 1, ahora: AHORA }, como(ctx.usuario))
    dentro.abrir()
    await abierta.pasa
  })
  await dentro.pasa
  let activada = false
  const activando = activar(v).then(() => {
    activada = true
  })
  await esperar(600)
  assert.equal(activada, false, 'activar espera a que termine la venta en curso')
  abierta.abrir()
  await Promise.all([enCurso, activando])
  assert.equal(activada, true)
  assert.ok(await prisma.inventoryLotTracking.findUnique({ where: { catalogVariantId: v } }))

  // (b) Una activación de X sigue abierta (candado exclusivo): una venta de Y —otro producto— espera a que confirme.
  const x = await producto('Candado X')
  const y = await producto('Candado Y')
  await entrada0(y, 5)
  const activacionAbierta = compuerta()
  const activacionDentro = compuerta()
  const activacion = enA(async (tx) => {
    await activarLotesEnTx(tx, ctx.a, { varianteId: x, ahora: AHORA }, como(ctx.usuario))
    activacionDentro.abrir()
    await activacionAbierta.pasa
  })
  await activacionDentro.pasa
  let vendida = false
  const venta = vender(y, 1).then(() => {
    vendida = true
  })
  await esperar(600)
  assert.equal(vendida, false, 'una operación sobre el inventario espera a que termine la activación en curso')
  activacionAbierta.abrir()
  await Promise.all([activacion, venta])
  assert.equal(vendida, true)
  assert.equal((await nivelDe(y)).onHand, 4)
})

test('31 · activar los lotes vence antes las reservas caducadas: lo apartado que ya no vale no pasa a «SIN LOTE» como apartado', async () => {
  const v = await producto('Activar con caducadas')
  await entrada0(v, 6)
  const r = await reservar(v, 4, { ttlMinutos: 60 })
  assert.equal((await nivelDe(v)).reserved, 4)
  // Una semana después la reserva (de una hora) lleva días caducada y nadie la ha barrido: al activar se vence antes de copiar lo apartado.
  await enA((tx) => activarLotesEnTx(tx, ctx.a, { varianteId: v, ahora: SEMANA_DESPUES }, como(ctx.usuario)))
  assert.equal((await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: r.reservaId } })).status, 'EXPIRED')
  assert.deepEqual(await lotesDe(v), { 'SIN LOTE': { onHand: 6, reserved: 0, damaged: 0 } })
  await verificarLotes(v)
})
