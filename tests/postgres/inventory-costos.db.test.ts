import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { costoADecimal, costoDeDecimal, parsearCosto, promedioPonderado, type Costo } from '../../src/modules/inventory/costos'
import { MAX_LINEAS_IMPORTACION } from '../../src/modules/inventory/entradas'
import { FILAS_POR_PAGINA_VALOR, leerFiltrosValor } from '../../src/modules/inventory/filtros'
import { costoDeVarianteEnTx, costoDeVentasEnTx, mesActual, valorDelInventarioEnTx } from '../../src/modules/inventory/valor'
import {
  abrirConteoEnTx,
  aplicarConteoEnTx,
  ajustarEnTx,
  cancelarTrasladoEnTx,
  consumirReservaEnTx,
  corregirCostoEnTx,
  danarEnTx,
  devolverEnTx,
  enviarTrasladoEnTx,
  recibirTrasladoEnTx,
  registrarConteoProductoEnTx,
  registrarEntradaMultipleEnTx,
  recibirEnTx,
  reservarEnTx,
  transferirEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'

/**
 * INV-3a · COSTO PROMEDIO Y VALOR DEL INVENTARIO contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que una entrada con costo crea y pondera el costo promedio con las existencias de TODAS las sucursales, y que una
 *    entrada sin costo no lo toca;
 *  · que ventas, devoluciones, daños, ajustes y conteos se valoran con el promedio DE ESE INSTANTE y lo congelan: un
 *    cambio posterior del promedio no reescribe lo ya vendido;
 *  · que lo que no tiene costo queda SIN costo (null) y no en cero, y que el costo de referencia del catálogo vale
 *    mientras no haya promedio;
 *  · que reservas y transferencias no se valoran ni mueven el promedio;
 *  · corregir el costo: deja historia inmutable, no toca el ledger y exige motivo;
 *  · que entradas simultáneas del mismo producto dan el promedio exacto, que las cruzadas con productos nuevos en
 *    distinto orden no se interbloquean, y que una VENTA nunca espera a una entrada;
 *  · que la base rechaza costos fuera de rango, no reescribe correcciones y no mezcla empresas;
 *  · una propiedad: 200 operaciones al azar dejan el promedio igual al de un modelo puro.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', sucA1: '', sucA2: '', sucA3: '', sucB: '', varianteB: '', servicio: '' }
/** Las empresas que las pruebas de lecturas crean aparte (para que sus totales sean exactos) y que `after` limpia. */
const extras: string[] = []

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

let contador = 0
/** Un producto nuevo de la empresa A (con control de inventario), con o sin costo de referencia en su ficha. */
async function producto(nombre: string, referencia?: string): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `COS-${n}-${sufijo}`, ...(referencia ? { cost: referencia } : {}) }, como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Costos ${x} ${sufijo}`, slug: `costos-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-cos-${sufijo}`, email: `cos-${sufijo}@prueba.test`, name: 'Compras', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre, activa: true }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucA3 = (await suc(ctx.a, 'Este')).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Ajeno ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `COS-B-${sufijo}` }, como(ctx.usuario)))
  ctx.varianteB = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  const s = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `Lavado ${sufijo}`, type: 'SERVICE', price: 100, sku: `COS-S-${sufijo}` }, como(ctx.usuario)))
  ctx.servicio = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: s.id }, select: { id: true } })).id
})

after(async () => {
  // El ledger, las entradas y las correcciones no se borran (lo prohíbe la base). Para limpiar el rastro se desactivan los
  // disparadores ordinarios solo en esta transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b, ...extras]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_cost_adjustments',
        'inventory_variant_costs',
        'inventory_transfer_lines',
        'inventory_transfers',
        'inventory_count_lines',
        'inventory_count_sessions',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_movements',
        'inventory_reservations',
        'inventory_levels',
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
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

type LineaCosto = { varianteId: string; cantidad: number; costo?: string | null }
const entrada = (sucursalId: string, lineas: LineaCosto[], extra: Partial<Parameters<typeof registrarEntradaMultipleEnTx>[2]> = {}) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas, ...extra }, como(ctx.usuario)))
const vender = (varianteId: string, sucursalId: string, cantidad: number) => enA((tx) => venderEnTx(tx, ctx.a, { varianteId, sucursalId, cantidad }, como(null)))

/** El costo promedio guardado (texto con 4 decimales) o null si el producto no tiene renglón. */
async function promedio(varianteId: string): Promise<string | null> {
  const r = await prisma.inventoryVariantCost.findUnique({ where: { catalogVariantId_companyId: { catalogVariantId: varianteId, companyId: ctx.a } } })
  return r ? r.averageCost.toFixed(4) : null
}
/** Los movimientos de un producto, del más viejo al más nuevo, con su costo como texto. */
async function movimientos(varianteId: string) {
  const ms = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, level: { catalogVariantId: varianteId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return ms.map((m) => ({ id: m.id, tipo: m.type, cantidad: m.quantity, costo: m.unitCost === null ? null : m.unitCost.toFixed(4) }))
}
const costoDeTipo = async (varianteId: string, tipo: string) => (await movimientos(varianteId)).filter((m) => m.tipo === tipo).map((m) => m.costo)
/** Unidades que la empresa tiene del producto (vendible + apartado + dañado, todas las sucursales). */
async function unidades(varianteId: string): Promise<number> {
  const a = await prisma.inventoryLevel.aggregate({ where: { companyId: ctx.a, catalogVariantId: varianteId }, _sum: { onHand: true, damaged: true } })
  return (a._sum.onHand ?? 0) + (a._sum.damaged ?? 0)
}
const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok)
  return r.valor
}

// ── Entradas con costo ───────────────────────────────────────────────────────

test('1 · una entrada con costo crea el costo promedio y valora la línea y el movimiento', async () => {
  const p = await producto('Aceite')
  assert.equal(await promedio(p), null, 'antes de la primera entrada con costo no hay renglón')
  const r = await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }])
  assert.equal(await promedio(p), '5.0000')
  const fila = await prisma.inventoryVariantCost.findFirstOrThrow({ where: { catalogVariantId: p } })
  assert.equal(fila.lastCost?.toFixed(4), '5.0000')
  assert.ok(fila.lastCostAt)
  const linea = await prisma.inventoryReceiptLine.findFirstOrThrow({ where: { receiptId: r.entradaId } })
  assert.equal(linea.unitCost?.toFixed(4), '5.0000')
  assert.deepEqual(await costoDeTipo(p, 'PURCHASE'), ['5.0000'])
})

test('2 · el promedio pondera TODAS las sucursales: 10 a 5 en Principal + 10 a 7 en Norte = 6', async () => {
  const p = await producto('Arroz')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }])
  await entrada(ctx.sucA2, [{ varianteId: p, cantidad: 10, costo: '7' }])
  assert.equal(await promedio(p), '6.0000')
  assert.deepEqual(await costoDeTipo(p, 'PURCHASE'), ['5.0000', '7.0000'], 'cada movimiento guarda el costo con que ENTRÓ, no el promedio')
  assert.equal((await prisma.inventoryVariantCost.findFirstOrThrow({ where: { catalogVariantId: p } })).lastCost?.toFixed(4), '7.0000')
  // Una tercera entrada pesa lo que hay en las dos sucursales: 20 a 6 + 20 a 10 = 8.
  await entrada(ctx.sucA3, [{ varianteId: p, cantidad: 20, costo: '10' }])
  assert.equal(await promedio(p), '8.0000')
})

test('3 · una entrada sin costo no mueve el promedio ni lo inventa; en una mezcla solo se mueven las líneas con costo', async () => {
  const [p, q, s] = [await producto('Sal'), await producto('Pimienta'), await producto('Azúcar')]
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 4 }])
  assert.equal(await promedio(p), null, 'sin costo no nace un promedio')
  assert.deepEqual(await costoDeTipo(p, 'PURCHASE'), [null], 'el movimiento queda SIN costo, no en cero')
  assert.equal((await prisma.inventoryReceiptLine.findFirstOrThrow({ where: { catalogVariantId: p } })).unitCost, null)

  await entrada(ctx.sucA1, [{ varianteId: q, cantidad: 10, costo: '4' }])
  await entrada(ctx.sucA1, [
    { varianteId: q, cantidad: 5 },
    { varianteId: s, cantidad: 3, costo: '9' },
    { varianteId: p, cantidad: 2, costo: '2' },
  ])
  assert.equal(await promedio(q), '4.0000', 'la línea sin costo no cambia el promedio de q')
  assert.equal(await promedio(s), '9.0000')
  // p tenía 4 sin costo ni referencia: las 4 viejas no se cuentan como cero, valen el costo de la entrada.
  assert.equal(await promedio(p), '2.0000')
})

test('4 · existencias anteriores a llevar costos: con costo de referencia pesa; sin él nace con el costo de la entrada', async () => {
  const conRef = await producto('Detergente', '4')
  const sinRef = await producto('Jabón')
  await entrada(ctx.sucA1, [{ varianteId: conRef, cantidad: 10 }, { varianteId: sinRef, cantidad: 10 }])
  assert.equal(await promedio(conRef), null)
  await entrada(ctx.sucA1, [{ varianteId: conRef, cantidad: 10, costo: '6' }, { varianteId: sinRef, cantidad: 10, costo: '6' }])
  assert.equal(await promedio(conRef), '5.0000', '10 viejas a la referencia 4 + 10 a 6')
  assert.equal(await promedio(sinRef), '6.0000', 'sin referencia las viejas no diluyen: valen el costo de la entrada')
})

test('5 · ventas, devoluciones, daños, ajustes y conteos se valoran con el promedio de ESE instante y lo congelan', async () => {
  const p = await producto('Harina')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 30, costo: '5' }])
  await vender(p, ctx.sucA1, 2)
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 3 }, como(null)))
  await enA((tx) => consumirReservaEnTx(tx, ctx.a, r.reservaId, {}, como(null)))
  await enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario)))
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 1, motivo: 'Se rompió' }, como(ctx.usuario)))
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cambio: -2, motivo: 'Faltante' }, como(ctx.usuario)))
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cambio: 1, motivo: 'Sobrante' }, como(ctx.usuario)))
  // Un conteo físico (escritura por lote): dice 20 y el sistema decía 24 → ajuste de -4 valorado igual.
  const onHand = (await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: p, locationId: ctx.sucA1 } })).onHand
  const conteo = await enA((tx) => abrirConteoEnTx(tx, ctx.a, { sucursalId: ctx.sucA1 }, como(ctx.usuario)))
  await enA((tx) => registrarConteoProductoEnTx(tx, ctx.a, { conteoId: conteo.conteoId, varianteId: p, cantidad: onHand - 4, modo: 'FIJAR' }, como(ctx.usuario)))
  await enA((tx) => aplicarConteoEnTx(tx, ctx.a, { conteoId: conteo.conteoId }, como(ctx.usuario)))

  const antes = await movimientos(p)
  for (const m of antes.filter((x) => ['SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT'].includes(x.tipo))) assert.equal(m.costo, '5.0000', `${m.tipo} valorado con el promedio vigente`)
  assert.equal(antes.filter((x) => x.tipo === 'SALE').length, 2, 'la venta directa y la reserva consumida')
  assert.equal(antes.filter((x) => x.tipo === 'ADJUSTMENT').length, 3, 'dos ajustes a mano y el del conteo')

  // El promedio cambia después: lo ya valorado NO se reescribe y lo nuevo usa el promedio nuevo.
  const s = await unidades(p)
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '9' }])
  const esperado = costoADecimal(promedioPonderado({ unidades: s, promedio: c('5'), referencia: null }, { unidades: 10, costo: c('9') }))
  assert.equal(await promedio(p), esperado)
  await vender(p, ctx.sucA1, 1)
  const despues = await movimientos(p)
  assert.deepEqual(
    despues.slice(0, antes.length).map((m) => m.costo),
    antes.map((m) => m.costo),
    'los movimientos anteriores conservan su costo'
  )
  assert.equal(despues[despues.length - 1].tipo, 'SALE')
  assert.equal(despues[despues.length - 1].costo, esperado, 'la venta nueva usa el promedio nuevo')
})

test('6 · sin costo ni referencia el movimiento queda SIN costo (no en cero); con referencia usa la referencia', async () => {
  const sin = await producto('Sin costo')
  const con = await producto('Con referencia', '3.50')
  await entrada(ctx.sucA1, [{ varianteId: sin, cantidad: 5 }, { varianteId: con, cantidad: 5 }])
  await vender(sin, ctx.sucA1, 1)
  await vender(con, ctx.sucA1, 1)
  assert.deepEqual(await costoDeTipo(sin, 'SALE'), [null])
  assert.deepEqual(await costoDeTipo(con, 'SALE'), ['3.5000'])
  assert.equal(await promedio(con), null, 'valorar con la referencia no crea un promedio')
})

test('7 · las reservas y las transferencias no se valoran ni mueven el promedio', async () => {
  const p = await producto('Cable')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 40, costo: '8' }])
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 2 }, como(null)))
  await enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: p, origenId: ctx.sucA1, destinoId: ctx.sucA2, cantidad: 5 }, como(ctx.usuario)))
  const envio = await enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: ctx.sucA1, destinoId: ctx.sucA3, lineas: [{ varianteId: p, cantidad: 6 }] }, como(ctx.usuario)))
  await enA((tx) => recibirTrasladoEnTx(tx, ctx.a, { trasladoId: envio.trasladoId, lineas: [{ varianteId: p, cantidad: 2 }] }, como(ctx.usuario)))
  await enA((tx) => cancelarTrasladoEnTx(tx, ctx.a, { trasladoId: envio.trasladoId }, como(ctx.usuario)))
  assert.ok(r.reservaId)
  const ms = await movimientos(p)
  for (const m of ms.filter((x) => ['RESERVATION', 'RESERVATION_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(x.tipo))) assert.equal(m.costo, null, `${m.tipo} no se valora`)
  assert.ok(ms.some((m) => m.tipo === 'TRANSFER_OUT') && ms.some((m) => m.tipo === 'TRANSFER_IN'))
  assert.equal(await promedio(p), '8.0000', 'mover unidades entre sucursales no cambia el costo')
})

// ── Corregir el costo ────────────────────────────────────────────────────────

test('8 · corregir el costo: cambia el promedio desde ahora, deja historia inmutable, no toca el ledger y exige motivo', async () => {
  const p = await producto('Tornillo', '4.00')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10 }])
  const movsAntes = await movimientos(p)
  assert.equal(await promedio(p), null)

  const r1 = await enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: '6.5', motivo: ' Se compró a 6.50 y no se capturó ' }, como(ctx.usuario)))
  assert.deepEqual({ ...r1, varianteId: undefined }, { varianteId: undefined, costoAnterior: '4.00', costoNuevo: '6.50', unidades: 10 })
  assert.equal(await promedio(p), '6.5000')
  assert.deepEqual(await movimientos(p), movsAntes, 'el ledger no se toca')
  await vender(p, ctx.sucA1, 1)
  assert.deepEqual(await costoDeTipo(p, 'SALE'), ['6.5000'])

  assert.equal(await codigoDe(enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: '6.5', motivo: 'otra vez' }, como(ctx.usuario)))), 'SIN_CAMBIOS')
  const r2 = await enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: '8', motivo: 'Cambió el proveedor' }, como(ctx.usuario)))
  assert.equal(r2.costoAnterior, '6.50')
  assert.equal(r2.unidades, 9)

  const historia = await prisma.inventoryCostAdjustment.findMany({ where: { catalogVariantId: p }, orderBy: { createdAt: 'asc' } })
  assert.equal(historia.length, 2)
  assert.deepEqual(
    historia.map((h) => [h.previousCost?.toFixed(4), h.newCost.toFixed(4), h.unitsOnHand, h.reason, h.userId]),
    [
      ['4.0000', '6.5000', 10, 'Se compró a 6.50 y no se capturó', ctx.usuario],
      ['6.5000', '8.0000', 9, 'Cambió el proveedor', ctx.usuario],
    ]
  )
  // La bitácora de actividad lo registra.
  const auditoria = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: p, entidadTipo: 'InventoryVariantCost' } })
  assert.equal(auditoria.length, 2)
  assert.ok(auditoria.every((a) => a.accion === 'INVENTORY_CONFIGURED'))
})

test('9 · corregir se rechaza sin motivo, con costo malo, en un producto sin existencias, en un servicio o de otra empresa', async () => {
  const p = await producto('Clavo')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 3, costo: '2' }])
  const sinExistencias = await producto('Nunca recibido')
  const intentar = (varianteId: string, costo: unknown, motivo: unknown) => enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId, costo, motivo }, como(ctx.usuario)))
  assert.equal(await codigoDe(intentar(p, '3', '')), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(intentar(p, '3', undefined)), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(intentar(p, '3,5', 'x')), 'COSTO_INVALIDO')
  assert.equal(await codigoDe(intentar(p, '-3', 'x')), 'COSTO_INVALIDO')
  assert.equal(await codigoDe(intentar(sinExistencias, '3', 'x')), 'SIN_EXISTENCIAS_PREVIAS')
  assert.equal(await codigoDe(intentar(ctx.servicio, '3', 'x')), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal(await codigoDe(intentar(ctx.varianteB, '3', 'x')), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await promedio(p), '2.0000', 'ningún rechazo cambió nada')
  assert.equal(await prisma.inventoryCostAdjustment.count({ where: { companyId: ctx.a, catalogVariantId: p } }), 0)
  // Cero es un costo válido.
  await intentar(p, '0', 'Era una muestra gratis')
  assert.equal(await promedio(p), '0.0000')
})

test('9b · la entrada de UN producto: con costo mueve el promedio, sin costo no; repetirla con la misma clave no lo mueve otra vez; un costo malo no toca nada', async () => {
  const p = await producto('Suelto')
  const recibir = (extra: Partial<Parameters<typeof recibirEnTx>[2]> & { cantidad: number }) => enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, ...extra }, como(ctx.usuario)))
  await recibir({ cantidad: 10, costo: '5' })
  assert.equal(await promedio(p), '5.0000')
  const clave = `cos-${sufijo}-suelto`
  const dos = await recibir({ cantidad: 10, costo: '7', idempotencyKey: clave })
  assert.equal(dos.repetido, false)
  assert.equal(await promedio(p), '6.0000')
  const otra = await recibir({ cantidad: 10, costo: '7', idempotencyKey: clave })
  assert.equal(otra.repetido, true)
  assert.equal(await promedio(p), '6.0000', 'repetirla no mueve el promedio otra vez')
  assert.equal(await unidades(p), 20)
  await recibir({ cantidad: 5 })
  await recibir({ cantidad: 5, costo: '' })
  assert.equal(await promedio(p), '6.0000', 'sin costo (ausente o vacío) no cambia el promedio')
  assert.deepEqual(await costoDeTipo(p, 'PURCHASE'), ['5.0000', '7.0000', null, null])
  for (const malo of ['1,5', '-1', 'abc', '1e3']) assert.equal(await codigoDe(recibir({ cantidad: 1, costo: malo })), 'COSTO_INVALIDO', malo)
  assert.equal(await unidades(p), 30, 'un costo malo no dejó pasar la entrada')
  assert.equal(await promedio(p), '6.0000')
})

test('9c · lo dañado también pesa: el promedio y las unidades de una corrección cuentan vendible, apartado y dañado de TODAS las sucursales', async () => {
  const p = await producto('Dañable')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '4' }])
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 4, motivo: 'Se cayó' }, como(ctx.usuario)))
  await entrada(ctx.sucA2, [{ varianteId: p, cantidad: 10, costo: '9' }])
  // 10 (6 vendibles + 4 dañadas) a 4 más 10 a 9 = 6.50; si lo dañado no pesara serían 6 a 4 más 10 a 9 = 7.125.
  assert.equal(await promedio(p), '6.5000')
  const r = await enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: '8', motivo: 'Revisión' }, como(ctx.usuario)))
  assert.equal(r.unidades, 20, 'la corrección afecta a las 20 unidades, también a las dañadas')
  assert.equal((await prisma.inventoryCostAdjustment.findFirstOrThrow({ where: { catalogVariantId: p } })).unitsOnHand, 20)
})

// ── Idempotencia ─────────────────────────────────────────────────────────────

test('10 · el mismo envío con el mismo costo no suma dos veces; con otro costo se rechaza; cinco a la vez = una', async () => {
  const p = await producto('Pintura')
  const clave = `cos-${sufijo}-1`
  const a = await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }], { idempotencyKey: clave })
  const b = await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }], { idempotencyKey: clave })
  assert.equal(b.repetido, true)
  assert.equal(b.entradaId, a.entradaId)
  assert.equal(await unidades(p), 10)
  assert.equal(await codigoDe(entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '6' }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  assert.equal(await codigoDe(entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10 }], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'quitar el costo tampoco es un reintento')
  assert.equal(await promedio(p), '5.0000')

  const q = await producto('Barniz')
  const k = `cos-${sufijo}-2`
  const cinco = await Promise.all(Array.from({ length: 5 }, () => entrada(ctx.sucA2, [{ varianteId: q, cantidad: 4, costo: '12' }], { idempotencyKey: k })))
  assert.equal(new Set(cinco.map((x) => x.entradaId)).size, 1)
  assert.equal(cinco.filter((x) => !x.repetido).length, 1)
  assert.equal(await unidades(q), 4)
  assert.equal(await promedio(q), '12.0000')
})

// ── Concurrencia ─────────────────────────────────────────────────────────────

test('11 · dos entradas simultáneas del mismo producto nuevo, en sucursales distintas, dan el promedio exacto (12 rondas)', async () => {
  for (let ronda = 0; ronda < 12; ronda++) {
    const p = await producto('Carrera')
    // 3 a 10 y 1 a 20: sea cual sea el orden en que se turnen, el promedio es (30 + 20) / 4 = 12.50.
    await Promise.all([entrada(ctx.sucA1, [{ varianteId: p, cantidad: 3, costo: '10' }]), entrada(ctx.sucA2, [{ varianteId: p, cantidad: 1, costo: '20' }])])
    assert.equal(await promedio(p), '12.5000', `ronda ${ronda}`)
    assert.equal(await unidades(p), 4)
  }
})

/** Todas las formas de turnarse tres entradas con costo sobre un promedio ya existente (el redondeo hace que el orden importe en la cuarta decimal). */
function resultadosPosibles(inicial: { unidades: number; costo: Costo }, entradas: Array<{ unidades: number; costo: Costo }>): Set<string> {
  const salidas = new Set<string>()
  const permutar = (resto: typeof entradas, unidades: number, promedio: Costo) => {
    if (resto.length === 0) {
      salidas.add(costoADecimal(promedio))
      return
    }
    resto.forEach((e, i) => permutar([...resto.slice(0, i), ...resto.slice(i + 1)], unidades + e.unidades, promedioPonderado({ unidades, promedio, referencia: null }, e)))
  }
  permutar(entradas, inicial.unidades, inicial.costo)
  return salidas
}

test('11b · entradas simultáneas de un producto que YA tiene costo (el renglón existe, no hay INSERT que las turne) no pierden ninguna', async () => {
  for (let ronda = 0; ronda < 12; ronda++) {
    const p = await producto('Carrera existente')
    await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }])
    // Tres entradas a la vez en tres sucursales distintas (sus saldos son distintos: solo el renglón del costo las une).
    await Promise.all([
      entrada(ctx.sucA1, [{ varianteId: p, cantidad: 3, costo: '10' }]),
      entrada(ctx.sucA2, [{ varianteId: p, cantidad: 1, costo: '20' }]),
      entrada(ctx.sucA3, [{ varianteId: p, cantidad: 2, costo: '30' }]),
    ])
    const posibles = resultadosPosibles({ unidades: 10, costo: c('5') }, [
      { unidades: 3, costo: c('10') },
      { unidades: 1, costo: c('20') },
      { unidades: 2, costo: c('30') },
    ])
    const real = await promedio(p)
    assert.ok(real !== null && posibles.has(real), `ronda ${ronda}: ${real} no es ninguno de ${[...posibles].join(', ')} (se perdió una entrada)`)
    assert.equal(await unidades(p), 16)
    assert.equal((await prisma.inventoryReceiptLine.count({ where: { catalogVariantId: p } })), 4)
  }
})

test('12 · entradas cruzadas con productos NUEVOS en distinto orden no se interbloquean y cada promedio es exacto', async () => {
  const N = 20
  for (let ronda = 0; ronda < 12; ronda++) {
    const ps: string[] = []
    for (let i = 0; i < N; i++) ps.push(await producto('Cruce'))
    const mismaSucursal = ronda % 2 === 0
    const lineasA = ps.map((v, i) => ({ varianteId: v, cantidad: 2, costo: String(10 + i) }))
    const lineasB = [...ps].reverse().map((v) => ({ varianteId: v, cantidad: 2, costo: String(30 + ps.indexOf(v)) }))
    await Promise.all([entrada(ctx.sucA1, lineasA), entrada(mismaSucursal ? ctx.sucA1 : ctx.sucA2, lineasB)])
    for (let i = 0; i < N; i++) {
      // (2·(10+i) + 2·(30+i)) / 4 = 20 + i
      assert.equal(await promedio(ps[i]), `${20 + i}.0000`, `ronda ${ronda}, producto ${i}`)
    }
  }
})

test('13 · una VENTA nunca espera al costo (solo lo lee); una ENTRADA con costo sí espera al candado', async () => {
  const p = await producto('Candado')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '5' }])
  let soltar!: () => void
  const suelta = new Promise<void>((r) => (soltar = r))
  let listo!: () => void
  const bloqueado = new Promise<void>((r) => (listo = r))
  // Otra transacción retiene el renglón de costo del producto.
  const retenedor = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "inventory_variant_costs" WHERE "catalogVariantId" = ${p} AND "companyId" = ${ctx.a} FOR UPDATE`
      listo()
      await suelta
    },
    { timeout: 30_000 }
  )
  await bloqueado
  const tarde = Symbol('tarde')
  const venta = await Promise.race([vender(p, ctx.sucA1, 1), new Promise<symbol>((r) => setTimeout(() => r(tarde), 6000))])
  assert.notEqual(venta, tarde, 'la venta esperó por un renglón de costo bloqueado')
  assert.deepEqual(await costoDeTipo(p, 'SALE'), ['5.0000'])

  // Una entrada con costo sí se turna: sigue pendiente mientras el candado esté puesto.
  let termino = false
  const nueva = entrada(ctx.sucA2, [{ varianteId: p, cantidad: 10, costo: '7' }]).then((r) => {
    termino = true
    return r
  })
  await new Promise((r) => setTimeout(r, 800))
  assert.equal(termino, false, 'la entrada con costo debía esperar al candado del renglón')
  soltar()
  await retenedor
  await nueva
  assert.equal(await promedio(p), costoADecimal(promedioPonderado({ unidades: 9, promedio: c('5'), referencia: null }, { unidades: 10, costo: c('7') })), 'pesa las existencias de DESPUÉS de la venta')
})

