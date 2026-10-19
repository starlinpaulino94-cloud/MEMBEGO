import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import {
  abrirConteoEnTx,
  activarLotesEnTx,
  aplicarConteoEnTx,
  cancelarConteoEnTx,
  contarEnTx,
  importarConteoEnTx,
  quitarLineaDeConteoEnTx,
  registrarConteoProductoEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import { conteoDetalleEnTx, hojaDeConteoEnTx, lotesParaContarEnTx, porContarEnTx, saldosActualesDeConteoEnTx } from '../../src/modules/inventory/queries'
import { claveDeLinea } from '../../src/modules/inventory/conteos'
import { aplicarImportacionDeConteoEnTx, informeDeConteoImportadoEnTx } from '../../src/modules/inventory/importar'
import { hojaDeConteoToCsv } from '../../src/modules/inventory/exportacion'

/**
 * INV-5b3 · CONTEO POR LOTE contra PostgreSQL de verdad, con el servicio real.
 *
 * Un producto que lleva lotes se cuenta LOTE POR LOTE: su línea de conteo es «producto + lote», con lo contado de ese lote y lo que el
 * sistema decía de ese lote al contar; al aplicar, cada línea con diferencia es un ajuste del producto cuyo reparto es ese lote. Lo que
 * solo se comprueba aquí:
 *
 *  · contar, recontar, sumar y quitar por lote; que el lote es obligatorio (y de ese producto) si el producto lleva lotes y prohibido si no;
 *  · aplicar: sobrantes y faltantes en lotes distintos del mismo producto (varios movimientos sobre un mismo saldo, en rondas), con el
 *    saldo del producto y los saldos por lote al día, y una línea de un lote que dejaría menos de lo apartado en ESE lote rechaza todo;
 *  · lo que se vendió mientras se contaba no se pierde (se ajusta la diferencia, por lote);
 *  · «sin contar» cuenta lotes; la hoja en blanco y la lista de «por contar» salen por lote; los lotes para elegir al contar no dicen cantidades;
 *  · la base: una línea de un producto con lotes sin lote (o al revés), un lote de otro producto, una línea repetida y los cambios a un
 *    conteo cerrado se rechazan aunque se escriba por fuera del servicio;
 *  · la concurrencia: dos capturas del mismo lote a la vez suman, y dos aplicaciones a la vez aplican una sola vez.
 *
 * Las fechas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`). `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
/** 12:00 en Santo Domingo del 15-jun-2027. */
const AHORA = new Date('2027-06-15T16:00:00.000Z')

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
/** Un producto físico ACTIVO de la empresa A. Devuelve su variante. */
async function producto(nombre = 'Conteo'): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku: `CT-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
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

interface LoteEntrante {
  codigo: string
  vencimiento?: string | null
  cantidad: number
}
/** Una entrada de UN producto con sus lotes (o sin ellos). */
const entrada = (v: string, lotes: LoteEntrante[] | null, cantidad: number, sucursalId = ctx.suc1) =>
  enA((tx) =>
    registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId: v, cantidad: lotes ? lotes.reduce((s, l) => s + l.cantidad, 0) : cantidad, ...(lotes ? { lotes } : {}) }], ahora: AHORA }, como(ctx.usuario))
  )

const loteId = async (v: string, codigo: string) => (await prisma.inventoryLot.findFirstOrThrow({ where: { catalogVariantId: v, code: codigo }, select: { id: true } })).id

async function nivelDe(v: string, sucursalId = ctx.suc1) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursalId } } })
}

type Cubetas3 = { onHand: number; reserved: number; damaged: number }
async function lotesDe(v: string, sucursalId = ctx.suc1): Promise<Record<string, Cubetas3>> {
  const nivel = await nivelDe(v, sucursalId)
  const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: nivel.id }, select: { onHand: true, reserved: true, damaged: true, lot: { select: { code: true } } } })
  return Object.fromEntries(bs.map((b) => [b.lot.code, { onHand: b.onHand, reserved: b.reserved, damaged: b.damaged }]))
}
const enMano = (m: Record<string, Cubetas3>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.onHand]))

/** Los lotes suman el saldo de la sucursal (las tres cubetas). */
async function verificarLotes(v: string): Promise<void> {
  const niveles = await prisma.inventoryLevel.findMany({ where: { catalogVariantId: v }, select: { id: true, onHand: true, reserved: true, damaged: true } })
  for (const n of niveles) {
    const bs = await prisma.inventoryLotBalance.findMany({ where: { inventoryLevelId: n.id }, select: { onHand: true, reserved: true, damaged: true } })
    const suma = bs.reduce((t, b) => ({ onHand: t.onHand + b.onHand, reserved: t.reserved + b.reserved, damaged: t.damaged + b.damaged }), { onHand: 0, reserved: 0, damaged: 0 })
    assert.deepEqual(suma, { onHand: n.onHand, reserved: n.reserved, damaged: n.damaged }, 'los lotes suman el saldo de la sucursal')
  }
}

const abrir = (sucursalId = ctx.suc1) => enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId, ahora: AHORA }, como(ctx.usuario)))
const contar = (conteoId: string, varianteId: string, lote: string | null, cantidad: number, modo: 'SUMAR' | 'FIJAR' = 'FIJAR') =>
  enA(async (tx) =>
    registrarConteoProductoEnTx(tx, ctx.a, { conteoId, varianteId, loteId: lote === null ? null : await loteId(varianteId, lote), cantidad, modo, ahora: AHORA }, como(ctx.usuario))
  )
const aplicar = (conteoId: string) => enA((tx) => aplicarConteoEnTx(tx, ctx.a, { conteoId, ahora: AHORA }, como(ctx.usuario)))
/** Las líneas de un conteo, por producto y código de lote (el orden de las claves no depende de la base). */
const lineasDe = async (conteoId: string) =>
  (await prisma.inventoryCountLine.findMany({ where: { sessionId: conteoId }, select: { catalogVariantId: true, counted: true, expected: true, onHandBefore: true, onHandAfter: true, movementId: true, lot: { select: { code: true } } } })).sort(
    (a, b) => (a.catalogVariantId + '|' + (a.lot?.code ?? '')).localeCompare(b.catalogVariantId + '|' + (b.lot?.code ?? ''))
  )

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Conteo lotes ${x} ${sufijo}`, slug: `conteo-lotes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b] = await Promise.all([mk('a'), mk('b')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-cntlot-${sufijo}`, email: `cntlot-${sufijo}@prueba.test`, name: 'Contador', role: 'SUPERADMIN' }, select: { id: true } })).id
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
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_count_lines',
        'inventory_count_sessions',
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
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── Contar y aplicar ─────────────────────────────────────────────────────────

