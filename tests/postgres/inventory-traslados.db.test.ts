import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { cuadra } from '../../src/modules/inventory/domain'
import {
  cancelarTrasladoEnTx,
  enviarTrasladoEnTx,
  recibirTrasladoEnTx,
  recibirEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  transferirEnTx,
} from '../../src/modules/inventory/service'
import { enTransitoDeVarianteEnTx, trasladoDetalleEnTx, trasladosDeLaEmpresaEnTx } from '../../src/modules/inventory/queries'

/**
 * INV-2c · TRANSFERENCIAS CON ENVÍO contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que al enviar las unidades salen del origen y NO están disponibles en ninguna
 *    sucursal hasta que se reciben (en tránsito), y que recibir, cancelar y cerrar
 *    con faltante conservan las unidades: origen + destino + en camino + perdidas
 *    = lo que había;
 *  · TODO O NADA al enviar (una línea sin existencias impide todo el envío);
 *  · recepciones parciales, cancelar devolviendo lo pendiente al origen, y que
 *    cerrar con faltante exige motivo;
 *  · idempotencia (5 envíos iguales a la vez = uno) y que dos recepciones o una
 *    recepción y una cancelación simultáneas no duplican ni pierden unidades;
 *  · que ni los envíos cruzados A→B / B→A con saldos nuevos ni la transferencia
 *    directa se interbloquean;
 *  · que la base no deja saltarse los estados ni bajar lo recibido, y que lo cerrado
 *    no cambia;
 *  · que ninguna empresa ve ni toca las transferencias de otra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', otro: '', sucA1: '', sucA2: '', sucA3: '', sucInactiva: '', sucB: '', varianteB: '', servicio: '', v: [] as string[] }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

async function varianteNueva(companyId: string, nombre: string, tipo: 'PHYSICAL_PRODUCT' | 'SERVICE', sku: string) {
  const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name: nombre, type: tipo, price: 100, sku }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return v.id
}

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Traslados ${x} ${sufijo}`, slug: `traslados-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-trf-${sufijo}`, email: `trf-${sufijo}@prueba.test`, name: 'Encargado', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.otro = (await prisma.user.create({ data: { supabaseId: `sb-trf2-${sufijo}`, email: `trf2-${sufijo}@prueba.test`, name: 'Recibe', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucA3 = (await suc(ctx.a, 'Este')).id
  ctx.sucInactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  for (let i = 0; i < 10; i++) ctx.v.push(await varianteNueva(ctx.a, `Producto ${i} ${sufijo}`, 'PHYSICAL_PRODUCT', `TRF-P${i}-${sufijo}`))
  ctx.servicio = await varianteNueva(ctx.a, `Lavado ${sufijo}`, 'SERVICE', `TRF-S-${sufijo}`)
  ctx.varianteB = await varianteNueva(ctx.b, `Ajeno ${sufijo}`, 'PHYSICAL_PRODUCT', `TRF-B-${sufijo}`)
})

after(async () => {
  // El ledger y las transferencias cerradas no se borran (lo prohíbe la base). Para limpiar el rastro se desactivan los
  // disparadores ordinarios solo en esta transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "inventory_receipt_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_receipts" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_transfer_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_transfers" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_movements" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_reservations" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_levels" WHERE "companyId" IN (${Prisma.join(ids)})`
  })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: [ctx.usuario, ctx.otro] } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
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

type Linea = { varianteId: string; cantidad: number }
const enviar = (origen: string, destino: string, lineas: Linea[], extra: Partial<Parameters<typeof enviarTrasladoEnTx>[2]> = {}, actor: string | null = ctx.usuario) =>
  enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: origen, destinoId: destino, lineas, ...extra }, como(actor)))
const recibir = (trasladoId: string, extra: Partial<Parameters<typeof recibirTrasladoEnTx>[2]> = {}, actor: string | null = ctx.otro) =>
  enA((tx) => recibirTrasladoEnTx(tx, ctx.a, { trasladoId, ...extra }, como(actor)))
const cancelar = (trasladoId: string, motivo: string | null = null) => enA((tx) => cancelarTrasladoEnTx(tx, ctx.a, { trasladoId, motivo }, como(ctx.usuario)))
const entrada = (varianteId: string, sucursalId: string, cantidad: number) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId, sucursalId, cantidad }, como(ctx.usuario)))
const nivel = (varianteId: string, sucursalId: string) => prisma.inventoryLevel.findFirst({ where: { catalogVariantId: varianteId, locationId: sucursalId } })
const existencia = async (varianteId: string, sucursalId: string) => (await nivel(varianteId, sucursalId))?.onHand ?? 0
const movimientosDe = (nivelId: string) => prisma.inventoryMovement.findMany({ where: { inventoryLevelId: nivelId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
async function verificarCuadre(varianteId: string, sucursalId: string) {
  const n = await nivel(varianteId, sucursalId)
  if (!n) return
  assert.ok(cuadra(n, await movimientosDe(n.id)), `el saldo de ${varianteId} en ${sucursalId} no cuadra con el ledger`)
}
const detalle = (id: string) => enA((tx) => trasladoDetalleEnTx(tx, ctx.a, id))
const enCamino = async (varianteId: string) => (await enA((tx) => enTransitoDeVarianteEnTx(tx, ctx.a, varianteId))).total
/** Las unidades se CONSERVAN: lo que hay en las sucursales + lo que va en camino + lo perdido = lo que había. */
async function conservado(varianteId: string, sucursales: string[], inicial: number) {
  const enSucursales = (await Promise.all(sucursales.map((s) => existencia(varianteId, s)))).reduce((a, b) => a + b, 0)
  const perdido = (await prisma.inventoryTransferLine.aggregate({ where: { catalogVariantId: varianteId }, _sum: { quantityLost: true } }))._sum.quantityLost ?? 0
  assert.equal(enSucursales + (await enCamino(varianteId)) + perdido, inicial, `se perdieron unidades de ${varianteId}`)
}

// ── Enviar ───────────────────────────────────────────────────────────────────

