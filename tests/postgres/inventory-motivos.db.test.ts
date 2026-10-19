import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import {
  abrirConteoEnTx,
  ajustarEnTx,
  aplicarConteoEnTx,
  contarEnTx,
  danarEnTx,
  devolverEnTx,
  recibirEnTx,
  registrarConteoProductoEnTx,
  reservarEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import { MOTIVO_DE_CONTEO } from '../../src/modules/inventory/motivos'

/**
 * INV-4b · MOTIVOS CODIFICADOS contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el código del catálogo llega a `inventory_movements."reasonCode"` por las DOS puertas del ledger (la de un movimiento y la
 *    de un lote) y solo en los ajustes y los daños;
 *  · que un motivo que no corresponde (de otra clase, inventado, «Otro» sin detalle, o ninguno cuando se exige) se rechaza SIN
 *    escribir nada ni mover el saldo;
 *  · que el texto del movimiento nunca queda vacío (sin detalle se guarda la etiqueta) y que el detalle tecleado se conserva;
 *  · que la base vigila lo suyo: el formato del código, que solo lo lleven ajustes y daños, y que el ledger no se reescriba.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', usuario: '', suc1: '', suc2: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)

let contador = 0
async function producto(nombre: string): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `MOT-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

before(async () => {
  ctx.a = (await prisma.company.create({ data: { name: `Motivos ${sufijo}`, slug: `motivos-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })).id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-mot-${sufijo}`, email: `mot-${sufijo}@prueba.test`, name: 'Bodeguero', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.suc1 = (await prisma.sucursal.create({ data: { companyId: ctx.a, nombre: 'Principal' }, select: { id: true } })).id
  ctx.suc2 = (await prisma.sucursal.create({ data: { companyId: ctx.a, nombre: 'Norte' }, select: { id: true } })).id
})

after(async () => {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of ['inventory_count_lines', 'inventory_count_sessions', 'inventory_transfer_lines', 'inventory_transfers', 'inventory_variant_costs', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" = '${ctx.a}'`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.auditLog.deleteMany({ where: { companyId: ctx.a } })
  await prisma.catalogItem.deleteMany({ where: { companyId: ctx.a } })
  await prisma.sucursal.deleteMany({ where: { companyId: ctx.a } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: ctx.a } })
  await prisma.$disconnect()
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

const entrada = (v: string, cantidad: number, sucursal = ctx.suc1) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: v, sucursalId: sucursal, cantidad }, como(ctx.usuario)))
const movimientos = (v: string) => prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, level: { catalogVariantId: v } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
const saldo = (v: string, sucursal = ctx.suc1) => prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: v, locationId: sucursal } } })

const ajustar = (v: string, cambio: number, e: { motivo?: string | null; motivoCodigo?: string | null; exigir?: boolean; clave?: string } = {}) =>
  enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cambio, motivo: e.motivo, motivoCodigo: e.motivoCodigo, exigirMotivoCodificado: e.exigir, idempotencyKey: e.clave }, como(ctx.usuario)))
const danar = (v: string, cantidad: number, e: { motivo?: string | null; motivoCodigo?: string | null; exigir?: boolean } = {}) =>
  enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad, motivo: e.motivo, motivoCodigo: e.motivoCodigo, exigirMotivoCodificado: e.exigir }, como(ctx.usuario)))
const resolver = (v: string, cantidad: number, destino: 'VENDIBLE' | 'BAJA', e: { motivo?: string | null; motivoCodigo?: string | null; exigir?: boolean } = {}) =>
  enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad, destino, motivo: e.motivo, motivoCodigo: e.motivoCodigo, exigirMotivoCodificado: e.exigir }, como(ctx.usuario)))

test('1 · un faltante con motivo guarda el código, y sin detalle el texto es la etiqueta; con detalle se conserva el detalle', async () => {
  const v = await producto('Faltante')
  await entrada(v, 20)
  await ajustar(v, -3, { motivoCodigo: 'EXPIRED' })
  await ajustar(v, -2, { motivoCodigo: 'THEFT', motivo: '  se llevaron   una caja  ' })
  const m = (await movimientos(v)).filter((x) => x.type === 'ADJUSTMENT')
  assert.deepEqual(m.map((x) => [x.reasonCode, x.reason, x.quantity, x.sourceBucket, x.destinationBucket]), [
    ['EXPIRED', 'Vencido', 3, 'AVAILABLE', null],
    ['THEFT', 'se llevaron una caja', 2, 'AVAILABLE', null],
  ])
  assert.equal((await saldo(v)).onHand, 15)
})

test('2 · un sobrante lleva un motivo de sobrante; un motivo de faltante o inventado se rechaza sin escribir ni mover nada', async () => {
  const v = await producto('Sobrante')
  await entrada(v, 5)
  const antes = (await movimientos(v)).length
  await ajustar(v, 4, { motivoCodigo: 'FOUND' })
  const m = (await movimientos(v)).at(-1)!
  assert.deepEqual([m.type, m.reasonCode, m.reason, m.sourceBucket, m.destinationBucket], ['ADJUSTMENT', 'FOUND', 'Apareció mercancía', null, 'AVAILABLE'])
  assert.equal((await saldo(v)).onHand, 9)
  for (const malo of ['THEFT', 'EXPIRED', 'NO_EXISTE', 'found']) {
    assert.equal(await codigoDe(ajustar(v, 1, { motivoCodigo: malo })), 'MOTIVO_INVALIDO', malo)
  }
  assert.equal(await codigoDe(ajustar(v, -1, { motivoCodigo: 'FOUND' })), 'MOTIVO_INVALIDO', 'un motivo de sobrante no explica un faltante')
  assert.equal((await movimientos(v)).length, antes + 1, 'lo rechazado no escribió nada')
  assert.equal((await saldo(v)).onHand, 9, 'ni movió el saldo')
})

test('3 · «Otro» exige detalle; sin motivo y sin exigirlo se sigue pudiendo escribir solo texto (el camino de antes), y exigiéndolo no', async () => {
  const v = await producto('Otro')
  await entrada(v, 10)
  assert.equal(await codigoDe(ajustar(v, -1, { motivoCodigo: 'OTHER' })), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(ajustar(v, -1, { motivoCodigo: 'OTHER', motivo: '   ' })), 'MOTIVO_OBLIGATORIO')
  await ajustar(v, -1, { motivoCodigo: 'OTHER', motivo: 'Se derramó en el almacén' })
  // El camino de antes: solo texto, sin código.
  await ajustar(v, -1, { motivo: 'Faltante de la semana pasada' })
  assert.equal(await codigoDe(ajustar(v, -1, {})), 'MOTIVO_OBLIGATORIO', 'sin código ni texto, nada')
  // Una pantalla lo exige: ni el texto lo sustituye.
  assert.equal(await codigoDe(ajustar(v, -1, { motivo: 'algo', exigir: true })), 'MOTIVO_OBLIGATORIO')
  const m = (await movimientos(v)).filter((x) => x.type === 'ADJUSTMENT')
  assert.deepEqual(m.map((x) => [x.reasonCode, x.reason]), [['OTHER', 'Se derramó en el almacén'], [null, 'Faltante de la semana pasada']])
  assert.equal((await saldo(v)).onHand, 8)
})

test('4 · un daño lleva un motivo de daño; la baja de lo dañado, uno de baja; recuperarlo no lleva motivo del catálogo', async () => {
  const v = await producto('Daño')
  await entrada(v, 30)
  await danar(v, 6, { motivoCodigo: 'HANDLING' })
  await danar(v, 2, { motivoCodigo: 'STORAGE', motivo: 'Humedad en el estante 3' })
  assert.equal(await codigoDe(danar(v, 1, { motivoCodigo: 'THEFT' })), 'MOTIVO_INVALIDO', 'un robo no daña mercancía')
  assert.equal(await codigoDe(danar(v, 1, { exigir: true })), 'MOTIVO_OBLIGATORIO')
  await resolver(v, 3, 'BAJA', { motivoCodigo: 'EXPIRED' })
  await resolver(v, 1, 'BAJA', { motivoCodigo: 'DEFECT', motivo: 'Lote con falla' })
  assert.equal(await codigoDe(resolver(v, 1, 'BAJA', { motivoCodigo: 'FOUND' })), 'MOTIVO_INVALIDO', 'un sobrante no es una baja')
  assert.equal(await codigoDe(resolver(v, 1, 'BAJA', { exigir: true, motivo: 'texto' })), 'MOTIVO_OBLIGATORIO')
  // Recuperar: texto obligatorio como antes, y un motivo del catálogo no aplica.
  await resolver(v, 2, 'VENDIBLE', { motivo: 'Resultó vendible' })
  assert.equal(await codigoDe(resolver(v, 1, 'VENDIBLE', { motivo: 'x', motivoCodigo: 'HANDLING' })), 'MOTIVO_NO_APLICA')
  assert.equal(await codigoDe(resolver(v, 1, 'VENDIBLE', {})), 'MOTIVO_OBLIGATORIO')
  const m = await movimientos(v)
  assert.deepEqual(
    m.filter((x) => x.type === 'DAMAGE').map((x) => [x.reasonCode, x.reason, x.quantity]),
    [['HANDLING', 'Golpe o mal manejo', 6], ['STORAGE', 'Humedad en el estante 3', 2]]
  )
  assert.deepEqual(
    m.filter((x) => x.type === 'ADJUSTMENT').map((x) => [x.reasonCode, x.reason, x.quantity, x.sourceBucket, x.destinationBucket]),
    [['EXPIRED', 'Vencido', 3, 'DAMAGED', null], ['DEFECT', 'Lote con falla', 1, 'DAMAGED', null], [null, 'Resultó vendible', 2, 'DAMAGED', 'AVAILABLE']]
  )
  const n = await saldo(v)
  assert.deepEqual([n.onHand, n.damaged], [24, 2], '30 − 8 dañadas = 22 vendibles, y las 2 recuperadas vuelven: 24; 8 − 4 bajas − 2 recuperadas = 2 dañadas')
})

test('4b · daño y baja son clases distintas: «devuelto al proveedor» sirve para dar de baja pero no para dañar; y recuperar, aunque se exija motivo, no lleva ninguno del catálogo', async () => {
  const v = await producto('Clases')
  await entrada(v, 20)
  assert.equal(await codigoDe(danar(v, 1, { motivoCodigo: 'SUPPLIER_RETURN' })), 'MOTIVO_INVALIDO', 'devolver al proveedor no daña mercancía')
  await danar(v, 5, { motivoCodigo: 'HANDLING' })
  await resolver(v, 2, 'BAJA', { motivoCodigo: 'SUPPLIER_RETURN' })
  assert.equal(await codigoDe(resolver(v, 1, 'BAJA', { motivoCodigo: 'THEFT' })), 'MOTIVO_INVALIDO', 'un robo no es una baja de lo dañado')
  // Las pantallas piden motivo para dar de baja, pero no para recuperar: aunque se exija, recuperar se escribe solo con su texto.
  await resolver(v, 1, 'VENDIBLE', { motivo: 'Resultó vendible', exigir: true })
  const m = await movimientos(v)
  assert.deepEqual(
    m.filter((x) => x.type === 'ADJUSTMENT').map((x) => [x.reasonCode, x.reason, x.destinationBucket]),
    [['SUPPLIER_RETURN', 'Devuelto al proveedor', null], [null, 'Resultó vendible', 'AVAILABLE']]
  )
})

test('5 · lo que no es un ajuste ni un daño nunca lleva código: ventas, entradas, devoluciones, reservas y transferencias', async () => {
  const v = await producto('Sin código')
  await entrada(v, 20)
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2 }, como(ctx.usuario)))
  await enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 1 }, como(ctx.usuario)))
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad: 2 }, como(ctx.usuario)))
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.suc1, destinoId: ctx.suc2, cantidad: 3 }, como(ctx.usuario)))
  const m = await movimientos(v)
  assert.deepEqual(new Set(m.map((x) => x.type)), new Set(['PURCHASE', 'SALE', 'RETURN', 'RESERVATION', 'TRANSFER_OUT', 'TRANSFER_IN']))
  for (const x of m) assert.equal(x.reasonCode, null, x.type)
})

test('6 · el conteo escribe solo el motivo «diferencia de conteo», y solo si hay diferencia; el manual y el de una sesión', async () => {
  const v1 = await producto('Contado a mano')
  await entrada(v1, 10)
  await enA((tx) => contarEnTx(tx, ctx.a, { varianteId: v1, sucursalId: ctx.suc1, conteo: 7 }, como(ctx.usuario)))
  await enA((tx) => contarEnTx(tx, ctx.a, { varianteId: v1, sucursalId: ctx.suc1, conteo: 7 }, como(ctx.usuario)))
  await enA((tx) => contarEnTx(tx, ctx.a, { varianteId: v1, sucursalId: ctx.suc1, conteo: 9, motivo: 'Aparecieron dos' }, como(ctx.usuario)))
  const m1 = (await movimientos(v1)).filter((x) => x.type === 'ADJUSTMENT')
  assert.deepEqual(m1.map((x) => [x.reasonCode, x.quantity, x.sourceBucket, x.destinationBucket]), [[MOTIVO_DE_CONTEO, 3, 'AVAILABLE', null], [MOTIVO_DE_CONTEO, 2, null, 'AVAILABLE']], 'el conteo sin diferencia no escribe nada')
  assert.equal(m1[0].reason, 'Conteo físico')
  assert.equal(m1[1].reason, 'Aparecieron dos')

  // Una sesión de conteo (movimientos por lote): cada diferencia lleva el código; lo que coincide no escribe.
  const a = await producto('Sesión sobra')
  const b = await producto('Sesión falta')
  const c = await producto('Sesión igual')
  for (const v of [a, b, c]) await entrada(v, 10, ctx.suc2)
  const s = await enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId: ctx.suc2, nota: null }, como(ctx.usuario)))
  for (const [v, n] of [[a, 12], [b, 6], [c, 10]] as const) await enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: s.conteoId, varianteId: v, cantidad: n, modo: 'FIJAR' }, como(ctx.usuario)))
  const r = await enA((tx) => aplicarConteoEnTx(tx, ctx.a, { conteoId: s.conteoId }, como(ctx.usuario)))
  assert.equal(r.aplicada, true)
  for (const [v, esperado] of [[a, 1], [b, 1], [c, 0]] as const) {
    const aj = (await movimientos(v)).filter((x) => x.type === 'ADJUSTMENT')
    assert.equal(aj.length, esperado, v)
    for (const x of aj) assert.equal(x.reasonCode, MOTIVO_DE_CONTEO)
  }
})

test('7 · repetir la misma operación con la misma clave no duplica ni cambia el motivo', async () => {
  const v = await producto('Idempotente')
  await entrada(v, 10)
  const clave = `motivo-${sufijo}-1`
  const uno = await ajustar(v, -2, { motivoCodigo: 'LOST', clave })
  const dos = await ajustar(v, -2, { motivoCodigo: 'LOST', clave })
  assert.equal(dos.repetido, true)
  assert.equal(dos.movimientoId, uno.movimientoId)
  const aj = (await movimientos(v)).filter((x) => x.type === 'ADJUSTMENT')
  assert.equal(aj.length, 1)
  assert.equal(aj[0].reasonCode, 'LOST')
  assert.equal((await saldo(v)).onHand, 8)
})

test('8 · el motivo queda en la bitácora de actividad junto al texto', async () => {
  const v = await producto('Bitácora')
  await entrada(v, 5)
  await ajustar(v, -1, { motivoCodigo: 'SAMPLE', motivo: 'Muestra al cliente nuevo' })
  const filas = await prisma.auditLog.findMany({ where: { companyId: ctx.a, accion: 'INVENTORY_STOCK_CHANGED' }, orderBy: { createdAt: 'desc' }, take: 5 })
  const f = filas.find((x) => JSON.stringify(x).includes('Muestra al cliente nuevo'))
  assert.ok(f, 'el ajuste dejó su huella')
  assert.match(JSON.stringify(f), /"motivoCodigo":"SAMPLE"/)
})

test('9 · la base vigila lo suyo: formato del código, que solo lo lleven ajustes y daños, y un ledger que no se reescribe', async () => {
  const v = await producto('Defensas')
  await entrada(v, 10)
  const nivel = await saldo(v)
  const base = { companyId: ctx.a, inventoryLevelId: nivel.id, quantity: 1, previousOnHand: 10, newOnHand: 11, sourceBucket: null, destinationBucket: 'AVAILABLE' as const }
  // Un código que no tiene forma de código.
  for (const malo of ['found', 'F', 'CON ESPACIO', '1ABC', 'A'.repeat(41), 'ÑANDÚ']) {
    await assert.rejects(prisma.inventoryMovement.create({ data: { ...base, type: 'ADJUSTMENT', reason: 'x', reasonCode: malo } }), /inventory_movements_motivo_codigo|violates check/i, malo)
  }
  // Una venta con «motivo»: la base no lo admite.
  await assert.rejects(
    prisma.inventoryMovement.create({ data: { ...base, type: 'SALE', sourceBucket: 'AVAILABLE', destinationBucket: null, reasonCode: 'THEFT' } }),
    /inventory_movements_motivo_codigo_tipo|violates check/i
  )
  // Con la forma correcta y en un ajuste, sí.
  const ok = await prisma.inventoryMovement.create({ data: { ...base, type: 'ADJUSTMENT', reason: 'x', reasonCode: 'FOUND' } })
  assert.equal(ok.reasonCode, 'FOUND')
  // Y una vez escrito, no se reescribe (el ledger es inmutable).
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "inventory_movements" SET "reasonCode" = 'LOST' WHERE "id" = '${ok.id}'`), /inmutable|immutable|no se puede|cannot/i)
})
