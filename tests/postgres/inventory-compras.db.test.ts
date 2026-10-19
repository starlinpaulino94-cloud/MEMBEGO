import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { InventarioError } from '../../src/modules/inventory/errores'
import { registrarEntradaMultipleEnTx } from '../../src/modules/inventory/service'
import {
  buscarProductosParaOrdenEnTx,
  ordenDeEntradaEnTx,
  ordenDetalleEnTx,
  ordenesDeLaEmpresaEnTx,
  pedidoEnCaminoDeVarianteEnTx,
  proveedorDetalleEnTx,
  proveedoresActivosEnTx,
  proveedoresDeLaEmpresaEnTx,
  proveedoresDeVarianteEnTx,
} from '../../src/modules/inventory/compras-queries'
import {
  actualizarProveedorEnTx,
  cambiarActivoProveedorEnTx,
  cancelarOrdenEnTx,
  crearProveedorEnTx,
  desvincularProveedorEnTx,
  guardarOrdenEnTx,
  pedirOrdenEnTx,
  recibirOrdenEnTx,
  vincularProveedorEnTx,
  type EntradaRecepcionOrden,
} from '../../src/modules/inventory/compras-service'

/**
 * INV-3b · PROVEEDORES Y ÓRDENES DE COMPRA contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el borrador no mueve stock ni costos, se numera sin huecos ni repeticiones aunque lleguen a la vez, y que dos
 *    envíos idénticos simultáneos crean UNA orden;
 *  · que recibir es una entrada de mercancía normal (con el costo de la línea, mueve el promedio y deja el último costo del
 *    proveedor), en una o varias tandas, sin pasarse de lo pedido y todo o nada;
 *  · que cerrar con faltante exige motivo, que cancelar tiene sus reglas, y que una recepción repetida no suma dos veces;
 *  · que recibir y cancelar a la vez, y dos recepciones cruzadas con los mismos productos en distinto orden, no se
 *    interbloquean ni descuadran;
 *  · que a lo sumo UN proveedor es el preferido de un producto, aunque dos personas lo marquen a la vez;
 *  · que la base no deja saltarse los estados, tocar lo pedido ni lo cerrado, ni mezclar empresas, aunque se escriba por fuera.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { a: '', b: '', usuario: '', sucA1: '', sucA2: '', sucCerrada: '', sucB: '', varianteB: '', servicio: '', proveedorB: '' }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

let contador = 0
/** Un producto nuevo de la empresa A (con control de inventario). Devuelve el producto y la variante. */
async function producto(nombre: string): Promise<{ item: string; variante: string }> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `CMP-${n}-${sufijo}` }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return { item: r.id, variante: v.id }
}
const variante = async (nombre: string) => (await producto(nombre)).variante

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) => prisma.company.create({ data: { name: `Compras ${x} ${sufijo}`, slug: `compras-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo' }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-cmp-${sufijo}`, email: `cmp-${sufijo}@prueba.test`, name: 'Comprador', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucCerrada = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Ajeno ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `CMP-B-${sufijo}` }, como(ctx.usuario)))
  ctx.varianteB = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
  const s = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `Lavado ${sufijo}`, type: 'SERVICE', price: 100, sku: `CMP-S-${sufijo}` }, como(ctx.usuario)))
  ctx.servicio = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: s.id }, select: { id: true } })).id
  ctx.proveedorB = (await enB((tx) => crearProveedorEnTx(tx, ctx.b, { nombre: 'Proveedor de B' }, como(ctx.usuario)))).proveedorId
})

after(async () => {
  // Lo que es de solo anexar no se borra (lo prohíbe la base). Para limpiar el rastro se desactivan los disparadores
  // ordinarios solo en esta transacción: `session_replication_role = replica` solo lo puede poner un superusuario.
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
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

type Datos = Record<string, unknown>
const proveedor = (nombre: string, extra: Datos = {}) => enA((tx) => crearProveedorEnTx(tx, ctx.a, { nombre, ...extra }, como(ctx.usuario)))
const L = (varianteId: string, cantidad: number, costo: string | null) => ({ varianteId, cantidad, costo })
const guardar = (proveedorId: string, lineas: unknown, extra: { sucursalId?: string; ordenId?: string; idempotencyKey?: string; cabecera?: Datos } = {}) =>
  enA((tx) => guardarOrdenEnTx(tx, ctx.a, { ordenId: extra.ordenId, cabecera: { proveedorId, sucursalId: extra.sucursalId ?? ctx.sucA1, ...extra.cabecera }, lineas, idempotencyKey: extra.idempotencyKey }, como(ctx.usuario)))
const pedir = (ordenId: string) => enA((tx) => pedirOrdenEnTx(tx, ctx.a, { ordenId }, como(ctx.usuario)))
const cancelar = (ordenId: string, motivo?: string) => enA((tx) => cancelarOrdenEnTx(tx, ctx.a, { ordenId, motivo }, como(ctx.usuario)))
const recibir = (ordenId: string, e: Omit<EntradaRecepcionOrden, 'ordenId'> = { todo: true }) => enA((tx) => recibirOrdenEnTx(tx, ctx.a, { ordenId, ...e }, como(ctx.usuario)))
/** Una orden ya pedida. */
async function pedida(proveedorId: string, lineas: ReturnType<typeof L>[], sucursalId?: string) {
  const o = await guardar(proveedorId, lineas, { sucursalId })
  await pedir(o.ordenId)
  return o
}
const orden = (id: string) => prisma.inventoryPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } })
const existencia = async (varianteId: string, sucursalId = ctx.sucA1) => (await prisma.inventoryLevel.findFirst({ where: { catalogVariantId: varianteId, locationId: sucursalId } }))?.onHand ?? 0
const promedio = async (varianteId: string) => (await prisma.inventoryVariantCost.findUnique({ where: { catalogVariantId_companyId: { catalogVariantId: varianteId, companyId: ctx.a } } }))?.averageCost.toFixed(4) ?? null
const vinculo = (varianteId: string, proveedorId: string) => prisma.inventoryVariantSupplier.findUnique({ where: { catalogVariantId_supplierId: { catalogVariantId: varianteId, supplierId: proveedorId } } })
const totalOrdenes = () => prisma.inventoryPurchaseOrder.count({ where: { companyId: ctx.a } })
const movimientosDe = (varianteId: string) => prisma.inventoryMovement.count({ where: { companyId: ctx.a, level: { catalogVariantId: varianteId } } })
const entradaManual = (sucursalId: string, lineas: Array<{ varianteId: string; cantidad: number; costo?: string }>) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas }, como(ctx.usuario)))

// ── Proveedores ──────────────────────────────────────────────────────────────

test('1 · un proveedor se crea con sus datos normalizados; el nombre no se repite (ni por mayúsculas) pero otra empresa puede usarlo', async () => {
  const r = await proveedor('Distribuidora Norte', { rnc: '101-00000-1', contacto: ' Ana   Pérez ', telefono: '809-555-0100', correo: 'ventas@norte.test', diasCredito: 30, notas: 'Entrega los martes' })
  const fila = await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: r.proveedorId } })
  assert.deepEqual(
    [fila.name, fila.taxId, fila.contactName, fila.phone, fila.email, fila.creditDays, fila.notes, fila.active, fila.companyId],
    ['Distribuidora Norte', '101-00000-1', 'Ana Pérez', '809-555-0100', 'ventas@norte.test', 30, 'Entrega los martes', true, ctx.a]
  )
  assert.equal(await codigoDe(proveedor('Distribuidora Norte')), 'PROVEEDOR_REPETIDO')
  assert.equal(await codigoDe(proveedor('DISTRIBUIDORA NORTE')), 'PROVEEDOR_REPETIDO', 'mayúsculas no hacen otro proveedor')
  assert.equal(await codigoDe(proveedor('  distribuidora   norte ')), 'PROVEEDOR_REPETIDO', 'ni los espacios de más')
  assert.equal(await prisma.inventorySupplier.count({ where: { companyId: ctx.a } }), 1, 'ningún rechazo dejó un proveedor a medias')
  await enB((tx) => crearProveedorEnTx(tx, ctx.b, { nombre: 'Distribuidora Norte' }, como(ctx.usuario)))
  const auditoria = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: r.proveedorId, entidadTipo: 'InventorySupplier' } })
  assert.equal(auditoria.length, 1)
  assert.equal(auditoria[0].accion, 'INVENTORY_CONFIGURED')
})

test('2 · los datos malos de un proveedor se rechazan con su código; solo el nombre es obligatorio', async () => {
  assert.equal(await codigoDe(proveedor('')), 'NOMBRE_OBLIGATORIO')
  assert.equal(await codigoDe(proveedor('   ')), 'NOMBRE_OBLIGATORIO')
  assert.equal(await codigoDe(proveedor('x'.repeat(121))), 'NOMBRE_INVALIDO')
  assert.equal(await codigoDe(proveedor('Con correo malo', { correo: 'no-es-correo' })), 'CORREO_INVALIDO')
  assert.equal(await codigoDe(proveedor('Con crédito malo', { diasCredito: 366 })), 'DIAS_CREDITO_INVALIDOS')
  assert.equal(await codigoDe(proveedor('Con crédito malo', { diasCredito: -1 })), 'DIAS_CREDITO_INVALIDOS')
  assert.equal(await codigoDe(proveedor('Con crédito malo', { diasCredito: '1.5' })), 'DIAS_CREDITO_INVALIDOS')
  assert.equal(await codigoDe(proveedor('Con notas largas', { notas: 'n'.repeat(501) })), 'NOTAS_INVALIDAS')
  const minimo = await proveedor('Solo nombre')
  const fila = await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: minimo.proveedorId } })
  assert.deepEqual([fila.creditDays, fila.taxId, fila.email], [0, null, null], 'de contado por defecto y lo demás vacío')
})

test('3 · editar un proveedor: cambia sus datos, no pisa el nombre de otro y no toca el de otra empresa', async () => {
  const x = await proveedor('Editable')
  const y = await proveedor('Otro nombre')
  await enA((tx) => actualizarProveedorEnTx(tx, ctx.a, { proveedorId: x.proveedorId, datos: { nombre: 'Editable S.R.L.', diasCredito: 15, correo: 'a@b.test' } }, como(ctx.usuario)))
  const fila = await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: x.proveedorId } })
  assert.deepEqual([fila.name, fila.creditDays, fila.email], ['Editable S.R.L.', 15, 'a@b.test'])
  assert.equal(await codigoDe(enA((tx) => actualizarProveedorEnTx(tx, ctx.a, { proveedorId: x.proveedorId, datos: { nombre: y.nombre.toUpperCase() } }, como(ctx.usuario)))), 'PROVEEDOR_REPETIDO')
  assert.equal((await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: x.proveedorId } })).name, 'Editable S.R.L.')
  // Cambiar solo el uso de mayúsculas del propio nombre es válido (es el mismo proveedor).
  await enA((tx) => actualizarProveedorEnTx(tx, ctx.a, { proveedorId: x.proveedorId, datos: { nombre: 'EDITABLE S.R.L.' } }, como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => actualizarProveedorEnTx(tx, ctx.a, { proveedorId: ctx.proveedorB, datos: { nombre: 'Robado' } }, como(ctx.usuario)))), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal(await codigoDe(enA((tx) => actualizarProveedorEnTx(tx, ctx.a, { proveedorId: 'no-existe', datos: { nombre: 'Nada' } }, como(ctx.usuario)))), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal((await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: ctx.proveedorB } })).name, 'Proveedor de B')
})

test('4 · desactivar un proveedor: no recibe pedidos nuevos, repetirlo no hace nada, y se puede reactivar', async () => {
  const x = await proveedor('Intermitente')
  const p = await variante('Cuaderno')
  const desactivar = (activo: boolean, id = x.proveedorId) => enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: id, activo }, como(ctx.usuario)))
  assert.deepEqual((await desactivar(false)).cambiado, true)
  assert.equal((await desactivar(false)).cambiado, false, 'repetir no cambia nada')
  assert.equal(await codigoDe(guardar(x.proveedorId, [L(p, 1, '1')])), 'PROVEEDOR_INACTIVO')
  assert.equal(await codigoDe(enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: x.proveedorId, datos: {} }, como(ctx.usuario)))), 'PROVEEDOR_INACTIVO', 'tampoco se le agregan productos nuevos')
  assert.equal((await desactivar(true)).cambiado, true)
  await guardar(x.proveedorId, [L(p, 1, '1')])
  assert.equal(await codigoDe(desactivar(false, ctx.proveedorB)), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal((await prisma.inventorySupplier.findUniqueOrThrow({ where: { id: ctx.proveedorB } })).active, true)
})

// ── Borrador ─────────────────────────────────────────────────────────────────

test('5 · un borrador se numera, guarda sus líneas con costo y NO mueve stock, costos ni vínculos', async () => {
  const s = await proveedor('Mayorista')
  const [p1, p2] = [await variante('Arroz'), await variante('Habichuela')]
  const o = await guardar(s.proveedorId, [L(p1, 10, '5'), L(p2, 4, ' 12.5 ')], { cabecera: { referencia: ' Cotización   7 ', nota: 'Urgente', fechaPrevista: '2099-03-04' } })
  assert.match(o.numero, /^OC-\d{4}-\d{6}$/)
  assert.deepEqual([o.lineas, o.unidades, o.valor, o.repetido], [2, 14, '100.00', false])
  const fila = await orden(o.ordenId)
  assert.deepEqual(
    [fila.status, fila.orderedAt, fila.closedAt, fila.lineCount, fila.reference, fila.note, fila.createdById, fila.supplierId, fila.locationId, fila.orderedUnits],
    ['DRAFT', null, null, 2, 'Cotización 7', 'Urgente', ctx.usuario, s.proveedorId, ctx.sucA1, null]
  )
  assert.equal(fila.expectedAt?.toISOString(), '2099-03-04T00:00:00.000Z')
  assert.deepEqual(
    fila.lines.map((l) => [l.catalogVariantId, l.position, l.quantityOrdered, l.quantityReceived, l.quantityCancelled, l.unitCost.toFixed(4)]),
    [
      [p1, 0, 10, 0, 0, '5.0000'],
      [p2, 1, 4, 0, 0, '12.5000'],
    ]
  )
  for (const p of [p1, p2]) {
    assert.equal(await movimientosDe(p), 0, 'un borrador no mueve el ledger')
    assert.equal(await existencia(p), 0)
    assert.equal(await promedio(p), null, 'ni crea costo promedio')
    assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p } }), 0, 'ni vincula al proveedor')
  }
  const auditoria = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: o.ordenId, entidadTipo: 'InventoryPurchaseOrder' } })
  assert.equal(auditoria.length, 1)
  assert.equal((auditoria[0].payload as Record<string, unknown>).tipo, 'ORDEN_CREADA')
})