test('1 · se cuenta lote por lote y al aplicar cada lote se ajusta por SU diferencia: un lote sobra y otro falta, y los saldos cuadran', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'A-1', vencimiento: '2027-09-01', cantidad: 10 }, { codigo: 'B-2', vencimiento: '2027-12-01', cantidad: 5 }], 15)
  const c = await abrir()

  // Contar sin decir el lote, con el lote de otro producto o con un lote en un producto que no los lleva: no se admite.
  const otro = await producto('Otro')
  await activar(otro)
  await entrada(otro, [{ codigo: 'X-1', cantidad: 3 }], 3)
  const simple = await producto('Simple')
  await entrada(simple, null, 4)
  assert.equal(await codigoDe(contar(c.conteoId, v, null, 3)), 'LOTES_FALTAN')
  assert.equal(await codigoDe(enA(async (tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: v, loteId: await loteId(otro, 'X-1'), cantidad: 3, modo: 'FIJAR' }, como(ctx.usuario)))), 'LOTE_NO_ENCONTRADO')
  assert.equal(await codigoDe(enA(async (tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: simple, loteId: await loteId(v, 'A-1'), cantidad: 3, modo: 'FIJAR' }, como(ctx.usuario)))), 'LOTES_NO_APLICAN')
  assert.equal(await codigoDe(enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: v, loteId: 'no-existe', cantidad: 3, modo: 'FIJAR' }, como(ctx.usuario)))), 'LOTE_NO_ENCONTRADO')
  assert.equal(await prisma.inventoryCountLine.count({ where: { sessionId: c.conteoId } }), 0, 'nada de eso dejó una línea')

  // Contar: A-1 cuenta 8 (sumando 3 y 5), B-2 cuenta 7; y el producto sin lotes, como siempre.
  const a1 = await contar(c.conteoId, v, 'A-1', 3, 'SUMAR')
  assert.deepEqual([a1.nueva, a1.contado, a1.lineas], [true, 3, 1])
  const a2 = await contar(c.conteoId, v, 'A-1', 5, 'SUMAR')
  assert.deepEqual([a2.nueva, a2.contado], [false, 8])
  const b = await contar(c.conteoId, v, 'B-2', 7)
  assert.equal(b.lineas, 2)
  await contar(c.conteoId, simple, null, 4)
  assert.deepEqual(
    Object.fromEntries((await lineasDe(c.conteoId)).map((l) => [l.lot?.code ?? 'SIN LOTES', [l.counted, l.expected]])),
    { 'A-1': [8, 10], 'B-2': [7, 5], 'SIN LOTES': [4, 4] },
    'lo esperado de cada línea es el saldo de ESE lote'
  )

  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  if (!r.aplicada) return
  assert.deepEqual(r.resumen, { lineas: 3, ajustadas: 2, unidadesSobrantes: 2, unidadesFaltantes: 2, sinContar: 1 }, 'queda sin contar el lote de otro producto que también tiene existencias en la sucursal')
  assert.deepEqual(r.variantesBajadas, [v], 'el producto cuyo vendible bajó (para el aviso de stock bajo)')
  assert.deepEqual(enMano(await lotesDe(v)), { 'A-1': 8, 'B-2': 7 })
  assert.equal((await nivelDe(v)).onHand, 15, 'el saldo del producto: -2 + 2')
  await verificarLotes(v)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }) - antes, 2, 'un movimiento por lote con diferencia (el sin lotes coincide)')

  // Cada ajuste es de UN lote, con el motivo de los conteos, y cada línea guarda su movimiento y sus existencias de antes y después.
  const movs = await prisma.inventoryMovement.findMany({
    where: { companyId: ctx.a, referenceType: 'STOCK_COUNT', referenceId: c.conteoId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, quantity: true, sourceBucket: true, destinationBucket: true, reasonCode: true, lotSplits: { select: { quantity: true, balance: { select: { lot: { select: { code: true } } } } } } },
  })
  const resumenMovs = movs.map((m) => [m.type, m.sourceBucket, m.destinationBucket, m.quantity, m.reasonCode, Object.fromEntries(m.lotSplits.map((x) => [x.balance.lot.code, x.quantity]))]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  assert.deepEqual(resumenMovs, [
    ['ADJUSTMENT', 'AVAILABLE', null, 2, 'COUNT_DIFFERENCE', { 'A-1': 2 }],
    ['ADJUSTMENT', null, 'AVAILABLE', 2, 'COUNT_DIFFERENCE', { 'B-2': 2 }],
  ])
  const lineas = await lineasDe(c.conteoId)
  const delLote = (codigo: string) => lineas.find((l) => l.lot?.code === codigo)!
  assert.deepEqual([delLote('A-1').onHandBefore, delLote('A-1').onHandAfter, delLote('A-1').movementId !== null], [10, 8, true])
  assert.deepEqual([delLote('B-2').onHandBefore, delLote('B-2').onHandAfter, delLote('B-2').movementId !== null], [5, 7, true])
  const sinLote = lineas.find((l) => l.lot === null)!
  assert.deepEqual([sinLote.onHandBefore, sinLote.onHandAfter, sinLote.movementId], [4, 4, null], 'la que coincide no mueve nada')

  // Aplicar otra vez no repite nada.
  const otraVez = await aplicar(c.conteoId)
  assert.ok(otraVez.aplicada && otraVez.repetido)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }) - antes, 2)
})