test('1 · enviar saca las unidades del origen y las deja EN TRÁNSITO: no hay en el destino ni disponibles en ninguna sucursal', async () => {
  const [p0, p1] = ctx.v
  await entrada(p0, ctx.sucA1, 10)
  await entrada(p1, ctx.sucA1, 6)
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p0, cantidad: 4 }, { varianteId: p1, cantidad: 6 }], { nota: '  Reposición   de la semana ' })
  assert.match(r.numero, /^TRF-\d{4}-\d{6}$/)
  assert.equal(r.repetido, false)
  assert.deepEqual([r.lineas, r.unidades], [2, 10])
  assert.deepEqual(r.variantes.sort(), [p0, p1].sort())
  assert.equal(await existencia(p0, ctx.sucA1), 6)
  assert.equal(await existencia(p1, ctx.sucA1), 0)
  assert.equal(await nivel(p0, ctx.sucA2), null, 'enviar no toca el destino: aún no hay nada allí')
  assert.equal(await enCamino(p0), 4)
  assert.equal(await enCamino(p1), 6)
  const d = (await detalle(r.trasladoId))!
  assert.equal(d.estado, 'SENT')
  assert.equal(d.nota, 'Reposición de la semana', 'la nota se normaliza')
  assert.deepEqual([d.origenNombre, d.destinoNombre, d.enviadoPorNombre], ['Principal', 'Norte', 'Encargado'])
  assert.deepEqual([d.lineas, d.unidades, d.recibidas, d.enTransito], [2, 10, 0, 10])
  assert.deepEqual(d.detalle.map((l) => [l.enviado, l.recibido, l.pendiente]), [[4, 0, 4], [6, 0, 6]])
  // Cada línea apunta al TRANSFER_OUT que la produjo, con el número en el motivo.
  const salidas = await prisma.inventoryMovement.findMany({ where: { referenceType: 'TRANSFER', referenceId: r.trasladoId } })
  assert.equal(salidas.length, 2)
  assert.ok(salidas.every((m) => m.type === 'TRANSFER_OUT' && m.reason === `Transferencia ${r.numero} enviada a Norte` && m.userId === ctx.usuario))
  assert.equal(await prisma.inventoryTransferLine.count({ where: { transferId: r.trasladoId, outMovementId: { in: salidas.map((m) => m.id) } } }), 2)
  const t = await enA((tx) => enTransitoDeVarianteEnTx(tx, ctx.a, p0))
  assert.deepEqual(t.traslados.map((x) => [x.numero, x.origenNombre, x.destinoNombre, x.pendiente]), [[r.numero, 'Principal', 'Norte', 4]])
  await verificarCuadre(p0, ctx.sucA1)
  await cancelar(r.trasladoId)
})

test('2 · lo que no se puede enviar se rechaza antes de tocar nada: misma sucursal, destino cerrado, producto ajeno o servicio, cantidades malas', async () => {
  const p = ctx.v[2]
  await entrada(p, ctx.sucA1, 5)
  const ok: Linea[] = [{ varianteId: p, cantidad: 1 }]
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA1, ok)), 'MISMA_SUCURSAL')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucInactiva, ok)), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucB, ok)), 'SUCURSAL_NO_ENCONTRADA', 'la sucursal de otra empresa no existe')
  assert.equal(await codigoDe(enviar('inventada', ctx.sucA2, ok)), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [])), 'TRASLADO_SIN_LINEAS')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: ctx.servicio, cantidad: 1 }])), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: ctx.varianteB, cantidad: 1 }])), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [ok[0], ok[0]])), 'LINEA_REPETIDA')
  for (const malo of [0, -1, 1.5, Number.NaN, 1_000_001]) assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: malo }])), 'CANTIDAD_INVALIDA', String(malo))
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, ok, { nota: 'x'.repeat(501) })), 'NOTA_INVALIDA')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, Array.from({ length: 201 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 })))), 'DEMASIADAS_LINEAS')
  assert.equal(await existencia(p, ctx.sucA1), 5, 'nada se movió')
})

test('3 · TODO O NADA: si una línea no alcanza no sale NINGUNA, se dicen todas las que no alcanzan y no se gasta un número', async () => {
  const [, , , p3, p4] = ctx.v
  await entrada(p3, ctx.sucA1, 5)
  await entrada(p4, ctx.sucA1, 2)
  const antes = await prisma.inventoryTransfer.count({ where: { companyId: ctx.a } })
  const e = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p3, cantidad: 3 }, { varianteId: p4, cantidad: 9 }, { varianteId: ctx.v[9], cantidad: 1 }]).catch((x) => x)
  assert.ok(e instanceof InventarioError && e.codigo === 'STOCK_INSUFICIENTE')
  assert.match(e.message, new RegExp(`Producto 4 ${sufijo}.*pides 9, hay 2`))
  assert.match(e.message, new RegExp(`Producto 9 ${sufijo}.*pides 1, hay 0`), 'un producto sin saldo es un cero')
  assert.equal(await existencia(p3, ctx.sucA1), 5, 'ni la línea buena salió')
  assert.equal(await prisma.inventoryTransfer.count({ where: { companyId: ctx.a } }), antes)
  const bueno = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p3, cantidad: 3 }])
  const siguiente = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p4, cantidad: 1 }])
  assert.equal(Number(siguiente.numero.slice(-6)), Number(bueno.numero.slice(-6)) + 1, 'el fallo no consumió un número')
  await cancelar(bueno.trasladoId)
  await cancelar(siguiente.trasladoId)
})

test('4 · lo apartado no se envía: un envío solo puede llevar lo vendible, y una reserva vencida que nadie barrió ya no aparta', async () => {
  const p = ctx.v[5]
  await entrada(p, ctx.sucA1, 10)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 6, referencia: { tipo: 'ORDER', id: `o-${sufijo}` } }, como(null)))
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 5 }])), 'STOCK_INSUFICIENTE', 'hay 10 pero 6 están apartadas: solo 4 se pueden enviar')
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 4 }])
  assert.equal((await nivel(p, ctx.sucA1))!.onHand, 6)
  assert.equal((await nivel(p, ctx.sucA1))!.reserved, 6)
  await cancelar(r.trasladoId)

  const q = ctx.v[6]
  await entrada(q, ctx.sucA1, 10)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: q, sucursalId: ctx.sucA1, cantidad: 6, ttlMinutos: 5, ahora: new Date(Date.now() - 3_600_000), referencia: { tipo: 'ORDER', id: `o2-${sufijo}` } }, como(null)))
  const vencida = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: q, cantidad: 9 }])
  assert.ok(vencida.numero)
  assert.equal((await nivel(q, ctx.sucA1))!.reserved, 0)
  await cancelar(vencida.trasladoId)
})