test('6 · lo que no es una orden válida se rechaza antes de tocar nada y no gasta un número', async () => {
  const s = await proveedor('Estricto')
  const inactivo = await proveedor('Inactivo')
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: inactivo.proveedorId, activo: false }, como(ctx.usuario)))
  const p = await variante('Lapicero')
  const base = await guardar(s.proveedorId, [L(p, 1, '1')])
  const antes = await totalOrdenes()
  const cod = (lineas: unknown, extra: Parameters<typeof guardar>[2] = {}, prov = s.proveedorId) => codigoDe(guardar(prov, lineas, extra))
  assert.equal(await cod([]), 'ORDEN_SIN_LINEAS')
  assert.equal(await cod(undefined), 'ORDEN_SIN_LINEAS')
  assert.equal(await cod([{ varianteId: p, cantidad: 5 }]), 'COSTO_OBLIGATORIO', 'una orden dice cuánto cuesta cada producto')
  assert.equal(await cod([L(p, 5, '')]), 'COSTO_OBLIGATORIO')
  assert.equal(await cod([L(p, 5, '1,5')]), 'COSTO_INVALIDO')
  assert.equal(await cod([L(p, 5, '-1')]), 'COSTO_INVALIDO')
  assert.equal(await cod([L(p, 0, '1')]), 'CANTIDAD_INVALIDA')
  assert.equal(await cod([L(p, 1.5, '1')]), 'CANTIDAD_INVALIDA')
  assert.equal(await cod([L(p, 1_000_001, '1')]), 'CANTIDAD_INVALIDA')
  assert.equal(await cod([L(p, 1, '1'), L(p, 2, '1')]), 'LINEA_REPETIDA')
  assert.equal(await cod([L(ctx.varianteB, 1, '1')]), 'VARIANTE_NO_ENCONTRADA', 'un producto de otra empresa')
  assert.equal(await cod([L('no-existe', 1, '1')]), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await cod([L(ctx.servicio, 1, '1')]), 'SIN_CONTROL_DE_INVENTARIO', 'un servicio no se pide a un proveedor')
  assert.equal(await cod(Array.from({ length: 201 }, (_, i) => L(`v${i}`, 1, '1'))), 'DEMASIADAS_LINEAS')
  assert.equal(await cod([L(p, 1, '1')], { sucursalId: ctx.sucB }), 'SUCURSAL_NO_ENCONTRADA')
  assert.equal(await cod([L(p, 1, '1')], { sucursalId: ctx.sucCerrada }), 'SUCURSAL_INACTIVA')
  assert.equal(await cod([L(p, 1, '1')], { cabecera: { nota: 'n'.repeat(501) } }), 'NOTA_INVALIDA')
  assert.equal(await cod([L(p, 1, '1')], { cabecera: { referencia: 'r'.repeat(121) } }), 'REFERENCIA_INVALIDA')
  assert.equal(await cod([L(p, 1, '1')], { cabecera: { fechaPrevista: '2099-02-31' } }), 'FECHA_INVALIDA')
  assert.equal(await cod([L(p, 1, '1')], { cabecera: { fechaPrevista: 'mañana' } }), 'FECHA_INVALIDA')
  assert.equal(await cod([L(p, 1, '1')], {}, ctx.proveedorB), 'PROVEEDOR_NO_ENCONTRADO', 'el proveedor de otra empresa')
  assert.equal(await cod([L(p, 1, '1')], {}, 'no-existe'), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal(await cod([L(p, 1, '1')], {}, inactivo.proveedorId), 'PROVEEDOR_INACTIVO')
  assert.equal(await cod([L(p, 1, '1')], {}, ''), 'PROVEEDOR_OBLIGATORIO')
  assert.equal(await totalOrdenes(), antes, 'ningún rechazo dejó una orden')
  const siguiente = await guardar(s.proveedorId, [L(p, 1, '1')])
  assert.equal(Number(siguiente.numero.slice(-6)), Number(base.numero.slice(-6)) + 1, 'los rechazos no consumieron números')
})

test('7 · editar el borrador reemplaza sus líneas y conserva el número; ya pedida o cancelada no se edita; la de otra empresa no existe', async () => {
  const s = await proveedor('Cambiante')
  const s2 = await proveedor('Cambiante 2')
  const [p1, p2, p3] = [await variante('E1'), await variante('E2'), await variante('E3')]
  const o = await guardar(s.proveedorId, [L(p1, 10, '5'), L(p2, 4, '2')])
  const e = await guardar(s2.proveedorId, [L(p3, 7, '3.25'), L(p1, 1, '9'), L(p2, 2, '1')], { ordenId: o.ordenId, sucursalId: ctx.sucA2, cabecera: { nota: 'Cambió todo', referencia: 'Cot nueva', fechaPrevista: '2031-01-02' } })
  assert.deepEqual([e.ordenId, e.numero, e.lineas, e.unidades, e.valor], [o.ordenId, o.numero, 3, 10, '33.75'])
  const fila = await orden(o.ordenId)
  assert.deepEqual([fila.supplierId, fila.locationId, fila.note, fila.reference, fila.lineCount, fila.status], [s2.proveedorId, ctx.sucA2, 'Cambió todo', 'Cot nueva', 3, 'DRAFT'])
  assert.equal(fila.expectedAt?.toISOString(), '2031-01-02T00:00:00.000Z')
  assert.deepEqual(
    fila.lines.map((l) => [l.catalogVariantId, l.position, l.quantityOrdered, l.unitCost.toFixed(4)]),
    [
      [p3, 0, 7, '3.2500'],
      [p1, 1, 1, '9.0000'],
      [p2, 2, 2, '1.0000'],
    ]
  )
  assert.equal(await prisma.inventoryPurchaseOrderLine.count({ where: { orderId: o.ordenId } }), 3, 'las viejas no quedaron')
  const rastro = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: o.ordenId, entidadTipo: 'InventoryPurchaseOrder' }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(rastro.map((r) => (r.payload as Record<string, unknown>).tipo), ['ORDEN_CREADA', 'ORDEN_EDITADA'], 'editar deja su rastro')
  // Un edit inválido no toca el borrador.
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p1, 0, '1')], { ordenId: o.ordenId })), 'CANTIDAD_INVALIDA')
  assert.equal((await orden(o.ordenId)).lines.length, 3)
  // Otra empresa, inexistente, ya pedida, cancelada.
  assert.equal(await codigoDe(enB((tx) => guardarOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId, cabecera: { proveedorId: ctx.proveedorB, sucursalId: ctx.sucB }, lineas: [L(ctx.varianteB, 1, '1')] }, como(ctx.usuario)))), 'ORDEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p1, 1, '1')], { ordenId: 'no-existe' })), 'ORDEN_NO_ENCONTRADA')
  await pedir(o.ordenId)
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p1, 1, '1')], { ordenId: o.ordenId })), 'ORDEN_YA_PEDIDA')
  const c = await guardar(s.proveedorId, [L(p1, 1, '1')])
  await cancelar(c.ordenId)
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p1, 2, '1')], { ordenId: c.ordenId })), 'ORDEN_CERRADA')
  assert.equal((await orden(o.ordenId)).lines.length, 3, 'lo pedido no cambió')
})

test('8 · el mismo envío, aunque llegue 8 veces a la vez, crea UNA orden; con otro contenido se rechaza', async () => {
  const s = await proveedor('Repetido')
  const p = await variante('Idem')
  const clave = `idem-${sufijo}`
  const antes = await totalOrdenes()
  const rs = await Promise.all(Array.from({ length: 8 }, () => guardar(s.proveedorId, [L(p, 3, '4')], { idempotencyKey: clave })))
  assert.equal(new Set(rs.map((r) => r.ordenId)).size, 1, 'todas devuelven la misma orden')
  assert.equal(rs.filter((r) => !r.repetido).length, 1, 'solo una la creó')
  assert.equal(await totalOrdenes(), antes + 1)
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 4, '4')], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'otra cantidad')
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 3, '5')], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'otro costo')
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 3, '4')], { idempotencyKey: clave, sucursalId: ctx.sucA2 })), 'CLAVE_REUTILIZADA', 'otra sucursal')
  const otroProveedor = await proveedor('Repetido otro')
  assert.equal(await codigoDe(guardar(otroProveedor.proveedorId, [L(p, 3, '4')], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'otro proveedor')
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 3, '4'), L(await variante('Idem extra'), 1, '1')], { idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'una línea más')
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 3, '4')], { idempotencyKey: 'k'.repeat(121) })), 'CLAVE_INVALIDA', 'una clave demasiado larga')
  // Menos líneas que las de la orden guardada tampoco es el mismo envío.
  const q = await variante('Idem segundo')
  const dos = await guardar(s.proveedorId, [L(p, 1, '1'), L(q, 2, '2')], { idempotencyKey: `${clave}-dos` })
  assert.equal(await codigoDe(guardar(s.proveedorId, [L(p, 1, '1')], { idempotencyKey: `${clave}-dos` })), 'CLAVE_REUTILIZADA', 'una línea menos')
  assert.equal((await guardar(s.proveedorId, [L(q, 2, '2'), L(p, 1, '1')], { idempotencyKey: `${clave}-dos` })).ordenId, dos.ordenId, 'las mismas líneas en otro orden sí son el mismo envío')
  assert.equal(await totalOrdenes(), antes + 2, 'la de las 8 simultáneas y la de dos líneas: ningún rechazo dejó otra')
})

test('9 · seis órdenes a la vez se numeran sin repetir ni dejar huecos', async () => {
  const s = await proveedor('Numerado')
  const p = await variante('Num')
  const rs = await Promise.all(Array.from({ length: 6 }, () => guardar(s.proveedorId, [L(p, 1, '1')])))
  const nums = rs.map((r) => Number(r.numero.slice(-6))).sort((x, y) => x - y)
  assert.equal(new Set(nums).size, 6)
  assert.equal(nums[5] - nums[0], 5, 'consecutivos')
})

// ── Pedir ────────────────────────────────────────────────────────────────────

test('10 · pedir congela lo pedido; pedir dos veces no hace nada nuevo; lo que dejó de ser válido no se pide', async () => {
  const s = await proveedor('Pedidor')
  const [p1, p2] = [await variante('P1'), await variante('P2')]
  const o = await guardar(s.proveedorId, [L(p1, 10, '5'), L(p2, 3, '2')])
  const r = await pedir(o.ordenId)
  assert.deepEqual([r.estado, r.unidades, r.valor, r.repetido], ['ORDERED', 13, '56.00', false])
  const fila = await orden(o.ordenId)
  assert.deepEqual([fila.status, fila.orderedUnits, fila.orderedById, fila.receivedUnits, fila.shortUnits], ['ORDERED', 13, ctx.usuario, null, null])
  assert.ok(fila.orderedAt)
  const otra = await pedir(o.ordenId)
  assert.deepEqual([otra.estado, otra.repetido], ['ORDERED', true])
  assert.equal((await orden(o.ordenId)).orderedAt?.getTime(), fila.orderedAt?.getTime(), 'la fecha de pedido no se pisa')
  assert.equal(await movimientosDe(p1), 0, 'pedir no mueve stock')
  assert.equal(await codigoDe(pedir('no-existe')), 'ORDEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => pedirOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId }, como(ctx.usuario)))), 'ORDEN_NO_ENCONTRADA')
  // Un borrador sin líneas solo existe si alguien lo escribió por fuera del servicio: no se pide.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "inventory_purchase_orders" ("id","companyId","number","supplierId","locationId") VALUES ('x-vacio-${sufijo}','${ctx.a}','OC-2098-000001','${s.proveedorId}','${ctx.sucA1}')`
  )
  try {
    assert.equal(await codigoDe(pedir(`x-vacio-${sufijo}`)), 'ORDEN_SIN_LINEAS')
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_purchase_orders" WHERE "id" = 'x-vacio-${sufijo}'`)
    })
  }

  // Un proveedor desactivado, o un producto que dejó de controlar inventario, entre guardar y pedir.
  const s2 = await proveedor('Se apaga')
  const q = await producto('Se apaga el control')
  const c = await guardar(s2.proveedorId, [L(q.variante, 1, '1')])
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: s2.proveedorId, activo: false }, como(ctx.usuario)))
  assert.equal(await codigoDe(pedir(c.ordenId)), 'PROVEEDOR_INACTIVO')
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: s2.proveedorId, activo: true }, como(ctx.usuario)))
  await prisma.catalogItem.update({ where: { id: q.item }, data: { capabilities: { trackInventory: false } } })
  assert.equal(await codigoDe(pedir(c.ordenId)), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal((await orden(c.ordenId)).status, 'DRAFT', 'seguía borrador')
  await cancelar(c.ordenId)
  assert.equal(await codigoDe(pedir(c.ordenId)), 'ORDEN_CERRADA')
})

// ── Recibir ──────────────────────────────────────────────────────────────────