test('2 · «sin contar» cuenta lotes (cada lote con existencias que no se contó), y los productos sin lotes como siempre', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'P-1', cantidad: 4 }, { codigo: 'P-2', cantidad: 6 }, { codigo: 'P-3', cantidad: 2 }], 12, ctx.suc2)
  const sinTocar = await producto('Sin tocar')
  await entrada(sinTocar, null, 9, ctx.suc2)
  const c = await abrir(ctx.suc2)
  await contar(c.conteoId, v, 'P-1', 4)
  // Antes de aplicar, lo que falta por contar son los otros dos lotes y el otro producto.
  const por = await enA((tx) => porContarEnTx(tx, ctx.a, c.conteoId, ctx.suc2))
  assert.equal(por.total, 3)
  assert.deepEqual(por.items.filter((i) => i.varianteId === v).map((i) => i.loteCodigo).sort(), ['P-2', 'P-3'])
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  if (r.aplicada) assert.deepEqual(r.resumen, { lineas: 1, ajustadas: 0, unidadesSobrantes: 0, unidadesFaltantes: 0, sinContar: 3 })
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'P-1': 4, 'P-2': 6, 'P-3': 2 }, 'lo que no se contó no se toca')
})

test('3 · un faltante en un lote que dejaría menos de lo APARTADO de ese lote rechaza todo el conteo; corregido, se aplica', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'R-1', vencimiento: '2027-08-01', cantidad: 10 }, { codigo: 'R-2', vencimiento: '2027-11-01', cantidad: 10 }], 20)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 6, ttlMinutos: 600, ahora: AHORA }, como(ctx.usuario))) // FEFO: aparta de R-1
  assert.equal((await lotesDe(v))['R-1'].reserved, 6)
  const c = await abrir()
  await contar(c.conteoId, v, 'R-1', 4) // faltan 6 y solo hay 4 sin apartar
  await contar(c.conteoId, v, 'R-2', 12) // sobran 2
  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const r = await aplicar(c.conteoId)
  assert.ok(!r.aplicada)
  if (r.aplicada) return
  assert.equal(r.rechazadas.length, 1)
  assert.match(r.rechazadas[0].nombre, /lote R-1/, 'dice de qué lote es')
  assert.equal(r.rechazadas[0].loteId, await loteId(v, 'R-1'))
  assert.equal(r.rechazadas[0].existenciaActual, 10, 'la existencia de ESE lote')
  assert.match(r.rechazadas[0].motivo, /dejaría menos de lo apartado/)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), antes, 'todo o nada: ni el sobrante se aplicó')
  assert.deepEqual(enMano(await lotesDe(v)), { 'R-1': 10, 'R-2': 10 })
  // La revisión previa lo avisa con el saldo del lote.
  const saldos = await enA((tx) => saldosActualesDeConteoEnTx(tx, ctx.a, c.conteoId, ctx.suc1))
  assert.deepEqual(saldos.get(claveDeLinea(v, await loteId(v, 'R-1'))), { onHand: 10, reserved: 6, damaged: 0 })
  // Recontado, entra.
  await contar(c.conteoId, v, 'R-1', 7)
  const ok = await aplicar(c.conteoId)
  assert.ok(ok.aplicada)
  assert.deepEqual(enMano(await lotesDe(v)), { 'R-1': 7, 'R-2': 12 })
  assert.equal((await lotesDe(v))['R-1'].reserved, 6, 'lo apartado sigue apartado')
  await verificarLotes(v)
})