test('5 · el mismo envío, aunque llegue 5 veces a la vez, crea UN traslado; con otra clave de otro contenido, se rechaza', async () => {
  const p = ctx.v[7]
  await entrada(p, ctx.sucA1, 20)
  const clave = `clave-${sufijo}`
  const rs = await Promise.all(Array.from({ length: 5 }, () => enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 3 }], { idempotencyKey: clave })))
  assert.equal(new Set(rs.map((r) => r.trasladoId)).size, 1)
  assert.equal(rs.filter((r) => !r.repetido).length, 1)
  assert.equal(await existencia(p, ctx.sucA1), 17, 'salieron 3 una sola vez')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 4 }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(enviar(ctx.sucA1, ctx.sucA3, [{ varianteId: p, cantidad: 3 }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  await cancelar(rs[0].trasladoId)
})

// ── Recibir ──────────────────────────────────────────────────────────────────

test('6 · recibir en partes: queda «recibida en parte» y lo que falta sigue en camino; recibir lo último la cierra', async () => {
  const [p0, p1] = ctx.v
  await entrada(p0, ctx.sucA1, 20)
  await entrada(p1, ctx.sucA1, 20)
  const inicial0 = await existencia(p0, ctx.sucA1)
  const inicial1 = await existencia(p1, ctx.sucA1)
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p0, cantidad: 10 }, { varianteId: p1, cantidad: 5 }])
  const antes0 = await existencia(p0, ctx.sucA2)
  const antes1 = await existencia(p1, ctx.sucA2)

  const a = await recibir(r.trasladoId, { lineas: [{ varianteId: p0, cantidad: 6 }] })
  assert.deepEqual([a.estado, a.recibidas, a.perdidas, a.enTransito, a.repetido], ['PARTIAL', 6, 0, 9, false])
  assert.equal(await existencia(p0, ctx.sucA2) - antes0, 6)
  assert.equal(await existencia(p1, ctx.sucA2) - antes1, 0)
  assert.equal(await enCamino(p0), 4)
  let d = (await detalle(r.trasladoId))!
  assert.equal(d.estado, 'PARTIAL')
  assert.deepEqual(d.detalle.map((l) => [l.enviado, l.recibido, l.pendiente]), [[10, 6, 4], [5, 0, 5]])

  // Más de lo que falta, un producto ajeno, cero o nada: se rechaza y no mueve nada.
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p0, cantidad: 5 }] })), 'RECIBE_MAS_DE_LO_ENVIADO')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: ctx.v[3], cantidad: 1 }] })), 'LINEA_AJENA')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p0, cantidad: 0 }] })), 'SIN_CANTIDADES')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [] })), 'SIN_CANTIDADES')
  assert.equal(await existencia(p0, ctx.sucA2) - antes0, 6)

  const b = await recibir(r.trasladoId, { lineas: [{ varianteId: p0, cantidad: 4 }, { varianteId: p1, cantidad: 2 }] })
  assert.deepEqual([b.estado, b.recibidas, b.enTransito], ['PARTIAL', 6, 3])
  const c = await recibir(r.trasladoId, { todo: true })
  assert.deepEqual([c.estado, c.recibidas, c.enTransito], ['RECEIVED', 3, 0])
  d = (await detalle(r.trasladoId))!
  assert.equal(d.estado, 'RECEIVED')
  assert.deepEqual([d.recibidas, d.perdidas, d.devueltas, d.enTransito], [15, 0, 0, 0])
  assert.equal(d.cerradoPorNombre, 'Recibe')
  assert.equal(await existencia(p0, ctx.sucA2) - antes0, 10)
  assert.equal(await existencia(p1, ctx.sucA2) - antes1, 5)
  await conservado(p0, [ctx.sucA1, ctx.sucA2], inicial0 + antes0)
  await conservado(p1, [ctx.sucA1, ctx.sucA2], inicial1 + antes1)
  for (const [v, s] of [[p0, ctx.sucA1], [p0, ctx.sucA2], [p1, ctx.sucA1], [p1, ctx.sucA2]] as const) await verificarCuadre(v, s)
  // El historial de la transferencia: la salida y cada recepción, en orden, con quién y cuándo.
  const tipos = d.historial.map((m) => m.tipo)
  assert.deepEqual(tipos, ['TRANSFER_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_IN', 'TRANSFER_IN', 'TRANSFER_IN'].slice(0, tipos.length))
  assert.equal(d.historial.filter((m) => m.tipo === 'TRANSFER_OUT').length, 2)
  assert.equal(d.historial.filter((m) => m.tipo === 'TRANSFER_IN').reduce((s, m) => s + m.cantidad, 0), 15)
  assert.ok(d.historial.filter((m) => m.tipo === 'TRANSFER_IN').every((m) => m.usuarioNombre === 'Recibe' && m.sucursalNombre === 'Norte'))
  // Ya cerrada: no admite más.
  assert.equal(await codigoDe(recibir(r.trasladoId, { todo: true })), 'TRASLADO_CERRADO')
  assert.equal(await codigoDe(cancelar(r.trasladoId)), 'TRASLADO_CERRADO')
})

test('7 · cerrar con faltante EXIGE motivo; lo que no llegó queda como perdido y las unidades siguen cuadrando', async () => {
  const p = ctx.v[8]
  await entrada(p, ctx.sucA1, 12)
  const r = await enviar(ctx.sucA1, ctx.sucA3, [{ varianteId: p, cantidad: 12 }])
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 9 }], cerrarConFaltante: true })), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 9 }], cerrarConFaltante: true, motivo: '   ' })), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 9 }], cerrarConFaltante: true, motivo: 'x'.repeat(301) })), 'MOTIVO_INVALIDO')
  assert.equal((await detalle(r.trasladoId))!.estado, 'SENT', 'los rechazos no movieron nada')
  assert.equal(await existencia(p, ctx.sucA3), 0)
  const c = await recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 9 }], cerrarConFaltante: true, motivo: '  Se mojaron 3 cajas en el camino ' })
  assert.deepEqual([c.estado, c.recibidas, c.perdidas, c.enTransito], ['RECEIVED', 9, 3, 0])
  const d = (await detalle(r.trasladoId))!
  assert.deepEqual([d.estado, d.recibidas, d.perdidas, d.devueltas], ['RECEIVED', 9, 3, 0])
  assert.equal(d.motivoCierre, 'Se mojaron 3 cajas en el camino')
  assert.deepEqual(d.detalle.map((l) => [l.enviado, l.recibido, l.perdido, l.pendiente]), [[12, 9, 3, 0]])
  assert.equal(await existencia(p, ctx.sucA3), 9)
  assert.equal(await enCamino(p), 0, 'lo perdido ya no está en camino')
  await conservado(p, [ctx.sucA1, ctx.sucA2, ctx.sucA3], 12)
  await verificarCuadre(p, ctx.sucA3)

  // Todo se perdió: se cierra sin recibir nada, también con motivo.
  await entrada(p, ctx.sucA1, 4)
  const t = await enviar(ctx.sucA1, ctx.sucA3, [{ varianteId: p, cantidad: 4 }])
  assert.equal(await codigoDe(recibir(t.trasladoId, { cerrarConFaltante: true })), 'MOTIVO_OBLIGATORIO')
  const perdida = await recibir(t.trasladoId, { cerrarConFaltante: true, motivo: 'El camión no llegó' })
  assert.deepEqual([perdida.estado, perdida.recibidas, perdida.perdidas], ['RECEIVED', 0, 4])
  assert.equal(await existencia(p, ctx.sucA3), 9)
})