test('11 · recibir en tandas: cada tanda es una entrada con el costo de la línea; mueve el promedio, deja el último costo del proveedor y el estado avanza', async () => {
  const s = await proveedor('Surtidor')
  const [p1, p2, p3] = [await variante('R1'), await variante('R2'), await variante('R3')]
  const o = await pedida(s.proveedorId, [L(p1, 10, '5'), L(p2, 20, '3'), L(p3, 5, '100')])

  const t1 = await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 4 }, { varianteId: p2, cantidad: 20 }], referencia: ' FAC-1 ', nota: 'Primera tanda' })
  assert.deepEqual([t1.estado, t1.recibidas, t1.cerradas, t1.pendientes, t1.repetido], ['PARTIAL', 24, 0, 11, false])
  assert.match(t1.entradaNumero ?? '', /^ENT-\d{4}-\d{6}$/)
  const e1 = await prisma.inventoryReceipt.findUniqueOrThrow({ where: { id: t1.entradaId! }, include: { lines: { orderBy: { position: 'asc' } } } })
  assert.deepEqual([e1.purchaseOrderId, e1.reference, e1.note, e1.locationId, e1.unitCount, e1.source], [o.ordenId, 'FAC-1', 'Primera tanda', ctx.sucA1, 24, 'MANUAL'])
  assert.deepEqual(e1.lines.map((l) => [l.catalogVariantId, l.quantity, l.unitCost?.toFixed(4)]), [[p1, 4, '5.0000'], [p2, 20, '3.0000']])
  assert.deepEqual([await existencia(p1), await existencia(p2), await existencia(p3)], [4, 20, 0])
  assert.deepEqual([await promedio(p1), await promedio(p2), await promedio(p3)], ['5.0000', '3.0000', null])
  const mov = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId: ctx.a, level: { catalogVariantId: p1 }, type: 'PURCHASE' } })
  assert.equal(mov.unitCost?.toFixed(4), '5.0000')
  const enc = await orden(o.ordenId)
  assert.deepEqual([enc.status, enc.receivedUnits, enc.closedAt], ['PARTIAL', null, null])
  assert.deepEqual(enc.lines.map((l) => [l.quantityReceived, l.quantityCancelled]), [[4, 0], [20, 0], [0, 0]])
  const v1 = await vinculo(p1, s.proveedorId)
  assert.equal(v1?.lastCost?.toFixed(4), '5.0000', 'la recepción vincula al proveedor y guarda su último costo')
  assert.ok(v1?.lastCostAt)
  assert.equal(v1?.preferred, false)
  assert.equal(await vinculo(p3, s.proveedorId), null, 'lo que no llegó no se vincula')

  const t2 = await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 6 }, { varianteId: p3, cantidad: 5 }] })
  assert.deepEqual([t2.estado, t2.recibidas, t2.pendientes], ['RECEIVED', 11, 0])
  const fin = await orden(o.ordenId)
  assert.deepEqual([fin.status, fin.receivedUnits, fin.shortUnits, fin.closeReason, fin.orderedUnits], ['RECEIVED', 35, 0, null, 35])
  assert.ok(fin.closedAt)
  assert.equal(fin.closedById, ctx.usuario)
  assert.deepEqual(fin.lines.map((l) => [l.quantityReceived, l.quantityCancelled]), [[10, 0], [20, 0], [5, 0]])
  assert.deepEqual([await existencia(p1), await existencia(p3), await promedio(p1), await promedio(p3)], [10, 5, '5.0000', '100.0000'])
  assert.equal(await prisma.inventoryReceipt.count({ where: { purchaseOrderId: o.ordenId } }), 2, 'una entrada por tanda')
  assert.equal(await codigoDe(recibir(o.ordenId)), 'ORDEN_CERRADA')
  assert.equal(await codigoDe(cancelar(o.ordenId, 'tarde')), 'ORDEN_CERRADA')
})

test('12 · el costo de la orden se pondera con lo que ya había: 10 a 4 + 10 recibidas a 6 = promedio 5; el último costo del proveedor es el de la orden', async () => {
  const s = await proveedor('Ponderador')
  const p = await variante('Pond')
  await entradaManual(ctx.sucA1, [{ varianteId: p, cantidad: 10, costo: '4' }])
  assert.equal(await promedio(p), '4.0000')
  const o = await pedida(s.proveedorId, [L(p, 10, '6')])
  await recibir(o.ordenId)
  assert.equal(await promedio(p), '5.0000')
  assert.equal((await vinculo(p, s.proveedorId))?.lastCost?.toFixed(4), '6.0000')
  // Una segunda orden de otro proveedor a otro precio: cada vínculo guarda SU último costo; el promedio es de la empresa.
  const s2 = await proveedor('Competidor')
  const o2 = await pedida(s2.proveedorId, [L(p, 20, '10')])
  await recibir(o2.ordenId)
  assert.equal(await promedio(p), '7.5000', '20 a 5 + 20 a 10')
})

test('13 · no se recibe más de lo pedido, ni un producto ajeno, ni nada de nada; un borrador no se recibe', async () => {
  const s = await proveedor('Estricto 2')
  const [p1, p2, otro] = [await variante('C1'), await variante('C2'), await variante('Ajeno de la orden')]
  const o = await pedida(s.proveedorId, [L(p1, 5, '2'), L(p2, 3, '2')])
  const antes = await existencia(p1)
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 6 }] })), 'RECIBE_MAS_DE_LO_PEDIDO')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: otro, cantidad: 1 }] })), 'LINEA_AJENA')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 1 }, { varianteId: p1, cantidad: 1 }] })), 'LINEA_REPETIDA')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 0 }] })), 'SIN_CANTIDADES', 'recibir cero es no recibir')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [] })), 'SIN_CANTIDADES')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: -1 }] })), 'CANTIDAD_INVALIDA')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 1.5 }] })), 'CANTIDAD_INVALIDA')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 1 }], referencia: 'r'.repeat(121) })), 'REFERENCIA_INVALIDA')
  assert.equal(await existencia(p1), antes, 'ningún rechazo movió stock')
  assert.equal(await prisma.inventoryReceipt.count({ where: { purchaseOrderId: o.ordenId } }), 0)
  // Una parte y luego intentar pasarse de lo que falta.
  await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 3 }] })
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 3 }] })), 'RECIBE_MAS_DE_LO_PEDIDO', 'solo faltan 2')
  await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 2 }] })
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 1 }] })), 'RECIBE_MAS_DE_LO_PEDIDO', 'ese producto ya llegó completo')
  // Un borrador, otra empresa, inexistente.
  const b = await guardar(s.proveedorId, [L(p1, 1, '1')])
  assert.equal(await codigoDe(recibir(b.ordenId)), 'ORDEN_SIN_PEDIR')
  assert.equal(await codigoDe(enB((tx) => recibirOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId, todo: true }, como(ctx.usuario)))), 'ORDEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(recibir('no-existe')), 'ORDEN_NO_ENCONTRADA')
})

test('14 · cerrar con faltante: exige motivo, no se puede si no llegó nada, y deja lo que no llegó en cada línea', async () => {
  const s = await proveedor('Faltante')
  const [p1, p2] = [await variante('F1'), await variante('F2')]
  const o = await pedida(s.proveedorId, [L(p1, 10, '1'), L(p2, 10, '1')])
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [], cerrarConFaltante: true, motivo: 'No llegó' })), 'NADA_RECIBIDO', 'si no llegó nada, se cancela')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 4 }], cerrarConFaltante: true })), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 4 }], cerrarConFaltante: true, motivo: '   ' })), 'MOTIVO_OBLIGATORIO')
  assert.equal(await existencia(p1), 0, 'sin motivo no entró NADA')
  assert.equal((await orden(o.ordenId)).status, 'ORDERED')

  const r = await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 4 }], cerrarConFaltante: true, motivo: ' El proveedor se quedó sin existencias ' })
  assert.deepEqual([r.estado, r.recibidas, r.cerradas, r.pendientes], ['RECEIVED', 4, 16, 0])
  const fin = await orden(o.ordenId)
  assert.deepEqual([fin.status, fin.receivedUnits, fin.shortUnits, fin.closeReason, fin.orderedUnits], ['RECEIVED', 4, 16, 'El proveedor se quedó sin existencias', 20])
  assert.deepEqual(fin.lines.map((l) => [l.quantityReceived, l.quantityCancelled]), [[4, 6], [0, 10]])
  assert.equal(await existencia(p1), 4)
  assert.equal(await existencia(p2), 0)
  assert.equal(await codigoDe(recibir(o.ordenId)), 'ORDEN_CERRADA')
})

test('15 · una orden recibida en parte se cierra con faltante SIN otra entrada; recibir todo lo que faltaba la cierra sola sin pedir motivo', async () => {
  const s = await proveedor('Faltante 2')
  const [p1, p2] = [await variante('G1'), await variante('G2')]
  const o = await pedida(s.proveedorId, [L(p1, 10, '2'), L(p2, 6, '2')])
  await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 4 }] })
  const entradasAntes = await prisma.inventoryReceipt.count({ where: { companyId: ctx.a } })
  const r = await recibir(o.ordenId, { lineas: [], cerrarConFaltante: true, motivo: 'Ya no lo van a mandar' })
  assert.deepEqual([r.estado, r.recibidas, r.cerradas, r.entradaId, r.entradaNumero], ['RECEIVED', 0, 12, null, null])
  assert.equal(await prisma.inventoryReceipt.count({ where: { companyId: ctx.a } }), entradasAntes, 'cerrar el faltante no crea una entrada')
  const fin = await orden(o.ordenId)
  assert.deepEqual([fin.status, fin.receivedUnits, fin.shortUnits, fin.closeReason], ['RECEIVED', 4, 12, 'Ya no lo van a mandar'])
  assert.deepEqual(fin.lines.map((l) => [l.quantityReceived, l.quantityCancelled]), [[4, 6], [0, 6]])

  const o2 = await pedida(s.proveedorId, [L(p1, 3, '2')])
  await recibir(o2.ordenId, { lineas: [{ varianteId: p1, cantidad: 1 }] })
  const r2 = await recibir(o2.ordenId, { todo: true, cerrarConFaltante: true, motivo: 'Por si acaso' })
  assert.deepEqual([r2.estado, r2.recibidas, r2.cerradas], ['RECEIVED', 2, 0])
  assert.equal((await orden(o2.ordenId)).closeReason, null, 'no faltó nada: el motivo que sobró no se guarda')
})

test('16 · «todo»: recibe lo que falte de cada línea, también después de una parte', async () => {
  const s = await proveedor('Todo')
  const [p1, p2] = [await variante('T1'), await variante('T2')]
  const o = await pedida(s.proveedorId, [L(p1, 7, '3'), L(p2, 2, '3')])
  await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 3 }] })
  const r = await recibir(o.ordenId, { todo: true })
  assert.deepEqual([r.estado, r.recibidas, r.pendientes], ['RECEIVED', 6, 0])
  assert.deepEqual([await existencia(p1), await existencia(p2)], [7, 2])
})

test('17 · la misma recepción (misma clave) no suma dos veces, aunque llegue 6 veces a la vez o la orden ya esté cerrada; con otras cantidades u otra orden se rechaza', async () => {
  const s = await proveedor('Reintento')
  const p = await variante('Idem 2')
  const o = await pedida(s.proveedorId, [L(p, 100, '2')])
  const clave = `rec-${sufijo}`
  const rs = await Promise.all(Array.from({ length: 6 }, () => recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 10 }], idempotencyKey: clave })))
  assert.equal(rs.filter((r) => !r.repetido).length, 1)
  assert.equal(new Set(rs.map((r) => r.entradaId)).size, 1)
  assert.equal(await existencia(p), 10, 'entró UNA vez')
  assert.equal(await prisma.inventoryReceipt.count({ where: { purchaseOrderId: o.ordenId } }), 1)
  assert.equal(await codigoDe(recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 11 }], idempotencyKey: clave })), 'CLAVE_REUTILIZADA')
  const otra = await pedida(s.proveedorId, [L(p, 100, '2')])
  assert.equal(await codigoDe(recibir(otra.ordenId, { lineas: [{ varianteId: p, cantidad: 10 }], idempotencyKey: clave })), 'CLAVE_REUTILIZADA', 'esa clave es de otra orden')
  assert.equal(await existencia(p), 10)

  // Aunque la orden ya se haya cerrado, repetir la última recepción devuelve lo hecho.
  const o2 = await pedida(s.proveedorId, [L(p, 5, '2')])
  const k2 = `rec2-${sufijo}`
  const primera = await recibir(o2.ordenId, { todo: true, idempotencyKey: k2 })
  assert.equal(primera.estado, 'RECEIVED')
  const eco = await recibir(o2.ordenId, { todo: true, idempotencyKey: k2 })
  assert.deepEqual([eco.repetido, eco.estado, eco.entradaId], [true, 'RECEIVED', primera.entradaId])
  assert.equal(await existencia(p), 15)
  // Una clave de una entrada manual (sin orden) tampoco es de esta recepción.
  const kManual = `man-${sufijo}`
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.sucA1, lineas: [{ varianteId: p, cantidad: 1 }], idempotencyKey: kManual }, como(ctx.usuario)))
  assert.equal(await codigoDe(recibir(otra.ordenId, { lineas: [{ varianteId: p, cantidad: 1 }], idempotencyKey: kManual })), 'CLAVE_REUTILIZADA')
})

test('18 · cinco recepciones simultáneas de 20 sobre 90 pendientes: ganan cuatro, la quinta se rechaza, y lo recibido nunca pasa de lo pedido', async () => {
  const s = await proveedor('Carrera')
  const p = await variante('Carrera')
  const o = await pedida(s.proveedorId, [L(p, 90, '2')])
  const rs = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 20 }], idempotencyKey: `carrera-${i}-${sufijo}` })))
  const ok = rs.filter((r) => r.status === 'fulfilled')
  const mal = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  assert.equal(ok.length, 4)
  assert.equal(mal.length, 1)
  assert.ok(mal[0].reason instanceof InventarioError)
  assert.equal(mal[0].reason.codigo, 'RECIBE_MAS_DE_LO_PEDIDO')
  assert.equal(await existencia(p), 80)
  const fila = await orden(o.ordenId)
  assert.deepEqual([fila.status, fila.lines[0].quantityReceived], ['PARTIAL', 80])
  const r = await recibir(o.ordenId, { todo: true })
  assert.deepEqual([r.estado, r.recibidas], ['RECEIVED', 10])
  assert.equal(await existencia(p), 90)
})

test('19 · TODO O NADA: si la entrada falla, ni el stock, ni los contadores de la orden, ni su estado, ni el vínculo cambian', async () => {
  const s = await proveedor('Todo o nada')
  const [bueno, malo] = [await producto('Bueno'), await producto('Malo')]
  const o = await pedida(s.proveedorId, [L(bueno.variante, 5, '2'), L(malo.variante, 5, '2')])
  await prisma.catalogItem.update({ where: { id: malo.item }, data: { capabilities: { trackInventory: false } } })
  assert.equal(await codigoDe(recibir(o.ordenId, { todo: true })), 'SIN_CONTROL_DE_INVENTARIO')
  assert.equal(await existencia(bueno.variante), 0)
  assert.equal(await promedio(bueno.variante), null)
  assert.equal(await vinculo(bueno.variante, s.proveedorId), null)
  const fila = await orden(o.ordenId)
  assert.deepEqual([fila.status, ...fila.lines.map((l) => l.quantityReceived)], ['ORDERED', 0, 0])
  assert.equal(await prisma.inventoryReceipt.count({ where: { purchaseOrderId: o.ordenId } }), 0)
  // Lo que sí se puede recibir, se recibe.
  const r = await recibir(o.ordenId, { lineas: [{ varianteId: bueno.variante, cantidad: 5 }] })
  assert.equal(r.estado, 'PARTIAL')
  assert.equal(await existencia(bueno.variante), 5)
})