test('4 · lo que se vendió mientras se contaba no se pierde: se ajusta la DIFERENCIA de cada lote, no el número', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'V-1', vencimiento: '2027-08-01', cantidad: 10 }, { codigo: 'V-2', vencimiento: '2027-11-01', cantidad: 10 }], 20)
  const c = await abrir()
  await contar(c.conteoId, v, 'V-1', 8) // esperado 10: faltan 2
  await contar(c.conteoId, v, 'V-2', 10) // esperado 10: coincide
  // Mientras tanto se venden 3 (FEFO: salen de V-1).
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 3, ahora: AHORA }, como(ctx.usuario)))
  assert.deepEqual(enMano(await lotesDe(v)), { 'V-1': 7, 'V-2': 10 })
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  assert.deepEqual(enMano(await lotesDe(v)), { 'V-1': 5, 'V-2': 10 }, '10 - 3 vendidos - 2 faltantes = 5 (no 8)')
  const l = (await lineasDe(c.conteoId)).find((x) => x.lot?.code === 'V-1')!
  assert.deepEqual([l.expected, l.counted, l.onHandBefore, l.onHandAfter], [10, 8, 7, 5], 'lo esperado al contar, lo contado y lo real al aplicar')
  await verificarLotes(v)
})

test('5 · recontar vuelve a tomar la foto, sumar acumula, quitar es por lote, y un lote sin saldo en la sucursal se cuenta desde cero', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'Q-1', cantidad: 6 }], 6, ctx.suc1)
  await entrada(v, [{ codigo: 'Q-2', cantidad: 5 }], 5, ctx.suc2) // Q-2 existe pero no tiene nada en Principal
  const c = await abrir()
  await contar(c.conteoId, v, 'Q-1', 2)
  // Se vende uno y se RECUENTA: lo esperado se actualiza al saldo de ahora.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1, ahora: AHORA }, como(ctx.usuario)))
  await contar(c.conteoId, v, 'Q-1', 5)
  const q1 = (await lineasDe(c.conteoId)).find((l) => l.lot?.code === 'Q-1')!
  assert.deepEqual([q1.counted, q1.expected], [5, 5])
  // Q-2 no tiene saldo en Principal: esperado 0, y encontrar 3 es un sobrante.
  await contar(c.conteoId, v, 'Q-2', 3)
  assert.equal((await lineasDe(c.conteoId)).find((l) => l.lot?.code === 'Q-2')!.expected, 0)
  // Quitar sin decir el lote no quita nada; con el lote, sí.
  assert.equal((await enA((tx) => quitarLineaDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: v }))).quitada, false)
  assert.equal((await enA(async (tx) => quitarLineaDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: v, loteId: await loteId(v, 'Q-1') }))).quitada, true)
  assert.deepEqual((await lineasDe(c.conteoId)).map((l) => l.lot?.code), ['Q-2'])
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  assert.deepEqual(enMano(await lotesDe(v)), { 'Q-1': 5, 'Q-2': 3 }, 'Q-2 nace en Principal con lo encontrado')
  // El «antes» y el «después» de una línea son los de SU lote (0 → 3 para el lote que no tenía saldo aquí), no los del producto.
  const q2 = (await lineasDe(c.conteoId)).find((l) => l.lot?.code === 'Q-2')!
  assert.deepEqual([q2.onHandBefore, q2.onHandAfter], [0, 3])
  assert.deepEqual(enMano(await lotesDe(v, ctx.suc2)), { 'Q-2': 5 }, 'la otra sucursal no se entera')
  await verificarLotes(v)
})