test('8 · cancelar devuelve al origen LO QUE SIGUE EN CAMINO (lo ya recibido se queda); cancelar dos veces no repite nada', async () => {
  const [p0, p1] = ctx.v
  await entrada(p0, ctx.sucA1, 10)
  await entrada(p1, ctx.sucA1, 10)
  const inicial0 = await existencia(p0, ctx.sucA1)
  const destino0 = await existencia(p0, ctx.sucA2)
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p0, cantidad: 8 }, { varianteId: p1, cantidad: 3 }])
  await recibir(r.trasladoId, { lineas: [{ varianteId: p0, cantidad: 5 }] })
  assert.equal(await existencia(p0, ctx.sucA1), inicial0 - 8)

  const c = await cancelar(r.trasladoId, '  El cliente cambió de idea ')
  assert.deepEqual([c.devueltas, c.repetido], [3 + 3, false])
  assert.equal(await existencia(p0, ctx.sucA1), inicial0 - 5, 'volvieron las 3 que no habían llegado; las 5 recibidas se quedan allá')
  assert.equal(await existencia(p0, ctx.sucA2), destino0 + 5)
  const d = (await detalle(r.trasladoId))!
  assert.deepEqual([d.estado, d.recibidas, d.devueltas, d.perdidas, d.enTransito], ['CANCELLED', 5, 6, 0, 0])
  assert.equal(d.motivoCierre, 'El cliente cambió de idea')
  assert.deepEqual(d.detalle.map((l) => [l.enviado, l.recibido, l.devuelto, l.pendiente]), [[8, 5, 3, 0], [3, 0, 3, 0]])
  const devoluciones = d.historial.filter((m) => m.motivo === `Transferencia ${d.numero} cancelada: devuelto al origen`)
  assert.equal(devoluciones.length, 2)
  assert.ok(devoluciones.every((m) => m.tipo === 'TRANSFER_IN' && m.sucursalNombre === 'Principal'))
  assert.equal(await enCamino(p0), 0)
  await conservado(p0, [ctx.sucA1, ctx.sucA2], inicial0 + destino0)
  await verificarCuadre(p0, ctx.sucA1)
  assert.equal((await cancelar(r.trasladoId)).repetido, true, 'cancelar de nuevo es inocuo')
  assert.equal(await existencia(p0, ctx.sucA1), inicial0 - 5)
  assert.equal(await codigoDe(recibir(r.trasladoId, { todo: true })), 'TRASLADO_CERRADO')
})

test('9 · una recepción repetida (misma clave) no suma dos veces, aunque la transferencia ya se haya cerrado; con otras cantidades se rechaza', async () => {
  const p = ctx.v[4]
  await entrada(p, ctx.sucA1, 10)
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 10 }])
  const antes = await existencia(p, ctx.sucA2)
  const clave = `rec-${sufijo}`
  const rs = await Promise.all(Array.from({ length: 4 }, () => recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 4 }], idempotencyKey: clave })))
  assert.equal(rs.filter((x) => !x.repetido).length, 1)
  assert.equal(await existencia(p, ctx.sucA2) - antes, 4, 'entró una sola vez')
  assert.equal(await codigoDe(recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 5 }], idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  // Cierra con otra clave; el reintento de la primera sigue siendo inocuo.
  await recibir(r.trasladoId, { todo: true, idempotencyKey: `rec2-${sufijo}` })
  assert.equal((await detalle(r.trasladoId))!.estado, 'RECEIVED')
  const tarde = await recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 4 }], idempotencyKey: clave })
  assert.equal(tarde.repetido, true)
  assert.equal(await existencia(p, ctx.sucA2) - antes, 10)
})

test('10 · el destino cerrado no recibe (y el mensaje manda a cancelar); cancelar devuelve al origen aunque ya esté cerrado', async () => {
  const p = ctx.v[1]
  await entrada(p, ctx.sucA1, 6)
  const r = await enviar(ctx.sucA1, ctx.sucA3, [{ varianteId: p, cantidad: 6 }])
  await prisma.sucursal.update({ where: { id: ctx.sucA3 }, data: { activa: false } })
  const e = await recibir(r.trasladoId, { todo: true }).catch((x) => x)
  assert.ok(e instanceof InventarioError && e.codigo === 'SUCURSAL_INACTIVA')
  assert.match(e.message, /cancela la transferencia/)
  await prisma.sucursal.update({ where: { id: ctx.sucA1 }, data: { activa: false } })
  const c = await cancelar(r.trasladoId)
  assert.equal(c.devueltas, 6, 'volver al origen es devolver: se admite aunque la sucursal esté cerrada')
  await prisma.sucursal.update({ where: { id: ctx.sucA1 }, data: { activa: true } })
  await prisma.sucursal.update({ where: { id: ctx.sucA3 }, data: { activa: true } })
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('11 · dos recepciones completas a la vez: una gana y la otra recibe «cerrada»; las unidades entran UNA vez', async () => {
  const p = ctx.v[2]
  await entrada(p, ctx.sucA1, 10)
  const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 10 }])
  const antes = await existencia(p, ctx.sucA2)
  const rs = await Promise.allSettled([recibir(r.trasladoId, { todo: true }), recibir(r.trasladoId, { todo: true }), recibir(r.trasladoId, { lineas: [{ varianteId: p, cantidad: 10 }] })])
  const ok = rs.filter((x) => x.status === 'fulfilled')
  assert.equal(ok.length, 1)
  for (const x of rs) if (x.status === 'rejected') assert.ok(x.reason instanceof InventarioError && x.reason.codigo === 'TRASLADO_CERRADO', String(x.reason))
  assert.equal(await existencia(p, ctx.sucA2) - antes, 10)
})