test('20 · la sucursal desactivada no recibe (y el mensaje dice qué hacer), pero sí se puede cerrar lo que falta', async () => {
  const s = await proveedor('Sucursal cerrada')
  const p = await variante('Cierre')
  const suc = await prisma.sucursal.create({ data: { companyId: ctx.a, nombre: `Temporal ${sufijo}`, activa: true }, select: { id: true } })
  const o = await pedida(s.proveedorId, [L(p, 10, '2')], suc.id)
  await recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 3 }] })
  await prisma.sucursal.update({ where: { id: suc.id }, data: { activa: false } })
  try {
    await recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 3 }] })
    assert.fail('debía rechazarse')
  } catch (e) {
    assert.ok(e instanceof InventarioError)
    assert.equal(e.codigo, 'SUCURSAL_INACTIVA')
    assert.match(e.message, /Actívala|ciérrala con faltante/i)
  }
  assert.equal(await existencia(p, suc.id), 3)
  const r = await recibir(o.ordenId, { lineas: [], cerrarConFaltante: true, motivo: 'La sucursal cerró' })
  assert.deepEqual([r.estado, r.cerradas], ['RECEIVED', 7])
})

test('21 · dos órdenes con los mismos productos en distinto orden, recibidas a la vez, no se interbloquean y el promedio es el exacto', async () => {
  const [s1, s2] = [await proveedor('Cruce 1'), await proveedor('Cruce 2')]
  const [pa, pb] = [await variante('CruceA'), await variante('CruceB')]
  const o1 = await pedida(s1.proveedorId, [L(pa, 10, '2'), L(pb, 10, '4')])
  const o2 = await pedida(s2.proveedorId, [L(pb, 10, '8'), L(pa, 10, '6')])
  const [r1, r2] = await Promise.all([recibir(o1.ordenId), recibir(o2.ordenId)])
  assert.deepEqual([r1.estado, r2.estado], ['RECEIVED', 'RECEIVED'])
  assert.deepEqual([await existencia(pa), await existencia(pb)], [20, 20])
  assert.deepEqual([await promedio(pa), await promedio(pb)], ['4.0000', '6.0000'])
  assert.equal((await vinculo(pa, s1.proveedorId))?.lastCost?.toFixed(4), '2.0000')
  assert.equal((await vinculo(pa, s2.proveedorId))?.lastCost?.toFixed(4), '6.0000')
})

test('22 · recibir y cancelar a la vez: o llega o se cancela, nunca las dos cosas', async () => {
  const s = await proveedor('Recibe o cancela')
  const p = await variante('RoC')
  for (let i = 0; i < 4; i++) {
    const o = await pedida(s.proveedorId, [L(p, 5, '2')])
    const antes = await existencia(p)
    const [rec, can] = await Promise.allSettled([recibir(o.ordenId), cancelar(o.ordenId, 'Cambio de planes')])
    const fila = await orden(o.ordenId)
    if (rec.status === 'fulfilled') {
      assert.equal(fila.status, 'RECEIVED', 'ganó la recepción')
      assert.equal(can.status, 'rejected')
      assert.equal(await existencia(p), antes + 5)
    } else {
      assert.equal(fila.status, 'CANCELLED', 'ganó la cancelación')
      assert.equal(can.status, 'fulfilled')
      assert.equal(await existencia(p), antes, 'cancelada no entró nada')
    }
  }
})

// ── Cancelar ─────────────────────────────────────────────────────────────────

test('23 · cancelar: un borrador se descarta sin motivo; una orden pedida pide motivo y cierra todo como faltante; repetir no hace nada', async () => {
  const s = await proveedor('Cancelador')
  const [p1, p2] = [await variante('X1'), await variante('X2')]
  const b = await guardar(s.proveedorId, [L(p1, 3, '2')])
  const rb = await cancelar(b.ordenId)
  assert.equal(rb.repetido, false)
  const fb = await orden(b.ordenId)
  assert.deepEqual([fb.status, fb.closeReason, fb.orderedAt, fb.receivedUnits, fb.shortUnits], ['CANCELLED', null, null, null, null])
  assert.ok(fb.closedAt)
  assert.deepEqual((await cancelar(b.ordenId)).repetido, true)

  const o = await pedida(s.proveedorId, [L(p1, 3, '2'), L(p2, 4, '2')])
  assert.equal(await codigoDe(cancelar(o.ordenId)), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(cancelar(o.ordenId, '   ')), 'MOTIVO_OBLIGATORIO')
  assert.equal(await codigoDe(cancelar(o.ordenId, 'm'.repeat(301))), 'MOTIVO_INVALIDO')
  assert.equal((await orden(o.ordenId)).status, 'ORDERED')
  await cancelar(o.ordenId, ' Ya no lo necesitamos ')
  const fo = await orden(o.ordenId)
  assert.deepEqual([fo.status, fo.closeReason, fo.receivedUnits, fo.shortUnits, fo.orderedUnits], ['CANCELLED', 'Ya no lo necesitamos', 0, 7, 7])
  assert.deepEqual(fo.lines.map((l) => [l.quantityReceived, l.quantityCancelled]), [[0, 3], [0, 4]])
  assert.equal(await codigoDe(recibir(o.ordenId)), 'ORDEN_CERRADA')
  assert.equal(await codigoDe(pedir(o.ordenId)), 'ORDEN_CERRADA')
  assert.equal(await movimientosDe(p1), 0)
  assert.equal(await codigoDe(cancelar('no-existe')), 'ORDEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => cancelarOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId, motivo: 'x' }, como(ctx.usuario)))), 'ORDEN_NO_ENCONTRADA')
})

test('24 · una orden recibida en parte NO se cancela (lo que llegó ya es stock): se cierra con faltante', async () => {
  const s = await proveedor('Parcial')
  const p = await variante('Parcial')
  const o = await pedida(s.proveedorId, [L(p, 10, '2')])
  await recibir(o.ordenId, { lineas: [{ varianteId: p, cantidad: 4 }] })
  assert.equal(await codigoDe(cancelar(o.ordenId, 'Quiero cancelarla')), 'ORDEN_CON_RECEPCIONES')
  assert.equal((await orden(o.ordenId)).status, 'PARTIAL')
  assert.equal(await existencia(p), 4)
})

// ── Producto ↔ proveedor ─────────────────────────────────────────────────────

test('25 · vincular un proveedor a un producto: código, días de entrega y preferido; marcar uno desmarca al anterior; el último costo no se escribe a mano', async () => {
  const [s1, s2] = [await proveedor('Vínculo 1'), await proveedor('Vínculo 2')]
  const p = await variante('Vinculado')
  const vincular = (proveedorId: string, datos: Datos) => enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId, datos }, como(ctx.usuario)))
  await vincular(s1.proveedorId, { codigoProveedor: ' AB-12 ', diasEntrega: 5, preferido: true })
  let v1 = await vinculo(p, s1.proveedorId)
  assert.deepEqual([v1?.supplierSku, v1?.leadTimeDays, v1?.preferred, v1?.lastCost], ['AB-12', 5, true, null])
  await vincular(s2.proveedorId, { preferido: true, lastCost: '999' })
  v1 = await vinculo(p, s1.proveedorId)
  const v2 = await vinculo(p, s2.proveedorId)
  assert.deepEqual([v1?.preferred, v2?.preferred, v2?.lastCost], [false, true, null], 'el nuevo preferido desmarca al anterior; el último costo no se acepta de fuera')
  assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p, preferred: true } }), 1)
  // Editar sin marcar preferido lo desmarca solo si el dato dice que no.
  await vincular(s2.proveedorId, { codigoProveedor: 'ZZ', preferido: false })
  assert.equal((await vinculo(p, s2.proveedorId))?.preferred, false)
  assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p, preferred: true } }), 0)
  // Errores.
  assert.equal(await codigoDe(vincular(s1.proveedorId, { diasEntrega: 366 })), 'DIAS_ENTREGA_INVALIDOS')
  assert.equal(await codigoDe(vincular(s1.proveedorId, { codigoProveedor: 'c'.repeat(81) })), 'CODIGO_INVALIDO')
  assert.equal(await codigoDe(vincular(ctx.proveedorB, {})), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal(await codigoDe(enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: ctx.varianteB, proveedorId: s1.proveedorId, datos: {} }, como(ctx.usuario)))), 'VARIANTE_NO_ENCONTRADA')
  assert.equal(await codigoDe(enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: ctx.servicio, proveedorId: s1.proveedorId, datos: {} }, como(ctx.usuario)))), 'SIN_CONTROL_DE_INVENTARIO')
  // Quitar: repetirlo no hace nada.
  const quitar = () => enA((tx) => desvincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s1.proveedorId }, como(ctx.usuario)))
  assert.equal((await quitar()).quitado, true)
  assert.equal((await quitar()).quitado, false)
  assert.equal(await vinculo(p, s1.proveedorId), null)
  assert.equal(await codigoDe(enA((tx) => desvincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: ctx.proveedorB }, como(ctx.usuario)))), 'PROVEEDOR_NO_ENCONTRADO')
})

test('26 · dos personas que marcan «preferido» a la vez sobre el mismo producto: queda UNO, sin error', async () => {
  const proveedores = await Promise.all(['Pref 1', 'Pref 2', 'Pref 3', 'Pref 4'].map((n) => proveedor(n)))
  const p = await variante('Preferido')
  await Promise.all(proveedores.map((s) => enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s.proveedorId, datos: { preferido: true } }, como(ctx.usuario)))))
  assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p } }), 4)
  assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p, preferred: true } }), 1)
})

test('27 · vincular y recibir a la vez (la recepción también crea el vínculo) no chocan; la recepción conserva el «preferido» y los datos del vínculo', async () => {
  const s = await proveedor('Vincula y recibe')
  const p = await variante('Doble vía')
  const o = await pedida(s.proveedorId, [L(p, 10, '3.5')])
  const [v, r] = await Promise.all([
    enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s.proveedorId, datos: { codigoProveedor: 'DV-1', diasEntrega: 3, preferido: true } }, como(ctx.usuario))),
    recibir(o.ordenId),
  ])
  assert.equal(v.preferido, true)
  assert.equal(r.estado, 'RECEIVED')
  const fila = await vinculo(p, s.proveedorId)
  assert.deepEqual([fila?.supplierSku, fila?.leadTimeDays, fila?.preferred, fila?.lastCost?.toFixed(4)], ['DV-1', 3, true, '3.5000'])
  assert.equal(await prisma.inventoryVariantSupplier.count({ where: { catalogVariantId: p, supplierId: s.proveedorId } }), 1)
  // Otra recepción posterior no pisa el código ni el preferido.
  const o2 = await pedida(s.proveedorId, [L(p, 5, '4')])
  await recibir(o2.ordenId)
  const despues = await vinculo(p, s.proveedorId)
  assert.deepEqual([despues?.supplierSku, despues?.preferred, despues?.lastCost?.toFixed(4)], ['DV-1', true, '4.0000'])
})

// ── Bitácora ─────────────────────────────────────────────────────────────────

test('28 · cada paso de la orden deja su rastro en la bitácora, y la entrada que crea la recepción deja el suyo', async () => {
  const s = await proveedor('Auditada')
  const p = await variante('Rastro')
  const o = await guardar(s.proveedorId, [L(p, 4, '2')])
  await pedir(o.ordenId)
  const r = await recibir(o.ordenId)
  const filas = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: o.ordenId, entidadTipo: 'InventoryPurchaseOrder' }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(
    filas.map((f) => (f.payload as Record<string, unknown>).tipo),
    ['ORDEN_CREADA', 'ORDEN_PEDIDA', 'ORDEN_RECIBIDA']
  )
  assert.ok(filas.every((f) => f.accion === 'INVENTORY_CONFIGURED' && f.userId === ctx.usuario))
  assert.equal((filas[2].payload as Record<string, unknown>).entrada, r.entradaNumero)
  assert.equal(await prisma.auditLog.count({ where: { companyId: ctx.a, entidadId: r.entradaId!, entidadTipo: 'InventoryReceipt' } }), 1)
  const c = await pedida(s.proveedorId, [L(p, 1, '1')])
  await cancelar(c.ordenId, 'Cambio de planes')
  const cancelacion = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: c.ordenId, entidadTipo: 'InventoryPurchaseOrder' }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(cancelacion.map((f) => (f.payload as Record<string, unknown>).tipo), ['ORDEN_CREADA', 'ORDEN_PEDIDA', 'ORDEN_CANCELADA'])
  assert.equal((cancelacion[2].payload as Record<string, unknown>).motivo, 'Cambio de planes')
  const parcial = await pedida(s.proveedorId, [L(p, 4, '1')])
  await recibir(parcial.ordenId, { lineas: [{ varianteId: p, cantidad: 1 }] })
  await recibir(parcial.ordenId, { lineas: [], cerrarConFaltante: true, motivo: 'Ya no lo mandan' })
  const cierre = await prisma.auditLog.findMany({ where: { companyId: ctx.a, entidadId: parcial.ordenId, entidadTipo: 'InventoryPurchaseOrder' }, orderBy: { createdAt: 'asc' } })
  const ultimo = cierre[cierre.length - 1].payload as Record<string, unknown>
  assert.deepEqual([ultimo.tipo, ultimo.cerradas, ultimo.estado, ultimo.motivo, ultimo.entrada], ['ORDEN_RECIBIDA', 3, 'RECEIVED', 'Ya no lo mandan', null])
})

// ── La base ──────────────────────────────────────────────────────────────────