// ── La base ──────────────────────────────────────────────────────────────────

test('14 · la base: costos fuera de rango, correcciones reescritas, renglones borrados o de otra empresa se rechazan aunque se escriban por fuera', async () => {
  const p = await producto('Regla')
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 5, costo: '3' }])
  await enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: '4', motivo: 'ajuste de prueba' }, como(ctx.usuario)))
  const linea = await prisma.inventoryReceiptLine.findFirstOrThrow({ where: { catalogVariantId: p } })
  const mov = await prisma.inventoryMovement.findFirstOrThrow({ where: { id: linea.movementId } })
  // Un movimiento que NO es de ninguna entrada: la línea de prueba solo puede fallar por su costo, no por reusar uno.
  await enA((tx) => recibirEnTx(tx, ctx.a, { varianteId: p, sucursalId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario)))
  const libre = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId: ctx.a, level: { catalogVariantId: p }, receiptLine: null } })

  // Rango del costo: negativo y más de cien millones.
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "averageCost" = -1 WHERE "catalogVariantId" = ${p}`, /inventory_variant_costs_forma/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "averageCost" = 100000000.0001 WHERE "catalogVariantId" = ${p}`, /inventory_variant_costs_forma/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "lastCost" = -5 WHERE "catalogVariantId" = ${p}`, /inventory_variant_costs_forma/)
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_receipt_lines" ("id","companyId","receiptId","catalogVariantId","position","quantity","unitCost","movementId") VALUES ('x-costo', ${ctx.a}, ${linea.receiptId}, ${p}, 9, 1, -1, ${libre.id})`,
    /inventory_receipt_lines_costo/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_receipt_lines" ("id","companyId","receiptId","catalogVariantId","position","quantity","unitCost","movementId") VALUES ('x-costo2', ${ctx.a}, ${linea.receiptId}, ${p}, 9, 1, 100000000.0001, ${libre.id})`,
    /inventory_receipt_lines_costo/,
    'más de cien millones'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_movements" ("id","companyId","inventoryLevelId","type","destinationBucket","quantity","previousOnHand","newOnHand","unitCost") VALUES ('x-mov', ${ctx.a}, ${mov.inventoryLevelId}, 'PURCHASE', 'AVAILABLE', 1, 0, 1, 200000000)`,
    /inventory_movements_costo/
  )
  // El renglón de costo no se borra ni cambia de producto o de empresa.
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_variant_costs" WHERE "catalogVariantId" = ${p}`, /no se borra/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "id" = 'x-otro-id' WHERE "catalogVariantId" = ${p}`, /inventory_costs_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "catalogVariantId" = ${ctx.varianteB} WHERE "catalogVariantId" = ${p}`, /inventory_costs_inmutable/)
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_variant_costs" SET "companyId" = ${ctx.b} WHERE "catalogVariantId" = ${p}`, /inventory_costs_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_variant_costs"'), /inventory_costs_inmutable/)
  // Las correcciones son historia.
  await assert.rejects(prisma.$executeRaw`UPDATE "inventory_cost_adjustments" SET "reason" = 'otra' WHERE "catalogVariantId" = ${p}`, /inventory_cost_adjustments_inmutable/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM "inventory_cost_adjustments" WHERE "catalogVariantId" = ${p}`, /inventory_cost_adjustments_inmutable/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "inventory_cost_adjustments"'), /inventory_costs_inmutable/)
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_cost_adjustments" ("id","companyId","catalogVariantId","newCost","unitsOnHand","reason") VALUES ('x-adj1', ${ctx.a}, ${p}, 1, 0, '   ')`,
    /inventory_cost_adjustments_forma/,
    'un motivo en blanco'
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_cost_adjustments" ("id","companyId","catalogVariantId","newCost","unitsOnHand","reason") VALUES ('x-adj2', ${ctx.a}, ${p}, 1, -1, 'x')`,
    /inventory_cost_adjustments_forma/
  )
  // Mezclar empresas: la variante de B con la empresa A.
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_variant_costs" ("id","companyId","catalogVariantId","averageCost","updatedAt") VALUES ('x-costo-b', ${ctx.a}, ${ctx.varianteB}, 1, now())`,
    /inventory_variant_costs_catalogVariantId_companyId_fkey/
  )
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_cost_adjustments" ("id","companyId","catalogVariantId","newCost","unitsOnHand","reason") VALUES ('x-adj3', ${ctx.a}, ${ctx.varianteB}, 1, 0, 'x')`,
    /inventory_cost_adjustments_catalogVariantId_companyId_fkey/
  )
  // Un solo renglón por producto.
  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "inventory_variant_costs" ("id","companyId","catalogVariantId","averageCost","updatedAt") VALUES ('x-costo-2', ${ctx.a}, ${p}, 1, now())`,
    /23505[\s\S]*Key \("catalogVariantId", "companyId"\)/
  )
})

// ── Propiedad ────────────────────────────────────────────────────────────────

/** Un generador determinista (mulberry32). */
function azar(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('15 · propiedad: 200 operaciones al azar dejan el promedio igual al de un modelo puro y cada venta con el costo de su instante', async () => {
  const r = azar(20261059)
  const ps = [await producto('Modelo'), await producto('Modelo'), await producto('Modelo')]
  const sucs = [ctx.sucA1, ctx.sucA2]
  const modelo = new Map(ps.map((p) => [p, { unidades: 0, promedio: null as Costo | null, disponible: new Map(sucs.map((s) => [s, 0])), ventas: [] as Array<Costo | null> }]))
  for (let i = 0; i < 200; i++) {
    const p = ps[Math.floor(r() * ps.length)]
    const m = modelo.get(p)!
    const suc = sucs[Math.floor(r() * sucs.length)]
    const dado = r()
    if (dado < 0.45) {
      const q = 1 + Math.floor(r() * 20)
      const costo = `${1 + Math.floor(r() * 500)}.${String(Math.floor(r() * 100)).padStart(2, '0')}`
      await entrada(suc, [{ varianteId: p, cantidad: q, costo }])
      m.promedio = promedioPonderado({ unidades: m.unidades, promedio: m.promedio, referencia: null }, { unidades: q, costo: c(costo) })
      m.unidades += q
      m.disponible.set(suc, m.disponible.get(suc)! + q)
    } else if (dado < 0.6) {
      const q = 1 + Math.floor(r() * 20)
      await entrada(suc, [{ varianteId: p, cantidad: q }])
      m.unidades += q
      m.disponible.set(suc, m.disponible.get(suc)! + q)
    } else if (dado < 0.9) {
      const hay = m.disponible.get(suc)!
      if (hay === 0) continue
      const q = 1 + Math.floor(r() * Math.min(hay, 8))
      await vender(p, suc, q)
      m.ventas.push(m.promedio)
      m.unidades -= q
      m.disponible.set(suc, hay - q)
    } else {
      const hay = m.disponible.get(suc)!
      if (hay === 0) continue
      await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: p, sucursalId: suc, cambio: -1, motivo: 'Faltante' }, como(ctx.usuario)))
      m.unidades -= 1
      m.disponible.set(suc, hay - 1)
    }
    const real = await promedio(p)
    assert.equal(real, m.promedio === null ? null : costoADecimal(m.promedio), `operación ${i}`)
    assert.equal(await unidades(p), m.unidades, `operación ${i}: existencias`)
  }
  for (const p of ps) {
    const m = modelo.get(p)!
    const reales = (await movimientos(p)).filter((x) => x.tipo === 'SALE').map((x) => x.costo)
    assert.deepEqual(reales, m.ventas.map((v) => (v === null ? null : costoADecimal(v))), 'cada venta con el promedio de su instante')
  }
})

// ── Volumen ──────────────────────────────────────────────────────────────────

test('16 · una entrada de 1.000 líneas con costo cabe en una transacción y deja cada promedio exacto', async (t) => {
  const N = MAX_LINEAS_IMPORTACION
  const ids = Array.from({ length: N }, (_, i) => `cos-${i}-${sufijo}`)
  await prisma.$transaction([
    prisma.catalogItem.createMany({ data: ids.map((id, i) => ({ id: `it-${id}`, companyId: ctx.a, name: `Volumen ${i} ${sufijo}`, slug: `vol-${i}-${sufijo}`, type: 'PHYSICAL_PRODUCT' as const, capabilities: { trackInventory: true } })) }),
    prisma.catalogVariant.createMany({ data: ids.map((id, i) => ({ id: `va-${id}`, companyId: ctx.a, catalogItemId: `it-${id}`, name: 'Default', sku: `VOL-${i}-${sufijo}`, price: 10, isDefault: true })) }),
  ])
  const primera = ids.map((id, i) => ({ varianteId: `va-${id}`, cantidad: (i % 9) + 1, costo: String(1 + (i % 50)) }))
  const t0 = Date.now()
  await entrada(ctx.sucA1, primera, { maxLineas: N, origen: 'CSV' })
  const ms1 = Date.now() - t0
  assert.ok(ms1 < 20_000, `1.000 líneas con costo tardaron ${ms1} ms`)
  assert.equal(await prisma.inventoryVariantCost.count({ where: { catalogVariantId: { in: primera.map((l) => l.varianteId) } } }), N)

  // Segunda entrada con otro costo y en otra sucursal: cada promedio es el ponderado exacto de las dos.
  const segunda = ids.map((id, i) => ({ varianteId: `va-${id}`, cantidad: 2, costo: String(100 + (i % 7)) }))
  const t1 = Date.now()
  await entrada(ctx.sucA2, segunda, { maxLineas: N, origen: 'CSV' })
  const ms2 = Date.now() - t1
  assert.ok(ms2 < 20_000, `la segunda entrada tardó ${ms2} ms`)
  const costos = await prisma.inventoryVariantCost.findMany({ where: { catalogVariantId: { in: primera.map((l) => l.varianteId) } }, select: { catalogVariantId: true, averageCost: true } })
  const real = new Map(costos.map((x) => [x.catalogVariantId, costoDeDecimal(x.averageCost)]))
  for (let i = 0; i < N; i += 37) {
    const esperado = promedioPonderado({ unidades: primera[i].cantidad, promedio: c(primera[i].costo), referencia: null }, { unidades: 2, costo: c(segunda[i].costo) })
    assert.equal(real.get(primera[i].varianteId), esperado, `producto ${i}`)
  }
  t.diagnostic(`1.000 líneas con costo: primera entrada ${ms1} ms, segunda (pondera) ${ms2} ms (transacción máxima: 45.000 ms)`)
})

// ── Las lecturas: valor del inventario, en tránsito y costo de ventas ────────

const ZONA = 'America/Santo_Domingo'

/** Una empresa nueva con dos sucursales, para que sus totales no dependan de las demás pruebas. */
async function empresaNueva(etiqueta: string) {
  const emp = await prisma.company.create({ data: { name: `Valor ${etiqueta} ${sufijo}`, slug: `valor-${etiqueta}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } })
  extras.push(emp.id)
  const s1 = await prisma.sucursal.create({ data: { companyId: emp.id, nombre: 'Principal', activa: true }, select: { id: true } })
  const s2 = await prisma.sucursal.create({ data: { companyId: emp.id, nombre: 'Norte', activa: true }, select: { id: true } })
  const en = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(emp.id, fn)
  const prod = async (nombre: string, referencia?: string) => {
    const n = ++contador
    const r = await en((tx) => crearItemEnTx(tx, emp.id, { name: `${nombre} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `VAL-${n}-${sufijo}`, ...(referencia ? { cost: referencia } : {}) }, como(ctx.usuario)))
    return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  }
  const entra = (sucursalId: string, lineas: LineaCosto[]) => en((tx) => registrarEntradaMultipleEnTx(tx, emp.id, { sucursalId, lineas }, como(ctx.usuario)))
  return { id: emp.id, s1: s1.id, s2: s2.id, en, prod, entra }
}

test('17 · el valor del inventario suma existencias × costo, por producto y por sucursal; lo que no tiene costo se cuenta aparte, no como cero', async () => {
  const e = await empresaNueva('uno')
  const [p1, p2, p3, p4, p5] = [await e.prod('Alfa'), await e.prod('Beta', '4'), await e.prod('Gamma'), await e.prod('Delta'), await e.prod('Epsilon')]
  await e.entra(e.s1, [{ varianteId: p1, cantidad: 10, costo: '5' }, { varianteId: p2, cantidad: 5 }, { varianteId: p4, cantidad: 4, costo: '10' }])
  await e.entra(e.s2, [{ varianteId: p1, cantidad: 10, costo: '7' }, { varianteId: p3, cantidad: 3 }])
  await e.en((tx) => danarEnTx(tx, e.id, { varianteId: p4, sucursalId: e.s1, cantidad: 1, motivo: 'Se cayó' }, como(ctx.usuario)))
  assert.ok(p5)

  const v = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({}), { zonaHoraria: ZONA }))
  assert.deepEqual(v.resumen, { valor: '180.00', unidades: 32, unidadesConCosto: 29, unidadesSinCosto: 3, productos: 4, productosSinCosto: 1, danadas: 1 })
  assert.deepEqual(
    v.porSucursal.map((x) => [x.nombre, x.unidades, x.unidadesSinCosto, x.valor]),
    [
      ['Norte', 13, 3, '60.00'],
      ['Principal', 19, 0, '120.00'],
    ]
  )
  // De más valor a menos; lo que no tiene costo, al final.
  assert.deepEqual(
    v.filas.map((x) => [x.nombre.split(' ')[0], x.unidades, x.costo, x.fuente, x.valor]),
    [
      ['Alfa', 20, '6.00', 'PROMEDIO', '120.00'],
      ['Delta', 4, '10.00', 'PROMEDIO', '40.00'],
      ['Beta', 5, '4.00', 'REFERENCIA', '20.00'],
      ['Gamma', 3, null, null, null],
    ]
  )
  assert.equal(v.filas[1].danadas, 1)
  assert.equal(v.totalFilas, 4)
  assert.equal(v.enTransito?.unidades, 0)

  // Filtro por sucursal: el resumen y la tabla se acotan, pero la lista de sucursales sigue completa.
  const norte = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ sucursal: e.s2 }), { zonaHoraria: ZONA }))
  assert.deepEqual(norte.resumen, { valor: '60.00', unidades: 13, unidadesConCosto: 10, unidadesSinCosto: 3, productos: 2, productosSinCosto: 1, danadas: 0 })
  assert.equal(norte.porSucursal.length, 2)
  // Solo sin costo, y búsqueda por nombre, SKU y comodines neutralizados.
  const sin = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ sinCosto: '1' }), { zonaHoraria: ZONA }))
  assert.deepEqual(sin.filas.map((x) => x.nombre.split(' ')[0]), ['Gamma'])
  assert.equal(sin.totalFilas, 1)
  const alfa = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ q: 'alf' }), { zonaHoraria: ZONA }))
  assert.deepEqual(alfa.filas.map((x) => x.nombre.split(' ')[0]), ['Alfa'])
  assert.equal(alfa.resumen.productos, 4, 'el resumen no se filtra por texto')
  const comodin = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ q: '%' }), { zonaHoraria: ZONA }))
  assert.equal(comodin.totalFilas, 0, 'un % escrito por la persona no es un comodín')
  // El costo se mueve y la tabla lo sigue: corregir Alfa a 10 → 200.00 de Alfa.
  await e.en((tx) => corregirCostoEnTx(tx, e.id, { varianteId: p1, costo: '10', motivo: 'Prueba' }, como(ctx.usuario)))
  const despues = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({}), { zonaHoraria: ZONA }))
  assert.equal(despues.resumen.valor, '260.00')
  // Otra empresa no ve nada de esta.
  const ajena = await enA((tx) => valorDelInventarioEnTx(tx, ctx.a, leerFiltrosValor({ q: 'Alfa' }), { zonaHoraria: ZONA }))
  assert.equal(ajena.totalFilas, 0)
})

test('18 · el valor de lo que va en camino se enseña aparte; las unidades en tránsito no suman a ninguna sucursal', async () => {
  const e = await empresaNueva('dos')
  const p = await e.prod('Transito')
  await e.entra(e.s1, [{ varianteId: p, cantidad: 10, costo: '5' }])
  await e.en((tx) => enviarTrasladoEnTx(tx, e.id, { origenId: e.s1, destinoId: e.s2, lineas: [{ varianteId: p, cantidad: 4 }] }, como(ctx.usuario)))
  const v = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({}), { zonaHoraria: ZONA }))
  assert.deepEqual(v.enTransito, { unidades: 4, unidadesSinCosto: 0, valor: '20.00' })
  assert.equal(v.resumen.unidades, 6, 'en las sucursales quedan 6')
  assert.equal(v.resumen.valor, '30.00')
  // Llegan 3 de las 4: en camino queda 1 (lo recibido ya está en el destino, no se cuenta dos veces).
  const envio = await prisma.inventoryTransfer.findFirstOrThrow({ where: { companyId: e.id }, select: { id: true } })
  await e.en((tx) => recibirTrasladoEnTx(tx, e.id, { trasladoId: envio.id, lineas: [{ varianteId: p, cantidad: 3 }] }, como(ctx.usuario)))
  const despues = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({}), { zonaHoraria: ZONA }))
  assert.deepEqual(despues.enTransito, { unidades: 1, unidadesSinCosto: 0, valor: '5.00' })
  assert.equal(despues.resumen.unidades, 9)
  assert.equal(despues.resumen.valor, '45.00')
})

test('19 · el costo de ventas del mes usa el costo congelado de cada venta, resta lo devuelto y cuenta aparte lo vendido sin costo', async () => {
  const e = await empresaNueva('tres')
  const [p1, p2, p3] = [await e.prod('Uno'), await e.prod('Dos', '4'), await e.prod('Tres')]
  await e.entra(e.s1, [{ varianteId: p1, cantidad: 10, costo: '5' }, { varianteId: p2, cantidad: 5 }, { varianteId: p3, cantidad: 5 }])
  const mes = mesActual(ZONA)
  const vender = (v: string, q: number) => e.en((tx) => venderEnTx(tx, e.id, { varianteId: v, sucursalId: e.s1, cantidad: q }, como(null)))
  await vender(p1, 2) // 2 × 5 = 10
  await e.entra(e.s1, [{ varianteId: p1, cantidad: 10, costo: '9' }]) // el promedio sube a (8·5 + 10·9)/18 = 7.2222
  await vender(p1, 1) // 7.2222
  await vender(p2, 1) // referencia 4
  await vender(p3, 2) // sin costo
  await e.en((tx) => devolverEnTx(tx, e.id, { varianteId: p1, sucursalId: e.s1, cantidad: 1 }, como(ctx.usuario))) // se resta 7.2222
  const cogs = await e.en((tx) => costoDeVentasEnTx(tx, e.id, mes, ZONA))
  // 10 + 7.2222 + 4 − 7.2222 = 14.00
  assert.deepEqual(cogs, { mes, costo: '14.00', unidadesVendidas: 6, unidadesSinCosto: 2, unidadesDevueltas: 1 })
  // Otro mes: nada. Por sucursal: la otra no vendió.
  const otroMes = mes.slice(0, 4) === '2000' ? '2001-01' : '2000-01'
  assert.deepEqual(await e.en((tx) => costoDeVentasEnTx(tx, e.id, otroMes, ZONA)), { mes: otroMes, costo: '0.00', unidadesVendidas: 0, unidadesSinCosto: 0, unidadesDevueltas: 0 })
  assert.equal((await e.en((tx) => costoDeVentasEnTx(tx, e.id, mes, ZONA, e.s2))).unidadesVendidas, 0)
  assert.equal((await e.en((tx) => costoDeVentasEnTx(tx, e.id, mes, ZONA, e.s1))).costo, '14.00')
  // Y viaja en la pantalla: el mes pedido por la URL.
  const v = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ mes }), { zonaHoraria: ZONA }))
  assert.equal(v.costoDeVentas.costo, '14.00')
  // El costo que un movimiento congeló NO cambia si el promedio cambia después.
  await e.en((tx) => corregirCostoEnTx(tx, e.id, { varianteId: p1, costo: '1000', motivo: 'Prueba de congelado' }, como(ctx.usuario)))
  assert.equal((await e.en((tx) => costoDeVentasEnTx(tx, e.id, mes, ZONA))).costo, '14.00')
  // Una venta de un mes anterior cuenta en SU mes y no en éste (se siembra con su fecha: el INSERT directo sí se permite).
  const nivel = await prisma.inventoryLevel.findFirstOrThrow({ where: { companyId: e.id, catalogVariantId: p1 } })
  const haceDosMeses = new Date(Date.now() - 62 * 86_400_000)
  await prisma.inventoryMovement.create({ data: { companyId: e.id, inventoryLevelId: nivel.id, type: 'SALE', sourceBucket: 'AVAILABLE', quantity: 3, previousOnHand: 9, newOnHand: 6, unitCost: '2.0000', createdAt: haceDosMeses } })
  const mesViejo = mesActual(ZONA, haceDosMeses)
  assert.equal((await e.en((tx) => costoDeVentasEnTx(tx, e.id, mes, ZONA))).costo, '14.00', 'la venta vieja no entra en el mes en curso')
  assert.deepEqual(await e.en((tx) => costoDeVentasEnTx(tx, e.id, mesViejo, ZONA)), { mes: mesViejo, costo: '6.00', unidadesVendidas: 3, unidadesSinCosto: 0, unidadesDevueltas: 0 })
})

test('20 · la tabla pagina sin repetir ni saltar, de más valor a menos, y la exportación trae todo', async () => {
  const e = await empresaNueva('cuatro')
  const N = 120
  const ids = Array.from({ length: N }, (_, i) => `pg-${i}-${sufijo}`)
  await prisma.$transaction([
    prisma.catalogItem.createMany({ data: ids.map((id, i) => ({ id: `it-${id}`, companyId: e.id, name: `Pagina ${String(i).padStart(3, '0')} ${sufijo}`, slug: `pg-${i}-${sufijo}`, type: 'PHYSICAL_PRODUCT' as const, capabilities: { trackInventory: true } })) }),
    prisma.catalogVariant.createMany({ data: ids.map((id, i) => ({ id: `va-${id}`, companyId: e.id, catalogItemId: `it-${id}`, name: 'Default', sku: `PG-${i}-${sufijo}`, price: 10, isDefault: true })) }),
  ])
  await e.entra(e.s1, ids.map((id, i) => ({ varianteId: `va-${id}`, cantidad: 1, costo: String(i + 1) })))
  const vistos: string[] = []
  const paginas = Math.ceil(N / FILAS_POR_PAGINA_VALOR)
  for (let pagina = 1; pagina <= paginas + 1; pagina++) {
    const v = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({ pagina: String(pagina) }), { zonaHoraria: ZONA }))
    assert.equal(v.totalFilas, N)
    if (pagina <= paginas) assert.equal(v.filas.length, pagina < paginas ? FILAS_POR_PAGINA_VALOR : N - FILAS_POR_PAGINA_VALOR * (paginas - 1))
    else assert.equal(v.filas.length, 0, 'más allá de la última página no hay filas')
    vistos.push(...v.filas.map((x) => x.sku))
  }
  assert.equal(new Set(vistos).size, N, 'ninguna fila se repite')
  assert.equal(vistos[0], `PG-${N - 1}-${sufijo}`, 'la de más valor va primero')
  const todo = await e.en((tx) => valorDelInventarioEnTx(tx, e.id, leerFiltrosValor({}), { zonaHoraria: ZONA, todas: true }))
  assert.equal(todo.filas.length, N)
  assert.deepEqual(todo.filas.map((x) => x.sku), vistos)
  assert.equal(todo.resumen.valor, formatearMontoEntero((N * (N + 1)) / 2))
})

const formatearMontoEntero = (n: number) => `${n.toLocaleString('es-DO')}.00`

test('21 · la ficha de un producto: costo vigente, de dónde sale, valor de lo que hay y sus últimas correcciones', async () => {
  const p = await producto('Ficha', '3')
  assert.equal((await enA((tx) => costoDeVarianteEnTx(tx, ctx.a, p))).fuente, 'REFERENCIA')
  // Con existencias sin costo capturado, el producto vale lo que dice la referencia del catálogo.
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 4 }])
  const soloRef = await enA((tx) => costoDeVarianteEnTx(tx, ctx.a, p))
  assert.deepEqual({ costo: soloRef.costo, fuente: soloRef.fuente, promedio: soloRef.promedio, valor: soloRef.valor, unidades: soloRef.unidades }, { costo: '3.00', fuente: 'REFERENCIA', promedio: null, valor: '12.00', unidades: 4 })
  await entrada(ctx.sucA1, [{ varianteId: p, cantidad: 6, costo: '5' }])
  let f = await enA((tx) => costoDeVarianteEnTx(tx, ctx.a, p))
  // 4 viejas a la referencia de 3.00 + 6 a 5.00 = 10 unidades a 4.20 de promedio.
  assert.deepEqual(
    { costo: f.costo, fuente: f.fuente, promedio: f.promedio, referencia: f.referencia, ultimoCosto: f.ultimoCosto, unidades: f.unidades, valor: f.valor, correcciones: f.correcciones.length },
    { costo: '4.20', fuente: 'PROMEDIO', promedio: '4.20', referencia: '3.00', ultimoCosto: '5.00', unidades: 10, valor: '42.00', correcciones: 0 }
  )
  assert.ok(f.ultimoCostoEn)
  for (let i = 1; i <= 7; i++) await enA((tx) => corregirCostoEnTx(tx, ctx.a, { varianteId: p, costo: String(5 + i), motivo: `corrección ${i}` }, como(ctx.usuario)))
  f = await enA((tx) => costoDeVarianteEnTx(tx, ctx.a, p))
  assert.equal(f.correcciones.length, 5, 'solo las cinco últimas')
  assert.deepEqual(f.correcciones.map((x) => x.motivo), ['corrección 7', 'corrección 6', 'corrección 5', 'corrección 4', 'corrección 3'])
  assert.equal(f.correcciones[0].autor, 'Compras')
  assert.equal(f.costo, '12.00')
  // Una variante de otra empresa no se lee desde esta.
  const ajena = await enA((tx) => costoDeVarianteEnTx(tx, ctx.a, ctx.varianteB))
  assert.deepEqual({ costo: ajena.costo, unidades: ajena.unidades, correcciones: ajena.correcciones.length }, { costo: null, unidades: 0, correcciones: 0 })
})