test('6 · un producto con muchos lotes, unos sobran y otros faltan, algunos coinciden: todos se aplican (cada uno con su movimiento) y cuadra', async () => {
  const v = await producto()
  await activar(v)
  const lotes = ['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6'].map((codigo, i) => ({ codigo, vencimiento: `2027-1${i % 3}-0${1 + i}`, cantidad: 10 }))
  await entrada(v, lotes, 60)
  const c = await abrir()
  const contados: Record<string, number> = { 'M-1': 14, 'M-2': 6, 'M-3': 10, 'M-4': 0, 'M-5': 11, 'M-6': 3 }
  for (const [codigo, n] of Object.entries(contados)) await contar(c.conteoId, v, codigo, n)
  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  if (!r.aplicada) return
  assert.deepEqual({ ...r.resumen, sinContar: 0 }, { lineas: 6, ajustadas: 5, unidadesSobrantes: 5, unidadesFaltantes: 21, sinContar: 0 }, '+4 +1 sobran; -4 -10 -7 faltan (el «sin contar» depende de lo demás que haya en la sucursal)')
  assert.deepEqual(enMano(await lotesDe(v)), contados)
  assert.equal((await nivelDe(v)).onHand, 44)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }) - antes, 5)
  const lineas = await lineasDe(c.conteoId)
  assert.equal(new Set(lineas.map((l) => l.movementId).filter(Boolean)).size, 5, 'cada línea con diferencia, su propio movimiento')
  await verificarLotes(v)
  // Los movimientos del producto encadenan: el «antes» de cada uno es el «después» del anterior.
  const movs = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, referenceType: 'STOCK_COUNT', referenceId: c.conteoId }, select: { previousOnHand: true, newOnHand: true } })
  const siguiente = new Map(movs.map((m) => [m.previousOnHand, m.newOnHand]))
  assert.equal(siguiente.size, movs.length, 'ningún «antes» se repite')
  let saldo = 60
  for (let i = 0; i < movs.length; i++) saldo = siguiente.get(saldo) ?? assert.fail(`el movimiento ${i + 1} no parte del saldo que dejó el anterior (${saldo})`)
  assert.equal(saldo, 44, 'los cinco movimientos encadenan del saldo de antes (60) al de después (44)')
})

test('7 · importar una hoja contada con lotes: por línea de lote, reemplaza lo que había, y rechaza lo mal armado sin dejar nada', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'I-1', cantidad: 5 }, { codigo: 'I-2', cantidad: 5 }], 10)
  const simple = await producto('Simple')
  await entrada(simple, null, 3)
  const c = await abrir()
  const i1 = await loteId(v, 'I-1')
  const i2 = await loteId(v, 'I-2')
  const importar = (lineas: Array<{ varianteId: string; loteId?: string | null; cantidad: number }>) => enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas, ahora: AHORA }, como(ctx.usuario)))

  assert.equal(await codigoDe(importar([{ varianteId: v, cantidad: 4 }])), 'LOTES_FALTAN', 'un producto con lotes sin lote')
  assert.equal(await codigoDe(importar([{ varianteId: simple, loteId: i1, cantidad: 4 }])), 'LOTES_NO_APLICAN', 'lote en un producto que no los lleva')
  assert.equal(await codigoDe(importar([{ varianteId: v, loteId: i1, cantidad: 1 }, { varianteId: v, loteId: i1, cantidad: 2 }])), 'LINEA_REPETIDA')
  assert.equal(await codigoDe(importar([{ varianteId: v, loteId: 'otro-lote', cantidad: 1 }])), 'LOTE_NO_ENCONTRADO')
  assert.equal(await prisma.inventoryCountLine.count({ where: { sessionId: c.conteoId } }), 0, 'nada a medias')

  const r1 = await importar([{ varianteId: v, loteId: i1, cantidad: 4 }, { varianteId: v, loteId: i2, cantidad: 6 }, { varianteId: simple, cantidad: 3 }])
  assert.deepEqual([r1.nuevas, r1.reemplazadas, r1.lineas], [3, 0, 3])
  const r2 = await importar([{ varianteId: v, loteId: i1, cantidad: 5 }])
  assert.deepEqual([r2.nuevas, r2.reemplazadas, r2.lineas], [0, 1, 3], 'reemplaza solo la línea de ese lote')
  const lineas = await lineasDe(c.conteoId)
  assert.deepEqual(lineas.filter((l) => l.lot).map((l) => [l.lot?.code, l.counted, l.expected]).sort(), [['I-1', 5, 5], ['I-2', 6, 5]])
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  assert.deepEqual(enMano(await lotesDe(v)), { 'I-1': 5, 'I-2': 6 })
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

