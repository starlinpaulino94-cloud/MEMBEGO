import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { recibirEnTx, registrarEntradaMultipleEnTx } from '../../src/modules/inventory/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { EXISTENCIA_MAXIMA, cuadra } from '../../src/modules/inventory/domain'
import { MAX_LINEAS_ENTRADA, MAX_LINEAS_IMPORTACION } from '../../src/modules/inventory/entradas'
import { buscarVariantesParaEntradaEnTx, entradaDetalleEnTx, entradasDeLaEmpresaEnTx } from '../../src/modules/inventory/queries'
import { aplicarImportacionEnTx, informeDeImportacionEnTx } from '../../src/modules/inventory/importar'

/**
 * INV-2a · ENTRADAS DE MERCANCÍA CON VARIAS LÍNEAS contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · TODO O NADA: una línea mala no deja NADA (ni movimientos, ni saldos, ni
 *    número consumido);
 *  · que dos entradas simultáneas con los mismos productos en distinto orden
 *    NO se interbloquean (los saldos se bloquean juntos y en orden de id);
 *  · que el envío repetido (5 a la vez) crea UNA entrada;
 *  · que la escritura por lote deja saldo y ledger cuadrados, también con 1.000
 *    líneas en una sola transacción;
 *  · que la base rechaza editar o borrar una entrada, y las combinaciones sin
 *    sentido (CHECK y FK compuestas);
 *  · que ninguna empresa ve ni toca las entradas de otra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const anio = new Date().getFullYear()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', sucA1: '', sucA2: '', sucInactiva: '', sucB: '', varianteB: '', servicio: '', v: [] as string[] }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

async function varianteNueva(companyId: string, nombre: string, tipo: 'PHYSICAL_PRODUCT' | 'SERVICE', sku: string, barcode: string | null = null) {
  const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name: nombre, type: tipo, price: 100, sku, barcode }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return v.id
}

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Entradas ${x} ${sufijo}`, slug: `entradas-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-ent-${sufijo}`, email: `ent-${sufijo}@prueba.test`, name: 'Recepción', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucInactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  for (let i = 0; i < 6; i++) ctx.v.push(await varianteNueva(ctx.a, `Producto ${i} ${sufijo}`, 'PHYSICAL_PRODUCT', `ENT-P${i}-${sufijo}`, i === 0 ? `7509${Date.now().toString().slice(-8)}` : null))
  ctx.servicio = await varianteNueva(ctx.a, `Lavado ${sufijo}`, 'SERVICE', `ENT-S-${sufijo}`)
  ctx.varianteB = await varianteNueva(ctx.b, `Ajeno ${sufijo}`, 'PHYSICAL_PRODUCT', `ENT-B-${sufijo}`)
})

after(async () => {
  // El ledger y las entradas no se borran (lo prohíbe la base). Para limpiar el rastro de la prueba se desactivan los
  // disparadores ordinarios solo en esta transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "inventory_receipt_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_receipts" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_movements" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_reservations" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_levels" WHERE "companyId" IN (${Prisma.join(ids)})`
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
})

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof InventarioError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un InventarioError y no falló')
}

const entrada = (lineas: { varianteId: string; cantidad: number }[], extra: Partial<Parameters<typeof registrarEntradaMultipleEnTx>[2]> = {}) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.sucA1, lineas, ...extra }, como(ctx.usuario)))
const nivelDe = (varianteId: string, sucursalId: string) =>
  prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } } })
const movimientosDe = (nivelId: string) => prisma.inventoryMovement.findMany({ where: { inventoryLevelId: nivelId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
async function verificarCuadre(varianteId: string, sucursalId: string) {
  const n = await nivelDe(varianteId, sucursalId)
  assert.ok(cuadra(n, await movimientosDe(n.id)), `el saldo de ${varianteId} no cuadra con el ledger`)
}
const totalEntradas = () => prisma.inventoryReceipt.count({ where: { companyId: ctx.a } })
const secuenciaDe = (numero: string) => Number(numero.slice(-6))

// ── Entrada básica ───────────────────────────────────────────────────────────

test('1 · una entrada de tres líneas es UN documento con su número, y cada línea apunta a su movimiento PURCHASE', async () => {
  const r = await entrada(
    [
      { varianteId: ctx.v[0], cantidad: 10 },
      { varianteId: ctx.v[1], cantidad: 4 },
      { varianteId: ctx.v[2], cantidad: 1 },
    ],
    { referencia: '  Factura   F-001 ', nota: 'Compra de prueba' }
  )
  assert.match(r.numero, new RegExp(`^ENT-${anio}-\\d{6}$`))
  assert.equal(r.lineas, 3)
  assert.equal(r.unidades, 15)
  assert.equal(r.repetido, false)

  const e = await prisma.inventoryReceipt.findUniqueOrThrow({ where: { id: r.entradaId }, include: { lines: { orderBy: { position: 'asc' } } } })
  assert.equal(e.companyId, ctx.a)
  assert.equal(e.locationId, ctx.sucA1)
  assert.equal(e.source, 'MANUAL')
  assert.equal(e.reference, 'Factura F-001', 'la referencia se limpia')
  assert.equal(e.note, 'Compra de prueba')
  assert.equal(e.userId, ctx.usuario)
  assert.equal(e.lineCount, 3)
  assert.equal(e.unitCount, 15)
  assert.deepEqual(e.lines.map((l) => [l.catalogVariantId, l.quantity, l.position]), [[ctx.v[0], 10, 0], [ctx.v[1], 4, 1], [ctx.v[2], 1, 2]])

  for (const l of e.lines) {
    const m = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: l.movementId } })
    assert.equal(m.type, 'PURCHASE')
    assert.equal(m.sourceBucket, null)
    assert.equal(m.destinationBucket, 'AVAILABLE')
    assert.equal(m.quantity, l.quantity)
    assert.equal(m.previousOnHand, 0)
    assert.equal(m.newOnHand, l.quantity)
    assert.equal(m.referenceType, 'RECEIPT')
    assert.equal(m.referenceId, e.id)
    assert.equal(m.userId, ctx.usuario)
    assert.equal(m.companyId, ctx.a)
  }
  for (const [i, v] of [ctx.v[0], ctx.v[1], ctx.v[2]].entries()) {
    assert.equal((await nivelDe(v, ctx.sucA1)).onHand, [10, 4, 1][i])
    await verificarCuadre(v, ctx.sucA1)
  }
  assert.equal(await prisma.auditLog.count({ where: { companyId: ctx.a, accion: 'INVENTORY_STOCK_CHANGED', entidadTipo: 'InventoryReceipt', entidadId: e.id } }), 1, 'queda UN rastro por documento')
})

test('2 · una segunda entrada suma sobre lo que había, guarda el antes y el después, y el correlativo avanza sin huecos', async () => {
  const antes = await prisma.inventoryReceipt.findMany({ where: { companyId: ctx.a }, orderBy: { number: 'desc' }, take: 1 })
  const r = await entrada([{ varianteId: ctx.v[0], cantidad: 5 }, { varianteId: ctx.v[3], cantidad: 2 }])
  assert.equal(secuenciaDe(r.numero), secuenciaDe(antes[0].number) + 1)
  const linea = await prisma.inventoryReceiptLine.findFirstOrThrow({ where: { receiptId: r.entradaId, catalogVariantId: ctx.v[0] }, include: { movement: true } })
  assert.equal(linea.movement.previousOnHand, 10)
  assert.equal(linea.movement.newOnHand, 15)
  assert.equal((await nivelDe(ctx.v[0], ctx.sucA1)).onHand, 15)
  await verificarCuadre(ctx.v[0], ctx.sucA1)
  // La misma variante en OTRA sucursal tiene su propio saldo.
  const norte = await entrada([{ varianteId: ctx.v[0], cantidad: 3 }], { sucursalId: ctx.sucA2 })
  assert.equal(norte.unidades, 3)
  assert.equal((await nivelDe(ctx.v[0], ctx.sucA2)).onHand, 3)
  assert.equal((await nivelDe(ctx.v[0], ctx.sucA1)).onHand, 15)
})

// ── Todo o nada ──────────────────────────────────────────────────────────────

test('3 · TODO O NADA: una línea mala no deja ni movimientos, ni saldos, ni número consumido', async () => {
  const entradasAntes = await totalEntradas()
  const movimientosAntes = await prisma.inventoryMovement.count({ where: { companyId: ctx.a } })
  const ultimo = (await prisma.inventoryReceipt.findMany({ where: { companyId: ctx.a }, orderBy: { number: 'desc' }, take: 1 }))[0].number

  // Un servicio no controla inventario.
  assert.equal(await codigoDe(entrada([{ varianteId: ctx.v[4], cantidad: 5 }, { varianteId: ctx.servicio, cantidad: 3 }])), 'SIN_CONTROL_DE_INVENTARIO')
  // Una variante de otra empresa se ve como inexistente.
  assert.equal(await codigoDe(entrada([{ varianteId: ctx.v[4], cantidad: 5 }, { varianteId: ctx.varianteB, cantidad: 1 }])), 'VARIANTE_NO_ENCONTRADA')
  // La última línea supera la existencia máxima: ninguna de las anteriores se queda.
  const tope = await varianteNueva(ctx.a, `Tope ${sufijo}`, 'PHYSICAL_PRODUCT', `ENT-TOPE-${sufijo}`)
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: tope, sucursalId: ctx.sucA1, cantidad: 10 }, como(null)))
  await prisma.inventoryLevel.update({ where: { catalogVariantId_locationId: { catalogVariantId: tope, locationId: ctx.sucA1 } }, data: { onHand: EXISTENCIA_MAXIMA - 5 } })
  assert.equal(await codigoDe(entrada([{ varianteId: ctx.v[4], cantidad: 5 }, { varianteId: tope, cantidad: 10 }])), 'EXISTENCIA_MAXIMA')

  assert.equal(await totalEntradas(), entradasAntes)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a } }), movimientosAntes + 1, 'solo el movimiento de preparar el tope; ninguno de las entradas rechazadas')
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: ctx.v[4] } }), 0, 'ni siquiera se creó el saldo de la línea buena')

  // El número rechazado NO se gastó: la siguiente entrada buena es la inmediata.
  const buena = await entrada([{ varianteId: ctx.v[4], cantidad: 5 }])
  assert.equal(secuenciaDe(buena.numero), secuenciaDe(ultimo) + 1)
})

test('4 · lo que no tiene forma se rechaza antes de tocar nada', async () => {
  const antes = await totalEntradas()
  const v = ctx.v[5]
  const malas: Array<[string, Parameters<typeof entrada>[0], Partial<Parameters<typeof registrarEntradaMultipleEnTx>[2]>?]> = [
    ['ENTRADA_SIN_LINEAS', []],
    ['LINEA_REPETIDA', [{ varianteId: v, cantidad: 1 }, { varianteId: v, cantidad: 2 }]],
    ['CANTIDAD_INVALIDA', [{ varianteId: v, cantidad: 0 }]],
    ['CANTIDAD_INVALIDA', [{ varianteId: v, cantidad: -3 }]],
    ['CANTIDAD_INVALIDA', [{ varianteId: v, cantidad: 1.5 }]],
    ['CANTIDAD_INVALIDA', [{ varianteId: v, cantidad: 2_000_000 }]],
    ['LINEA_INVALIDA', [{ varianteId: '', cantidad: 1 }]],
    ['REFERENCIA_INVALIDA', [{ varianteId: v, cantidad: 1 }], { referencia: 'x'.repeat(121) }],
    ['NOTA_INVALIDA', [{ varianteId: v, cantidad: 1 }], { nota: 'x'.repeat(501) }],
    ['SUCURSAL_INACTIVA', [{ varianteId: v, cantidad: 1 }], { sucursalId: ctx.sucInactiva }],
    ['SUCURSAL_NO_ENCONTRADA', [{ varianteId: v, cantidad: 1 }], { sucursalId: ctx.sucB }],
    ['SUCURSAL_NO_ENCONTRADA', [{ varianteId: v, cantidad: 1 }], { sucursalId: '' }],
    ['VARIANTE_NO_ENCONTRADA', [{ varianteId: 'no-existe', cantidad: 1 }]],
    ['CLAVE_INVALIDA', [{ varianteId: v, cantidad: 1 }], { idempotencyKey: 'k'.repeat(121) }],
  ]
  for (const [codigo, lineas, extra] of malas) assert.equal(await codigoDe(entrada(lineas, extra)), codigo, codigo)
  const demasiadas = Array.from({ length: MAX_LINEAS_ENTRADA + 1 }, (_, i) => ({ varianteId: `x${i}`, cantidad: 1 }))
  assert.equal(await codigoDe(entrada(demasiadas)), 'DEMASIADAS_LINEAS')
  assert.equal(await totalEntradas(), antes)
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: v } }), 0, 'nada se tocó')
})

// ── Idempotencia ─────────────────────────────────────────────────────────────

test('5 · el mismo envío, aunque llegue 5 veces a la vez, crea UNA entrada y mueve el stock una sola vez', async () => {
  const v = await varianteNueva(ctx.a, `Idem ${sufijo}`, 'PHYSICAL_PRODUCT', `ENT-IDEM-${sufijo}`)
  const clave = `idem-${sufijo}`
  const antes = await totalEntradas()
  const rs = await Promise.all(Array.from({ length: 5 }, () => entrada([{ varianteId: v, cantidad: 7 }], { idempotencyKey: clave })))
  assert.equal(new Set(rs.map((r) => r.entradaId)).size, 1)
  assert.equal(rs.filter((r) => !r.repetido).length, 1, 'solo una hizo el trabajo')
  assert.equal(await totalEntradas(), antes + 1)
  assert.equal((await nivelDe(v, ctx.sucA1)).onHand, 7)
  await verificarCuadre(v, ctx.sucA1)
  // Reintentar mucho después sigue siendo inofensivo…
  const otra = await entrada([{ varianteId: v, cantidad: 7 }], { idempotencyKey: clave })
  assert.equal(otra.repetido, true)
  assert.equal(otra.numero, rs[0].numero)
  // …pero la misma clave para OTRA entrada se rechaza: cambia la cantidad, la sucursal o el producto.
  assert.equal(await codigoDe(entrada([{ varianteId: v, cantidad: 8 }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(entrada([{ varianteId: v, cantidad: 7 }], { idempotencyKey: clave, sucursalId: ctx.sucA2 })), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(entrada([{ varianteId: ctx.v[5], cantidad: 7 }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  assert.equal((await nivelDe(v, ctx.sucA1)).onHand, 7)
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

// Medido: con 30×20 el interbloqueo salía 3 de 3 veces sin el orden fijo; con 25×20 sale de forma casi segura y tarda unos segundos.
const RONDAS = 25
const PRODUCTOS = 20
test('6 · 12 entradas simultáneas con los MISMOS productos en distinto orden no se interbloquean y suman bien', async () => {
  const barajar = <T,>(xs: T[], semilla: number) => xs.map((x, i) => [x, Math.sin(semilla * 97 + i * 31)] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  // Varias rondas, y en CADA una productos nuevos: lo peligroso es crear a la vez los saldos que faltan (un INSERT por producto en
  // distinto orden se interbloquea), y solo existe la primera vez que se recibe un producto. Una sola ronda lo deja pasar de suerte.
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const vs = await Promise.all(Array.from({ length: PRODUCTOS }, (_, i) => varianteNueva(ctx.a, `Carrera ${ronda}-${i} ${sufijo}`, 'PHYSICAL_PRODUCT', `ENT-RACE${ronda}-${i}-${sufijo}`)))
    const antes = await totalEntradas()
    const envios = Array.from({ length: 12 }, (_, n) => barajar(vs, n + 1 + ronda * 13).map((varianteId, i) => ({ varianteId, cantidad: ((n + i) % 5) + 1 })))
    const rs = await Promise.all(envios.map((lineas) => entrada(lineas)))
    assert.equal(await totalEntradas(), antes + 12)
    const numeros = rs.map((r) => secuenciaDe(r.numero)).sort((a, b) => a - b)
    assert.equal(new Set(numeros).size, 12, 'ningún número se repite')
    assert.equal(numeros[11] - numeros[0], 11, 'y no hay huecos')
    for (const v of vs) {
      const esperado = envios.flat().filter((l) => l.varianteId === v).reduce((s, l) => s + l.cantidad, 0)
      assert.equal((await nivelDe(v, ctx.sucA1)).onHand, esperado)
      await verificarCuadre(v, ctx.sucA1)
    }
  }
})

test('7 · una tanda de 1.000 líneas cabe en UNA transacción y deja saldo y ledger cuadrados', async () => {
  const N = MAX_LINEAS_IMPORTACION
  const ids = Array.from({ length: N }, (_, i) => `tanda-${i}-${sufijo}`)
  // Un ítem sin variante no se confirma (disparador diferido): ítems y variantes van en la misma transacción.
  await prisma.$transaction([
    prisma.catalogItem.createMany({
      data: ids.map((id, i) => ({ id: `it-${id}`, companyId: ctx.a, name: `Tanda ${i} ${sufijo}`, slug: `tanda-${i}-${sufijo}`, type: 'PHYSICAL_PRODUCT' as const, capabilities: { trackInventory: true } })),
    }),
    prisma.catalogVariant.createMany({
      data: ids.map((id, i) => ({ id: `va-${id}`, companyId: ctx.a, catalogItemId: `it-${id}`, name: 'Default', sku: `TANDA-${i}-${sufijo}`, price: 10, isDefault: true })),
    }),
  ])
  const lineas = ids.map((id, i) => ({ varianteId: `va-${id}`, cantidad: (i % 9) + 1 }))
  const t0 = Date.now()
  const r = await entrada(lineas, { maxLineas: MAX_LINEAS_IMPORTACION, origen: 'CSV', referencia: 'Importación de prueba' })
  const ms = Date.now() - t0
  assert.ok(ms < 20_000, `1.000 líneas tardaron ${ms} ms: la escritura por lote se rompió`)
  assert.equal(r.lineas, N)
  assert.equal(r.unidades, lineas.reduce((s, l) => s + l.cantidad, 0))
  const e = await prisma.inventoryReceipt.findUniqueOrThrow({ where: { id: r.entradaId } })
  assert.equal(e.source, 'CSV')
  assert.equal(await prisma.inventoryReceiptLine.count({ where: { receiptId: r.entradaId } }), N)
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceType: 'RECEIPT', referenceId: r.entradaId } }), N)
  assert.equal((await prisma.inventoryLevel.aggregate({ where: { catalogVariantId: { in: lineas.map((l) => l.varianteId) } }, _sum: { onHand: true } }))._sum.onHand, r.unidades)
  for (const i of [0, 1, 499, 998, 999]) await verificarCuadre(lineas[i].varianteId, ctx.sucA1)
  // El tope manual sigue siendo el manual.
  assert.equal(await codigoDe(entrada(lineas.slice(0, MAX_LINEAS_ENTRADA + 1))), 'DEMASIADAS_LINEAS')
  assert.equal(await codigoDe(entrada([...lineas, { varianteId: ctx.v[5], cantidad: 1 }], { maxLineas: MAX_LINEAS_IMPORTACION })), 'DEMASIADAS_LINEAS')
})

// ── La base rechaza lo imposible ─────────────────────────────────────────────

test('8 · una entrada y sus líneas no se editan ni se borran: la base lo rechaza', async () => {
  const r = await entrada([{ varianteId: ctx.v[5], cantidad: 2 }])
  const intentos: Array<[string, Prisma.Sql]> = [
    ['UPDATE de la entrada', Prisma.sql`UPDATE "inventory_receipts" SET "note" = 'editada' WHERE "id" = ${r.entradaId}`],
    ['DELETE de la entrada', Prisma.sql`DELETE FROM "inventory_receipts" WHERE "id" = ${r.entradaId}`],
    ['UPDATE de una línea', Prisma.sql`UPDATE "inventory_receipt_lines" SET "quantity" = 99 WHERE "receiptId" = ${r.entradaId}`],
    ['DELETE de una línea', Prisma.sql`DELETE FROM "inventory_receipt_lines" WHERE "receiptId" = ${r.entradaId}`],
    ['TRUNCATE de las entradas', Prisma.sql`TRUNCATE "inventory_receipts" CASCADE`],
    ['TRUNCATE de las líneas', Prisma.sql`TRUNCATE "inventory_receipt_lines"`],
  ]
  for (const [que, sql] of intentos) {
    await assert.rejects(prisma.$executeRaw(sql), /inventory_receipts_inmutable/, `${que} debía rechazarse`)
  }
  const e = await prisma.inventoryReceipt.findUniqueOrThrow({ where: { id: r.entradaId } })
  assert.equal(e.note, null)
  assert.equal(await prisma.inventoryReceiptLine.count({ where: { receiptId: r.entradaId } }), 1)
})

test('9 · los CHECK y las FK compuestas rechazan lo que no tiene sentido, aunque se escriba por fuera del servicio', async () => {
  const ahora = new Date()
  const insertarEntrada = (o: { id: string; companyId?: string; number?: string; locationId?: string; lineCount?: number; unitCount?: number }) =>
    prisma.$executeRaw`INSERT INTO "inventory_receipts" ("id", "companyId", "number", "locationId", "lineCount", "unitCount", "createdAt")
      VALUES (${o.id}, ${o.companyId ?? ctx.a}, ${o.number ?? `ENT-${anio}-900001`}, ${o.locationId ?? ctx.sucA1}, ${o.lineCount ?? 1}, ${o.unitCount ?? 1}, ${ahora})`
  await assert.rejects(insertarEntrada({ id: `x1-${sufijo}`, lineCount: 0 }), /inventory_receipts_forma/, 'sin líneas')
  await assert.rejects(insertarEntrada({ id: `x2-${sufijo}`, lineCount: 3, unitCount: 2 }), /inventory_receipts_forma/, 'menos unidades que líneas')
  await assert.rejects(insertarEntrada({ id: `x3-${sufijo}`, number: 'ENT-MAL' }), /inventory_receipts_forma/, 'número sin el formato ENT-AAAA-NNNNNN')
  await assert.rejects(insertarEntrada({ id: `x4-${sufijo}`, locationId: ctx.sucB }), /inventory_receipts_locationId_companyId_fkey/, 'la sucursal de OTRA empresa')
  // Una entrada válida de verdad, para probar las líneas.
  await insertarEntrada({ id: `ok-${sufijo}`, number: `ENT-${anio}-900002` })
  // Un movimiento suelto (no enlazado a ninguna entrada): cada línea exige el suyo, y el índice único del movimiento se comprueba antes que las FK.
  const suelto = await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: ctx.v[1], sucursalId: ctx.sucA1, cantidad: 1 }, como(null)))
  const mov = { id: suelto.movimientoId }
  const insertarLinea = (o: { id: string; variante: string; cantidad?: number; posicion?: number }) =>
    prisma.$executeRaw`INSERT INTO "inventory_receipt_lines" ("id", "companyId", "receiptId", "catalogVariantId", "position", "quantity", "movementId")
      VALUES (${o.id}, ${ctx.a}, ${`ok-${sufijo}`}, ${o.variante}, ${o.posicion ?? 0}, ${o.cantidad ?? 1}, ${mov.id})`
  await assert.rejects(insertarLinea({ id: `l1-${sufijo}`, variante: ctx.v[0], cantidad: 0 }), /inventory_receipt_lines_forma/, 'cantidad cero')
  await assert.rejects(insertarLinea({ id: `l2-${sufijo}`, variante: ctx.v[0], cantidad: 1_000_001 }), /inventory_receipt_lines_forma/, 'cantidad desmedida')
  await assert.rejects(insertarLinea({ id: `l3-${sufijo}`, variante: ctx.varianteB }), /inventory_receipt_lines_catalogVariantId_companyId_fkey/, 'la variante de OTRA empresa')
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

test('10 · la lista filtra por sucursal, número, referencia y fechas locales, pagina sin repetir, y no cruza empresas', async () => {
  const zonaHoraria = 'America/Santo_Domingo'
  const ver = (f: Parameters<typeof entradasDeLaEmpresaEnTx>[2], o: { limite?: number; cursor?: string | null } = {}) =>
    enA((tx) => entradasDeLaEmpresaEnTx(tx, ctx.a, f, { zonaHoraria, ...o }))
  const v = ctx.v[5]
  const marca = `LST${sufijo}`
  const e1 = await entrada([{ varianteId: v, cantidad: 1 }], { referencia: `${marca}-A`, sucursalId: ctx.sucA1 })
  const e2 = await entrada([{ varianteId: v, cantidad: 2 }], { referencia: `${marca}-B`, sucursalId: ctx.sucA2 })
  const e3 = await entrada([{ varianteId: v, cantidad: 3 }], { referencia: `${marca}-C`, sucursalId: ctx.sucA2 })

  const todas = await ver({ q: marca })
  assert.deepEqual(todas.filas.map((f) => f.numero), [e3.numero, e2.numero, e1.numero], 'de la más reciente a la más antigua')
  assert.equal(todas.siguiente, null)
  assert.equal(todas.filas[0].usuarioNombre, 'Recepción')
  assert.equal(todas.filas[0].sucursalNombre, 'Norte')
  assert.equal((await ver({ q: marca, sucursalId: ctx.sucA2 })).filas.length, 2)
  assert.equal((await ver({ q: e2.numero.toLowerCase() })).filas.length, 1, 'por número, sin importar mayúsculas')
  assert.equal((await ver({ q: `${marca}-b` })).filas.length, 1, 'por referencia')

  const p1 = await ver({ q: marca }, { limite: 2 })
  assert.equal(p1.filas.length, 2)
  assert.ok(p1.siguiente)
  const p2 = await ver({ q: marca }, { limite: 2, cursor: p1.siguiente })
  assert.deepEqual([...p1.filas, ...p2.filas].map((f) => f.id), todas.filas.map((f) => f.id))
  assert.equal(p2.siguiente, null)

  // Fechas LOCALES: 03:30 UTC es el 4 a las 23:30 en Santo Domingo; se mueve la fecha con los disparadores desactivados (solo pruebas).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`UPDATE "inventory_receipts" SET "createdAt" = ${new Date('2030-03-05T03:30:00.000Z')} WHERE "id" = ${e1.entradaId}`
    await tx.$executeRaw`UPDATE "inventory_receipts" SET "createdAt" = ${new Date('2030-03-05T04:00:00.000Z')} WHERE "id" = ${e2.entradaId}`
  })
  const dia = (desde?: string, hasta?: string) => ver({ q: marca, desde, hasta }).then((r) => r.filas.map((f) => f.id))
  assert.deepEqual(await dia('2030-03-04', '2030-03-04'), [e1.entradaId])
  assert.deepEqual(await dia('2030-03-05', '2030-03-05'), [e2.entradaId])
  assert.equal((await dia('2030-03-04', '2030-03-05')).length, 2)
  assert.deepEqual(await dia(undefined, '2030-03-03'), [e3.entradaId], 'antes del 4 solo queda la que se registró hoy (2026)')
  assert.deepEqual(await dia('2030-03-06'), [], 'después del 5 no hay nada')

  // La otra empresa no ve nada de esto.
  const enOtra = await enB((tx) => entradasDeLaEmpresaEnTx(tx, ctx.b, { q: marca }, { zonaHoraria }))
  assert.equal(enOtra.filas.length, 0)
  assert.equal((await enB((tx) => entradasDeLaEmpresaEnTx(tx, ctx.b, { sucursalId: ctx.sucA1 }, { zonaHoraria }))).filas.length, 0)
})

test('11 · el detalle trae las líneas en orden con el antes y el después; una entrada ajena o inventada se ve igual: nada', async () => {
  const r = await entrada([{ varianteId: ctx.v[3], cantidad: 4 }, { varianteId: ctx.v[0], cantidad: 6 }], { referencia: 'Detalle', nota: 'Con nota' })
  const d = await enA((tx) => entradaDetalleEnTx(tx, ctx.a, r.entradaId))
  assert.ok(d)
  assert.equal(d.numero, r.numero)
  assert.equal(d.nota, 'Con nota')
  assert.equal(d.sucursalNombre, 'Principal')
  assert.deepEqual(d.detalle.map((l) => [l.posicion, l.varianteId, l.cantidad]), [[0, ctx.v[3], 4], [1, ctx.v[0], 6]])
  for (const l of d.detalle) assert.equal(l.existenciaDespues - l.existenciaAntes, l.cantidad)
  assert.ok(d.detalle[1].barcode, 'el código de barras viaja con la línea')
  assert.equal(await enB((tx) => entradaDetalleEnTx(tx, ctx.b, r.entradaId)), null)
  assert.equal(await enA((tx) => entradaDetalleEnTx(tx, ctx.a, 'no-existe')), null)
  assert.equal(await enA((tx) => entradaDetalleEnTx(tx, ctx.a, '')), null)
})

test('12 · la búsqueda de productos para una entrada: el código exacto va primero; servicios, descontinuados y ajenos no salen', async () => {
  const buscar = (q: string, sucursalId: string | null = ctx.sucA1) => enA((tx) => buscarVariantesParaEntradaEnTx(tx, ctx.a, q, sucursalId))
  const conCodigo = await prisma.catalogVariant.findUniqueOrThrow({ where: { id: ctx.v[0] }, select: { sku: true, barcode: true } })
  const exacto = await buscar(conCodigo.barcode!)
  assert.equal(exacto[0].id, ctx.v[0])
  assert.equal(exacto[0].exacto, true)
  assert.equal(exacto[0].disponible, (await nivelDe(ctx.v[0], ctx.sucA1)).onHand - (await nivelDe(ctx.v[0], ctx.sucA1)).reserved)
  assert.equal((await buscar(conCodigo.sku.toLowerCase()))[0].id, ctx.v[0], 'el SKU exacto, sin importar mayúsculas')
  // Un fragmento encuentra, pero no es «exacto».
  const parcial = await buscar(`Producto 1 ${sufijo}`)
  assert.ok(parcial.some((f) => f.id === ctx.v[1]))
  assert.ok(parcial.every((f) => !f.exacto))
  assert.equal((await buscar(`Lavado ${sufijo}`)).length, 0, 'un servicio no controla inventario')
  assert.equal((await buscar(`Ajeno ${sufijo}`)).length, 0, 'ni el producto de otra empresa')
  await prisma.catalogVariant.update({ where: { id: ctx.v[2] }, data: { status: 'DISCONTINUED' } })
  assert.equal((await buscar(`Producto 2 ${sufijo}`)).length, 0, 'ni lo descontinuado')
  await prisma.catalogVariant.update({ where: { id: ctx.v[2] }, data: { status: 'ACTIVE' } })
  assert.equal((await buscar('   ')).length, 0)
  assert.equal((await buscar(`Producto 3 ${sufijo}`, null))[0].disponible, null, 'sin sucursal no hay existencia que enseñar')
  assert.equal((await buscar('Producto')).length <= 10, true, 'el límite se respeta')
})

// ── Importación CSV contra la base ───────────────────────────────────────────

const csv = (...filas: string[]) => ['sku;codigo_de_barras;cantidad', ...filas].join('\r\n') + '\r\n'
const informeDe = (texto: unknown) => enA((tx) => informeDeImportacionEnTx(tx, ctx.a, texto))
const aplicarCsv = (texto: unknown, extra: { sucursalId?: string; referencia?: string; idempotencyKey?: string } = {}) =>
  enA((tx) => aplicarImportacionEnTx(tx, ctx.a, { sucursalId: ctx.sucA1, texto, ...extra }, como(ctx.usuario)))

test('13 · importar un CSV: el archivo limpio es UNA entrada de origen CSV; con un solo error no se aplica NADA, y se revisa contra el catálogo de AHORA', async () => {
  const codigo = (n: number) => `7520${Date.now().toString().slice(-8)}${n}`
  const a = await varianteNueva(ctx.a, `Imp A ${sufijo}`, 'PHYSICAL_PRODUCT', `IMP-A-${sufijo}`, codigo(1))
  const b = await varianteNueva(ctx.a, `Imp B ${sufijo}`, 'PHYSICAL_PRODUCT', `IMP-B-${sufijo}`, codigo(2))
  const c = await varianteNueva(ctx.a, `Imp C ${sufijo}`, 'PHYSICAL_PRODUCT', `IMP-C-${sufijo}`)
  const barcodeB = (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: b }, select: { barcode: true } })).barcode!

  // El informe encuentra por SKU (sin importar mayúsculas) y por código de barras, y enseña el nombre.
  const limpio = csv(`imp-a-${sufijo};;10`, `;${barcodeB};4`, `IMP-C-${sufijo};;1`)
  const i1 = await informeDe(limpio)
  assert.ok(i1.ok && i1.informe.ok)
  assert.equal(i1.informe.productos, 3)
  assert.equal(i1.informe.unidades, 15)
  assert.deepEqual(i1.informe.vistaPrevia.map((l) => l.nombre), [`Imp A ${sufijo}`, `Imp B ${sufijo}`, `Imp C ${sufijo}`])

  // Cada problema, con su fila: producto ajeno, servicio, inexistente, repetido.
  const sucio = await informeDe(csv(`IMP-A-${sufijo};;5`, `ENT-B-${sufijo};;5`, `ENT-S-${sufijo};;5`, `NO-EXISTE;;5`, `IMP-A-${sufijo};;2`))
  assert.ok(sucio.ok)
  assert.equal(sucio.informe.ok, false)
  assert.equal(sucio.informe.totalErrores, 4)
  assert.deepEqual(sucio.informe.errores.map((e) => e.fila), [3, 4, 5, 6])
  assert.match(sucio.informe.errores[0].mensaje, /No existe ningún producto con el SKU «ENT-B-/, 'el producto de OTRA empresa se ve como inexistente')
  assert.match(sucio.informe.errores[1].mensaje, /no controla inventario/)
  assert.match(sucio.informe.errores[3].mensaje, /ya aparece en la fila 2/)

  // Todo o nada: con errores no se escribe NADA, ni siquiera lo bueno.
  const entradasAntes = await totalEntradas()
  const r0 = await aplicarCsv(csv(`IMP-A-${sufijo};;5`, `NO-EXISTE;;5`))
  assert.ok(r0.ok && !r0.resultado.aplicada)
  assert.equal(await totalEntradas(), entradasAntes)
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: a } }), 0)

  // Limpio: se registra como UNA entrada de origen CSV, con la referencia.
  const r1 = await aplicarCsv(limpio, { referencia: 'Inventario inicial', idempotencyKey: `csv-${sufijo}` })
  assert.ok(r1.ok && r1.resultado.aplicada)
  assert.equal(r1.resultado.entrada.lineas, 3)
  assert.equal(r1.resultado.entrada.unidades, 15)
  const e = await prisma.inventoryReceipt.findUniqueOrThrow({ where: { id: r1.resultado.entrada.entradaId } })
  assert.equal(e.source, 'CSV')
  assert.equal(e.reference, 'Inventario inicial')
  assert.equal((await nivelDe(a, ctx.sucA1)).onHand, 10)
  assert.equal((await nivelDe(b, ctx.sucA1)).onHand, 4)
  for (const v of [a, b, c]) await verificarCuadre(v, ctx.sucA1)

  // El mismo archivo con la misma clave, aunque llegue de nuevo, no mueve nada otra vez.
  const r2 = await aplicarCsv(limpio, { referencia: 'Inventario inicial', idempotencyKey: `csv-${sufijo}` })
  assert.ok(r2.ok && r2.resultado.aplicada && r2.resultado.entrada.repetido)
  assert.equal(r2.resultado.entrada.entradaId, r1.resultado.entrada.entradaId)
  assert.equal((await nivelDe(a, ctx.sucA1)).onHand, 10)

  // El catálogo cambió ENTRE la revisión y el registro: aplicar vuelve a validar y lo rechaza.
  const itemC = (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: c }, select: { catalogItemId: true } })).catalogItemId
  await prisma.catalogItem.update({ where: { id: itemC }, data: { capabilities: { trackInventory: false } } })
  const antesDeC = (await nivelDe(c, ctx.sucA1)).onHand
  const r3 = await aplicarCsv(csv(`IMP-A-${sufijo};;1`, `IMP-C-${sufijo};;1`))
  assert.ok(r3.ok && !r3.resultado.aplicada)
  assert.match(r3.resultado.informe.errores[0].mensaje, /no controla inventario/)
  assert.equal((await nivelDe(a, ctx.sucA1)).onHand, 10, 'lo bueno tampoco entró')
  assert.equal((await nivelDe(c, ctx.sucA1)).onHand, antesDeC)

  // Lo que no es un archivo, y una sucursal que no sirve.
  const mal = await informeDe(null)
  assert.ok(!mal.ok)
  assert.equal(await codigoDe(aplicarCsv(csv(`IMP-A-${sufijo};;1`), { sucursalId: ctx.sucInactiva })), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(aplicarCsv(csv(`IMP-A-${sufijo};;1`), { sucursalId: ctx.sucB })), 'SUCURSAL_NO_ENCONTRADA')
})

test('14 · un archivo de 1.000 filas se revisa y se registra en una sola entrada; con 1.001 se rechaza entero', async () => {
  const hay = await prisma.catalogVariant.count({ where: { companyId: ctx.a, sku: { startsWith: 'TANDA-' }, id: { endsWith: sufijo } } })
  assert.equal(hay, MAX_LINEAS_IMPORTACION, 'precondición: la prueba 7 dejó sus 1.000 productos')
  const filas = Array.from({ length: MAX_LINEAS_IMPORTACION }, (_, i) => `TANDA-${i}-${sufijo};;${(i % 4) + 1}`)
  const t0 = Date.now()
  const informe = await informeDe(csv(...filas))
  assert.ok(informe.ok && informe.informe.ok)
  assert.equal(informe.informe.productos, MAX_LINEAS_IMPORTACION)
  const r = await aplicarCsv(csv(...filas), { sucursalId: ctx.sucA2 })
  const ms = Date.now() - t0
  assert.ok(r.ok && r.resultado.aplicada)
  assert.equal(r.resultado.entrada.lineas, MAX_LINEAS_IMPORTACION)
  assert.ok(ms < 30_000, `revisar y registrar 1.000 filas tardó ${ms} ms`)
  assert.equal(await prisma.inventoryReceiptLine.count({ where: { receiptId: r.resultado.entrada.entradaId } }), MAX_LINEAS_IMPORTACION)

  const demasiadas = await informeDe(csv(...filas, `TANDA-0-${sufijo};;1`))
  assert.ok(demasiadas.ok)
  assert.equal(demasiadas.informe.ok, false)
  assert.equal(demasiadas.informe.totalErrores, 1)
  assert.match(demasiadas.informe.errores[0].mensaje, /máximo por archivo es 1000/)
})