test('29 · la base: no deja saltarse los estados, tocar lo pedido ni lo cerrado, ni bajar lo recibido — aunque se escriba por fuera del servicio', async () => {
  const s = await proveedor('Base')
  const [p1, p2] = [await variante('B1'), await variante('B2')]
  const borrador = await guardar(s.proveedorId, [L(p1, 10, '2')])
  const abierta = await pedida(s.proveedorId, [L(p1, 10, '2'), L(p2, 5, '1')])
  const parcial = await pedida(s.proveedorId, [L(p1, 6, '2')])
  await recibir(parcial.ordenId, { lineas: [{ varianteId: p1, cantidad: 2 }] })
  const cerrada = await pedida(s.proveedorId, [L(p1, 2, '2')])
  await recibir(cerrada.ordenId)
  const cancelada = await guardar(s.proveedorId, [L(p1, 1, '1')])
  await cancelar(cancelada.ordenId)
  const lineaAbierta = await prisma.inventoryPurchaseOrderLine.findFirstOrThrow({ where: { orderId: abierta.ordenId, catalogVariantId: p1 } })
  const lineaBorrador = await prisma.inventoryPurchaseOrderLine.findFirstOrThrow({ where: { orderId: borrador.ordenId } })
  const lineaCerrada = await prisma.inventoryPurchaseOrderLine.findFirstOrThrow({ where: { orderId: cerrada.ordenId } })
  const sql = (texto: string) => prisma.$executeRawUnsafe(texto)
  const upd = (id: string, set: string) => sql(`UPDATE "inventory_purchase_orders" SET ${set} WHERE "id" = '${id}'`)
  const updL = (id: string, set: string) => sql(`UPDATE "inventory_purchase_order_lines" SET ${set} WHERE "id" = '${id}'`)

  // Estados: la tabla de transiciones.
  await assert.rejects(upd(borrador.ordenId, `"status" = 'RECEIVED', "orderedAt" = now(), "orderedUnits" = 10, "closedAt" = now(), "receivedUnits" = 10, "shortUnits" = 0`), /inventory_purchasing_transicion/, 'un borrador no se salta a recibida')
  await assert.rejects(upd(abierta.ordenId, `"status" = 'DRAFT', "orderedAt" = NULL, "orderedUnits" = NULL`), /inventory_purchasing_(transicion|inmutable)/, 'pedida no vuelve a borrador')
  await assert.rejects(upd(abierta.ordenId, `"status" = 'ORDERED'`), /inventory_purchasing_transicion/, 'pedida → pedida no es una transición')
  await assert.rejects(upd(parcial.ordenId, `"status" = 'CANCELLED', "closedAt" = now(), "closeReason" = 'x', "receivedUnits" = 0, "shortUnits" = 6`), /inventory_purchasing_transicion/, 'parcial no se cancela')
  await assert.rejects(upd(parcial.ordenId, `"status" = 'ORDERED'`), /inventory_purchasing_transicion/, 'parcial no vuelve a pedida')
  // Cerrar sin contar la historia lo rechaza el CHECK.
  await assert.rejects(upd(abierta.ordenId, `"status" = 'RECEIVED', "closedAt" = now()`), /inventory_purchase_orders_forma/)
  await assert.rejects(upd(abierta.ordenId, `"status" = 'RECEIVED', "closedAt" = now(), "receivedUnits" = 10, "shortUnits" = 4, "closeReason" = 'x'`), /inventory_purchase_orders_forma/, 'recibido + faltante tiene que dar lo pedido (14 de 15)')
  await assert.rejects(upd(abierta.ordenId, `"status" = 'RECEIVED', "closedAt" = now(), "receivedUnits" = 12, "shortUnits" = 3`), /inventory_purchase_orders_forma/, 'un faltante sin motivo')
  await assert.rejects(upd(abierta.ordenId, `"status" = 'RECEIVED', "closedAt" = now(), "receivedUnits" = 0, "shortUnits" = 15, "closeReason" = 'x'`), /inventory_purchase_orders_forma/, 'recibida sin que llegara nada')
  await assert.rejects(upd(abierta.ordenId, `"status" = 'CANCELLED', "closedAt" = now(), "receivedUnits" = 0, "shortUnits" = 15`), /inventory_purchase_orders_forma/, 'pedida y cancelada sin motivo')
  // Lo que identifica a la orden y lo pedido no cambian, columna por columna.
  const congeladas: Array<[string, string]> = [
    ['number', `'OC-2000-000001'`],
    ['createdAt', `now() + interval '1 day'`],
    ['createdById', `'otro'`],
    ['idempotencyKey', `'otra-clave'`],
    ['supplierId', `'${ctx.proveedorB}'`],
    ['locationId', `'${ctx.sucA2}'`],
    ['reference', `'otra'`],
    ['note', `'otra nota'`],
    ['expectedAt', `now()`],
    ['lineCount', '9'],
    ['orderedUnits', '99'],
    ['orderedAt', `now() + interval '1 day'`],
    ['orderedById', `'otro'`],
  ]
  for (const [columna, valor] of congeladas) {
    await assert.rejects(upd(abierta.ordenId, `"${columna}" = ${valor}`), /inventory_purchasing_inmutable|violates|foreign key|inventory_purchase_orders_forma/, `la orden pedida no cambia su ${columna}`)
  }
  await assert.rejects(upd(abierta.ordenId, `"supplierId" = (SELECT "id" FROM "inventory_suppliers" WHERE "companyId" = '${ctx.a}' AND "id" <> '${s.proveedorId}' LIMIT 1)`), /inventory_purchasing_inmutable/, 'otro proveedor de la misma empresa tampoco')
  // El id y la empresa de la orden no cambian NUNCA (con la clave foránea en cascada, un cambio de id arrastraría a las líneas):
  // aquí el mensaje tiene que ser el del disparador, no el de otra restricción.
  await assert.rejects(upd(abierta.ordenId, `"id" = 'x-id-nuevo'`), /inventory_purchasing_inmutable/, 'el id de la orden no cambia')
  await assert.rejects(upd(abierta.ordenId, `"companyId" = '${ctx.b}'`), /inventory_purchasing_inmutable/, 'la empresa de la orden no cambia')
  // Y «pedida → borrador» lo prohíbe la tabla de transiciones (no solo un CHECK que se entere después).
  await assert.rejects(upd(abierta.ordenId, `"status" = 'DRAFT'`), /inventory_purchasing_transicion/, 'pedida no vuelve a borrador')
  await assert.rejects(upd(parcial.ordenId, `"status" = 'DRAFT'`), /inventory_purchasing_transicion/, 'parcial tampoco')
  // Cerrada y cancelada: nada cambia, con el mismo mensaje.
  await assert.rejects(upd(cerrada.ordenId, `"closeReason" = 'x'`), /inventory_purchasing_inmutable: una orden RECEIVED no admite cambios/)
  await assert.rejects(upd(cancelada.ordenId, `"closeReason" = 'x'`), /inventory_purchasing_inmutable: una orden CANCELLED no admite cambios/)
  await assert.rejects(updL(lineaCerrada.id, `"quantityReceived" = 2`), /inventory_purchasing_inmutable/)
  // No se borra ni se vacía.
  await assert.rejects(sql(`DELETE FROM "inventory_purchase_orders" WHERE "id" = '${borrador.ordenId}'`), /no admiten DELETE/)
  await assert.rejects(sql(`DELETE FROM "inventory_purchase_orders" WHERE "id" = '${abierta.ordenId}'`), /no admiten DELETE/)
  await assert.rejects(sql('TRUNCATE "inventory_purchase_orders" CASCADE'), /inventory_purchasing_inmutable/)
  await assert.rejects(sql('TRUNCATE "inventory_purchase_order_lines"'), /inventory_purchasing_inmutable/)

  // Las líneas de una orden pedida: ni se agregan, ni se quitan, ni cambian de producto, cantidad o costo; los contadores solo suben.
  await assert.rejects(
    sql(`INSERT INTO "inventory_purchase_order_lines" ("id","companyId","orderId","catalogVariantId","position","quantityOrdered","unitCost") VALUES ('x-nueva','${ctx.a}','${abierta.ordenId}','${p2}',7,1,1)`),
    /inventory_purchasing_inmutable/,
    'a una orden pedida no se le agregan líneas'
  )
  await assert.rejects(sql(`DELETE FROM "inventory_purchase_order_lines" WHERE "id" = '${lineaAbierta.id}'`), /a una orden ORDERED no se le quitan líneas/)
  for (const [columna, valor] of [['catalogVariantId', `'${p2}'`], ['position', '9'], ['quantityOrdered', '11'], ['unitCost', '3'], ['orderId', `'${borrador.ordenId}'`], ['companyId', `'${ctx.b}'`]] as const) {
    await assert.rejects(updL(lineaAbierta.id, `"${columna}" = ${valor}`), /inventory_purchasing_inmutable|violates/, `la línea pedida no cambia su ${columna}`)
  }
  await assert.rejects(updL(lineaAbierta.id, `"id" = 'x-l-nuevo'`), /inventory_purchasing_inmutable/, 'el id de la línea no cambia')
  await assert.rejects(updL(lineaAbierta.id, `"companyId" = '${ctx.b}'`), /inventory_purchasing_inmutable/, 'la empresa de la línea no cambia')
  await updL(lineaAbierta.id, `"quantityReceived" = 3`)
  await assert.rejects(updL(lineaAbierta.id, `"quantityReceived" = 2`), /no baja/)
  await updL(lineaAbierta.id, `"quantityCancelled" = 2`)
  await assert.rejects(updL(lineaAbierta.id, `"quantityCancelled" = 1`), /no baja/)
  await assert.rejects(updL(lineaAbierta.id, `"quantityReceived" = 9`), /inventory_purchase_order_lines_forma/, 'recibido + cancelado no pasa de lo pedido (3 → 9 + 2 > 10)')

  // El borrador sí se edita: líneas nuevas, cambios y borrados; pero nace sin nada recibido.
  await updL(lineaBorrador.id, `"quantityOrdered" = 12, "unitCost" = 3`)
  await assert.rejects(updL(lineaBorrador.id, `"quantityReceived" = 1`), /en un borrador nada se ha recibido/)
  await assert.rejects(
    sql(`INSERT INTO "inventory_purchase_order_lines" ("id","companyId","orderId","catalogVariantId","position","quantityOrdered","quantityReceived","unitCost") VALUES ('x-recibida','${ctx.a}','${borrador.ordenId}','${p2}',5,3,1,1)`),
    /nace sin nada recibido/
  )
  await sql(`INSERT INTO "inventory_purchase_order_lines" ("id","companyId","orderId","catalogVariantId","position","quantityOrdered","unitCost") VALUES ('x-ok','${ctx.a}','${borrador.ordenId}','${p2}',5,3,1)`)
  await sql(`DELETE FROM "inventory_purchase_order_lines" WHERE "id" = 'x-ok'`)
})