test('8 · el detalle trae el lote de cada línea; la hoja en blanco y «por contar» salen por lote; los lotes para elegir no dicen cantidades', async () => {
  const v = await producto('Lecturas')
  await activar(v)
  await entrada(v, [{ codigo: 'L-2', vencimiento: '2027-12-01', cantidad: 3 }, { codigo: 'L-1', vencimiento: '2027-08-01', cantidad: 4 }], 7, ctx.suc2)
  await entrada(v, [{ codigo: 'L-3', cantidad: 9 }], 9, ctx.suc1) // otro lote, en la otra sucursal
  const c = await abrir(ctx.suc2)
  await contar(c.conteoId, v, 'L-1', 4)

  const detalle = await enA((tx) => conteoDetalleEnTx(tx, ctx.a, c.conteoId, { conEsperado: false }))
  assert.deepEqual(detalle?.detalle.map((l) => [l.loteCodigo, l.loteVencimiento, l.contado, l.esperado]), [['L-1', '2027-08-01', 4, null]], 'a ciegas: el lote y lo contado, no lo esperado')
  const conEsperado = await enA((tx) => conteoDetalleEnTx(tx, ctx.a, c.conteoId, { conEsperado: true }))
  assert.equal(conEsperado?.detalle[0].esperado, 4)

  // Un producto con lotes que no tiene NINGUNA línea sale solo por sus lotes (nunca también como «producto entero»).
  const intacto = await producto('Intacto')
  await activar(intacto)
  await entrada(intacto, [{ codigo: 'Z-1', cantidad: 2 }, { codigo: 'Z-2', cantidad: 3 }], 5, ctx.suc2)
  const hoja = await enA((tx) => hojaDeConteoEnTx(tx, ctx.a, ctx.suc2))
  assert.deepEqual(hoja.filas.filter((f) => f.producto.startsWith('Intacto')).map((f) => f.lote), ['Z-1', 'Z-2'], 'solo sus lotes, sin una fila de producto entero')
  assert.deepEqual(hoja.filas.filter((f) => f.producto.startsWith('Lecturas')).map((f) => f.lote), ['L-1', 'L-2'], 'una fila por lote con existencias en la sucursal, sin cantidades')
  assert.ok(hoja.filas.every((f) => Object.keys(f).sort().join() === 'barcode,lote,producto,sku'))

  const por = await enA((tx) => porContarEnTx(tx, ctx.a, c.conteoId, ctx.suc2))
  assert.deepEqual(por.items.filter((i) => i.varianteId === v).map((i) => [i.loteCodigo, i.loteVencimiento]), [['L-2', '2027-12-01']])
  assert.deepEqual(por.items.filter((i) => i.varianteId === intacto).map((i) => i.loteCodigo), ['Z-1', 'Z-2'], 'un producto con lotes sin ninguna línea sale por lotes, no entero')

  const elegir = await enA((tx) => lotesParaContarEnTx(tx, ctx.a, c.conteoId, v, ctx.suc2))
  assert.deepEqual(
    elegir.map((l) => [l.legado ? 'SIN LOTE' : l.codigo, l.vencimiento, l.contado]),
    [['SIN LOTE', null, false], ['L-1', '2027-08-01', true], ['L-2', '2027-12-01', false], ['L-3', null, false]],
    'SIN LOTE primero, luego por vencimiento; L-3 tiene existencias en otra sucursal'
  )
  assert.ok(elegir.every((l) => Object.keys(l).sort().join() === 'codigo,contado,legado,loteId,vencimiento'), 'ninguna cantidad')
})

test('9 · el conteo suelto de la ficha no cuenta un producto con lotes y dice dónde hacerlo', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'S-1', cantidad: 3 }], 3)
  try {
    await enA((tx) => contarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, conteo: 2 }, como(ctx.usuario)))
    assert.fail('debía rechazarlo')
  } catch (e) {
    assert.equal((e as { codigo?: string }).codigo, 'LOTES_NO_SOPORTADO')
    assert.match((e as Error).message, /Cuéntalo en un conteo \(Inventario → Conteos\), que cuenta lote por lote/)
  }
  assert.equal((await nivelDe(v)).onHand, 3)
})

// ── La base ──────────────────────────────────────────────────────────────────