test('12 · recibir y cancelar a la vez: o llega o vuelve, nunca las dos cosas ni ninguna; las unidades se conservan', async () => {
  const p = ctx.v[3]
  await entrada(p, ctx.sucA1, 30)
  const inicial = (await existencia(p, ctx.sucA1)) + (await existencia(p, ctx.sucA2))
  for (let ronda = 0; ronda < 6; ronda++) {
    const r = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 4 }])
    const rs = await Promise.allSettled(ronda % 2 ? [recibir(r.trasladoId, { todo: true }), cancelar(r.trasladoId)] : [cancelar(r.trasladoId), recibir(r.trasladoId, { todo: true })])
    assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1, `ronda ${ronda}`)
    for (const x of rs) if (x.status === 'rejected') assert.ok(x.reason instanceof InventarioError && x.reason.codigo === 'TRASLADO_CERRADO', String(x.reason))
    const d = (await detalle(r.trasladoId))!
    assert.ok(d.estado === 'RECEIVED' || d.estado === 'CANCELLED')
    assert.equal(d.recibidas + d.devueltas, 4)
    await conservado(p, [ctx.sucA1, ctx.sucA2], inicial)
  }
  await verificarCuadre(p, ctx.sucA1)
  await verificarCuadre(p, ctx.sucA2)
})

test('13 · envíos cruzados A→B y B→A con saldos NUEVOS, y la transferencia directa cruzada, no se interbloquean', async () => {
  const RONDAS = 12
  const POR_RONDA = 12
  const item = await prisma.$transaction(
    async (tx) => {
      const it = await tx.catalogItem.create({
        data: { companyId: ctx.a, name: `Cruce ${sufijo}`, slug: `cruce-${sufijo}`, type: 'PHYSICAL_PRODUCT', status: 'ACTIVE', capabilities: { availableMarketplace: false, availablePOS: true, trackInventory: true } },
        select: { id: true },
      })
      await tx.catalogVariant.createMany({
        data: Array.from({ length: RONDAS * POR_RONDA }, (_, i) => ({ companyId: ctx.a, catalogItemId: it.id, name: `X${i}`, sku: `CRUCE-${i}-${sufijo}`, price: 1, attributes: {}, status: 'ACTIVE' as const, isDefault: false, position: i })),
      })
      return it.id
    },
    { timeout: 60_000 }
  )
  const todas = (await prisma.catalogVariant.findMany({ where: { catalogItemId: item }, orderBy: { position: 'asc' }, select: { id: true } })).map((x) => x.id)
  const barajar = <T,>(xs: T[], semilla: number) => xs.map((x, i) => [x, Math.sin(semilla * 97 + i * 31)] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const vs = todas.slice(ronda * POR_RONDA, (ronda + 1) * POR_RONDA)
    // Existencias en AMBAS sucursales (por entrada, que crea los saldos): el cruce de envíos pelea por las filas ya existentes.
    for (const v of vs) {
      await entrada(v, ctx.sucA1, 10)
      await entrada(v, ctx.sucA2, 10)
    }
    const rs = await Promise.all([
      enviar(ctx.sucA1, ctx.sucA2, barajar(vs, ronda + 1).map((varianteId) => ({ varianteId, cantidad: 3 }))),
      enviar(ctx.sucA2, ctx.sucA1, barajar(vs, ronda + 50).map((varianteId) => ({ varianteId, cantidad: 2 }))),
      enviar(ctx.sucA1, ctx.sucA2, barajar(vs, ronda + 100).map((varianteId) => ({ varianteId, cantidad: 1 }))),
    ])
    // Y a la vez se reciben en el orden opuesto, más una directa cruzada del primero.
    await Promise.all([
      recibir(rs[0].trasladoId, { todo: true }),
      recibir(rs[1].trasladoId, { todo: true }),
      cancelar(rs[2].trasladoId),
      enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: vs[0], origenId: ctx.sucA2, destinoId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario))),
      enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: vs[0], origenId: ctx.sucA1, destinoId: ctx.sucA2, cantidad: 1 }, como(ctx.usuario))),
    ])
  }
  // Cada producto: 10 + 10 al principio; los envíos solo mueven entre las dos sucursales y no hay nada en camino ni perdido.
  for (const v of todas.slice(0, 20)) {
    assert.equal((await existencia(v, ctx.sucA1)) + (await existencia(v, ctx.sucA2)), 20)
    await verificarCuadre(v, ctx.sucA1)
    await verificarCuadre(v, ctx.sucA2)
  }
  assert.equal((await enA((tx) => enTransitoDeVarianteEnTx(tx, ctx.a, todas[0]))).total, 0)
})

test('13b · la transferencia DIRECTA cruzada con saldos que aún no existen no se interbloquea (se crean en orden fijo)', async () => {
  const RONDAS = 25
  const item = await prisma.$transaction(
    async (tx) => {
      const it = await tx.catalogItem.create({
        data: { companyId: ctx.a, name: `Directa ${sufijo}`, slug: `directa-${sufijo}`, type: 'PHYSICAL_PRODUCT', status: 'ACTIVE', capabilities: { availableMarketplace: false, availablePOS: true, trackInventory: true } },
        select: { id: true },
      })
      await tx.catalogVariant.createMany({
        data: Array.from({ length: RONDAS }, (_, i) => ({ companyId: ctx.a, catalogItemId: it.id, name: `D${i}`, sku: `DIR-${i}-${sufijo}`, price: 1, attributes: {}, status: 'ACTIVE' as const, isDefault: false, position: i })),
      })
      return it.id
    },
    { timeout: 60_000 }
  )
  const todas = (await prisma.catalogVariant.findMany({ where: { catalogItemId: item }, orderBy: { position: 'asc' }, select: { id: true } })).map((x) => x.id)
  for (const v of todas) {
    // Ninguna de las dos sucursales tiene saldo: las dos transferencias intentan crear los dos a la vez.
    const rs = await Promise.allSettled([
      enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.sucA1, destinoId: ctx.sucA2, cantidad: 1 }, como(ctx.usuario))),
      enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.sucA2, destinoId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario))),
    ])
    // Sin existencias ninguna puede salir: el error esperado es «no hay suficiente», NUNCA un interbloqueo.
    for (const x of rs) {
      assert.equal(x.status, 'rejected')
      if (x.status === 'rejected') assert.ok(x.reason instanceof InventarioError && x.reason.codigo === 'STOCK_INSUFICIENTE', String(x.reason))
    }
  }
})