test('30 · la base: formas imposibles, números y claves repetidos, y mezcla de empresas se rechazan aunque se escriban por fuera', async () => {
  const s = await proveedor('Base 2')
  const p = await variante('B3')
  const insertOrden = (id: string, extra: { numero?: string; empresa?: string; proveedor?: string; sucursal?: string; clave?: string | null; columnas?: string; valores?: string } = {}) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "inventory_purchase_orders" ("id","companyId","number","supplierId","locationId","idempotencyKey"${extra.columnas ?? ''}) VALUES ('${id}','${extra.empresa ?? ctx.a}','${extra.numero ?? 'OC-2099-000001'}','${extra.proveedor ?? s.proveedorId}','${extra.sucursal ?? ctx.sucA1}',${extra.clave === undefined || extra.clave === null ? 'NULL' : `'${extra.clave}'`}${extra.valores ?? ''})`
    )
  try {
    await insertOrden('x-o1', { numero: 'OC-2099-000001', clave: 'clave-x' })
    await assert.rejects(insertOrden('x-o2', { numero: 'OC-2099-000001' }), /23505[\s\S]*Key \("companyId", number\)/, 'el mismo número en la misma empresa')
    await assert.rejects(insertOrden('x-o3', { numero: 'OC-2099-000002', clave: 'clave-x' }), /23505[\s\S]*Key \("companyId", "idempotencyKey"\)/, 'la misma clave en la misma empresa')
    await insertOrden('x-o4', { numero: 'OC-2099-000003' })
    await insertOrden('x-o5', { numero: 'OC-2099-000004' })
    for (const mal of ['OC-MAL', 'OC-99-000001', 'oc-2099-000001', 'OC-2099-1', 'ENT-2099-000001', 'OC-2099-000001x']) {
      await assert.rejects(insertOrden('x-mal', { numero: mal }), /inventory_purchase_orders_forma/, `el número «${mal}»`)
    }
    await assert.rejects(insertOrden('x-ajena', { numero: 'OC-2099-000005', proveedor: ctx.proveedorB }), /inventory_purchase_orders_supplierId_companyId_fkey/, 'un proveedor de otra empresa')
    await assert.rejects(insertOrden('x-ajena2', { numero: 'OC-2099-000006', sucursal: ctx.sucB }), /inventory_purchase_orders_locationId_companyId_fkey/, 'una sucursal de otra empresa')
    await assert.rejects(insertOrden('x-ajena3', { numero: 'OC-2099-000007', empresa: ctx.b }), /inventory_purchase_orders_(supplierId|locationId)_companyId_fkey/, 'la orden de B con proveedor y sucursal de A')
    // Cada estado cuenta su historia.
    await assert.rejects(insertOrden('x-ped', { numero: 'OC-2099-000008', columnas: ',"status"', valores: `,'ORDERED'` }), /inventory_purchase_orders_forma/, 'pedida sin fecha de pedido')
    await assert.rejects(insertOrden('x-bor', { numero: 'OC-2099-000009', columnas: ',"orderedAt"', valores: ',now()' }), /inventory_purchase_orders_forma/, 'borrador con fecha de pedido')
    await assert.rejects(insertOrden('x-neg', { numero: 'OC-2099-000010', columnas: ',"lineCount"', valores: ',-1' }), /inventory_purchase_orders_forma/)
    await assert.rejects(insertOrden('x-ref', { numero: 'OC-2099-000011', columnas: ',"reference"', valores: `,'${'r'.repeat(121)}'` }), /inventory_purchase_orders_forma/)
    await assert.rejects(insertOrden('x-ped2', { numero: 'OC-2099-000012', columnas: ',"status","orderedAt","orderedUnits","lineCount"', valores: `,'ORDERED',now(),1,0` }), /inventory_purchase_orders_forma/, 'pedida sin líneas')
    await assert.rejects(insertOrden('x-ped3', { numero: 'OC-2099-000013', columnas: ',"status","orderedAt","orderedUnits","lineCount","receivedUnits"', valores: `,'ORDERED',now(),5,1,0` }), /inventory_purchase_orders_forma/, 'pedida con resumen de cierre')

    const linea = (id: string, ordenId: string, extra: { empresa?: string; variante?: string; posicion?: number; cantidad?: number; costo?: string; recibido?: number; cancelado?: number } = {}) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "inventory_purchase_order_lines" ("id","companyId","orderId","catalogVariantId","position","quantityOrdered","quantityReceived","quantityCancelled","unitCost") VALUES ('${id}','${extra.empresa ?? ctx.a}','${ordenId}','${extra.variante ?? p}',${extra.posicion ?? 0},${extra.cantidad ?? 1},${extra.recibido ?? 0},${extra.cancelado ?? 0},${extra.costo ?? '1'})`
      )
    await linea('x-l1', 'x-o1', { cantidad: 10 })
    await assert.rejects(linea('x-l2', 'x-o1', { posicion: 1 }), /23505[\s\S]*Key \("orderId", "catalogVariantId"\)/, 'el mismo producto dos veces en una orden')
    const q = await variante('B4')
    await assert.rejects(linea('x-l3', 'x-o1', { variante: q, posicion: 0 }), /23505[\s\S]*Key \("orderId", "position"\)/, 'dos líneas en la misma posición')
    await assert.rejects(linea('x-l4', 'x-o1', { variante: ctx.varianteB, posicion: 2 }), /inventory_purchase_order_lines_catalogVariantId_companyId_fkey/, 'un producto de otra empresa')
    await assert.rejects(linea('x-l5', 'x-o1', { empresa: ctx.b, variante: ctx.varianteB, posicion: 3 }), /inventory_purchase_order_lines_orderId_companyId_fkey/, 'una línea de otra empresa en la orden de ésta')
    for (const [nombre, extra] of [
      ['cantidad cero', { variante: q, posicion: 4, cantidad: 0 }],
      ['más de un millón', { variante: q, posicion: 4, cantidad: 1_000_001 }],
      ['costo negativo', { variante: q, posicion: 4, costo: '-1' }],
      ['costo sobre el tope', { variante: q, posicion: 4, costo: '100000001' }],
      ['posición negativa', { variante: q, posicion: -1 }],
    ] as const) {
      await assert.rejects(linea('x-l6', 'x-o1', extra), /inventory_purchase_order_lines_forma/, nombre)
    }
    await linea('x-l7', 'x-o1', { variante: q, posicion: 4, costo: '0' })

    // La entrada → su orden: la clave compuesta no mezcla empresas.
    await assert.rejects(
      prisma.$executeRawUnsafe(`INSERT INTO "inventory_receipts" ("id","companyId","number","locationId","lineCount","unitCount","purchaseOrderId") VALUES ('x-e1','${ctx.b}','ENT-2099-000001','${ctx.sucB}',1,1,'x-o1')`),
      /inventory_receipts_purchaseOrderId_companyId_fkey/,
      'una entrada de B que apunta a una orden de A'
    )
    // Un solo proveedor preferido por producto, y nombres de proveedor sin repetir ni salirse de forma.
    const vinc = (id: string, proveedorId: string, preferido: boolean, extra = '') =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "inventory_variant_suppliers" ("id","companyId","catalogVariantId","supplierId","preferred","updatedAt"${extra ? ',' + extra.split('=')[0] : ''}) VALUES ('${id}','${ctx.a}','${p}','${proveedorId}',${preferido},now()${extra ? ',' + extra.split('=')[1] : ''})`
      )
    const otro = await proveedor('Base 3')
    await vinc('x-v1', s.proveedorId, true)
    await assert.rejects(vinc('x-v2', otro.proveedorId, true), /23505[\s\S]*Key \("catalogVariantId"\)/, 'dos preferidos del mismo producto')
    await vinc('x-v2', otro.proveedorId, false)
    await assert.rejects(vinc('x-v3', s.proveedorId, false), /23505[\s\S]*Key \("catalogVariantId", "supplierId"\)/, 'el mismo vínculo dos veces')
    await assert.rejects(vinc('x-v4', ctx.proveedorB, false), /inventory_variant_suppliers_supplierId_companyId_fkey/, 'un proveedor de otra empresa')
    await assert.rejects(
      prisma.$executeRawUnsafe(`INSERT INTO "inventory_variant_suppliers" ("id","companyId","catalogVariantId","supplierId","updatedAt") VALUES ('x-v6','${ctx.a}','${ctx.varianteB}','${otro.proveedorId}',now())`),
      /inventory_variant_suppliers_catalogVariantId_companyId_fkey/,
      'un producto de otra empresa'
    )
    await assert.rejects(vinc('x-v5', otro.proveedorId, false, `"leadTimeDays"=366`), /inventory_variant_suppliers_forma|23505/)
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "inventory_variant_suppliers" SET "lastCost" = -1 WHERE "id" = 'x-v2'`), /inventory_variant_suppliers_forma/)
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "inventory_suppliers" ("id","companyId","name","updatedAt") VALUES ('x-s1','${ctx.a}','  ',now())`), /inventory_suppliers_forma/, 'nombre vacío')
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "inventory_suppliers" ("id","companyId","name","creditDays","updatedAt") VALUES ('x-s2','${ctx.a}','Con crédito malo',366,now())`), /inventory_suppliers_forma/)
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "inventory_suppliers" ("id","companyId","name","updatedAt") VALUES ('x-s3','${ctx.a}','BASE 3',now())`), /23505/, 'mismo nombre con otras mayúsculas')
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_variant_suppliers" WHERE "id" LIKE 'x-v%'`)
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_purchase_order_lines" WHERE "id" LIKE 'x-l%'`)
      await tx.$executeRawUnsafe(`DELETE FROM "inventory_purchase_orders" WHERE "id" LIKE 'x-o%'`)
    })
  }
})

test('31 · el proveedor y las órdenes de una empresa no existen para otra', async () => {
  const s = await proveedor('Privado')
  const p = await variante('Privado')
  const o = await pedida(s.proveedorId, [L(p, 3, '2')])
  assert.equal(await codigoDe(enB((tx) => cambiarActivoProveedorEnTx(tx, ctx.b, { proveedorId: s.proveedorId, activo: false }, como(ctx.usuario)))), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => recibirOrdenEnTx(tx, ctx.b, { ordenId: o.ordenId, todo: true }, como(ctx.usuario)))), 'ORDEN_NO_ENCONTRADA')
  assert.equal(await codigoDe(enB((tx) => guardarOrdenEnTx(tx, ctx.b, { cabecera: { proveedorId: s.proveedorId, sucursalId: ctx.sucB }, lineas: [L(ctx.varianteB, 1, '1')] }, como(ctx.usuario)))), 'PROVEEDOR_NO_ENCONTRADO')
  assert.equal((await orden(o.ordenId)).status, 'ORDERED')
  assert.equal(await existencia(p), 0)
  // La numeración es de cada empresa: B empieza en 1 aunque A ya vaya por decenas.
  const deB = await enB((tx) => guardarOrdenEnTx(tx, ctx.b, { cabecera: { proveedorId: ctx.proveedorB, sucursalId: ctx.sucB }, lineas: [L(ctx.varianteB, 1, '1')] }, como(ctx.usuario)))
  assert.match(deB.numero, /^OC-\d{4}-000001$/)
  assert.ok(Number(o.numero.slice(-6)) > 1)
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

test('32 · la lista de proveedores: solo activos por defecto, búsqueda por nombre/RNC/contacto, y cuenta productos y órdenes esperando mercancía', async () => {
  // «Beta» se crea ANTES que «Alfa»: el orden por nombre no coincide con el orden de creación.
  const inactivo = await proveedor('Lectura Beta')
  const s = await proveedor('Lectura Alfa', { rnc: '131-ALFA-1', contacto: 'Zulema Ríos' })
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: inactivo.proveedorId, activo: false }, como(ctx.usuario)))
  const [p1, p2] = [await variante('L1'), await variante('L2')]
  const esperando = await pedida(s.proveedorId, [L(p1, 5, '2'), L(p2, 5, '2')])
  const recibida = await pedida(s.proveedorId, [L(p1, 1, '2')])
  await recibir(recibida.ordenId)
  const borradorProv = await guardar(s.proveedorId, [L(p1, 1, '1')]) // un borrador no cuenta como «esperando mercancía»

  const por = (f: Parameters<typeof proveedoresDeLaEmpresaEnTx>[2]) => enA((tx) => proveedoresDeLaEmpresaEnTx(tx, ctx.a, f))
  const base = await por({ q: 'Lectura' })
  assert.deepEqual(base.filas.map((f) => f.nombre), ['Lectura Alfa'], 'el desactivado no sale')
  assert.equal(base.truncado, false)
  const alfa = base.filas[0]
  assert.deepEqual([alfa.productos, alfa.ordenesAbiertas, alfa.activo, alfa.rnc, alfa.contacto, alfa.diasCredito], [1, 1, true, '131-ALFA-1', 'Zulema Ríos', 0], 'solo p1 quedó vinculado: llegó; p2 sigue sin recibir')
  assert.deepEqual((await por({ q: 'Lectura', incluirInactivos: true })).filas.map((f) => f.nombre), ['Lectura Alfa', 'Lectura Beta'], 'ordenados por nombre')
  assert.deepEqual((await por({ q: '131-alfa' })).filas.map((f) => f.nombre), ['Lectura Alfa'], 'por RNC, sin importar mayúsculas')
  assert.deepEqual((await por({ q: 'zulema' })).filas.map((f) => f.nombre), ['Lectura Alfa'], 'por contacto')
  assert.deepEqual((await por({ q: 'no-existe-nadie' })).filas, [])
  assert.equal((await enB((tx) => proveedoresDeLaEmpresaEnTx(tx, ctx.b, { q: 'Lectura', incluirInactivos: true }))).filas.length, 0, 'otra empresa no los ve')
  const activos = await enA((tx) => proveedoresActivosEnTx(tx, ctx.a))
  assert.ok(activos.some((a) => a.id === s.proveedorId) && !activos.some((a) => a.id === inactivo.proveedorId))
  assert.equal((await enB((tx) => proveedoresActivosEnTx(tx, ctx.b))).some((a) => a.id === s.proveedorId), false)

  const det = await enA((tx) => proveedorDetalleEnTx(tx, ctx.a, s.proveedorId))
  assert.ok(det)
  assert.deepEqual([det.productos, det.ordenesAbiertas, det.productosSurtidos.length, det.ordenes.length], [1, 1, 1, 3])
  assert.deepEqual(det.ordenes.map((o) => o.numero), [borradorProv.numero, recibida.numero, esperando.numero], 'las órdenes, de la más reciente a la más antigua')
  assert.deepEqual([det.productosSurtidos[0].varianteId, det.productosSurtidos[0].ultimoCosto, det.productosSurtidos[0].preferido], [p1, '2.00', false])
  assert.equal(await enB((tx) => proveedorDetalleEnTx(tx, ctx.b, s.proveedorId)), null)
  assert.equal(await enA((tx) => proveedorDetalleEnTx(tx, ctx.a, 'no-existe')), null)
  assert.equal(await enA((tx) => proveedorDetalleEnTx(tx, ctx.a, '')), null)
})

test('33 · la lista de órdenes filtra por estado, proveedor, sucursal, texto y fechas; «abiertas» solo trae las que esperan; pagina sin repetir; no cruza empresas', async () => {
  const [s1, s2] = [await proveedor('Listado Uno'), await proveedor('Listado Dos')]
  const p = await variante('Lista')
  const a = await pedida(s1.proveedorId, [L(p, 10, '3')])
  await recibir(a.ordenId, { lineas: [{ varianteId: p, cantidad: 4 }], referencia: 'FAC-LISTA' })
  const b = await guardar(s1.proveedorId, [L(p, 2, '1.5')], { sucursalId: ctx.sucA2, cabecera: { referencia: 'Cotización Zeta', nota: 'nota rara' } })
  const c = await pedida(s2.proveedorId, [L(p, 1, '1')])
  await recibir(c.ordenId)
  const d = await guardar(s2.proveedorId, [L(p, 1, '1')])
  await cancelar(d.ordenId)

  const zona = 'America/Santo_Domingo'
  const lista = (f: Parameters<typeof ordenesDeLaEmpresaEnTx>[2], o: Partial<Parameters<typeof ordenesDeLaEmpresaEnTx>[3]> = {}) => enA((tx) => ordenesDeLaEmpresaEnTx(tx, ctx.a, f, { zonaHoraria: zona, ...o }))
  const numeros = async (f: Parameters<typeof ordenesDeLaEmpresaEnTx>[2], o: Partial<Parameters<typeof ordenesDeLaEmpresaEnTx>[3]> = {}) => (await lista(f, o)).filas.map((x) => x.numero)

  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId }), [b.numero, a.numero], 'del más reciente al más antiguo')
  assert.deepEqual(await numeros({ proveedorId: s2.proveedorId }), [d.numero, c.numero])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, estado: 'PARTIAL' }), [a.numero])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, estado: 'DRAFT' }), [b.numero])
  assert.deepEqual(await numeros({ proveedorId: s2.proveedorId, estado: 'CANCELLED' }), [d.numero])
  assert.deepEqual(await numeros({ proveedorId: s2.proveedorId, estado: 'RECEIVED' }), [c.numero])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, sucursalId: ctx.sucA2 }), [b.numero], 'por la sucursal que recibe')
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, q: 'zeta' }), [b.numero], 'por referencia, sin importar mayúsculas')
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, q: 'nota rara' }), [b.numero], 'por nota')
  assert.deepEqual(await numeros({ q: a.numero }), [a.numero], 'por número')
  assert.deepEqual(await numeros({ q: 'listado dos' }), [d.numero, c.numero], 'por nombre del proveedor')
  const hoy = new Date().toISOString().slice(0, 10)
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, desde: hoy, hasta: hoy }), [b.numero, a.numero])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, hasta: '2000-01-01' }), [])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId, desde: '2999-01-01' }), [])
  assert.deepEqual(await numeros({ proveedorId: s1.proveedorId }, { abiertas: true }), [a.numero], 'esperando mercancía: ni borradores ni cerradas')
  assert.deepEqual(await numeros({ proveedorId: 'de-otra-empresa' }), [])

  const fila = (await lista({ proveedorId: s1.proveedorId, estado: 'PARTIAL' })).filas[0]
  assert.deepEqual(
    [fila.estado, fila.proveedorNombre, fila.sucursalNombre, fila.referencia, fila.lineas, fila.unidades, fila.valor, fila.recibidas, fila.pendientes, fila.creadoPorNombre],
    ['PARTIAL', 'Listado Uno', 'Principal', null, 1, 10, '30.00', 4, 6, 'Comprador']
  )
  const borrador = (await lista({ proveedorId: s1.proveedorId, estado: 'DRAFT' })).filas[0]
  assert.deepEqual([borrador.unidades, borrador.valor, borrador.recibidas, borrador.pendientes, borrador.pedidoEn], [2, '3.00', 0, 0, null], 'un borrador no espera nada')
  const cancelada = (await lista({ proveedorId: s2.proveedorId, estado: 'CANCELLED' })).filas[0]
  assert.equal(cancelada.pendientes, 0)

  // Paginación por cursor sin repetir ni saltar.
  const s3 = await proveedor('Listado Paginado')
  const hechas: string[] = []
  for (let i = 0; i < 7; i++) hechas.push((await guardar(s3.proveedorId, [L(p, 1, '1')])).numero)
  const vistas: string[] = []
  let cursor: string | null = null
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const pag = await lista({ proveedorId: s3.proveedorId }, { limite: 3, cursor })
    vistas.push(...pag.filas.map((x) => x.numero))
    cursor = pag.siguiente
    if (!cursor) break
  }
  assert.deepEqual(vistas, [...hechas].reverse(), 'todas, una vez, de la más reciente a la más antigua')
  // Otra empresa no ve nada.
  assert.ok((await enB((tx) => ordenesDeLaEmpresaEnTx(tx, ctx.b, {}, { zonaHoraria: zona }))).filas.every((x) => x.proveedorId === ctx.proveedorB), 'B solo ve lo suyo')
  assert.equal((await enB((tx) => ordenesDeLaEmpresaEnTx(tx, ctx.b, { proveedorId: s1.proveedorId }, { zonaHoraria: zona }))).filas.length, 0)
})