test('10 · la base rechaza, aunque se escriba por fuera del servicio: línea de un producto con lotes sin lote (y al revés), lote de otro producto, repetidas, cambiar de lote y tocar un conteo cerrado', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'D-1', cantidad: 3 }, { codigo: 'D-2', cantidad: 3 }], 6)
  const otro = await producto('Otro')
  await activar(otro)
  await entrada(otro, [{ codigo: 'D-1', cantidad: 2 }], 2)
  const simple = await producto('Simple')
  await entrada(simple, null, 2)
  const c = await abrir()
  const d1 = await loteId(v, 'D-1')
  const d2 = await loteId(v, 'D-2')
  const dOtro = await loteId(otro, 'D-1')
  const insertar = (varianteId: string, lotId: string | null, id = `cl-${Math.random().toString(36).slice(2)}`) =>
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","lotId","counted","expected") VALUES (${id}, ${ctx.a}, ${c.conteoId}, ${varianteId}, ${lotId}, 1, 1)`

  await assert.rejects(insertar(v, null), /el producto .* lleva lotes: su línea de conteo debe decir el lote/, 'un producto con lotes sin lote')
  await assert.rejects(insertar(simple, d1), /no lleva lotes: su línea de conteo no puede traer lote/, 'un lote en un producto sin lotes')
  await assert.rejects(insertar(v, dOtro), /foreign key|inventory_count_lines_lotId_catalogVariantId_companyId_fkey/, 'el lote de otro producto')
  await insertar(v, d1, 'linea-d1')
  await assert.rejects(insertar(v, d1), /already exists|23505/, 'el mismo lote dos veces')
  await insertar(simple, null, 'linea-simple')
  await assert.rejects(insertar(simple, null), /already exists|23505/, 'el mismo producto sin lotes dos veces')
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_lines" SET "lotId" = ${d2} WHERE "id" = 'linea-d1'`, /no cambia de conteo, de producto ni de lote/, 'una línea no cambia de lote')

  // Cancelado, el conteo no admite cambios a sus líneas de lote.
  await enA((tx) => cancelarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, motivo: 'prueba', ahora: AHORA }, como(ctx.usuario)))
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_lines" SET "counted" = 5 WHERE "id" = 'linea-d1'`, /no admiten UPDATE/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_count_lines" WHERE "id" = 'linea-d1'`, /no admiten DELETE/)
  await assert.rejects(insertar(v, d2), /no admiten INSERT/)
})

test('11 · activar los lotes de un producto con un conteo abierto que lo incluye sigue sin permitirse (y la línea de un lote cuenta)', async () => {
  const v = await producto()
  await entrada(v, null, 5)
  const c = await abrir()
  await contar(c.conteoId, v, null, 5)
  assert.equal(await codigoDe(activar(v)), 'ACTIVAR_CON_CONTEO_ABIERTO')
  await enA((tx) => cancelarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, ahora: AHORA }, como(ctx.usuario)))
  await activar(v)
  const c2 = await abrir()
  await contar(c2.conteoId, v, 'SIN LOTE', 5)
  assert.equal((await lineasDe(c2.conteoId))[0].lot?.code, 'SIN LOTE', 'lo que había antes de activar se cuenta en «SIN LOTE»')
  await enA((tx) => cancelarConteoEnTx(tx, ctx.a, { conteoId: c2.conteoId, ahora: AHORA }, como(ctx.usuario)))
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('12 · dos capturas del mismo lote a la vez se suman; y dos aplicaciones a la vez aplican UNA vez', async () => {
  const v = await producto()
  await activar(v)
  await entrada(v, [{ codigo: 'K-1', cantidad: 10 }, { codigo: 'K-2', cantidad: 10 }], 20)
  const c = await abrir()
  await Promise.all([contar(c.conteoId, v, 'K-1', 3, 'SUMAR'), contar(c.conteoId, v, 'K-1', 4, 'SUMAR'), contar(c.conteoId, v, 'K-2', 12, 'SUMAR')])
  const lineas = await lineasDe(c.conteoId)
  assert.deepEqual(lineas.map((l) => [l.lot?.code, l.counted]), [['K-1', 7], ['K-2', 12]])

  const antes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const [x, y] = await Promise.all([aplicar(c.conteoId), aplicar(c.conteoId)])
  assert.ok(x.aplicada && y.aplicada)
  if (x.aplicada && y.aplicada) assert.deepEqual([x.repetido, y.repetido].sort(), [false, true])
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }) - antes, 2, 'dos movimientos, no cuatro')
  assert.deepEqual(enMano(await lotesDe(v)), { 'K-1': 7, 'K-2': 12 })
  await verificarLotes(v)
})

test('13 · la hoja en blanco se llena y se sube: una fila por lote, el informe dice qué está mal, y con un solo error no entra nada', async () => {
  const v = await producto('Hoja')
  await activar(v)
  await entrada(v, [{ codigo: 'H-1', vencimiento: '2027-09-01', cantidad: 6 }, { codigo: 'H-2', cantidad: 4 }], 10)
  const simple = await producto('HojaSimple')
  await entrada(simple, null, 3)
  const c = await abrir()
  const skuDe = async (id: string) => (await prisma.catalogVariant.findUniqueOrThrow({ where: { id }, select: { sku: true } })).sku
  const [skuV, skuS] = [await skuDe(v), await skuDe(simple)]
  const informe = (texto: string) => enA((tx) => informeDeConteoImportadoEnTx(tx, ctx.a, texto))
  const subir = (texto: string) => enA((tx) => aplicarImportacionDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, texto }, como(ctx.usuario)))

  // La hoja que baja el administrador (la de la sucursal) trae una fila por lote y ninguna cantidad.
  const hoja = await enA((tx) => hojaDeConteoEnTx(tx, ctx.a, ctx.suc1))
  const csv = hojaDeConteoToCsv(hoja.filas)
  assert.ok(csv.includes('sku;codigo_de_barras;producto;lote;contado'))
  assert.ok(csv.includes(`${skuV};;`) && csv.includes(';H-1;') && csv.includes(';H-2;'))
  assert.match(csv, new RegExp(`^${skuS};;[^;]*;;$`, 'm'), 'el producto sin lotes deja el lote vacío')

  // Rellenar esa misma hoja: cada fila con SU lote (H-1 cuenta 5 y H-2 queda sin contar).
  const llena = csv
    .split('\n')
    .map((fila) => (fila.startsWith(`${skuV};`) && fila.includes(';H-1;') ? `${fila}5` : fila.startsWith(`${skuS};`) ? `${fila}3` : fila))
    .join('\n')
  const r = await informe(llena)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.informe.ok, true, JSON.stringify(r.informe.errores))
  assert.equal(r.informe.lineas.length, 2)
  assert.equal(r.informe.omitidas ?? 0, hoja.filas.length - 2, 'las filas sin llenar no cuentan')
  assert.equal(r.informe.lineas.find((l) => l.varianteId === v)?.loteId, await loteId(v, 'H-1'))
  assert.equal(r.informe.lineas.find((l) => l.varianteId === simple)?.loteId, undefined)

  // Un error por tipo: ninguno deja nada.
  const malos: Array<[string, RegExp]> = [
    [`sku;lote;contado\n${skuV};;4\n`, /lleva lotes: escribe el lote/],
    [`sku;lote;contado\n${skuV};NO-EXISTE;4\n`, /El lote «NO-EXISTE» no existe/],
    [`sku;lote;contado\n${skuS};H-1;4\n`, /no lleva lotes: deja vacía la columna «lote»/],
    [`sku;contado\n${skuV};4\n`, /lleva lotes/],
    [`sku;lote;contado\n${skuV};H-1;4\n${skuV};h-1;2\n`, /ya aparece en la fila 2/],
  ]
  for (const [texto, esperado] of malos) {
    const m = await subir(texto)
    assert.ok(m.ok)
    if (!m.ok) continue
    assert.equal(m.resultado.aplicada, false, texto)
    if (!m.resultado.aplicada) assert.match(m.resultado.informe.errores.map((e) => e.mensaje).join(' | '), esperado, texto)
    assert.equal(await prisma.inventoryCountLine.count({ where: { sessionId: c.conteoId } }), 0, 'con un error no entra nada')
  }

  // Limpio: entra por línea de lote (el código del lote se escribe como sea) y aplicar ajusta el lote contado.
  const ok = await subir(`sku;lote;contado\n${skuV};h-1;5\n${skuV};H-2;;\n${skuS};;3\n`)
  assert.ok(ok.ok)
  if (!ok.ok || !ok.resultado.aplicada) return assert.fail('debió entrar')
  assert.deepEqual([ok.resultado.nuevas, ok.resultado.reemplazadas, ok.resultado.lineas], [2, 0, 2])
  assert.deepEqual(
    (await lineasDe(c.conteoId)).map((l) => [l.lot?.code ?? null, l.counted, l.expected]).sort(),
    [['H-1', 5, 6], [null, 3, 3]].sort()
  )
  const res = await aplicar(c.conteoId)
  assert.ok(res.aplicada)
  assert.deepEqual(enMano(await lotesDe(v)), { 'H-1': 5, 'H-2': 4 }, 'el lote sin contar no se toca')
  await verificarLotes(v)
})