// ── Lo que garantiza la base ─────────────────────────────────────────────────

test('14 · la base: no deja saltarse los estados, bajar lo recibido ni tocar lo cerrado; las líneas solo avanzan', async () => {
  const p = ctx.v[6]
  await entrada(p, ctx.sucA1, 20)
  const abierta = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 10 }])
  const l = await prisma.inventoryTransferLine.findFirstOrThrow({ where: { transferId: abierta.trasladoId } })
  // Estados: de «enviada» no se pasa a «enviada»; lo que identifica a la transferencia no se toca.
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "status" = 'SENT' WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_transicion/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "number" = 'TRF-2000-000001' WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "toLocationId" = ${ctx.sucA3} WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "unitCount" = 1 WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_transfers" WHERE "id" = ${abierta.trasladoId}`, /no admiten DELETE/)
  // Cerrar sin contar la historia lo rechaza el CHECK (recibidas + devueltas + perdidas = enviadas).
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "status" = 'RECEIVED', "closedAt" = now() WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_forma/)
  await assert.rejects(
    prisma.$executeRaw`UPDATE "inventory_transfers" SET "status" = 'RECEIVED', "closedAt" = now(), "receivedUnits" = 7, "returnedUnits" = 0, "lostUnits" = 3 WHERE "id" = ${abierta.trasladoId}`,
    /inventory_transfers_forma/,
    'un faltante sin motivo'
  )
  // Las líneas: solo suben, nunca pasan de lo enviado, y lo suyo no cambia.
  await prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 3 WHERE "id" = ${l.id}`
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 2 WHERE "id" = ${l.id}`, /no baja/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 11 WHERE "id" = ${l.id}`, /inventory_transfer_lines_forma/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReturned" = 8 WHERE "id" = ${l.id}`, /inventory_transfer_lines_forma/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantitySent" = 99 WHERE "id" = ${l.id}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "catalogVariantId" = ${ctx.v[7]} WHERE "id" = ${l.id}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_transfer_lines" WHERE "id" = ${l.id}`, /no admiten DELETE/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_transfers" CASCADE'), /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_transfer_lines"'), /inventory_transfers_inmutable/)
  // Se pone la línea en su sitio para que el servicio siga viendo lo que corresponde (el disparador no deja bajarla: se limpia al final).
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfer_lines" ("id","companyId","transferId","catalogVariantId","position","quantitySent","outMovementId") VALUES ('x-nueva', ${ctx.a}, ${abierta.trasladoId}, ${ctx.v[7]}, 5, 1, 'no-existe')`,
    /inventory_transfer_lines_outMovementId_fkey/,
    'el movimiento de salida tiene que existir'
  )

  // «Recibida en parte» no vuelve a «enviada», pero sí puede cerrarse o cancelarse.
  const parcial = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 4 }])
  await recibir(parcial.trasladoId, { lineas: [{ varianteId: p, cantidad: 1 }] })
  assert.equal((await detalle(parcial.trasladoId))?.estado, 'PARTIAL')
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "status" = 'SENT' WHERE "id" = ${parcial.trasladoId}`, /inventory_transfers_transicion/, 'parcial → enviada no existe')
  await cancelar(parcial.trasladoId)

  // Cerrada: ni el encabezado ni las líneas.
  const cerrada = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 2 }])
  await recibir(cerrada.trasladoId, { todo: true })
  const lc = await prisma.inventoryTransferLine.findFirstOrThrow({ where: { transferId: cerrada.trasladoId } })
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "closeReason" = 'x' WHERE "id" = ${cerrada.trasladoId}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "status" = 'CANCELLED' WHERE "id" = ${cerrada.trasladoId}`, /inventory_transfers_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 2 WHERE "id" = ${lc.id}`, /inventory_transfers_inmutable/)
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfer_lines" ("id","companyId","transferId","catalogVariantId","position","quantitySent","outMovementId") VALUES ('x-cerrada', ${ctx.a}, ${cerrada.trasladoId}, ${ctx.v[7]}, 5, 1, ${lc.outMovementId})`,
    /inventory_transfers_inmutable/,
    'a una transferencia que ya no está «enviada» no se le agregan líneas'
  )
  await cancelar(abierta.trasladoId)
  // Cancelada tampoco cambia (y lo dice con el mismo mensaje que «recibida»).
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_transfers" SET "closeReason" = 'x' WHERE "id" = ${abierta.trasladoId}`, /inventory_transfers_inmutable: una transferencia CANCELLED no admite cambios/)
})

test('15 · la base: formas imposibles y mezcla de empresas se rechazan aunque se escriban por fuera del servicio', async () => {
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount") VALUES ('x-mismo', ${ctx.a}, 'TRF-2099-000001', ${ctx.sucA1}, ${ctx.sucA1}, 1, 1)`,
    /inventory_transfers_forma/,
    'el origen y el destino son la misma sucursal'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount") VALUES ('x-numero', ${ctx.a}, 'TRF-MAL', ${ctx.sucA1}, ${ctx.sucA2}, 1, 1)`,
    /inventory_transfers_forma/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount") VALUES ('x-vacia', ${ctx.a}, 'TRF-2099-000002', ${ctx.sucA1}, ${ctx.sucA2}, 0, 0)`,
    /inventory_transfers_forma/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount","status") VALUES ('x-cerrada', ${ctx.a}, 'TRF-2099-000003', ${ctx.sucA1}, ${ctx.sucA2}, 1, 1, 'RECEIVED')`,
    /inventory_transfers_forma/,
    'recibida sin fecha de cierre ni resumen'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount") VALUES ('x-ajena', ${ctx.a}, 'TRF-2099-000004', ${ctx.sucA1}, ${ctx.sucB}, 1, 1)`,
    /inventory_transfers_toLocationId_companyId_fkey/,
    'una sucursal de otra empresa'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount") VALUES ('x-ajena2', ${ctx.a}, 'TRF-2099-000005', ${ctx.sucB}, ${ctx.sucA2}, 1, 1)`,
    /inventory_transfers_fromLocationId_companyId_fkey/
  )
})