test('34 · el detalle de una orden trae sus líneas con costo y valor, sus entradas, lo pendiente y los cierres; una ajena o inventada no existe', async () => {
  const s = await proveedor('Detalle')
  const [p1, p2] = [await variante('D1'), await variante('D2')]
  const o = await pedida(s.proveedorId, [L(p1, 10, '12.5'), L(p2, 4, '1000')], ctx.sucA2)
  await prisma.inventoryPurchaseOrder.findUniqueOrThrow({ where: { id: o.ordenId } })
  const t1 = await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 6 }, { varianteId: p2, cantidad: 4 }], referencia: 'FAC-D1' })
  const t2 = await recibir(o.ordenId, { lineas: [{ varianteId: p1, cantidad: 1 }], referencia: 'FAC-D2' })
  const abierta = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, o.ordenId))
  assert.ok(abierta)
  assert.deepEqual(
    [abierta.numero, abierta.estado, abierta.proveedorNombre, abierta.sucursalNombre, abierta.proveedorActivo, abierta.unidades, abierta.valor, abierta.recibidas, abierta.pendientes, abierta.valorRecibido, abierta.valorPendiente, abierta.faltantes],
    [o.numero, 'PARTIAL', 'Detalle', 'Norte', true, 14, '4,125.00', 11, 3, '4,087.50', '37.50', 0]
  )
  assert.deepEqual(
    abierta.detalle.map((l) => [l.varianteId, l.pedido, l.recibido, l.cancelado, l.pendiente, l.costo, l.costoCampo, l.valor]),
    [
      [p1, 10, 7, 0, 3, '12.50', '12.5', '125.00'],
      [p2, 4, 4, 0, 0, '1,000.00', '1000', '4,000.00'],
    ]
  )
  assert.deepEqual(abierta.entradas.map((e) => [e.id, e.referencia, e.unidades, e.usuarioNombre]), [[t1.entradaId, 'FAC-D1', 10, 'Comprador'], [t2.entradaId, 'FAC-D2', 1, 'Comprador']], 'una entrada por tanda, en orden')
  // Un faltante ya anotado en una orden ABIERTA (la base deja subir el contador) deja de contar como pendiente.
  await prisma.$executeRaw`UPDATE "inventory_purchase_order_lines" SET "quantityCancelled" = 1 WHERE "orderId" = ${o.ordenId} AND "catalogVariantId" = ${p1}`
  const conFaltante = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, o.ordenId))
  assert.ok(conFaltante)
  assert.deepEqual([conFaltante.pendientes, conFaltante.valorPendiente, conFaltante.faltantes, conFaltante.detalle[0].pendiente], [2, '25.00', 1, 2], 'lo cerrado como faltante no está por llegar')
  const filaFaltante = (await enA((tx) => ordenesDeLaEmpresaEnTx(tx, ctx.a, { proveedorId: s.proveedorId }, { zonaHoraria: 'America/Santo_Domingo' }))).filas.find((f) => f.id === o.ordenId)
  assert.equal(filaFaltante?.pendientes, 2, 'la lista cuenta igual')
  // Cerrada con faltante: el valor pendiente se va a cero y el faltante se cuenta.
  await recibir(o.ordenId, { lineas: [], cerrarConFaltante: true, motivo: 'No hay más' })
  const cerrada = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, o.ordenId))
  assert.ok(cerrada)
  assert.deepEqual([cerrada.estado, cerrada.pendientes, cerrada.valorPendiente, cerrada.faltantes, cerrada.motivoCierre, cerrada.cerradoPorNombre, cerrada.pedidoPorNombre], ['RECEIVED', 0, '0.00', 3, 'No hay más', 'Comprador', 'Comprador'])
  assert.ok(cerrada.cerradoEn && cerrada.pedidoEn)
  // El borrador y la cancelada.
  const descartado = await guardar(s.proveedorId, [L(p1, 3, '4')])
  await cancelar(descartado.ordenId)
  const dd = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, descartado.ordenId))
  assert.ok(dd)
  assert.deepEqual([dd.estado, dd.pendientes, dd.valorPendiente, dd.detalle[0].pendiente, dd.valor], ['CANCELLED', 0, '0.00', 3, '12.00'], 'una cancelada no espera nada, aunque su línea nunca se cerró (era borrador)')
  // Las líneas salen por POSICIÓN, no por el orden físico de la tabla.
  const reordenada = await guardar(s.proveedorId, [L(p1, 1, '1'), L(p2, 1, '1')])
  const lns = await prisma.inventoryPurchaseOrderLine.findMany({ where: { orderId: reordenada.ordenId }, orderBy: { position: 'asc' } })
  await prisma.$executeRaw`UPDATE "inventory_purchase_order_lines" SET "position" = 5 WHERE "id" = ${lns[0].id}`
  await prisma.$executeRaw`UPDATE "inventory_purchase_order_lines" SET "position" = 0 WHERE "id" = ${lns[1].id}`
  const re = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, reordenada.ordenId))
  assert.deepEqual(re?.detalle.map((l) => l.varianteId), [p2, p1], 'por posición')
  const b = await guardar(s.proveedorId, [L(p1, 1, '2')], { cabecera: { fechaPrevista: '2031-07-08' } })
  const bd = await enA((tx) => ordenDetalleEnTx(tx, ctx.a, b.ordenId))
  assert.ok(bd)
  assert.deepEqual([bd.estado, bd.entradas.length, bd.previstaEn?.toISOString(), bd.pedidoPorNombre], ['DRAFT', 0, '2031-07-08T00:00:00.000Z', null])
  // Otra empresa, inexistente, vacío.
  assert.equal(await enB((tx) => ordenDetalleEnTx(tx, ctx.b, o.ordenId)), null)
  assert.equal(await enA((tx) => ordenDetalleEnTx(tx, ctx.a, 'no-existe')), null)
  assert.equal(await enA((tx) => ordenDetalleEnTx(tx, ctx.a, '')), null)
  // Un proveedor desactivado después se ve como tal.
  await enA((tx) => cambiarActivoProveedorEnTx(tx, ctx.a, { proveedorId: s.proveedorId, activo: false }, como(ctx.usuario)))
  assert.equal((await enA((tx) => ordenDetalleEnTx(tx, ctx.a, o.ordenId)))?.proveedorActivo, false)
})

test('35 · buscar productos para una orden: lo disponible en la sucursal que recibe y el último costo de ESE proveedor; no sugiere el de otro', async () => {
  const [s1, s2] = [await proveedor('Busca Uno'), await proveedor('Busca Dos')]
  const p = await producto('Zapallo Buscable')
  await entradaManual(ctx.sucA1, [{ varianteId: p.variante, cantidad: 7 }])
  const o = await pedida(s1.proveedorId, [L(p.variante, 5, '8.25')])
  await recibir(o.ordenId)
  const buscar = (q: string, suc: string | null, prov: string | null) => enA((tx) => buscarProductosParaOrdenEnTx(tx, ctx.a, q, suc, prov))
  const con = await buscar('Zapallo Buscable', ctx.sucA1, s1.proveedorId)
  assert.deepEqual(con.map((x) => [x.id, x.disponible, x.costoSugerido]), [[p.variante, 12, '8.25']])
  const otro = await buscar('Zapallo Buscable', ctx.sucA1, s2.proveedorId)
  assert.equal(otro[0].costoSugerido, null, 'el último costo de otro proveedor no se sugiere')
  assert.equal((await buscar('Zapallo Buscable', ctx.sucA2, s1.proveedorId))[0].disponible, 0, 'lo disponible es el de la sucursal que recibe')
  assert.equal((await buscar('Zapallo Buscable', null, null))[0].disponible, null)
  assert.deepEqual(await buscar('', ctx.sucA1, s1.proveedorId), [])
  assert.deepEqual((await buscar('Lavado', ctx.sucA1, s1.proveedorId)).map((x) => x.id), [], 'un servicio no se ofrece')
  assert.deepEqual(await enB((tx) => buscarProductosParaOrdenEnTx(tx, ctx.b, 'Zapallo Buscable', ctx.sucB, s1.proveedorId)), [], 'otra empresa no ve los productos de ésta')
  assert.equal((await enB((tx) => buscarProductosParaOrdenEnTx(tx, ctx.b, 'Ajeno', ctx.sucB, s1.proveedorId)))[0]?.costoSugerido ?? null, null, 'ni un proveedor de otra empresa sugiere costos')
  const exacto = await buscar(p.variante === '' ? 'x' : (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: p.variante } })).sku, ctx.sucA1, s1.proveedorId)
  assert.equal(exacto[0].exacto, true, 'un lector que escribe el SKU exacto lo encuentra primero')
})

test('36 · en la ficha del producto: sus proveedores (el preferido primero), lo pedido que no ha llegado y la orden de una entrada', async () => {
  const [s1, s2, s3] = [await proveedor('Ficha Uno'), await proveedor('Ficha Dos'), await proveedor('Ficha Tres')]
  const p = await variante('Ficha')
  await enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s3.proveedorId, datos: { codigoProveedor: 'T-3', diasEntrega: 2 } }, como(ctx.usuario)))
  await enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s2.proveedorId, datos: {} }, como(ctx.usuario)))
  const o1 = await pedida(s1.proveedorId, [L(p, 10, '4')])
  await recibir(o1.ordenId, { lineas: [{ varianteId: p, cantidad: 3 }] })
  // El preferido es «Ficha Uno»: alfabéticamente el último, y aun así va primero.
  await enA((tx) => vincularProveedorEnTx(tx, ctx.a, { varianteId: p, proveedorId: s1.proveedorId, datos: { preferido: true } }, como(ctx.usuario)))
  // Una orden con dos productos donde el nuestro ya llegó completo y el otro no: de ESTE producto no queda nada pedido.
  const otroProducto = await variante('Ficha otro')
  const mixta = await pedida(s2.proveedorId, [L(p, 3, '1'), L(otroProducto, 5, '1')])
  await recibir(mixta.ordenId, { lineas: [{ varianteId: p, cantidad: 3 }] })
  assert.equal((await orden(mixta.ordenId)).status, 'PARTIAL')
  const o2 = await pedida(s2.proveedorId, [L(p, 5, '6')], ctx.sucA2)
  const borrador = await guardar(s1.proveedorId, [L(p, 99, '1')])
  const cerrada = await pedida(s1.proveedorId, [L(p, 2, '1')])
  await recibir(cerrada.ordenId)
  const cancelada = await pedida(s1.proveedorId, [L(p, 50, '1')])
  await cancelar(cancelada.ordenId, 'no')
  assert.ok(borrador.ordenId)

  // Un faltante ya anotado en una orden ABIERTA (la base deja subir el contador) deja de contar como pedido.
  await prisma.$executeRaw`UPDATE "inventory_purchase_order_lines" SET "quantityCancelled" = 2 WHERE "orderId" = ${o2.ordenId} AND "catalogVariantId" = ${p}`
  const provs = await enA((tx) => proveedoresDeVarianteEnTx(tx, ctx.a, p))
  assert.deepEqual(
    provs.map((x) => [x.nombre, x.preferido, x.codigoProveedor, x.ultimoCosto, x.diasEntrega, x.activo]),
    [
      ['Ficha Uno', true, null, '1.00', null, true],
      ['Ficha Dos', false, null, '1.00', null, true],
      ['Ficha Tres', false, 'T-3', null, 2, true],
    ],
    'el preferido primero, después por nombre; el último costo de Uno es el de su recepción más reciente (la orden cerrada a 1)'
  )
  assert.ok(provs.find((x) => x.nombre === 'Ficha Uno')?.ultimoCostoEn instanceof Date)
  const pedido = await enA((tx) => pedidoEnCaminoDeVarianteEnTx(tx, ctx.a, p))
  assert.equal(pedido.total, 7 + 3, 'solo lo pedido que falta: 7 de la parcial y 3 de la pedida (2 ya se dieron por faltante); ni el borrador, ni lo cerrado, ni lo cancelado, ni lo que ya llegó')
  assert.deepEqual(pedido.ordenes.map((x) => [x.numero, x.pendiente, x.proveedorNombre, x.sucursalNombre]).sort(), [[o1.numero, 7, 'Ficha Uno', 'Principal'], [o2.numero, 3, 'Ficha Dos', 'Norte']].sort())
  assert.deepEqual(await enB((tx) => proveedoresDeVarianteEnTx(tx, ctx.b, p)), [])
  assert.equal((await enB((tx) => pedidoEnCaminoDeVarianteEnTx(tx, ctx.b, p))).total, 0)

  // La orden de una entrada: la tiene la que salió de una orden; no la de una entrada a mano ni la de otra empresa.
  const tanda = await prisma.inventoryReceipt.findFirstOrThrow({ where: { purchaseOrderId: o1.ordenId }, select: { id: true } })
  assert.deepEqual(await enA((tx) => ordenDeEntradaEnTx(tx, ctx.a, tanda.id)), { id: o1.ordenId, numero: o1.numero, proveedorNombre: 'Ficha Uno' })
  const manual = await entradaManual(ctx.sucA1, [{ varianteId: p, cantidad: 1 }])
  assert.equal(await enA((tx) => ordenDeEntradaEnTx(tx, ctx.a, manual.entradaId)), null)
  assert.equal(await enB((tx) => ordenDeEntradaEnTx(tx, ctx.b, tanda.id)), null)
  assert.equal(await enA((tx) => ordenDeEntradaEnTx(tx, ctx.a, 'no-existe')), null)
  assert.equal(await enA((tx) => ordenDeEntradaEnTx(tx, ctx.a, '')), null)
})

