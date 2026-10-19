import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { cuadra } from '../../src/modules/inventory/domain'
import { MAX_LINEAS_CONTEO } from '../../src/modules/inventory/conteos'
import {
  abrirConteoEnTx,
  aplicarConteoEnTx,
  cancelarConteoEnTx,
  importarConteoEnTx,
  quitarLineaDeConteoEnTx,
  recibirEnTx,
  registrarConteoProductoEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import { conteoAbiertoDeSucursalEnTx, conteoDetalleEnTx, conteosDeLaEmpresaEnTx, hojaDeConteoEnTx, porContarEnTx } from '../../src/modules/inventory/queries'
import { informeDeConteoImportadoEnTx, aplicarImportacionDeConteoEnTx } from '../../src/modules/inventory/importar'

/**
 * INV-2b · CONTEO FÍSICO POR SUCURSAL contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · UN conteo abierto por sucursal (índice único parcial), también con aperturas
 *    simultáneas;
 *  · que aplicar ajusta por la DIFERENCIA y no por el número: una venta ocurrida
 *    mientras se contaba se conserva;
 *  · TODO O NADA: una línea que dejaría menos de lo apartado impide aplicar el
 *    conteo entero, y se dice cuál;
 *  · lo que no se contó no se toca; el saldo cuadra con el ledger;
 *  · aplicar dos veces (también a la vez) no repite nada;
 *  · que un conteo cerrado no se edita ni se borra (disparadores) y que las
 *    líneas llevan las FK compuestas por empresa;
 *  · que ninguna empresa ve ni toca los conteos de otra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', otro: '', sucA1: '', sucA2: '', sucInactiva: '', sucB: '', varianteB: '', servicio: '', v: [] as string[], codigos: [] as string[] }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

async function varianteNueva(companyId: string, nombre: string, tipo: 'PHYSICAL_PRODUCT' | 'SERVICE', sku: string, barcode: string | null = null) {
  const r = await conEmpresa(companyId, (tx) => crearItemEnTx(tx, companyId, { name: nombre, type: tipo, price: 100, sku, barcode }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return v.id
}

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Conteos ${x} ${sufijo}`, slug: `conteos-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-cnt-${sufijo}`, email: `cnt-${sufijo}@prueba.test`, name: 'Encargada', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.otro = (await prisma.user.create({ data: { supabaseId: `sb-cnt2-${sufijo}`, email: `cnt2-${sufijo}@prueba.test`, name: 'Otra persona', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucInactiva = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  for (let i = 0; i < 8; i++) {
    const codigo = `7508${i}${Date.now().toString().slice(-8)}`
    ctx.codigos.push(codigo)
    ctx.v.push(await varianteNueva(ctx.a, `Producto ${i} ${sufijo}`, 'PHYSICAL_PRODUCT', `CNT-P${i}-${sufijo}`, codigo))
  }
  ctx.servicio = await varianteNueva(ctx.a, `Lavado ${sufijo}`, 'SERVICE', `CNT-S-${sufijo}`)
  ctx.varianteB = await varianteNueva(ctx.b, `Ajeno ${sufijo}`, 'PHYSICAL_PRODUCT', `CNT-B-${sufijo}`)
})

after(async () => {
  // El ledger y los conteos cerrados no se borran (lo prohíbe la base). Para limpiar el rastro se desactivan los
  // disparadores ordinarios solo en esta transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRaw`DELETE FROM "inventory_receipt_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_receipts" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_count_lines" WHERE "companyId" IN (${Prisma.join(ids)})`
    await tx.$executeRaw`DELETE FROM "inventory_count_sessions" WHERE "companyId" IN (${Prisma.join(ids)})`
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

const abrir = (sucursalId: string, nota: string | null = null, actor: string | null = ctx.usuario) => enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId, nota }, como(actor)))
const contar = (conteoId: string, varianteId: string, cantidad: number, modo: 'SUMAR' | 'FIJAR' = 'FIJAR', actor: string | null = ctx.usuario) =>
  enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId, varianteId, cantidad, modo }, como(actor)))
const aplicar = (conteoId: string, ahora?: Date) => enA((tx) => aplicarConteoEnTx(tx, ctx.a, { conteoId, ahora }, como(ctx.usuario)))
const cancelar = (conteoId: string, motivo: string | null = null) => enA((tx) => cancelarConteoEnTx(tx, ctx.a, { conteoId, motivo }, como(ctx.usuario)))
const entrada = (varianteId: string, sucursalId: string, cantidad: number) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId, sucursalId, cantidad }, como(ctx.usuario)))
const nivelDe = (varianteId: string, sucursalId: string) =>
  prisma.inventoryLevel.findUniqueOrThrow({ where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } } })
const existencia = async (varianteId: string, sucursalId: string) => (await nivelDe(varianteId, sucursalId)).onHand
const movimientosDe = (nivelId: string) => prisma.inventoryMovement.findMany({ where: { inventoryLevelId: nivelId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
async function verificarCuadre(varianteId: string, sucursalId: string) {
  const n = await nivelDe(varianteId, sucursalId)
  assert.ok(cuadra(n, await movimientosDe(n.id)), `el saldo de ${varianteId} no cuadra con el ledger`)
}
const detalle = (id: string, conEsperado = true) => enA((tx) => conteoDetalleEnTx(tx, ctx.a, id, { conEsperado }))

// ── Abrir ────────────────────────────────────────────────────────────────────

test('1 · abrir un conteo le da su número CNT-AAAA-NNNNNN y deja UNO abierto por sucursal; la misma persona recupera el suyo, otra recibe el aviso', async () => {
  const c = await abrir(ctx.sucA1, '  Inventario   de cierre ')
  assert.match(c.numero, /^CNT-\d{4}-\d{6}$/)
  assert.equal(c.repetido, false)
  const d = await detalle(c.conteoId)
  assert.equal(d?.estado, 'OPEN')
  assert.equal(d?.nota, 'Inventario de cierre', 'la nota se normaliza')
  assert.equal(d?.sucursalNombre, 'Principal')
  assert.equal(d?.abiertoPorNombre, 'Encargada')

  const otraVez = await abrir(ctx.sucA1)
  assert.equal(otraVez.repetido, true, 'un doble clic no abre dos')
  assert.equal(otraVez.conteoId, c.conteoId)
  assert.equal(await codigoDe(abrir(ctx.sucA1, null, ctx.otro)), 'CONTEO_YA_ABIERTO')
  assert.equal((await enA((tx) => conteoAbiertoDeSucursalEnTx(tx, ctx.a, ctx.sucA1)))?.numero, c.numero)

  // Otra sucursal sí admite el suyo, y los correlativos avanzan sin repetirse.
  const n = await abrir(ctx.sucA2)
  assert.equal(Number(n.numero.slice(-6)), Number(c.numero.slice(-6)) + 1)

  assert.equal(await codigoDe(abrir(ctx.sucInactiva)), 'SUCURSAL_INACTIVA')
  assert.equal(await codigoDe(abrir(ctx.sucB)), 'SUCURSAL_NO_ENCONTRADA', 'la sucursal de otra empresa no existe')
  assert.equal(await codigoDe(abrir(ctx.sucA2, 'x'.repeat(501))), 'NOTA_INVALIDA', 'la nota se valida antes de mirar si hay otro abierto')
  await cancelar(c.conteoId)
  await cancelar(n.conteoId)
})

test('2 · 8 aperturas simultáneas de la misma sucursal: nace UN conteo; la misma persona recibe el suyo SIN error y otra recibe el aviso, nunca un error de la base', async () => {
  // La MISMA persona (doble clic, dos pestañas): uno lo crea y los demás reciben ese mismo, ninguno falla.
  const mismos = await Promise.all(Array.from({ length: 8 }, () => abrir(ctx.sucA2)))
  assert.equal(new Set(mismos.map((x) => x.conteoId)).size, 1, 'un solo conteo')
  assert.equal(mismos.filter((x) => !x.repetido).length, 1, 'uno solo lo creó')
  await cancelar(mismos[0].conteoId)

  // Personas DISTINTAS: gana una y las otras reciben «ya hay uno abierto»; ningún error de la base se cuela.
  const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => abrir(ctx.sucA2, null, i % 2 === 0 ? ctx.usuario : ctx.otro)))
  const ok = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const falla = resultados.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
  assert.equal(new Set(ok.map((x) => x.conteoId)).size, 1, 'un solo conteo')
  assert.equal(ok.filter((x) => !x.repetido).length, 1, 'uno solo lo creó')
  for (const f of falla) assert.ok(f instanceof InventarioError && f.codigo === 'CONTEO_YA_ABIERTO', `error inesperado: ${f}`)
  assert.equal(await prisma.inventoryCountSession.count({ where: { companyId: ctx.a, locationId: ctx.sucA2, status: 'OPEN' } }), 1)
  await cancelar(ok[0].conteoId)
})

// ── Contar ───────────────────────────────────────────────────────────────────

test('3 · contar: SUMAR es un escaneo, FIJAR escribe el número y retoma la foto de lo esperado; el conteo a ciegas no devuelve lo esperado', async () => {
  const [p0, p1] = ctx.v
  await entrada(p0, ctx.sucA1, 10)
  const c = await abrir(ctx.sucA1)
  const a = await contar(c.conteoId, p0, 1, 'SUMAR')
  assert.deepEqual([a.contado, a.nueva, a.lineas], [1, true, 1])
  assert.equal((await contar(c.conteoId, p0, 2, 'SUMAR')).contado, 3, 'escanear de nuevo suma')
  assert.equal((await contar(c.conteoId, p0, 3, 'SUMAR')).nueva, false)

  // Cambia lo que dice el sistema DESPUÉS de la primera captura: SUMAR conserva la foto, FIJAR la retoma.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p0, sucursalId: ctx.sucA1, cantidad: 1 }, como(null)))
  await contar(c.conteoId, p0, 1, 'SUMAR')
  let l = (await detalle(c.conteoId))!.detalle.find((x) => x.varianteId === p0)!
  assert.deepEqual([l.contado, l.esperado], [7, 10], 'SUMAR no retoma la foto')
  await contar(c.conteoId, p0, 8, 'FIJAR')
  l = (await detalle(c.conteoId))!.detalle.find((x) => x.varianteId === p0)!
  assert.deepEqual([l.contado, l.esperado], [8, 9], 'FIJAR es un recuento de este momento')

  // A ciegas: ni lo esperado ni las existencias antes/después salen de la lectura.
  const ciego = (await detalle(c.conteoId, false))!.detalle[0]
  assert.equal(ciego.esperado, null)
  assert.equal(ciego.existenciaAntes, null)
  assert.equal(ciego.existenciaDespues, null)

  // Contar un producto que nunca tuvo saldo: lo esperado es 0 y no se crea ningún saldo hasta aplicar.
  await contar(c.conteoId, p1, 4, 'FIJAR')
  assert.equal((await detalle(c.conteoId))!.detalle.find((x) => x.varianteId === p1)!.esperado, 0)
  assert.equal(await prisma.inventoryLevel.count({ where: { catalogVariantId: p1, locationId: ctx.sucA1 } }), 0)
  assert.equal(await existencia(p0, ctx.sucA1), 9, 'contar no mueve existencias')

  await quitarYComprobar(c.conteoId, p1)
  await cancelar(c.conteoId, 'prueba')
})

async function quitarYComprobar(conteoId: string, varianteId: string) {
  const antes = (await detalle(conteoId))!.detalle.length
  assert.equal((await enA((tx) => quitarLineaDeConteoEnTx(tx, ctx.a, { conteoId, varianteId }))).quitada, true)
  assert.equal((await detalle(conteoId))!.detalle.length, antes - 1)
  assert.equal((await enA((tx) => quitarLineaDeConteoEnTx(tx, ctx.a, { conteoId, varianteId }))).quitada, false, 'quitar lo que no está no falla')
}

test('4 · lo que no se puede contar se rechaza: servicio, producto ajeno, cantidades malas, conteo inexistente o de otra empresa', async () => {
  const c = await abrir(ctx.sucA1)
  assert.equal(await codigoDe(contar(c.conteoId, ctx.servicio, 1)), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal(await codigoDe(contar(c.conteoId, ctx.varianteB, 1)), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(contar(c.conteoId, 'inexistente', 1)), 'VARIANTE_NO_ENCONTRADA')
  for (const malo of [-1, 1.5, Number.NaN, 1_000_001, '3' as unknown as number]) assert.equal(await codigoDe(contar(c.conteoId, ctx.v[0], malo)), 'CANTIDAD_INVALIDA', String(malo))
  assert.equal(await codigoDe(contar(c.conteoId, ctx.v[0], 0, 'SUMAR')), 'CANTIDAD_INVALIDA', 'sumar cero no es un escaneo')
  assert.equal(await codigoDe(enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: ctx.v[0], cantidad: 1, modo: 'OTRO' as never }, como(null)))), 'MODO_INVALIDO')
  assert.equal((await contar(c.conteoId, ctx.v[0], 0, 'FIJAR')).contado, 0, '«lo busqué y no hay» es un cero válido')
  // Un conteo de otra empresa o inventado: misma respuesta.
  assert.equal(await codigoDe(enB((tx) => registrarConteoProductoEnTx(tx, ctx.b, { conteoId: c.conteoId, varianteId: ctx.varianteB, cantidad: 1, modo: 'FIJAR' }, como(null)))), 'CONTEO_NO_ENCONTRADO')
  assert.equal(await codigoDe(enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: 'inventado', varianteId: ctx.v[0], cantidad: 1, modo: 'FIJAR' }, como(null)))), 'CONTEO_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => aplicarConteoEnTx(tx, ctx.b, { conteoId: c.conteoId }, como(null)))), 'CONTEO_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => cancelarConteoEnTx(tx, ctx.b, { conteoId: c.conteoId }, como(null)))), 'CONTEO_NO_ENCONTRADO')
  assert.equal((await enB((tx) => conteoDetalleEnTx(tx, ctx.b, c.conteoId, { conEsperado: true }))), null, 'la empresa B no lo ve')
  assert.equal(await prisma.inventoryCountLine.count({ where: { sessionId: c.conteoId } }), 1)
  await cancelar(c.conteoId)
})

// ── Aplicar ──────────────────────────────────────────────────────────────────

test('5 · aplicar ajusta por la DIFERENCIA, no por el número: una venta ocurrida mientras se contaba se conserva; lo que no se contó no se toca', async () => {
  const [, , p2, p3, p4] = ctx.v
  for (const [v, n] of [[p2, 10], [p3, 20], [p4, 7]] as const) await entrada(v, ctx.sucA2, n)
  const c = await abrir(ctx.sucA2, 'Pasillo 1')
  await contar(c.conteoId, p2, 8) // faltan 2
  await contar(c.conteoId, p3, 23) // sobran 3
  // p4 no se cuenta. Mientras se contaba se vendieron 3 de p2 (después de contarlo): 10 → 7.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p2, sucursalId: ctx.sucA2, cantidad: 3 }, como(null)))

  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada)
  assert.equal(r.repetido, false)
  assert.deepEqual(r.resumen, { lineas: 2, ajustadas: 2, unidadesSobrantes: 3, unidadesFaltantes: 2, sinContar: 1 })
  assert.deepEqual(r.variantesBajadas, [p2])
  assert.equal(await existencia(p2, ctx.sucA2), 5, '10 − 3 vendidas − 2 faltantes: la diferencia se aplica a lo de AHORA (7), no se pisa con 8')
  assert.equal(await existencia(p3, ctx.sucA2), 23)
  assert.equal(await existencia(p4, ctx.sucA2), 7, 'lo no contado queda igual')

  // Cada ajuste es un movimiento ADJUSTMENT con el número del conteo, enlazado a su línea.
  const mov = await prisma.inventoryMovement.findMany({ where: { referenceType: 'STOCK_COUNT', referenceId: c.conteoId }, orderBy: { quantity: 'asc' } })
  assert.equal(mov.length, 2)
  assert.ok(mov.every((m) => m.type === 'ADJUSTMENT' && m.reason === `Conteo físico ${c.numero}` && m.userId === ctx.usuario))
  const d = (await detalle(c.conteoId))!
  assert.equal(d.estado, 'APPLIED')
  assert.equal(d.aplicadoPorNombre, 'Encargada')
  const l2 = d.detalle.find((x) => x.varianteId === p2)!
  assert.deepEqual([l2.contado, l2.esperado, l2.existenciaAntes, l2.existenciaDespues, l2.ajustado], [8, 10, 7, 5, true])
  const l3 = d.detalle.find((x) => x.varianteId === p3)!
  assert.deepEqual([l3.existenciaAntes, l3.existenciaDespues], [20, 23])
  for (const v of [p2, p3, p4]) await verificarCuadre(v, ctx.sucA2)
  // Pedido a ciegas, un conteo YA aplicado tampoco entrega lo esperado ni las existencias de antes y después.
  for (const x of (await detalle(c.conteoId, false))!.detalle) assert.deepEqual([x.esperado, x.existenciaAntes, x.existenciaDespues], [null, null, null])

  // Aplicar de nuevo —también a la vez— no repite nada.
  const rs = await Promise.all([aplicar(c.conteoId), aplicar(c.conteoId), aplicar(c.conteoId)])
  for (const x of rs) assert.ok(x.aplicada && x.repetido)
  assert.equal(await existencia(p2, ctx.sucA2), 5)
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceType: 'STOCK_COUNT', referenceId: c.conteoId } }), 2)
  // Ya cerrado: no admite cambios por el servicio.
  assert.equal(await codigoDe(contar(c.conteoId, p2, 1)), 'CONTEO_CERRADO')
  assert.equal(await codigoDe(cancelar(c.conteoId)), 'CONTEO_CERRADO')
  assert.equal(await codigoDe(enA((tx) => quitarLineaDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, varianteId: p2 }))), 'CONTEO_CERRADO')
  // Y la sucursal queda libre para el siguiente.
  const siguiente = await abrir(ctx.sucA2)
  await cancelar(siguiente.conteoId)
})

test('6 · una línea que dejaría menos de lo apartado impide aplicar TODO el conteo, y se dice cuál; al quitarla o corregirla, aplica', async () => {
  const [, , , , , p5, p6] = ctx.v
  await entrada(p5, ctx.sucA1, 10)
  await entrada(p6, ctx.sucA1, 10)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p5, sucursalId: ctx.sucA1, cantidad: 6, referencia: { tipo: 'ORDER', id: `o-${sufijo}` } }, como(null)))
  const c = await abrir(ctx.sucA1)
  await contar(c.conteoId, p5, 2) // 10 → 2 dejaría 2 < 6 apartadas
  await contar(c.conteoId, p6, 9) // esta sí se puede
  const antesP6 = await existencia(p6, ctx.sucA1)

  const r = await aplicar(c.conteoId)
  assert.equal(r.aplicada, false)
  if (r.aplicada) return
  assert.equal(r.rechazadas.length, 1)
  assert.equal(r.rechazadas[0].varianteId, p5)
  assert.match(r.rechazadas[0].motivo, /menos de lo apartado/)
  assert.equal(await existencia(p5, ctx.sucA1), 10)
  assert.equal(await existencia(p6, ctx.sucA1), antesP6, 'ni siquiera la línea buena se aplicó')
  assert.equal((await detalle(c.conteoId))!.estado, 'OPEN')
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceType: 'STOCK_COUNT', referenceId: c.conteoId } }), 0)

  // Corregir la línea (hay al menos 6 en el estante) y aplicar.
  await contar(c.conteoId, p5, 7)
  const ok = await aplicar(c.conteoId)
  assert.ok(ok.aplicada)
  assert.equal(await existencia(p5, ctx.sucA1), 7)
  assert.equal(await existencia(p6, ctx.sucA1), 9)
  assert.equal((await nivelDe(p5, ctx.sucA1)).reserved, 6, 'lo apartado no se toca')
  await verificarCuadre(p5, ctx.sucA1)
})

test('7 · una reserva VENCIDA que nadie ha barrido no impide un faltante: se vence primero', async () => {
  const p7 = ctx.v[7]
  await entrada(p7, ctx.sucA1, 10)
  const hace1h = new Date(Date.now() - 3_600_000)
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p7, sucursalId: ctx.sucA1, cantidad: 6, ttlMinutos: 5, ahora: hace1h, referencia: { tipo: 'ORDER', id: `o7-${sufijo}` } }, como(null)))
  assert.equal((await nivelDe(p7, ctx.sucA1)).reserved, 6, 'la caché sigue apartando: nadie ha barrido')
  const c = await abrir(ctx.sucA1)
  await contar(c.conteoId, p7, 4) // 10 → 4 solo cabe si la reserva vencida ya no aparta
  const r = await aplicar(c.conteoId)
  assert.ok(r.aplicada, JSON.stringify(r))
  const n = await nivelDe(p7, ctx.sucA1)
  assert.deepEqual([n.onHand, n.reserved], [4, 0])
  await verificarCuadre(p7, ctx.sucA1)
})

test('8 · un conteo sin líneas no se aplica; cancelar no toca existencias y queda guardado con quién y por qué', async () => {
  const c = await abrir(ctx.sucA2)
  assert.equal(await codigoDe(aplicar(c.conteoId)), 'CONTEO_SIN_LINEAS')
  await contar(c.conteoId, ctx.v[2], 1)
  const antes = await existencia(ctx.v[2], ctx.sucA2)
  assert.equal(await codigoDe(cancelar(c.conteoId, 'x'.repeat(301))), 'MOTIVO_INVALIDO')
  const r = await cancelar(c.conteoId, '  Se contó la sucursal equivocada ')
  assert.equal(r.repetido, false)
  assert.equal((await cancelar(c.conteoId)).repetido, true, 'cancelar de nuevo es inocuo')
  const d = (await detalle(c.conteoId))!
  assert.equal(d.estado, 'CANCELLED')
  assert.equal(d.motivoCancelacion, 'Se contó la sucursal equivocada')
  assert.equal(d.canceladoPorNombre, 'Encargada')
  assert.equal(await existencia(ctx.v[2], ctx.sucA2), antes)
  assert.equal(await codigoDe(aplicar(c.conteoId)), 'CONTEO_CERRADO')
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('9 · tres personas contando a la vez el mismo conteo suman bien (un escaneo = una unidad) y no se pisan', async () => {
  const c = await abrir(ctx.sucA1, 'Tres lectores')
  const p = ctx.v[0]
  const envios = Array.from({ length: 30 }, (_, i) => contar(c.conteoId, p, 1, 'SUMAR', i % 2 ? ctx.otro : ctx.usuario))
  await Promise.all(envios)
  assert.equal((await detalle(c.conteoId))!.detalle.find((x) => x.varianteId === p)!.contado, 30)
  await cancelar(c.conteoId)
})

test('10 · contar mientras se aplica: o entra antes de aplicar o recibe «cerrado», nunca queda una línea huérfana ni a medias', async () => {
  const p = ctx.v[3]
  const c = await abrir(ctx.sucA2)
  await contar(c.conteoId, p, await existencia(p, ctx.sucA2)) // coincide: aplicar no mueve nada
  const rs = await Promise.allSettled([aplicar(c.conteoId), ...Array.from({ length: 6 }, (_, i) => contar(c.conteoId, ctx.v[4], i + 1, 'FIJAR'))])
  for (const r of rs) if (r.status === 'rejected') assert.ok(r.reason instanceof InventarioError && r.reason.codigo === 'CONTEO_CERRADO', String(r.reason))
  const d = (await detalle(c.conteoId))!
  assert.equal(d.estado, 'APPLIED')
  const lineas = await prisma.inventoryCountLine.findMany({ where: { sessionId: c.conteoId } })
  assert.ok(lineas.every((l) => l.onHandBefore !== null && l.onHandAfter !== null), 'toda línea que quedó tiene su resultado')
  assert.equal(d.lineas, lineas.length)
})

test('11 · dos conteos de sucursales distintas con los mismos productos aplicados a la vez no se interbloquean', async () => {
  const productos = ctx.v.slice(0, 6)
  for (const suc of [ctx.sucA1, ctx.sucA2]) for (const v of productos) await entrada(v, suc, 5)
  for (let ronda = 0; ronda < 4; ronda++) {
    const cs = await Promise.all([abrir(ctx.sucA1), abrir(ctx.sucA2)])
    for (const [i, suc] of [ctx.sucA1, ctx.sucA2].entries()) {
      const orden = [...productos].sort(() => (i ? 1 : -1))
      for (const v of orden) await contar(cs[i].conteoId, v, (await existencia(v, suc)) + (i ? 1 : -1))
    }
    const rs = await Promise.all(cs.map((x) => aplicar(x.conteoId)))
    for (const r of rs) assert.ok(r.aplicada)
  }
  for (const v of productos) {
    await verificarCuadre(v, ctx.sucA1)
    await verificarCuadre(v, ctx.sucA2)
  }
})

test('11b · aplicar un conteo con productos NUEVOS mientras llegan entradas de esos mismos productos no se interbloquea (los dos escritores piden los saldos en el mismo orden)', async () => {
  const RONDAS = 12
  const POR_RONDA = 16
  const item = await prisma.$transaction(
    async (tx) => {
      const it = await tx.catalogItem.create({
        data: { companyId: ctx.a, name: `Carrera ${sufijo}`, slug: `carrera-${sufijo}`, type: 'PHYSICAL_PRODUCT', status: 'ACTIVE', capabilities: { availableMarketplace: false, availablePOS: true, trackInventory: true } },
        select: { id: true },
      })
      await tx.catalogVariant.createMany({
        data: Array.from({ length: RONDAS * POR_RONDA }, (_, i) => ({ companyId: ctx.a, catalogItemId: it.id, name: `R${i}`, sku: `CARR-${i}-${sufijo}`, price: 1, attributes: {}, status: 'ACTIVE' as const, isDefault: false, position: i })),
      })
      return it.id
    },
    { timeout: 60_000 }
  )
  const todas = (await prisma.catalogVariant.findMany({ where: { catalogItemId: item }, orderBy: { position: 'asc' }, select: { id: true } })).map((x) => x.id)
  const barajar = <T,>(xs: T[], semilla: number) => xs.map((x, i) => [x, Math.sin(semilla * 97 + i * 31)] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const vs = todas.slice(ronda * POR_RONDA, (ronda + 1) * POR_RONDA)
    const c = await abrir(ctx.sucA2)
    await enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas: vs.map((varianteId) => ({ varianteId, cantidad: 4 })) }, como(ctx.usuario)))
    // Entradas de los mismos productos, cada una en un orden distinto, a la vez que se aplica el conteo.
    const entradas = Array.from({ length: 5 }, (_, n) =>
      enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.sucA2, lineas: barajar(vs, n + 1 + ronda * 7).map((varianteId) => ({ varianteId, cantidad: 1 })) }, como(ctx.usuario)))
    )
    const [ap] = await Promise.all([aplicar(c.conteoId), ...entradas])
    assert.ok(ap.aplicada, JSON.stringify(ap).slice(0, 200))
  }
  // Cada producto: lo contado (4, desde cero) más las 5 entradas de 1, en el orden que fuera.
  const niveles = await prisma.inventoryLevel.findMany({ where: { companyId: ctx.a, locationId: ctx.sucA2, catalogVariantId: { in: todas } }, select: { onHand: true } })
  assert.equal(niveles.length, todas.length)
  assert.ok(niveles.every((n) => n.onHand === 9), `existencias: ${[...new Set(niveles.map((n) => n.onHand))].join(', ')}`)
  for (const v of todas.slice(0, 5)) await verificarCuadre(v, ctx.sucA2)
})

// ── Importar un CSV de conteo ────────────────────────────────────────────────

test('12 · importar la hoja contada: celdas vacías = «no se contó»; un solo error y no entra nada; lo ya contado se reemplaza', async () => {
  const [p0, p1, p2] = ctx.v
  const c = await abrir(ctx.sucA1, 'Hoja')
  await contar(c.conteoId, p0, 2)
  const hoja = await enA((tx) => hojaDeConteoEnTx(tx, ctx.a, ctx.sucA1))
  assert.ok(hoja.filas.length >= 3 && !hoja.truncado)
  assert.ok(hoja.filas.every((f) => f.sku && f.producto), 'la hoja trae SKU y nombre')

  const csv = (filas: string[]) => ['sku;codigo_de_barras;contado', ...filas].join('\n')
  // Con un error: no se aplica nada.
  const malo = csv([`CNT-P0-${sufijo};;9`, `NO-EXISTE-${sufijo};;1`, `CNT-P1-${sufijo};;`])
  const informeMalo = await enA((tx) => informeDeConteoImportadoEnTx(tx, ctx.a, malo))
  assert.ok(informeMalo.ok && !informeMalo.informe.ok)
  assert.equal(informeMalo.informe.totalErrores, 1)
  assert.equal(informeMalo.informe.omitidas, 1, 'la celda vacía no cuenta como error')
  const rMalo = await enA((tx) => aplicarImportacionDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, texto: malo }, como(ctx.usuario)))
  assert.ok(rMalo.ok && !rMalo.resultado.aplicada)
  assert.equal((await detalle(c.conteoId))!.detalle.find((x) => x.varianteId === p0)!.contado, 2, 'ni la fila buena entró')

  // Limpio: p0 se reemplaza (2 → 9), p2 entra con 0 («lo busqué y no hay»), p1 queda sin contar (celda vacía).
  const bueno = csv([`CNT-P0-${sufijo};;9`, `;${ctx.codigos[2]};0`, `CNT-P1-${sufijo};;`])
  const rBueno = await enA((tx) => aplicarImportacionDeConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, texto: bueno }, como(ctx.usuario)))
  assert.ok(rBueno.ok && rBueno.resultado.aplicada)
  if (rBueno.ok && rBueno.resultado.aplicada) assert.deepEqual([rBueno.resultado.nuevas, rBueno.resultado.reemplazadas], [1, 1])
  const d = (await detalle(c.conteoId))!
  assert.equal(d.detalle.find((x) => x.varianteId === p0)!.contado, 9)
  assert.equal(d.detalle.find((x) => x.varianteId === p0)!.esperado, await existencia(p0, ctx.sucA1), 'lo reemplazado retoma la foto de lo que dice el sistema ahora')
  assert.equal(d.detalle.find((x) => x.varianteId === p2)!.contado, 0)
  assert.equal(d.detalle.find((x) => x.varianteId === p2)!.esperado, await existencia(p2, ctx.sucA1), 'lo nuevo toma la foto de lo que dice el sistema ahora')
  assert.equal(d.detalle.find((x) => x.varianteId === p1), undefined, 'el vacío no creó línea')

  // Los pendientes por contar son nombres, sin cantidades, y el total es exacto.
  const por = await enA((tx) => porContarEnTx(tx, ctx.a, c.conteoId, ctx.sucA1))
  assert.ok(por.items.every((i) => Object.keys(i).sort().join() === 'loteCodigo,loteId,loteVencimiento,nombre,sku,varianteId'), 'solo nombres y lote: ninguna cantidad')
  assert.equal(por.items.some((i) => i.varianteId === p0), false)
  await cancelar(c.conteoId)
})

test('13 · un conteo admite hasta 1.000 productos; el archivo de 1.000 filas se importa entero y con 1.001 se rechaza', async (t) => {
  // Dos mil... no hace falta: mil líneas contra variantes reales cuestan; se prueba el tope con el servicio y variantes repetidas por lote.
  const lote = 1000
  const ids: string[] = []
  const creadas = await prisma.$transaction(async (tx) => {
    const item = await tx.catalogItem.create({
      data: { companyId: ctx.a, name: `Lote ${sufijo}`, slug: `lote-${sufijo}`, type: 'PHYSICAL_PRODUCT', status: 'ACTIVE', capabilities: { availableMarketplace: false, availablePOS: true, trackInventory: true } },
      select: { id: true },
    })
    await tx.catalogVariant.createMany({
      data: Array.from({ length: lote + 1 }, (_, i) => ({ companyId: ctx.a, catalogItemId: item.id, name: `V${i}`, sku: `LOTE-${i}-${sufijo}`, price: 1, attributes: {}, status: 'ACTIVE' as const, isDefault: false, position: i })),
    })
    return item.id
  }, { timeout: 60_000 })
  for (const v of await prisma.catalogVariant.findMany({ where: { catalogItemId: creadas }, orderBy: { position: 'asc' }, select: { id: true } })) ids.push(v.id)

  const c = await abrir(ctx.sucA1, 'Mil')
  const t0 = Date.now()
  const r = await enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas: ids.slice(0, lote).map((varianteId, i) => ({ varianteId, cantidad: i % 7 })) }, como(ctx.usuario)))
  assert.deepEqual([r.nuevas, r.reemplazadas, r.lineas], [lote, 0, lote])
  const msImportar = Date.now() - t0
  assert.ok(msImportar < 20_000, `importar 1.000 líneas tardó ${msImportar} ms`)
  // Una más: pasa del tope. Reimportar las mismas 1.000: las reemplaza sin crecer.
  assert.equal(await codigoDe(contar(c.conteoId, ids[lote], 1)), 'DEMASIADAS_LINEAS')
  assert.equal(await codigoDe(enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas: [{ varianteId: ids[lote], cantidad: 1 }] }, como(ctx.usuario)))), 'DEMASIADAS_LINEAS')
  const otra = await enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas: ids.slice(0, lote).map((varianteId) => ({ varianteId, cantidad: 3 })) }, como(ctx.usuario)))
  assert.deepEqual([otra.nuevas, otra.reemplazadas], [0, lote])
  assert.equal(MAX_LINEAS_CONTEO, lote)

  // Aplicarlo entero: 1.000 saldos nuevos en cero que pasan a 3, en UNA transacción y dentro del tiempo.
  const t1 = Date.now()
  const ap = await aplicar(c.conteoId)
  assert.ok(ap.aplicada, JSON.stringify(ap).slice(0, 300))
  const msAplicar = Date.now() - t1
  assert.ok(msAplicar < 25_000, `aplicar 1.000 líneas tardó ${msAplicar} ms`)
  t.diagnostic(`1.000 líneas: importar ${msImportar} ms, aplicar ${msAplicar} ms (transacción máxima: 45.000 ms)`)
  if (ap.aplicada) assert.deepEqual([ap.resumen.lineas, ap.resumen.ajustadas, ap.resumen.unidadesSobrantes], [lote, lote, lote * 3])
  const suma = await prisma.inventoryLevel.aggregate({ where: { companyId: ctx.a, locationId: ctx.sucA1, catalogVariantId: { in: ids } }, _sum: { onHand: true }, _count: true })
  assert.equal(suma._sum.onHand, lote * 3)
  assert.equal(await codigoDe(enA((tx) => importarConteoEnTx(tx, ctx.a, { conteoId: c.conteoId, lineas: [{ varianteId: ids[0], cantidad: 1 }] }, como(ctx.usuario)))), 'CONTEO_CERRADO')
})

// ── Lo que garantiza la base ─────────────────────────────────────────────────

test('14 · la base: un conteo cerrado y sus líneas no se editan ni se borran; uno abierto solo cambia lo que debe; un solo abierto por sucursal', async () => {
  const cerrado = await prisma.inventoryCountSession.findFirstOrThrow({ where: { companyId: ctx.a, status: 'APPLIED' } })
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "note" = 'editado' WHERE "id" = ${cerrado.id}`, /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "status" = 'OPEN' WHERE "id" = ${cerrado.id}`, /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_count_sessions" WHERE "id" = ${cerrado.id}`, /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_count_sessions" CASCADE'), /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_count_lines"'), /inventory_counts_inmutable/)
  const linea = await prisma.inventoryCountLine.findFirstOrThrow({ where: { sessionId: cerrado.id } })
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_lines" SET "counted" = 999 WHERE "id" = ${linea.id}`, /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_count_lines" WHERE "id" = ${linea.id}`, /inventory_counts_inmutable/)
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","counted","expected") VALUES ('x-cerrado', ${ctx.a}, ${cerrado.id}, ${ctx.v[5]}, 1, 1)`,
    /inventory_counts_inmutable/,
    'a un conteo cerrado tampoco se le agregan líneas'
  )

  // Abierto: la nota sí se puede cambiar; lo que lo identifica, no.
  const abierto = await abrir(ctx.sucA1)
  await prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "note" = 'ok' WHERE "id" = ${abierto.conteoId}`
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "number" = 'CNT-2000-000001' WHERE "id" = ${abierto.conteoId}`, /inventory_counts_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "locationId" = ${ctx.sucA2} WHERE "id" = ${abierto.conteoId}`, /inventory_counts_inmutable/)
  // Un solo abierto por sucursal, aunque se escriba por fuera del servicio.
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_sessions" ("id","companyId","number","locationId") VALUES ('x-dos', ${ctx.a}, 'CNT-2099-000001', ${ctx.sucA1})`,
    /Key \("companyId", "locationId"\)/
  )
  // CHECK de forma: el estado cuenta una historia coherente.
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "status" = 'APPLIED' WHERE "id" = ${abierto.conteoId}`, /inventory_count_sessions_forma/, 'aplicado sin fecha ni resumen')
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_count_sessions" SET "status" = 'CANCELLED' WHERE "id" = ${abierto.conteoId}`, /inventory_count_sessions_forma/, 'cancelado sin fecha')
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_sessions" ("id","companyId","number","locationId","status","cancelledAt") VALUES ('x-mal', ${ctx.a}, 'CNT-MAL', ${ctx.sucA2}, 'CANCELLED', now())`,
    /inventory_count_sessions_forma/,
    'el número tiene forma'
  )
  // Líneas: lo contado tiene tope, el resultado va completo, y las FK compuestas impiden mezclar empresas.
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","counted","expected") VALUES ('x-neg', ${ctx.a}, ${abierto.conteoId}, ${ctx.v[5]}, -1, 0)`,
    /inventory_count_lines_forma/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","counted","expected","onHandBefore") VALUES ('x-res', ${ctx.a}, ${abierto.conteoId}, ${ctx.v[5]}, 1, 0, 3)`,
    /inventory_count_lines_forma/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","counted","expected") VALUES ('x-aj', ${ctx.b}, ${abierto.conteoId}, ${ctx.varianteB}, 1, 0)`,
    /inventory_count_lines_sessionId_companyId_fkey/,
    'una línea de la empresa B no cuelga de un conteo de la A'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_count_lines" ("id","companyId","sessionId","catalogVariantId","counted","expected") VALUES ('x-aj2', ${ctx.a}, ${abierto.conteoId}, ${ctx.varianteB}, 1, 0)`,
    /inventory_count_lines_catalogVariantId_companyId_fkey/,
    'ni un producto de otra empresa'
  )
  await cancelar(abierto.conteoId)
})

test('15 · la lista filtra por estado, sucursal, número y nota; pagina sin repetir; y no cruza empresas', async () => {
  const todos = await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, {}, { zonaHoraria: 'America/Santo_Domingo', limite: 200 }))
  assert.ok(todos.filas.length >= 8)
  assert.deepEqual(todos.filas.map((f) => f.creadoEn.getTime()), [...todos.filas.map((f) => f.creadoEn.getTime())].sort((a, b) => b - a), 'de lo más reciente a lo más antiguo')
  const aplicados = await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, { estado: 'APPLIED' }, { zonaHoraria: 'UTC' }))
  assert.ok(aplicados.filas.length >= 3 && aplicados.filas.every((f) => f.estado === 'APPLIED'))
  const f5 = aplicados.filas.find((f) => f.sinContar !== null)!
  assert.ok(f5.lineas >= 1 && f5.ajustadas !== null && f5.unidadesSobrantes !== null)
  assert.ok((await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, { q: 'Pasillo 1' }, { zonaHoraria: 'UTC' }))).filas.some((f) => f.nota === 'Pasillo 1'), 'busca en la nota')
  const unico = todos.filas[0]
  assert.equal((await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, { q: unico.numero.toLowerCase() }, { zonaHoraria: 'UTC' }))).filas.length, 1, 'busca por número sin importar mayúsculas')
  assert.equal((await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, { sucursalId: ctx.sucB }, { zonaHoraria: 'UTC' }))).filas.length, 0, 'una sucursal ajena no encuentra nada')
  // Paginar de 3 en 3 recorre todo sin repetir ni saltarse.
  const vistos: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 40; i++) {
    const p: Awaited<ReturnType<typeof conteosDeLaEmpresaEnTx>> = await enA((tx) => conteosDeLaEmpresaEnTx(tx, ctx.a, {}, { zonaHoraria: 'UTC', cursor, limite: 3 }))
    vistos.push(...p.filas.map((x) => x.id))
    if (!p.siguiente) break
    cursor = p.siguiente
  }
  assert.equal(new Set(vistos).size, vistos.length, 'sin repetidos')
  assert.equal(vistos.length, todos.filas.length)
  assert.equal((await enB((tx) => conteosDeLaEmpresaEnTx(tx, ctx.b, {}, { zonaHoraria: 'UTC' }))).filas.length, 0, 'la empresa B no ve los conteos de la A')
})