test('15b · la base: ni el número, ni la clave, ni el movimiento de salida, ni el producto se repiten, y una línea no mezcla empresas — aunque se escriba por fuera del servicio', async () => {
  const libres = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, transferOutLine: null }, take: 2, select: { id: true } })
  assert.equal(libres.length, 2, 'hacen falta dos movimientos sin línea de transferencia para probar')
  const [mov1, mov2] = libres.map((m) => m.id)
  const traslado = (id: string, numero: string, clave: string | null = null) =>
    prisma.$executeRaw`INSERT INTO "inventory_transfers" ("id","companyId","number","fromLocationId","toLocationId","lineCount","unitCount","idempotencyKey") VALUES (${id}, ${ctx.a}, ${numero}, ${ctx.sucA1}, ${ctx.sucA2}, 1, 1, ${clave})`
  const linea = (id: string, empresa: string, transferId: string, varianteId: string, posicion: number, movimientoId: string, enviado = 1) =>
    prisma.$executeRaw`INSERT INTO "inventory_transfer_lines" ("id","companyId","transferId","catalogVariantId","position","quantitySent","outMovementId") VALUES (${id}, ${empresa}, ${transferId}, ${varianteId}, ${posicion}, ${enviado}, ${movimientoId})`
  try {
    await traslado('x-u1', 'TRF-2099-000010', 'clave-u')
    await assert.rejects(traslado('x-u2', 'TRF-2099-000010'), /23505[\s\S]*Key \("companyId", number\)/, 'el mismo número en la misma empresa')
    await assert.rejects(traslado('x-u3', 'TRF-2099-000011', 'clave-u'), /23505[\s\S]*Key \("companyId", "idempotencyKey"\)/, 'la misma clave de idempotencia en la misma empresa')
    // Sin clave no chocan entre sí: NULL no es igual a NULL.
    await traslado('x-u4', 'TRF-2099-000012')
    await traslado('x-u5', 'TRF-2099-000013')

    await linea('x-l1', ctx.a, 'x-u1', ctx.v[8], 0, mov1, 10)
    await assert.rejects(linea('x-l2', ctx.a, 'x-u1', ctx.v[7], 1, mov1), /23505[\s\S]*Key \("outMovementId"\)/, 'un movimiento de salida no puede ser de dos líneas')
    await assert.rejects(linea('x-l3', ctx.a, 'x-u1', ctx.v[8], 2, mov2), /23505[\s\S]*Key \("transferId", "catalogVariantId"\)/, 'el mismo producto dos veces en una transferencia')
    await assert.rejects(linea('x-l4', ctx.a, 'x-u1', ctx.v[7], 0, mov2), /23505[\s\S]*Key \("transferId", "position"\)/, 'dos líneas en la misma posición')
    await assert.rejects(linea('x-l5', ctx.a, 'x-u1', ctx.varianteB, 3, mov2), /inventory_transfer_lines_catalogVariantId_companyId_fkey/, 'un producto de otra empresa')
    await assert.rejects(linea('x-l6', ctx.b, 'x-u1', ctx.varianteB, 4, mov2), /inventory_transfer_lines_transferId_companyId_fkey/, 'una línea de otra empresa en la transferencia de ésta')

    // Los tres contadores de una línea solo suben, cada uno por su cuenta.
    await prisma.$executeRaw`UPDATE "inventory_transfer_lines" SET "quantityReceived" = 2, "quantityReturned" = 2, "quantityLost" = 2 WHERE "id" = 'x-l1'`
    for (const columna of ['quantityReceived', 'quantityReturned', 'quantityLost']) {
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "inventory_transfer_lines" SET "${columna}" = 1 WHERE "id" = 'x-l1'`), /no baja/, `${columna} no baja`)
    }
    // Lo que identifica a una línea no cambia, columna por columna.
    const cambiosDeLinea: Array<[string, string]> = [
      ['id', `'x-l9'`],
      ['position', '7'],
      ['outMovementId', `'${mov2}'`],
      ['transferId', `'x-u4'`],
      ['companyId', `'${ctx.b}'`],
    ]
    for (const [columna, valor] of cambiosDeLinea) {
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "inventory_transfer_lines" SET "${columna}" = ${valor} WHERE "id" = 'x-l1'`), /inventory_transfers_inmutable/, `la línea no cambia su ${columna}`)
    }
    // Lo que identifica a una transferencia tampoco, columna por columna.
    const cambiosDeTraslado: Array<[string, string]> = [
      ['id', `'x-u9'`],
      ['companyId', `'${ctx.b}'`],
      ['fromLocationId', `'${ctx.sucA3}'`],
      ['createdAt', `now() + interval '1 day'`],
      ['lineCount', '5'],
      ['sentById', `'${ctx.usuario}'`],
      ['note', `'otra nota'`],
      ['idempotencyKey', `'otra-clave'`],
    ]
    for (const [columna, valor] of cambiosDeTraslado) {
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "inventory_transfers" SET "${columna}" = ${valor} WHERE "id" = 'x-u1'`), /inventory_transfers_inmutable/, `la transferencia no cambia su ${columna}`)
    }
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_transfer_lines" WHERE "id" LIKE 'x-l%'`)
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_transfers" WHERE "id" LIKE 'x-u%'`)
    })
  }
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