// ── La base, cláusula por cláusula ───────────────────────────────────────────

test('37 · la base: cada cláusula de los CHECK rechaza lo suyo — las formas válidas entran y la menor desviación no', async () => {
  const s = await proveedor('Cláusulas')
  const p = await variante('Cláusulas')
  const ejecutar = (sql: string) => prisma.$executeRawUnsafe(sql)
  const limpiar = () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const t of ['inventory_variant_suppliers', 'inventory_purchase_order_lines', 'inventory_purchase_orders', 'inventory_suppliers']) await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "id" LIKE 'x-ck%'`)
    })
  let n = 0
  try {
    // ── Órdenes: una forma válida por estado, y cada desviación rechazada por el CHECK ──
    const orden = (cols: Record<string, string>) => {
      const id = `x-ck-o${++n}`
      const columnas = ['id', 'companyId', 'number', 'supplierId', 'locationId', ...Object.keys(cols)]
      const valores = [`'${id}'`, `'${ctx.a}'`, `'OC-2097-${String(n).padStart(6, '0')}'`, `'${s.proveedorId}'`, `'${ctx.sucA1}'`, ...Object.values(cols)]
      return ejecutar(`INSERT INTO "inventory_purchase_orders" (${columnas.map((c) => `"${c}"`).join(',')}) VALUES (${valores.join(',')})`)
    }
    const BORRADOR = {}
    const PEDIDA = { status: `'ORDERED'`, orderedAt: 'now()', orderedUnits: '5', lineCount: '1' }
    const RECIBIDA = { status: `'RECEIVED'`, orderedAt: 'now()', orderedUnits: '5', closedAt: 'now()', receivedUnits: '5', shortUnits: '0', lineCount: '1' }
    const CANCELADA_BORRADOR = { status: `'CANCELLED'`, closedAt: 'now()' }
    const CANCELADA_PEDIDA = { status: `'CANCELLED'`, orderedAt: 'now()', orderedUnits: '5', closedAt: 'now()', receivedUnits: '0', shortUnits: '5', closeReason: `'x'`, lineCount: '1' }
    for (const [nombre, forma] of Object.entries({ BORRADOR, PEDIDA, RECIBIDA, CANCELADA_BORRADOR, CANCELADA_PEDIDA })) {
      await orden(forma).catch((e) => assert.fail(`la forma válida «${nombre}» debía entrar: ${e instanceof Error ? e.message.slice(0, 160) : e}`))
    }
    const largo = (k: number) => `'${'x'.repeat(k)}'`
    const malas: Array<[string, Record<string, string>]> = [
      ['nota de 501', { ...BORRADOR, note: largo(501) }],
      ['referencia de 121', { ...BORRADOR, reference: largo(121) }],
      ['motivo de 301', { ...CANCELADA_BORRADOR, closeReason: largo(301) }],
      ['borrador con total pedido', { ...BORRADOR, orderedUnits: '5' }],
      ['borrador con total recibido', { ...BORRADOR, receivedUnits: '1' }],
      ['borrador con faltante', { ...BORRADOR, shortUnits: '1' }],
      ['borrador con fecha de cierre', { ...BORRADOR, closedAt: 'now()' }],
      ['borrador con quién cerró', { ...BORRADOR, closedById: `'u'` }],
      ['borrador con motivo', { ...BORRADOR, closeReason: `'x'` }],
      ['pedida sin total pedido', { ...PEDIDA, orderedUnits: 'NULL' }],
      ['pedida con menos unidades que líneas', { ...PEDIDA, lineCount: '3', orderedUnits: '2' }],
      ['pedida sin líneas', { ...PEDIDA, lineCount: '0', orderedUnits: '0' }],
      ['pedida sin fecha de pedido', { ...PEDIDA, orderedAt: 'NULL' }],
      ['pedida con total recibido', { ...PEDIDA, receivedUnits: '0' }],
      ['pedida con faltante', { ...PEDIDA, shortUnits: '0' }],
      ['pedida ya cerrada', { ...PEDIDA, closedAt: 'now()' }],
      ['pedida con quién cerró', { ...PEDIDA, closedById: `'u'` }],
      ['pedida con motivo', { ...PEDIDA, closeReason: `'x'` }],
      ['recibida sin fecha de pedido', { ...RECIBIDA, orderedAt: 'NULL' }],
      ['recibida sin total pedido', { ...RECIBIDA, orderedUnits: 'NULL' }],
      ['recibida sin fecha de cierre', { ...RECIBIDA, closedAt: 'NULL' }],
      ['recibida sin total recibido', { ...RECIBIDA, receivedUnits: 'NULL' }],
      ['recibida sin faltante', { ...RECIBIDA, shortUnits: 'NULL' }],
      ['recibida sin nada recibido', { ...RECIBIDA, receivedUnits: '0', shortUnits: '5', closeReason: `'x'` }],
      ['recibida con faltante negativo', { ...RECIBIDA, receivedUnits: '6', shortUnits: '-1' }],
      ['recibida que no cuadra', { ...RECIBIDA, receivedUnits: '4' }],
      ['recibida con faltante sin motivo', { ...RECIBIDA, receivedUnits: '3', shortUnits: '2' }],
      ['cancelada sin fecha de cierre', { ...CANCELADA_BORRADOR, closedAt: 'NULL' }],
      ['cancelada de borrador con total pedido', { ...CANCELADA_BORRADOR, orderedUnits: '5' }],
      ['cancelada de borrador con total recibido', { ...CANCELADA_BORRADOR, receivedUnits: '0' }],
      ['cancelada de borrador con faltante', { ...CANCELADA_BORRADOR, shortUnits: '0' }],
      ['cancelada pedida con algo recibido', { ...CANCELADA_PEDIDA, receivedUnits: '1', shortUnits: '4' }],
      ['cancelada pedida con faltante distinto', { ...CANCELADA_PEDIDA, shortUnits: '3' }],
      ['cancelada pedida sin motivo', { ...CANCELADA_PEDIDA, closeReason: 'NULL' }],
      ['cancelada pedida sin total pedido', { ...CANCELADA_PEDIDA, orderedUnits: 'NULL' }],
    ]
    for (const [nombre, forma] of malas) await assert.rejects(orden(forma), /inventory_purchase_orders_forma/, nombre)

    // ── Líneas: cada cláusula, SIN los disparadores (con ellos, el disparador responde antes que el CHECK) ──
    const idOrden = 'x-ck-o1' // un borrador
    const lineaSinDisparadores = (cols: Record<string, string>) => {
      const c = { quantityOrdered: '5', quantityReceived: '0', quantityCancelled: '0', unitCost: '1', position: '0', ...cols }
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
        await tx.$executeRawUnsafe(
          `INSERT INTO "inventory_purchase_order_lines" ("id","companyId","orderId","catalogVariantId","position","quantityOrdered","quantityReceived","quantityCancelled","unitCost") VALUES ('x-ck-l${++n}','${ctx.a}','${idOrden}','${p}',${c.position},${c.quantityOrdered},${c.quantityReceived},${c.quantityCancelled},${c.unitCost})`
        )
        throw new Error('ENTRO') // la forma válida también se deshace: así no queda nada que limpiar
      })
    }
    await assert.rejects(lineaSinDisparadores({}), /ENTRO/, 'la línea válida entra')
    for (const [nombre, cols] of [
      ['cantidad cero', { quantityOrdered: '0' }],
      ['más de un millón', { quantityOrdered: '1000001' }],
      ['posición negativa', { position: '-1' }],
      ['recibido negativo', { quantityReceived: '-1' }],
      ['cancelado negativo', { quantityCancelled: '-1' }],
      ['recibido + cancelado de más', { quantityReceived: '3', quantityCancelled: '3' }],
      ['costo negativo', { unitCost: '-0.0001' }],
      ['costo sobre el tope', { unitCost: '100000000.0001' }],
    ] as Array<[string, Record<string, string>]>) {
      await assert.rejects(lineaSinDisparadores(cols), /inventory_purchase_order_lines_forma/, nombre)
    }
    await assert.rejects(lineaSinDisparadores({ quantityOrdered: '1000000', unitCost: '100000000' }), /ENTRO/, 'los topes exactos entran')

    // ── Proveedores y vínculos ────────────────────────────────────────────
    const proveedorRaw = (cols: Record<string, string>) => {
      const id = `x-ck-s${++n}`
      const c = { name: `'Cláusula ${n}'`, ...cols }
      return ejecutar(`INSERT INTO "inventory_suppliers" ("id","companyId","updatedAt",${Object.keys(c).map((k) => `"${k}"`).join(',')}) VALUES ('${id}','${ctx.a}',now(),${Object.values(c).join(',')})`)
    }
    await proveedorRaw({ name: largo(120), taxId: largo(30), contactName: largo(120), phone: largo(40), email: largo(160), notes: largo(500), creditDays: '365' })
    await proveedorRaw({ creditDays: '0' })
    for (const [nombre, cols] of [
      ['nombre de 121', { name: largo(121) }],
      ['nombre en blanco', { name: `'   '` }],
      ['crédito negativo', { creditDays: '-1' }],
      ['crédito de 366', { creditDays: '366' }],
      ['RNC de 31', { taxId: largo(31) }],
      ['contacto de 121', { contactName: largo(121) }],
      ['teléfono de 41', { phone: largo(41) }],
      ['correo de 161', { email: largo(161) }],
      ['notas de 501', { notes: largo(501) }],
    ] as Array<[string, Record<string, string>]>) {
      await assert.rejects(proveedorRaw({ name: `'Cláusula x${++n}'`, ...cols }), /inventory_suppliers_forma/, nombre)
    }
    const otroProveedor = await proveedor('Cláusulas otro')
    let k = 0
    const vinculoRaw = (cols: Record<string, string>) => {
      // Un proveedor distinto cada vez: el único (producto, proveedor) no debe estorbar a lo que se prueba.
      const prov = k++ === 0 ? s.proveedorId : otroProveedor.proveedorId
      const c = { ...cols }
      return ejecutar(
        `INSERT INTO "inventory_variant_suppliers" ("id","companyId","catalogVariantId","supplierId","updatedAt"${Object.keys(c).map((x) => `,"${x}"`).join('')}) VALUES ('x-ck-v${++n}','${ctx.a}','${p}','${prov}',now()${Object.values(c).map((v) => `,${v}`).join('')})`
      )
    }
    await vinculoRaw({ supplierSku: largo(80), leadTimeDays: '365', lastCost: '100000000' })
    for (const [nombre, cols] of [
      ['código de 81', { supplierSku: largo(81) }],
      ['entrega negativa', { leadTimeDays: '-1' }],
      ['entrega de 366', { leadTimeDays: '366' }],
      ['último costo negativo', { lastCost: '-0.0001' }],
      ['último costo sobre el tope', { lastCost: '100000000.0001' }],
    ] as Array<[string, Record<string, string>]>) {
      k = 1 // siempre el segundo proveedor (el primero ya tiene su vínculo válido)
      await assert.rejects(vinculoRaw(cols), /inventory_variant_suppliers_forma/, nombre)
    }
  } finally {
    await limpiar()
  }
})

test('38 · el nombre repetido se rechaza aunque la base NO tenga el índice único (una base armada con db push, como la del E2E y el CI, no lo trae)', async () => {
  const x = await proveedor('Sin Indice Norte')
  const y = await proveedor('Sin Indice Sur')
  const SENTINELA = 'deshacer-sin-indice'
  // DROP INDEX es transaccional en PostgreSQL: se quita el índice dentro de una transacción que SIEMPRE se deshace.
  await assert.rejects(
    enA(async (tx) => {
      await tx.$executeRawUnsafe('DROP INDEX "inventory_suppliers_companyId_name_lower_key"')
      assert.equal(await codigoDe(crearProveedorEnTx(tx, ctx.a, { nombre: 'SIN INDICE NORTE' }, como(ctx.usuario))), 'PROVEEDOR_REPETIDO', 'crear')
      assert.equal(await codigoDe(actualizarProveedorEnTx(tx, ctx.a, { proveedorId: y.proveedorId, datos: { nombre: 'sin indice norte' } }, como(ctx.usuario))), 'PROVEEDOR_REPETIDO', 'editar')
      // Sin índice, lo que sí es válido sigue pasando: otro nombre, y el propio nombre con otro uso de mayúsculas.
      await crearProveedorEnTx(tx, ctx.a, { nombre: 'Sin Indice Este' }, como(ctx.usuario))
      await actualizarProveedorEnTx(tx, ctx.a, { proveedorId: x.proveedorId, datos: { nombre: 'SIN INDICE NORTE' } }, como(ctx.usuario))
      throw new Error(SENTINELA)
    }),
    new RegExp(SENTINELA)
  )
  const indice = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'inventory_suppliers_companyId_name_lower_key'`
  assert.equal(indice[0].n, 1, 'el índice sigue ahí: la transacción se deshizo')
  assert.equal(await prisma.inventorySupplier.count({ where: { companyId: ctx.a, name: { startsWith: 'Sin Indice' } } }), 2, 'nada de lo hecho sin índice quedó escrito')
})
