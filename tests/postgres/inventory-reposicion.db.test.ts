import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import {
  configurarObjetivoEnTx,
  configurarObjetivoOtrasSucursalesEnTx,
  configurarUmbralEnTx,
  enviarTrasladoEnTx,
  recibirTrasladoEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import {
  cambiarActivoProveedorEnTx,
  cancelarOrdenEnTx,
  crearProveedorEnTx,
  guardarOrdenEnTx,
  pedirOrdenEnTx,
  recibirOrdenEnTx,
  vincularProveedorEnTx,
} from '../../src/modules/inventory/compras-service'
import { reposicionEnTx, type DatosReposicion } from '../../src/modules/inventory/reposicion-queries'
import { NOTA_BORRADOR_REPOSICION, type FiltrosReposicion, type LineaDeReposicion } from '../../src/modules/inventory/reposicion'

/**
 * INV-3c · REPOSICIÓN («qué comprar») contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que «llenar hasta» se guarda por producto y sucursal, se audita, no se repite, respeta su rango y NO se deja chocar con
 *    el umbral de aviso (ni al fijarlo ni al mover el umbral), también cuando se aplica a las otras sucursales;
 *  · que la posición de un producto suma lo disponible (sin lo apartado), lo pedido a proveedores que no ha llegado (órdenes
 *    pedidas o recibidas en parte, solo las de ESA sucursal) y lo que va en camino hacia ella; que un borrador se enseña pero
 *    no cuenta; y que todo eso vuelve a su sitio al recibir, cancelar o cerrar;
 *  · qué proveedor se elige (preferido activo, único activo, ninguno), con qué costo, y cómo se agrupa;
 *  · que solo salen los productos que controlan inventario, vigentes, en sucursales activas y de ESTA empresa;
 *  · la base: el rango de «llenar hasta» lo impone un CHECK aunque se escriba por fuera.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', sucA1: '', sucA2: '', sucA3: '', sucCerrada: '', sucB: '', varianteB: '', servicio: '', proveedorB: '' }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

let contador = 0
/** Un producto nuevo de la empresa A (con control de inventario). `nombre` es único: sirve de filtro `q` para aislar la prueba. */
async function producto(nombre: string): Promise<{ item: string; variante: string; nombre: string; sku: string }> {
  const n = ++contador
  const nombreCompleto = `${nombre} ${n} ${sufijo}`
  const sku = `REP-${n}-${sufijo}`.toUpperCase() // el catálogo guarda el SKU en mayúsculas
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: nombreCompleto, type: 'PHYSICAL_PRODUCT', price: 100, sku }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return { item: r.id, variante: v.id, nombre: nombreCompleto, sku }
}

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Reposicion ${x} ${sufijo}`, slug: `reposicion-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-rep-${sufijo}`, email: `rep-${sufijo}@prueba.test`, name: 'Repositor', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucA3 = (await suc(ctx.a, 'Este')).id
  ctx.sucCerrada = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Ajeno ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `REP-B-${sufijo}` }, como(ctx.usuario)))
  ctx.varianteB = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  const s = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `Lavado ${sufijo}`, type: 'SERVICE', price: 100, sku: `REP-S-${sufijo}` }, como(ctx.usuario)))
  ctx.servicio = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: s.id }, select: { id: true } })).id
  ctx.proveedorB = (await enB((tx) => crearProveedorEnTx(tx, ctx.b, { nombre: 'Proveedor de B' }, como(ctx.usuario)))).proveedorId
})

after(async () => {
  // Lo que es de solo anexar no se borra (lo prohíbe la base): se desactivan los disparadores solo en esta transacción.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_transfer_lines',
        'inventory_transfers',
        'inventory_variant_suppliers',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_purchase_order_lines',
        'inventory_purchase_orders',
        'inventory_suppliers',
        'inventory_cost_adjustments',
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

async function mensajeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof InventarioError) return e.message
    throw e
  }
  assert.fail('se esperaba un InventarioError y no falló')
}

const objetivo = (varianteId: string, sucursalId: string, llenarHasta: number) => enA((tx) => configurarObjetivoEnTx(tx, ctx.a, { varianteId, sucursalId, llenarHasta }, como(ctx.usuario)))
const umbral = (varianteId: string, sucursalId: string, valor: number) => enA((tx) => configurarUmbralEnTx(tx, ctx.a, { varianteId, sucursalId, umbral: valor }, como(ctx.usuario)))
const entrada = (sucursalId: string, lineas: Array<{ varianteId: string; cantidad: number; costo?: string }>) => enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas }, como(ctx.usuario)))
const nivel = (varianteId: string, sucursalId: string) => prisma.inventoryLevel.findUnique({ where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } } })
const proveedor = (nombre: string) => enA((tx) => crearProveedorEnTx(tx, ctx.a, { nombre: `${nombre} ${sufijo}` }, como(ctx.usuario)))
const vincular = (varianteId: string, proveedorId: string, datos: Record<string, unknown> = {}) => enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId, proveedorId, datos }, como(ctx.usuario)))
const repos = (f: FiltrosReposicion = {}, max?: number): Promise<DatosReposicion> => enA((tx) => reposicionEnTx(tx, ctx.a, f, max))
/** La propuesta de UN producto (se aísla por su nombre, que es único). */
const deProducto = (p: { nombre: string }, extra: FiltrosReposicion = {}) => repos({ q: p.nombre, ...extra })
const lineas = (d: DatosReposicion): LineaDeReposicion[] => d.grupos.flatMap((g) => g.lineas)
const unica = (d: DatosReposicion): LineaDeReposicion => {
  const l = lineas(d)
  assert.equal(l.length, 1, `se esperaba una sola línea y hay ${l.length}`)
  return l[0]
}
const orden = (proveedorId: string, sucursalId: string, ls: Array<{ varianteId: string; cantidad: number; costo?: string }>, clave?: string) =>
  enA((tx) =>
    guardarOrdenEnTx(
      tx,
      ctx.a,
      { cabecera: { proveedorId, sucursalId }, lineas: ls.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, costo: l.costo ?? '5' })), idempotencyKey: clave },
      como(ctx.usuario)
    )
  )
const pedida = async (proveedorId: string, sucursalId: string, ls: Array<{ varianteId: string; cantidad: number; costo?: string }>) => {
  const o = await orden(proveedorId, sucursalId, ls)
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId }, como(ctx.usuario)))
  return o
}

// ── «Llenar hasta» ───────────────────────────────────────────────────────────

test('1 · «llenar hasta» se guarda por producto y sucursal (crea el saldo si no existe), se audita, y repetirlo no hace nada', async () => {
  const p = await producto('Objetivo')
  assert.equal(await nivel(p.variante, ctx.sucA1), null, 'sin saldo todavía')
  const r = await objetivo(p.variante, ctx.sucA1, 20)
  assert.equal(r.llenarHasta, 20)
  const n = await nivel(p.variante, ctx.sucA1)
  assert.equal(n?.targetStock, 20)
  assert.equal(n?.onHand, 0, 'fijar el objetivo no mueve existencias')
  assert.equal(n?.lowStockThreshold, 0)
  assert.equal(await prisma.inventoryMovement.count({ where: { companyId: ctx.a, inventoryLevelId: n!.id } }), 0, 'ni deja movimientos en el ledger')
  const rastro = () => prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: r.nivelId, entidadTipo: 'InventoryLevel', accion: 'INVENTORY_CONFIGURED' }, orderBy: { createdAt: 'asc' } })
  assert.equal((await rastro()).length, 1)
  assert.deepEqual((await rastro())[0].payload, { sku: p.sku, producto: p.nombre, sucursal: 'Principal', antes: { llenarHasta: 0 }, despues: { llenarHasta: 20 } })
  // Lo mismo otra vez: ni cambia ni deja otra huella.
  await objetivo(p.variante, ctx.sucA1, 20)
  assert.equal((await rastro()).length, 1)
  // Cambiarlo sí, con su antes y su después; otra sucursal es otro saldo.
  await objetivo(p.variante, ctx.sucA1, 35)
  const huellas = await rastro()
  assert.equal(huellas.length, 2)
  assert.deepEqual((huellas[1].payload as { antes: unknown; despues: unknown }).antes, { llenarHasta: 20 })
  assert.deepEqual((huellas[1].payload as { antes: unknown; despues: unknown }).despues, { llenarHasta: 35 })
  assert.equal((await nivel(p.variante, ctx.sucA2)), null, 'otra sucursal no se tocó')
  await objetivo(p.variante, ctx.sucA2, 7)
  assert.deepEqual([(await nivel(p.variante, ctx.sucA1))?.targetStock, (await nivel(p.variante, ctx.sucA2))?.targetStock], [35, 7])
  // 0 lo quita.
  await objetivo(p.variante, ctx.sucA1, 0)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.targetStock, 0)
})

test('2 · lo que no es un objetivo válido se rechaza antes de tocar nada; un servicio o un producto ajeno no tienen objetivo', async () => {
  const p = await producto('Rangos')
  for (const mal of [-1, 1.5, 1_000_001, Number.NaN, '5' as unknown as number, null as unknown as number]) {
    assert.equal(await codigoDe(objetivo(p.variante, ctx.sucA1, mal)), 'OBJETIVO_INVALIDO', String(mal))
  }
  assert.equal(await nivel(p.variante, ctx.sucA1), null, 'ningún rechazo creó un saldo')
  await objetivo(p.variante, ctx.sucA1, 1_000_000)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.targetStock, 1_000_000, 'el máximo vale')
  assert.equal(await codigoDe(objetivo(ctx.servicio, ctx.sucA1, 5)), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal(await codigoDe(objetivo(ctx.varianteB, ctx.sucA1, 5)), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(objetivo(p.variante, ctx.sucB, 5)), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await codigoDe(objetivo('no-existe', ctx.sucA1, 5)), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(objetivo(p.variante, 'no-existe', 5)), 'SUCURSAL_NO_ENCONTRADA')
  // Una sucursal desactivada admite configuración (igual que el umbral): no se vende ahí, pero se puede dejar lista.
  await objetivo(p.variante, ctx.sucCerrada, 4)
  assert.equal((await nivel(p.variante, ctx.sucCerrada))?.targetStock, 4)
})

test('3 · el objetivo no se deja chocar con el umbral: ni al fijarlo ni al mover el umbral; el mensaje dice dónde', async () => {
  const p = await producto('Choque')
  await umbral(p.variante, ctx.sucA1, 5)
  assert.equal(await codigoDe(objetivo(p.variante, ctx.sucA1, 5)), 'OBJETIVO_MENOR_QUE_UMBRAL', 'igual al umbral no vale')
  assert.equal(await codigoDe(objetivo(p.variante, ctx.sucA1, 3)), 'OBJETIVO_MENOR_QUE_UMBRAL')
  const mensaje = await mensajeDe(objetivo(p.variante, ctx.sucA1, 4))
  assert.match(mensaje, /«Llenar hasta» \(4\) en Principal tiene que ser mayor que el umbral de aviso \(5\)/)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.targetStock, 0, 'el rechazo no escribió nada')
  await objetivo(p.variante, ctx.sucA1, 6)
  // Con objetivo 6, el umbral no puede subir a 6 ni más…
  assert.equal(await codigoDe(umbral(p.variante, ctx.sucA1, 6)), 'UMBRAL_MAYOR_QUE_OBJETIVO')
  assert.equal(await codigoDe(umbral(p.variante, ctx.sucA1, 50)), 'UMBRAL_MAYOR_QUE_OBJETIVO')
  assert.match(await mensajeDe(umbral(p.variante, ctx.sucA1, 50)), /«Llenar hasta» \(6\) en Principal tiene que ser mayor que el umbral de aviso \(50\)/)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.lowStockThreshold, 5, 'el umbral no cambió')
  // …pero sí a 5, a 1, o a 0 (sin aviso).
  await umbral(p.variante, ctx.sucA1, 1)
  await umbral(p.variante, ctx.sucA1, 0)
  // Sin umbral, cualquier objetivo; y sin objetivo, cualquier umbral.
  await objetivo(p.variante, ctx.sucA1, 2)
  await objetivo(p.variante, ctx.sucA1, 0)
  await umbral(p.variante, ctx.sucA1, 999)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.lowStockThreshold, 999)
  // Repetir el mismo umbral ya fijado no vuelve a mirar el objetivo (un dato viejo no impide dejarlo como está).
  await prisma.inventoryLevel.update({ where: { catalogVariantId_locationId: { catalogVariantId: p.variante, locationId: ctx.sucA1 } }, data: { targetStock: 10 } })
  await umbral(p.variante, ctx.sucA1, 999)
  await objetivo(p.variante, ctx.sucA1, 10)
})

test('4 · aplicar a las otras sucursales: solo donde ya hay saldo y están activas; repetirlo no cambia nada; un choque deshace TODO', async () => {
  const p = await producto('Otras')
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 3 }])
  await entrada(ctx.sucA2, [{ varianteId: p.variante, cantidad: 3 }])
  // sucA3 no tiene saldo de este producto; en la sucursal cerrada sí hay un saldo (con otro objetivo) y no debe tocarse.
  await objetivo(p.variante, ctx.sucCerrada, 3)
  const aplicar = (llenarHasta: number) =>
    enA(async (tx) => {
      const propia = await configurarObjetivoEnTx(tx, ctx.a, { varianteId: p.variante, sucursalId: ctx.sucA1, llenarHasta }, como(ctx.usuario))
      const otras = await configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: p.variante, sucursalOrigenId: ctx.sucA1, llenarHasta }, como(ctx.usuario))
      return { propia: propia.llenarHasta, otras: otras.sucursales }
    })
  assert.deepEqual(await aplicar(15), { propia: 15, otras: 1 })
  assert.deepEqual([(await nivel(p.variante, ctx.sucA1))?.targetStock, (await nivel(p.variante, ctx.sucA2))?.targetStock], [15, 15])
  assert.equal(await nivel(p.variante, ctx.sucA3), null, 'no se crean saldos donde el producto nunca estuvo')
  assert.equal((await nivel(p.variante, ctx.sucCerrada))?.targetStock, 3, 'la sucursal desactivada no se toca')
  assert.deepEqual(await aplicar(15), { propia: 15, otras: 0 }, 'repetirlo no cambia nada')
  // En Norte hay un umbral de 10: un objetivo de 10 no cabe ahí → falla todo, también lo ya hecho en Principal.
  await umbral(p.variante, ctx.sucA2, 10)
  await objetivo(p.variante, ctx.sucA2, 11)
  assert.equal(await codigoDe(aplicar(10)), 'OBJETIVO_MENOR_QUE_UMBRAL')
  assert.match(await mensajeDe(aplicar(10)), /en Norte/)
  assert.deepEqual([(await nivel(p.variante, ctx.sucA1))?.targetStock, (await nivel(p.variante, ctx.sucA2))?.targetStock], [15, 11], 'nada cambió en ninguna')
  assert.equal(await codigoDe(enA((tx) => configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: p.variante, sucursalOrigenId: ctx.sucA1, llenarHasta: -5 }, como(ctx.usuario)))), 'OBJETIVO_INVALIDO')
  assert.equal(await codigoDe(enA((tx) => configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: ctx.servicio, sucursalOrigenId: ctx.sucA1, llenarHasta: 5 }, como(ctx.usuario)))), 'SIN_CONTROL_DE_INVENTARIO')
})

test('5 · la base: «llenar hasta» va de 0 a un millón aunque se escriba por fuera; un saldo nuevo nace sin objetivo', async () => {
  const p = await producto('Base')
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 1 }])
  const n = (await nivel(p.variante, ctx.sucA1))!
  assert.equal(n.targetStock, 0, 'por defecto, sin objetivo')
  const poner = (v: number) => prisma.$executeRawUnsafe(`UPDATE "inventory_levels" SET "targetStock" = ${v} WHERE "id" = '${n.id}'`)
  await assert.rejects(poner(-1), /inventory_levels_objetivo/)
  await assert.rejects(poner(1_000_001), /inventory_levels_objetivo/)
  await poner(1_000_000)
  await poner(0)
  assert.equal((await nivel(p.variante, ctx.sucA1))?.targetStock, 0)
  const indice = await prisma.$queryRaw<{ def: string }[]>`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'inventory_levels_objetivo_idx'`
  assert.match(indice[0]?.def ?? '', /WHERE \(?"?targetStock"? > 0\)?/, 'el índice parcial existe')
})

// ── La propuesta ─────────────────────────────────────────────────────────────

test('6 · la sugerencia es lo que falta para llegar al objetivo: lo disponible NO incluye lo apartado, y una venta la sube', async () => {
  const p = await producto('Sugerencia')
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 8 }])
  await objetivo(p.variante, ctx.sucA1, 20)
  let l = unica(await deProducto(p))
  assert.deepEqual([l.disponible, l.pedido, l.enCamino, l.enBorrador, l.llenarHasta, l.umbral, l.sugerida], [8, 0, 0, 0, 20, 0, 12])
  assert.equal(l.sku, p.sku)
  assert.equal(l.producto, p.nombre, 'trae el nombre del producto')
  // Lo apartado no está disponible: 3 apartados → disponible 5 → faltan 15.
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: p.variante, sucursalId: ctx.sucA1, cantidad: 3 }, como(ctx.usuario)))
  l = unica(await deProducto(p))
  assert.deepEqual([l.disponible, l.sugerida], [5, 15])
  // Una venta baja lo disponible.
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p.variante, sucursalId: ctx.sucA1, cantidad: 2 }, como(ctx.usuario)))
  l = unica(await deProducto(p))
  assert.deepEqual([l.disponible, l.sugerida], [3, 17])
  // Con el stock cubierto, desaparece de la propuesta y cuenta como al día.
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 17 }])
  const d = await deProducto(p)
  assert.equal(lineas(d).length, 0)
  assert.equal(d.alDia, 1)
  assert.equal(d.conObjetivo, 1)
})

test('7 · con umbral solo propone al llegar al umbral; sin umbral, en cuanto queda por debajo del objetivo', async () => {
  const p = await producto('Umbral')
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 9 }])
  await umbral(p.variante, ctx.sucA1, 5)
  await objetivo(p.variante, ctx.sucA1, 20)
  const d = await deProducto(p)
  assert.equal(lineas(d).length, 0, '9 > 5: aún no toca')
  assert.equal(d.alDia, 1)
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: p.variante, sucursalId: ctx.sucA1, cantidad: 4 }, como(ctx.usuario)))
  assert.equal(unica(await deProducto(p)).sugerida, 15, '5 ≤ 5: toca, y se pide hasta 20')
  await umbral(p.variante, ctx.sucA1, 0)
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 10 }])
  assert.equal(unica(await deProducto(p)).sugerida, 5, 'sin umbral, 15 < 20 ya propone')
})

test('8 · lo pedido a proveedores se descuenta mientras no llegue: pedida, recibida en parte, cerrada con faltante y cancelada', async () => {
  const p = await producto('Pedido')
  const prov = await proveedor('Surtidor')
  await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 2 }])
  await objetivo(p.variante, ctx.sucA1, 20)
  assert.equal(unica(await deProducto(p)).sugerida, 18)
  // Una orden PEDIDA de 10 para Principal: la posición sube 10.
  const o = await pedida(prov.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 10 }])
  let l = unica(await deProducto(p))
  assert.deepEqual([l.pedido, l.sugerida], [10, 8])
  // Recibir 4: lo disponible sube 4 y lo pendiente baja 4: la posición no cambia.
  await enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, lineas: [{ varianteId: p.variante, cantidad: 4 }] }, como(ctx.usuario)))
  l = unica(await deProducto(p))
  assert.deepEqual([l.disponible, l.pedido, l.sugerida], [6, 6, 8])
  // Cerrar con faltante: lo que no llega deja de contar → hay que volver a pedirlo.
  await enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId, cerrarConFaltante: true, motivo: 'El proveedor no tenía más' }, como(ctx.usuario)))
  l = unica(await deProducto(p))
  assert.deepEqual([l.disponible, l.pedido, l.sugerida], [6, 0, 14])
  // Una orden pedida y luego cancelada no cuenta.
  const o2 = await pedida(prov.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 5 }])
  assert.equal(unica(await deProducto(p)).sugerida, 9)
  await enA((tx) => cancelarOrdenEnTx(tx, ctx.a, { ordenId: o2.ordenId, motivo: 'Ya no' }, como(ctx.usuario)))
  assert.equal(unica(await deProducto(p)).sugerida, 14)
})

test('9 · lo pedido para OTRA sucursal no cubre esta; una orden recibida del todo ya no es «pedido»', async () => {
  const p = await producto('Sucursales')
  const prov = await proveedor('Mayorista')
  await objetivo(p.variante, ctx.sucA1, 10)
  await objetivo(p.variante, ctx.sucA2, 10)
  await pedida(prov.proveedorId, ctx.sucA2, [{ varianteId: p.variante, cantidad: 6 }])
  const d = await deProducto(p)
  const por = new Map(lineas(d).map((l) => [l.sucursalId, l]))
  assert.equal(por.get(ctx.sucA1)?.sugerida, 10, 'Principal sigue sin nada pedido')
  assert.equal(por.get(ctx.sucA1)?.pedido, 0)
  assert.equal(por.get(ctx.sucA2)?.sugerida, 4, 'Norte tiene 6 pedidos')
  assert.equal(por.get(ctx.sucA2)?.pedido, 6)
  // Recibirla toda: pasa a ser stock, no pedido.
  const o = await prisma.inventoryPurchaseOrder.findFirstOrThrow({ where: { companyId: ctx.a, locationId: ctx.sucA2, lines: { some: { catalogVariantId: p.variante } } }, select: { id: true } })
  await enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId: o.id, todo: true }, como(ctx.usuario)))
  const despues = new Map(lineas(await deProducto(p)).map((l) => [l.sucursalId, l]))
  assert.deepEqual([despues.get(ctx.sucA2)?.disponible, despues.get(ctx.sucA2)?.pedido, despues.get(ctx.sucA2)?.sugerida], [6, 0, 4])
})

test('10 · lo que va en camino hacia la sucursal se descuenta; el origen no gana nada; al recibirlo pasa a ser stock', async () => {
  const p = await producto('Camino')
  await entrada(ctx.sucA2, [{ varianteId: p.variante, cantidad: 30 }])
  await objetivo(p.variante, ctx.sucA1, 12)
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).sugerida, 12)
  const t = await enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: ctx.sucA2, destinoId: ctx.sucA1, lineas: [{ varianteId: p.variante, cantidad: 5 }] }, como(ctx.usuario)))
  let l = unica(await deProducto(p, { sucursalId: ctx.sucA1 }))
  assert.deepEqual([l.disponible, l.enCamino, l.sugerida], [0, 5, 7])
  // Hacia el origen no va nada: si también tuviera objetivo, no se le descuenta.
  await objetivo(p.variante, ctx.sucA2, 40)
  const norte = lineas(await deProducto(p, { sucursalId: ctx.sucA2 }))[0]
  assert.deepEqual([norte.disponible, norte.enCamino, norte.sugerida], [25, 0, 15])
  // Recibir 2 de 5: 2 son stock y 3 siguen en camino: la posición no cambia.
  await enA((tx) => recibirTrasladoEnTx(tx, ctx.a, { trasladoId: t.trasladoId, lineas: [{ varianteId: p.variante, cantidad: 2 }] }, como(ctx.usuario)))
  l = unica(await deProducto(p, { sucursalId: ctx.sucA1 }))
  assert.deepEqual([l.disponible, l.enCamino, l.sugerida], [2, 3, 7])
  // Cerrar con faltante: lo que no llegó deja de contar.
  await enA((tx) => recibirTrasladoEnTx(tx, ctx.a, { trasladoId: t.trasladoId, cerrarConFaltante: true, motivo: 'Se perdió en el camino' }, como(ctx.usuario)))
  l = unica(await deProducto(p, { sucursalId: ctx.sucA1 }))
  assert.deepEqual([l.disponible, l.enCamino, l.sugerida], [2, 0, 10])
})

test('11 · un borrador se enseña (y su orden se avisa) pero NO se descuenta: no es un compromiso', async () => {
  const p = await producto('Borrador')
  const prov = await proveedor('Casa')
  await vincular(p.variante, prov.proveedorId, { preferido: true })
  await objetivo(p.variante, ctx.sucA1, 10)
  const o = await orden(prov.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 7 }])
  const d = await deProducto(p)
  const l = unica(d)
  assert.deepEqual([l.enBorrador, l.pedido, l.sugerida], [7, 0, 10])
  const g = d.grupos[0]
  assert.deepEqual(g.borradores.map((b) => b.id), [o.ordenId])
  assert.equal(g.borradores[0].numero, o.numero)
  // Otro borrador del mismo proveedor y sucursal se suma; uno de OTRA sucursal o de otro proveedor no aparece.
  const o2 = await orden(prov.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 2 }])
  const otroProv = await proveedor('Otra casa')
  await orden(otroProv.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 1 }])
  await orden(prov.proveedorId, ctx.sucA2, [{ varianteId: p.variante, cantidad: 1 }])
  const d2 = await deProducto(p)
  assert.deepEqual(d2.grupos[0].borradores.map((b) => b.id), [o.ordenId, o2.ordenId], 'los dos de este proveedor y esta sucursal, en orden de creación')
  assert.equal(unica(d2).enBorrador, 10, '7 + 2 + 1 (del otro proveedor, misma sucursal) — cantidades por producto y sucursal')
  // Pedir el borrador lo vuelve compromiso y baja la sugerencia.
  await enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId: o.ordenId }, como(ctx.usuario)))
  const d3 = await deProducto(p)
  assert.deepEqual([unica(d3).pedido, unica(d3).sugerida], [7, 3])
  assert.equal(unica(d3).enBorrador, 3, 'lo que ya se pidió dejó de ser borrador: quedan el de 2 y el del otro proveedor (1)')
  assert.deepEqual(d3.grupos[0].borradores.map((b) => b.id), [o2.ordenId], 'el pedido ya no es borrador')
})

test('12 · un borrador creado desde la propuesta lleva su nota, el costo y la cantidad, y repetir el mismo envío no crea otro', async () => {
  const p = await producto('Desde propuesta')
  const prov = await proveedor('Proveedor propuesta')
  await vincular(p.variante, prov.proveedorId, { preferido: true })
  await objetivo(p.variante, ctx.sucA1, 12)
  const l = unica(await deProducto(p))
  const clave = `rep-${sufijo}-1`
  const cabecera = { proveedorId: prov.proveedorId, sucursalId: ctx.sucA1, nota: NOTA_BORRADOR_REPOSICION }
  const crear = () => enA((tx) => guardarOrdenEnTx(tx, ctx.a, { cabecera, lineas: [{ varianteId: l.varianteId, cantidad: l.sugerida, costo: '4.5' }], idempotencyKey: clave }, como(ctx.usuario)))
  const r1 = await crear()
  const r2 = await crear()
  assert.equal(r2.ordenId, r1.ordenId)
  assert.equal(r2.repetido, true)
  const fila = await prisma.inventoryPurchaseOrder.findUniqueOrThrow({ where: { id: r1.ordenId }, include: { lines: true } })
  assert.equal(fila.status, 'DRAFT')
  assert.equal(fila.note, NOTA_BORRADOR_REPOSICION)
  assert.deepEqual(fila.lines.map((x) => [x.quantityOrdered, x.unitCost.toFixed(4)]), [[12, '4.5000']])
  assert.equal(await nivel(p.variante, ctx.sucA1).then((n) => n?.onHand), 0, 'un borrador no mueve stock')
  assert.equal((await deProducto(p)).grupos[0].borradores[0].id, r1.ordenId)
})

// ── Proveedor, costo y grupos ────────────────────────────────────────────────

test('13 · el proveedor de cada línea: el preferido activo; si no hay, el único activo; si hay varios o ninguno, «sin proveedor»', async () => {
  const pref = await producto('Con preferido')
  const unico = await producto('Con uno solo')
  const varios = await producto('Con varios')
  const ninguno = await producto('Sin vínculos')
  const inactivo = await producto('Preferido inactivo')
  const [pa, pb, pc, pd] = await Promise.all(['Alfa', 'Beta', 'Gamma', 'Delta'].map(proveedor))
  await vincular(pref.variante, pa.proveedorId)
  await vincular(pref.variante, pb.proveedorId, { preferido: true })
  await vincular(unico.variante, pc.proveedorId)
  await vincular(varios.variante, pa.proveedorId)
  await vincular(varios.variante, pc.proveedorId)
  await vincular(inactivo.variante, pd.proveedorId, { preferido: true })
  await vincular(inactivo.variante, pa.proveedorId)
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: pd.proveedorId, activo: false }, como(ctx.usuario)))
  for (const x of [pref, unico, varios, ninguno, inactivo]) await objetivo(x.variante, ctx.sucA1, 10)
  const eleccion = async (x: { nombre: string }) => (await deProducto(x)).grupos[0].proveedor?.id ?? null
  assert.equal(await eleccion(pref), pb.proveedorId, 'el preferido, aunque no sea el primero')
  assert.equal(await eleccion(unico), pc.proveedorId, 'el único activo')
  assert.equal(await eleccion(varios), null, 'dos activos sin preferido: no se decide por el usuario')
  assert.equal(await eleccion(ninguno), null)
  assert.equal(await eleccion(inactivo), pa.proveedorId, 'el preferido desactivado se salta y queda el único activo')
  // El nombre del proveedor llega a la propuesta.
  assert.equal((await deProducto(pref)).grupos[0].proveedor?.nombre, `Beta ${sufijo}`)
  // Desactivar también al otro: ya no hay a quién pedirle.
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: pa.proveedorId, activo: false }, como(ctx.usuario)))
  assert.equal(await eleccion(inactivo), null)
  assert.equal(await eleccion(unico), pc.proveedorId, 'el de otro producto sigue activo')
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: pa.proveedorId, activo: true }, como(ctx.usuario)))
})

test('14 · el costo de la línea es el último costo de SU proveedor; sin él, no hay costo y el valor del grupo lo dice', async () => {
  const x = await producto('Costo X')
  const y = await producto('Costo Y')
  const prov = await proveedor('Costeado')
  await vincular(x.variante, prov.proveedorId, { preferido: true })
  await vincular(y.variante, prov.proveedorId, { preferido: true })
  await prisma.inventoryVariantSupplier.update({ where: { catalogVariantId_supplierId: { catalogVariantId: x.variante, supplierId: prov.proveedorId } }, data: { lastCost: '2.5000' } })
  await objetivo(x.variante, ctx.sucA1, 10)
  await objetivo(y.variante, ctx.sucA1, 4)
  const d = await repos({ proveedorId: prov.proveedorId, q: ` ${sufijo}` })
  const g = d.grupos.find((gr) => gr.lineas.some((l) => l.varianteId === x.variante))!
  const lx = g.lineas.find((l) => l.varianteId === x.variante)!
  const ly = g.lineas.find((l) => l.varianteId === y.variante)!
  assert.equal(lx.ultimoCosto, BigInt(25000))
  assert.equal(ly.ultimoCosto, null)
  assert.equal(g.lineasSinCosto >= 1, true)
  // Las cifras del grupo: 10 × 2.50 de X; Y no suma.
  const solo = await repos({ proveedorId: prov.proveedorId, q: x.nombre })
  assert.equal(solo.grupos[0].valor, '25.00')
  assert.equal(solo.resumen.valor, '25.00')
  assert.equal(solo.resumen.sinCosto, 0)
  const sinCosto = await repos({ proveedorId: prov.proveedorId, q: y.nombre })
  assert.equal(sinCosto.grupos[0].valor, '0.00')
  assert.equal(sinCosto.resumen.sinCosto, 1)
})

test('15 · los filtros: sucursal, proveedor (y «sin»), y búsqueda por nombre, SKU o código de barras', async () => {
  const p = await producto('Filtro uno')
  const q = await producto('Filtro dos')
  await prisma.catalogVariant.update({ where: { id: q.variante }, data: { barcode: `BC-${sufijo}-q` } })
  const prov = await proveedor('Filtrado')
  await vincular(p.variante, prov.proveedorId, { preferido: true })
  await objetivo(p.variante, ctx.sucA1, 10)
  await objetivo(p.variante, ctx.sucA2, 10)
  await objetivo(q.variante, ctx.sucA1, 10)
  const ids = (d: DatosReposicion) => new Set(lineas(d).map((l) => `${l.varianteId}@${l.sucursalId}`))
  const tag = 'Filtro'
  // Sucursal: solo sus saldos.
  assert.deepEqual([...ids(await repos({ q: tag, sucursalId: ctx.sucA2 }))].sort(), [`${p.variante}@${ctx.sucA2}`])
  assert.equal(ids(await repos({ q: tag, sucursalId: ctx.sucA1 })).size >= 2, true)
  // Proveedor: solo lo que se le pide a ese; «sin»: lo que no tiene a quién.
  const deProv = await repos({ q: tag, proveedorId: prov.proveedorId })
  assert.deepEqual([...ids(deProv)].sort(), [`${p.variante}@${ctx.sucA1}`, `${p.variante}@${ctx.sucA2}`].sort())
  assert.equal(deProv.grupos.length, 2, 'un grupo por sucursal')
  const sin = await repos({ q: tag, proveedorId: 'sin' })
  assert.equal(ids(sin).has(`${q.variante}@${ctx.sucA1}`), true)
  assert.equal(ids(sin).has(`${p.variante}@${ctx.sucA1}`), false)
  assert.equal(sin.grupos.every((g) => g.proveedor === null), true)
  assert.equal(ids(await repos({ q: tag, proveedorId: 'no-existe' })).size, 0)
  // El resumen sigue al filtro.
  assert.equal(deProv.resumen.grupos, 2)
  assert.equal(deProv.resumen.productos, 2)
  assert.equal(deProv.resumen.unidades, 20)
  // Búsqueda: nombre (sin importar mayúsculas), SKU y código de barras.
  assert.deepEqual([...ids(await repos({ q: p.nombre.toUpperCase() }))].map((k) => k.split('@')[0]), [p.variante, p.variante])
  assert.deepEqual([...ids(await repos({ q: q.sku }))], [`${q.variante}@${ctx.sucA1}`])
  assert.deepEqual([...ids(await repos({ q: `BC-${sufijo}-q` }))], [`${q.variante}@${ctx.sucA1}`])
  assert.equal(ids(await repos({ q: 'nada-que-coincida-xyz' })).size, 0)
  // El nombre de la variante también busca (sin que el producto, el SKU ni el código lo digan).
  await prisma.catalogVariant.update({ where: { id: q.variante }, data: { name: `Talla Unica ${sufijo}` } })
  assert.deepEqual([...ids(await repos({ q: `talla unica ${sufijo}` }))], [`${q.variante}@${ctx.sucA1}`])
})

test('16 · agrupa por proveedor Y sucursal, en un orden estable, con los «sin proveedor» al final', async () => {
  const a = await producto('Grupo a')
  const b = await producto('Grupo b')
  const c = await producto('Grupo c')
  const zeta = await proveedor('Zeta grupos')
  const alfa = await proveedor('Alfa grupos')
  await vincular(a.variante, zeta.proveedorId, { preferido: true })
  await vincular(b.variante, alfa.proveedorId, { preferido: true })
  for (const x of [a, b, c]) await objetivo(x.variante, ctx.sucA1, 5)
  await objetivo(a.variante, ctx.sucA2, 5)
  const d = await repos({ q: ` ${sufijo}` })
  const mios = d.grupos.filter((g) => g.lineas.some((l) => [a.variante, b.variante, c.variante].includes(l.varianteId)))
  const etiqueta = (g: (typeof mios)[number]) => `${g.proveedor?.nombre.split(' ')[0] ?? 'sin'}@${g.sucursalNombre}`
  const orden = mios.map(etiqueta)
  const iAlfa = orden.indexOf('Alfa@Principal')
  const iZetaNorte = orden.indexOf('Zeta@Norte')
  const iZetaPrincipal = orden.indexOf('Zeta@Principal')
  const iSin = orden.indexOf('sin@Principal')
  assert.ok(iAlfa >= 0 && iZetaNorte >= 0 && iZetaPrincipal >= 0 && iSin >= 0, orden.join(', '))
  assert.ok(iAlfa < iZetaNorte && iZetaNorte < iZetaPrincipal, 'por proveedor y, dentro, por sucursal (Norte antes que Principal)')
  assert.ok(iSin > iZetaPrincipal, 'los sin proveedor, al final')
  assert.equal(new Set(mios.map((g) => g.clave)).size, mios.length, 'cada grupo tiene su clave')
  assert.equal(mios.find((g) => g.proveedor === null)!.clave, `sin:${ctx.sucA1}`)
  // La misma consulta dos veces da lo mismo.
  assert.deepEqual((await repos({ q: ` ${sufijo}` })).grupos.map((g) => g.clave), d.grupos.map((g) => g.clave))
})

// ── Qué cuenta ───────────────────────────────────────────────────────────────

test('17 · solo cuentan los productos vigentes que controlan inventario, en sucursales activas y de esta empresa', async () => {
  const bueno = await producto('Vigente')
  const descontinuado = await producto('Descontinuado')
  const archivado = await producto('Archivado')
  const sinControl = await producto('Ya no controla')
  const enCerrada = await producto('En cerrada')
  for (const x of [bueno, descontinuado, archivado, sinControl, enCerrada]) await objetivo(x.variante, ctx.sucA1, 10)
  await objetivo(enCerrada.variante, ctx.sucCerrada, 10)
  await prisma.catalogVariant.update({ where: { id: descontinuado.variante }, data: { status: 'DISCONTINUED' } })
  await prisma.catalogItem.update({ where: { id: archivado.item }, data: { status: 'ARCHIVED' } })
  await prisma.$executeRawUnsafe(`UPDATE "catalog_items" SET "capabilities" = jsonb_set("capabilities", '{trackInventory}', 'false') WHERE "id" = '${sinControl.item}'`)
  const visibles = new Set(lineas(await repos({ q: ` ${sufijo}` })).map((l) => l.varianteId))
  assert.equal(visibles.has(bueno.variante), true)
  assert.equal(visibles.has(descontinuado.variante), false, 'descontinuado')
  assert.equal(visibles.has(archivado.variante), false, 'archivado')
  assert.equal(visibles.has(sinControl.variante), false, 'ya no controla inventario')
  const enCerradaLineas = lineas(await repos({ q: enCerrada.nombre }))
  assert.deepEqual(enCerradaLineas.map((l) => l.sucursalId), [ctx.sucA1], 'la sucursal desactivada no cuenta')
  // Un saldo con «llenar hasta» 0 no está en la propuesta ni cuenta como al día.
  const sinObj = await producto('Sin objetivo')
  await entrada(ctx.sucA1, [{ varianteId: sinObj.variante, cantidad: 1 }])
  const d = await deProducto(sinObj)
  assert.deepEqual([lineas(d).length, d.alDia, d.conObjetivo], [0, 0, 0])
})

test('18 · una empresa no ve ni descuenta lo de otra: sus saldos, sus órdenes y sus traslados no cuentan aquí', async () => {
  const p = await producto('Aislado')
  await objetivo(p.variante, ctx.sucA1, 10)
  // La empresa B tiene su propio producto con objetivo, orden pedida y proveedor.
  await enB((tx) => configurarObjetivoEnTx(tx, ctx.b, { varianteId: ctx.varianteB, sucursalId: ctx.sucB, llenarHasta: 50 }, como(ctx.usuario)))
  await enB(async (tx) => {
    const o = await guardarOrdenEnTx(tx, ctx.b, { cabecera: { proveedorId: ctx.proveedorB, sucursalId: ctx.sucB }, lineas: [{ varianteId: ctx.varianteB, cantidad: 9, costo: '3' }] }, como(ctx.usuario))
    await pedirOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId }, como(ctx.usuario))
  })
  const deB = await enB((tx) => reposicionEnTx(tx, ctx.b))
  const lb = lineas(deB).find((l) => l.varianteId === ctx.varianteB)!
  assert.deepEqual([lb.pedido, lb.sugerida], [9, 41], 'B ve lo suyo')
  const deA = await repos({ q: ` ${sufijo}` })
  assert.equal(lineas(deA).some((l) => l.varianteId === ctx.varianteB), false, 'A no ve el producto de B')
  assert.equal(unica(await deProducto(p)).pedido, 0)
  // La empresa A no puede fijar el objetivo de un saldo de B, ni ver el vínculo de su proveedor.
  assert.equal(await codigoDe(objetivo(ctx.varianteB, ctx.sucB, 5)), 'VARIANTE_NO_ENCONTRADA')
})

test('19 · las alertas de stock bajo SIN «llenar hasta» se cuentan aparte (no salen en la propuesta): solo con umbral, en alerta, en sucursales activas y de la sucursal pedida', async () => {
  const bajo = await producto('Alerta baja')
  const agotado = await producto('Alerta agotada')
  const sano = await producto('Alerta sana')
  const conObj = await producto('Alerta con objetivo')
  const sinUmbral = await producto('Alerta sin umbral')
  const enCerrada = await producto('Alerta en cerrada')
  await entrada(ctx.sucA1, [{ varianteId: bajo.variante, cantidad: 3 }, { varianteId: agotado.variante, cantidad: 1 }, { varianteId: sano.variante, cantidad: 50 }, { varianteId: conObj.variante, cantidad: 2 }])
  await enA((tx) => venderEnTx(tx, ctx.a, { varianteId: agotado.variante, sucursalId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario)))
  for (const x of [bajo, agotado, sano, conObj]) await umbral(x.variante, ctx.sucA1, 5)
  await objetivo(conObj.variante, ctx.sucA1, 20)
  // Un saldo agotado pero SIN umbral (el 0 de «sin aviso») y otro en una sucursal desactivada no son alertas de nadie.
  await umbral(sinUmbral.variante, ctx.sucA1, 0)
  await umbral(enCerrada.variante, ctx.sucCerrada, 5)
  const contar = async (f: FiltrosReposicion = {}) => (await repos({ q: 'Alerta', ...f })).alertasSinObjetivo
  assert.equal(await contar(), 2, 'la baja y la agotada: ni la sana, ni la que tiene objetivo, ni la que no avisa, ni la de la sucursal cerrada')
  // Por sucursal: las alertas están en Principal, no en Norte (se mira ANTES de apagar ninguna).
  assert.equal(await contar({ sucursalId: ctx.sucA1 }), 2)
  assert.equal(await contar({ sucursalId: ctx.sucA2 }), 0)
  // Quitarle el umbral a la baja la saca de las alertas; ponerle objetivo a la agotada también.
  await umbral(bajo.variante, ctx.sucA1, 0)
  assert.equal(await contar(), 1)
  await objetivo(agotado.variante, ctx.sucA1, 20)
  assert.equal(await contar(), 0)
})

test('20 · aplicar a las otras sucursales NUNCA toca la de origen, y valida aunque no haya otras donde aplicarlo', async () => {
  const p = await producto('Otras directo')
  await objetivo(p.variante, ctx.sucA1, 7)
  await objetivo(p.variante, ctx.sucA2, 7)
  const r = await enA((tx) => configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: p.variante, sucursalOrigenId: ctx.sucA1, llenarHasta: 9 }, como(ctx.usuario)))
  assert.equal(r.sucursales, 1)
  assert.deepEqual([(await nivel(p.variante, ctx.sucA1))?.targetStock, (await nivel(p.variante, ctx.sucA2))?.targetStock], [7, 9], 'la de origen se queda como estaba: esa la fija quien llama')
  // Sin otras sucursales con saldo, un valor inválido igual se rechaza (no se calla porque no había nada que hacer).
  const solo = await producto('Otras sin otras')
  await objetivo(solo.variante, ctx.sucA1, 5)
  for (const mal of [-5, 1.5, 1_000_001]) {
    assert.equal(await codigoDe(enA((tx) => configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: solo.variante, sucursalOrigenId: ctx.sucA1, llenarHasta: mal }, como(ctx.usuario)))), 'OBJETIVO_INVALIDO', String(mal))
  }
  assert.deepEqual(await enA((tx) => configurarObjetivoOtrasSucursalesEnTx(tx, ctx.a, { varianteId: solo.variante, sucursalOrigenId: ctx.sucA1, llenarHasta: 6 }, como(ctx.usuario))), { sucursales: 0 })
})

test('21 · lo cerrado como faltante en una orden abierta, y lo devuelto o perdido en una transferencia en camino, no cuentan como «por llegar» (aunque se escriba por fuera del servicio)', async () => {
  const p = await producto('Contadores')
  const prov = await proveedor('Contadora')
  await entrada(ctx.sucA2, [{ varianteId: p.variante, cantidad: 40 }])
  await objetivo(p.variante, ctx.sucA1, 50)
  // Orden pedida de 10: el servicio no cierra faltante en una orden abierta, pero la base lo admite; la propuesta tiene que leerlo.
  const o = await pedida(prov.proveedorId, ctx.sucA1, [{ varianteId: p.variante, cantidad: 10 }])
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).sugerida, 40)
  await prisma.$executeRawUnsafe(`UPDATE "inventory_purchase_order_lines" SET "quantityCancelled" = 4 WHERE "orderId" = '${o.ordenId}'`)
  assert.deepEqual([unica(await deProducto(p, { sucursalId: ctx.sucA1 })).pedido, unica(await deProducto(p, { sucursalId: ctx.sucA1 })).sugerida], [6, 44], '10 pedidas − 4 cerradas = 6 por llegar')
  // Una transferencia de 12 en camino: lo perdido y lo devuelto dejan de venir.
  const t = await enA((tx) => enviarTrasladoEnTx(tx, ctx.a, { origenId: ctx.sucA2, destinoId: ctx.sucA1, lineas: [{ varianteId: p.variante, cantidad: 12 }] }, como(ctx.usuario)))
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).enCamino, 12)
  await prisma.$executeRawUnsafe(`UPDATE "inventory_transfer_lines" SET "quantityLost" = 2 WHERE "transferId" = '${t.trasladoId}'`)
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).enCamino, 10, '12 enviadas − 2 perdidas')
  await prisma.$executeRawUnsafe(`UPDATE "inventory_transfer_lines" SET "quantityReturned" = 3 WHERE "transferId" = '${t.trasladoId}'`)
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).enCamino, 7, '12 − 2 perdidas − 3 devueltas')
  assert.equal(unica(await deProducto(p, { sucursalId: ctx.sucA1 })).sugerida, 50 - 0 - 6 - 7)
})

test('22 · si hay más saldos con objetivo de los que se leen de una vez, lo dice y no se pasa', async () => {
  const [x, y, z] = [await producto('Corte x'), await producto('Corte y'), await producto('Corte z')]
  for (const p of [x, y, z]) await objetivo(p.variante, ctx.sucA1, 10)
  const tag = ` ${sufijo}`
  const completo = await repos({ q: tag, sucursalId: ctx.sucA1 })
  assert.equal(completo.truncado, false)
  const n = completo.conObjetivo // los saldos con objetivo que se leen: los que se reponen y los que están al día
  assert.equal(n >= 3, true)
  assert.equal(lineas(completo).length + completo.alDia, n)
  const justo = await repos({ q: tag, sucursalId: ctx.sucA1 }, n)
  assert.equal(justo.truncado, false, 'exactamente el tope no es cortar')
  assert.equal(justo.conObjetivo, n)
  const corto = await repos({ q: tag, sucursalId: ctx.sucA1 }, n - 1)
  assert.equal(corto.truncado, true)
  assert.equal(corto.conObjetivo, n - 1, 'no lee más del tope')
})

test('23 · cambiar el umbral y el objetivo A LA VEZ no puede dejarlos cruzados: la regla se comprueba con el saldo bloqueado, y solo uno de los dos gana', async () => {
  for (let ronda = 0; ronda < 12; ronda++) {
    const p = await producto(`Carrera ${ronda}`)
    await entrada(ctx.sucA1, [{ varianteId: p.variante, cantidad: 1 }])
    // Desde (umbral 0, objetivo 0): umbral 8 y objetivo 6 son incompatibles entre sí; cada uno solo es válido si el otro no está.
    const r = await Promise.allSettled([umbral(p.variante, ctx.sucA1, 8), objetivo(p.variante, ctx.sucA1, 6)])
    const ganaron = r.filter((x) => x.status === 'fulfilled').length
    assert.equal(ganaron, 1, `ronda ${ronda}: ${r.map((x) => x.status).join(', ')}`)
    const n = (await nivel(p.variante, ctx.sucA1))!
    assert.equal(n.lowStockThreshold === 0 || n.targetStock === 0 || n.targetStock > n.lowStockThreshold, true, `ronda ${ronda}: quedaron cruzados (${n.lowStockThreshold}, ${n.targetStock})`)
    assert.notEqual(n.lowStockThreshold === 8 && n.targetStock === 6, true)
  }
})