test('16 · la lista filtra por estado, sucursal (de cualquiera de los dos lados), número y nota; pagina sin repetir; y no cruza empresas', async () => {
  const p = ctx.v[9]
  await entrada(p, ctx.sucA1, 30)
  const a = await enviar(ctx.sucA1, ctx.sucA2, [{ varianteId: p, cantidad: 1 }], { nota: 'Pasillo 7' })
  const b = await enviar(ctx.sucA2, ctx.sucA3, [{ varianteId: p, cantidad: 0 + 1 }].map((x) => x)).catch(() => null)
  assert.equal(b, null, 'Norte no tiene existencias de eso todavía: no sale')
  await recibir(a.trasladoId, { todo: true })
  const c = await enviar(ctx.sucA1, ctx.sucA3, [{ varianteId: p, cantidad: 2 }])
  const todos = await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, {}, { zonaHoraria: 'America/Santo_Domingo', limite: 200 }))
  assert.ok(todos.filas.length >= 6)
  assert.deepEqual(todos.filas.map((f) => f.creadoEn.getTime()), [...todos.filas.map((f) => f.creadoEn.getTime())].sort((x, y) => y - x), 'de lo más reciente a lo más antiguo')
  const abiertas = await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, {}, { zonaHoraria: 'UTC', abiertas: true }))
  assert.ok(abiertas.filas.some((f) => f.id === c.trasladoId) && abiertas.filas.every((f) => f.estado === 'SENT' || f.estado === 'PARTIAL'))
  assert.equal(abiertas.filas.find((f) => f.id === c.trasladoId)!.enTransito, 2)
  const recibidas = await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, { estado: 'RECEIVED' }, { zonaHoraria: 'UTC' }))
  assert.ok(recibidas.filas.some((f) => f.id === a.trasladoId) && recibidas.filas.every((f) => f.estado === 'RECEIVED' && f.enTransito === 0))
  // La sucursal filtra por cualquiera de los dos extremos.
  const deNorte = await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, { sucursalId: ctx.sucA2 }, { zonaHoraria: 'UTC', limite: 200 }))
  assert.ok(deNorte.filas.some((f) => f.id === a.trasladoId) && deNorte.filas.every((f) => f.origenId === ctx.sucA2 || f.destinoId === ctx.sucA2))
  assert.ok(!deNorte.filas.some((f) => f.id === c.trasladoId), 'la que va a Este no toca Norte')
  assert.ok((await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, { q: 'pasillo 7' }, { zonaHoraria: 'UTC' }))).filas.some((f) => f.id === a.trasladoId), 'busca en la nota sin importar mayúsculas')
  assert.equal((await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, { q: c.numero.toLowerCase() }, { zonaHoraria: 'UTC' }))).filas.length, 1, 'busca por número')
  assert.equal((await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, { sucursalId: ctx.sucB }, { zonaHoraria: 'UTC' }))).filas.length, 0, 'una sucursal ajena no encuentra nada')
  // Paginar de 3 en 3 recorre todo sin repetir ni saltarse.
  const vistos: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 60; i++) {
    const pag: Awaited<ReturnType<typeof trasladosDeLaEmpresaEnTx>> = await enA((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.a, {}, { zonaHoraria: 'UTC', cursor, limite: 3 }))
    vistos.push(...pag.filas.map((x) => x.id))
    if (!pag.siguiente) break
    cursor = pag.siguiente
  }
  assert.equal(new Set(vistos).size, vistos.length, 'sin repetidos')
  assert.equal(vistos.length, todos.filas.length)
  // Aislamiento: la empresa B no ve las de A, ni su detalle, ni puede recibir, cancelar o enviar con ellas.
  assert.equal((await enB((tx) => trasladosDeLaEmpresaEnTx(tx, ctx.b, {}, { zonaHoraria: 'UTC' }))).filas.length, 0)
  assert.equal(await enB((tx) => trasladoDetalleEnTx(tx, ctx.b, c.trasladoId)), null)
  assert.equal(await enA((tx) => trasladoDetalleEnTx(tx, ctx.a, 'inventada')), null)
  assert.equal(await codigoDe(enB((tx) => recibirTrasladoEnTx(tx, ctx.b, { trasladoId: c.trasladoId, todo: true }, como(null)))), 'TRASLADO_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => cancelarTrasladoEnTx(tx, ctx.b, { trasladoId: c.trasladoId }, como(null)))), 'TRASLADO_NO_ENCONTRADO')
  assert.equal((await enB((tx) => enTransitoDeVarianteEnTx(tx, ctx.b, p))).total, 0, 'lo que va en camino de A no se ve desde B')
  await cancelar(c.trasladoId)
})

test('17 · un envío de 200 líneas se envía, se recibe en dos tandas y se cierra dentro del tiempo de una transacción', async (t) => {
  const N = 200
  const item = await prisma.$transaction(
    async (tx) => {
      const it = await tx.catalogItem.create({
        data: { companyId: ctx.a, name: `Docientos ${sufijo}`, slug: `docientos-${sufijo}`, type: 'PHYSICAL_PRODUCT', status: 'ACTIVE', capabilities: { availableMarketplace: false, availablePOS: true, trackInventory: true } },
        select: { id: true },
      })
      await tx.catalogVariant.createMany({
        data: Array.from({ length: N }, (_, i) => ({ companyId: ctx.a, catalogItemId: it.id, name: `M${i}`, sku: `MIL-${i}-${sufijo}`, price: 1, attributes: {}, status: 'ACTIVE' as const, isDefault: false, position: i })),
      })
      return it.id
    },
    { timeout: 60_000 }
  )
  const vs = (await prisma.catalogVariant.findMany({ where: { catalogItemId: item }, orderBy: { position: 'asc' }, select: { id: true } })).map((x) => x.id)
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.sucA1, lineas: vs.map((varianteId) => ({ varianteId, cantidad: 5 })) }, como(ctx.usuario)))
  const t0 = Date.now()
  const r = await enviar(ctx.sucA1, ctx.sucA2, vs.map((varianteId) => ({ varianteId, cantidad: 5 })))
  const msEnviar = Date.now() - t0
  const t1 = Date.now()
  await recibir(r.trasladoId, { lineas: vs.slice(0, 100).map((varianteId) => ({ varianteId, cantidad: 3 })) })
  const msRecibir = Date.now() - t1
  const t2 = Date.now()
  const cierre = await recibir(r.trasladoId, { todo: true })
  const msCerrar = Date.now() - t2
  assert.equal(cierre.estado, 'RECEIVED')
  assert.ok(msEnviar < 15_000 && msRecibir < 15_000 && msCerrar < 15_000, `tardó ${msEnviar} / ${msRecibir} / ${msCerrar} ms`)
  t.diagnostic(`200 líneas: enviar ${msEnviar} ms, recibir en parte ${msRecibir} ms, cerrar ${msCerrar} ms (transacción máxima: 45.000 ms)`)
  const suma = await prisma.inventoryLevel.aggregate({ where: { companyId: ctx.a, locationId: ctx.sucA2, catalogVariantId: { in: vs } }, _sum: { onHand: true } })
  assert.equal(suma._sum.onHand, N * 5)
  const origen = await prisma.inventoryLevel.aggregate({ where: { companyId: ctx.a, locationId: ctx.sucA1, catalogVariantId: { in: vs } }, _sum: { onHand: true } })
  assert.equal(origen._sum.onHand, 0)
})
