import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { siguienteNumero } from '@/lib/commerce-primitives/numeracion'
import { esViolacionUnica } from '@/lib/prisma-errors'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { auditarInventario, type ContextoAuditoria } from './auditoria'
import {
  MAX_MOTIVO_ORDEN,
  MAX_NOTA_ORDEN,
  MAX_REFERENCIA_ORDEN,
  PREFIJO_ORDEN,
  esEstadoOrden,
  fechaPrevistaATexto,
  pendienteDeOrden,
  planDeRecepcionOrden,
  puedeRecibirse,
  validarCabeceraOrden,
  validarCancelacionDeOrden,
  validarLineasOrden,
  validarProveedor,
  validarVinculo,
  type EstadoOrden,
  type LineaRecibida,
} from './compras'
import { costoADecimal, costoDeDecimal, formatearMonto, valorDe, type Costo } from './costos'
import { normalizarTextoLibre } from './entradas'
import { fallo } from './errores'
import { registrarEntradaMultipleEnTx } from './service'

/**
 * COMMERCE CORE · inventario — INV-3b: proveedores y órdenes de compra (servicio).
 *
 * Este archivo NO toca el ledger ni los saldos: recibir una orden delega en
 * `registrarEntradaMultipleEnTx` (la misma entrada de mercancía de siempre, con el
 * costo de cada línea), así que el stock y el costo promedio siguen teniendo UN
 * solo camino de escritura. Lo propio de aquí son los DOCUMENTOS: el proveedor, la
 * orden con sus líneas y el vínculo producto↔proveedor.
 *
 * CONCURRENCIA. Recibir y cancelar bloquean PRIMERO la orden (`SELECT … FOR UPDATE`) y
 * después, dentro de la entrada, los saldos (orden de id) y los renglones de costo
 * (orden de producto). Nada bloquea saldos y luego una orden, así que no hay ciclos.
 * La idempotencia se revisa YA con la orden bloqueada: el segundo de dos envíos
 * idénticos llega tras el primero y devuelve su resultado. Crear un borrador con
 * clave de idempotencia toma antes un cerrojo de esa clave, para que dos envíos
 * simultáneos no lleguen los dos a numerar.
 *
 * Los resultados de las líneas (lo recibido, lo cerrado) se escriben ANTES de cambiar
 * el estado de la orden, que después no admite cambios (la base lo exige).
 */

// ── Ayudas ───────────────────────────────────────────────────────────────────

function claveValida(k: unknown): string | null {
  if (k === undefined || k === null || k === '') return null
  if (typeof k !== 'string' || k.length > 120) fallo('CLAVE_INVALIDA', 'La clave de idempotencia no es válida.')
  return k
}

function idObligatorio(v: unknown, codigo: string, mensaje: string): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 120) fallo(codigo, mensaje)
  return v
}

/** Cerrojo de transacción sobre una clave de idempotencia: dos envíos idénticos simultáneos se turnan. */
async function bloquearClave(tx: Tx, companyId: string, ambito: string, clave: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ambito}:${companyId}:${clave}`}))`
}

/** El último correlativo de órdenes de la empresa para el prefijo con año (`OC-2026-`). */
async function ultimaOrden(tx: Tx, companyId: string, prefijo: string): Promise<string | null> {
  const filas = await tx.$queryRaw<{ number: string }[]>`
    SELECT "number" FROM "inventory_purchase_orders"
     WHERE "companyId" = ${companyId} AND "number" ~ ${'^' + prefijo + '[0-9]{6,}$'}
     ORDER BY "number" DESC LIMIT 1`
  return filas[0]?.number ?? null
}

interface OrdenBloqueada {
  id: string
  number: string
  status: EstadoOrden
  supplierId: string
  locationId: string
  orderedUnits: number | null
}

/** Bloquea la orden y la devuelve; si no existe (o es de otra empresa) se dice igual: no existe. */
async function bloquearOrden(tx: Tx, companyId: string, ordenId: unknown): Promise<OrdenBloqueada> {
  if (typeof ordenId !== 'string' || ordenId === '' || ordenId.length > 120) fallo('ORDEN_NO_ENCONTRADA', 'La orden de compra no existe.')
  const filas = await tx.$queryRaw<OrdenBloqueada[]>`
    SELECT "id", "number", "status", "supplierId", "locationId", "orderedUnits"
      FROM "inventory_purchase_orders"
     WHERE "id" = ${ordenId} AND "companyId" = ${companyId}
       FOR UPDATE`
  const o = filas[0]
  if (!o || !esEstadoOrden(o.status)) fallo('ORDEN_NO_ENCONTRADA', 'La orden de compra no existe.')
  return o
}

/** Las líneas de una orden, en el orden en que se capturaron, con lo que ha pasado con cada una. */
async function lineasDeOrden(tx: Tx, companyId: string, ordenId: string) {
  const filas = await tx.inventoryPurchaseOrderLine.findMany({
    where: { companyId, orderId: ordenId },
    orderBy: [{ position: 'asc' }],
    select: { id: true, catalogVariantId: true, quantityOrdered: true, quantityReceived: true, quantityCancelled: true, unitCost: true },
  })
  return filas.map((l) => ({
    id: l.id,
    varianteId: l.catalogVariantId,
    pedido: l.quantityOrdered,
    recibido: l.quantityReceived,
    cancelado: l.quantityCancelled,
    costo: costoDeDecimal(l.unitCost) as Costo,
  }))
}

async function exigirProveedor(tx: Tx, companyId: string, proveedorId: string, activo: boolean) {
  const p = await tx.inventorySupplier.findFirst({ where: { id: proveedorId, companyId }, select: { id: true, name: true, active: true } })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (activo && !p.active) fallo('PROVEEDOR_INACTIVO', `El proveedor «${p.name}» está desactivado. Actívalo para hacerle pedidos.`)
  return p
}

async function exigirSucursal(tx: Tx, companyId: string, sucursalId: string, activa: boolean) {
  const s = await tx.sucursal.findFirst({ where: { id: sucursalId, companyId }, select: { id: true, nombre: true, activa: true } })
  if (!s) fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal no existe.')
  if (activa && !s.activa) fallo('SUCURSAL_INACTIVA', `La sucursal «${s.nombre}» está desactivada.`)
  return s
}

/** Todos los productos existen en la empresa y controlan inventario (si no, no tiene sentido pedirlos). */
async function exigirVariantesControladas(tx: Tx, companyId: string, ids: readonly string[]) {
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: [...ids] } },
    select: { id: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  for (const id of ids) {
    const v = porId.get(id)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los productos de la orden ya no existe.')
    if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      fallo('SIN_CONTROL_DE_INVENTARIO', `«${v.item.name}» no controla inventario. Actívalo en su ficha del catálogo para llevar existencias.`)
    }
  }
  return porId
}

// ── Proveedores ──────────────────────────────────────────────────────────────

export interface ResultadoProveedor {
  proveedorId: string
  nombre: string
}

const MENSAJE_PROVEEDOR_REPETIDO = 'Ya tienes un proveedor con ese nombre (sin importar mayúsculas).'

function traducirNombreRepetido(err: unknown): never {
  if (esViolacionUnica(err)) fallo('PROVEEDOR_REPETIDO', MENSAJE_PROVEEDOR_REPETIDO)
  throw err
}

/**
 * El nombre no se repite en la empresa, sin distinguir mayúsculas. Se mira ANTES de escribir y no solo se deja a la base:
 * el índice único `(companyId, lower(name))` no se puede expresar en el esquema de Prisma, así que una base armada con
 * `db push` (el E2E y el CI) no lo trae, y la regla no puede depender de que exista. El índice sigue siendo la
 * garantía contra dos altas a la vez (esa carrera la traduce `traducirNombreRepetido`).
 */
async function exigirNombreLibre(tx: Tx, companyId: string, nombre: string, exceptoId?: string) {
  const otro = exceptoId ? Prisma.sql`AND "id" <> ${exceptoId}` : Prisma.empty
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "inventory_suppliers"
    WHERE "companyId" = ${companyId} AND lower("name") = lower(${nombre}) ${otro}
    LIMIT 1`
  if (filas.length > 0) fallo('PROVEEDOR_REPETIDO', MENSAJE_PROVEEDOR_REPETIDO)
}

export async function crearProveedorEnTx(tx: Tx, companyId: string, datos: unknown, ctx: ContextoAuditoria): Promise<ResultadoProveedor> {
  const v = validarProveedor(datos)
  if (!v.ok) fallo(v.codigo, v.error)
  const d = v.valor
  await exigirNombreLibre(tx, companyId, d.nombre)
  let creado
  try {
    creado = await tx.inventorySupplier.create({
      data: { companyId, name: d.nombre, taxId: d.rnc, contactName: d.contacto, phone: d.telefono, email: d.correo, creditDays: d.diasCredito, notes: d.notas },
      select: { id: true },
    })
  } catch (err) {
    traducirNombreRepetido(err)
  }
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', creado.id, { tipo: 'PROVEEDOR_CREADO', proveedor: d.nombre, diasCredito: d.diasCredito }, 'InventorySupplier')
  return { proveedorId: creado.id, nombre: d.nombre }
}

export async function actualizarProveedorEnTx(tx: Tx, companyId: string, e: { proveedorId: string; datos: unknown }, ctx: ContextoAuditoria): Promise<ResultadoProveedor> {
  const v = validarProveedor(e.datos)
  if (!v.ok) fallo(v.codigo, v.error)
  const id = idObligatorio(e.proveedorId, 'PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const previo = await tx.inventorySupplier.findFirst({ where: { id, companyId }, select: { id: true, name: true } })
  if (!previo) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const d = v.valor
  await exigirNombreLibre(tx, companyId, d.nombre, id)
  try {
    await tx.inventorySupplier.update({
      where: { id_companyId: { id, companyId } },
      data: { name: d.nombre, taxId: d.rnc, contactName: d.contacto, phone: d.telefono, email: d.correo, creditDays: d.diasCredito, notes: d.notas },
    })
  } catch (err) {
    traducirNombreRepetido(err)
  }
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', id, { tipo: 'PROVEEDOR_EDITADO', proveedor: d.nombre, antes: previo.name, diasCredito: d.diasCredito }, 'InventorySupplier')
  return { proveedorId: id, nombre: d.nombre }
}

/**
 * Activa o desactiva un proveedor. Uno desactivado ya no recibe pedidos nuevos, pero sus órdenes en curso se
 * siguen recibiendo y su historial no cambia. Los proveedores no se borran.
 */
export async function cambiarActivoProveedorEnTx(tx: Tx, companyId: string, e: { proveedorId: string; activo: boolean }, ctx: ContextoAuditoria): Promise<{ proveedorId: string; nombre: string; activo: boolean; cambiado: boolean }> {
  const id = idObligatorio(e.proveedorId, 'PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const p = await tx.inventorySupplier.findFirst({ where: { id, companyId }, select: { id: true, name: true, active: true } })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (p.active === e.activo) return { proveedorId: id, nombre: p.name, activo: p.active, cambiado: false }
  await tx.inventorySupplier.update({ where: { id_companyId: { id, companyId } }, data: { active: e.activo } })
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', id, { tipo: e.activo ? 'PROVEEDOR_ACTIVADO' : 'PROVEEDOR_DESACTIVADO', proveedor: p.name }, 'InventorySupplier')
  return { proveedorId: id, nombre: p.name, activo: e.activo, cambiado: true }
}

// ── Orden: crear y editar el borrador ────────────────────────────────────────

export interface EntradaOrden {
  /** Si viene, se reemplaza el contenido de ESE borrador; si no, se crea uno nuevo. */
  ordenId?: string | null
  cabecera: unknown
  lineas: unknown
  idempotencyKey?: string | null
  ahora?: Date
}

export interface ResultadoOrden {
  ordenId: string
  numero: string
  lineas: number
  unidades: number
  /** Lo que cuesta lo pedido, con dos decimales. */
  valor: string
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
}

function exigirBorrador(o: OrdenBloqueada): void {
  if (o.status === 'DRAFT') return
  if (o.status === 'CANCELLED') fallo('ORDEN_CERRADA', `La orden ${o.number} está cancelada: no admite cambios.`)
  if (o.status === 'RECEIVED') fallo('ORDEN_CERRADA', `La orden ${o.number} ya está recibida: no admite cambios.`)
  fallo('ORDEN_YA_PEDIDA', `La orden ${o.number} ya se pidió: no se edita. Si algo cambió, recíbela con lo que llegue o cancélala.`)
}

/** Crea una orden en BORRADOR, o reemplaza el contenido de uno (cabecera y líneas). Un borrador no mueve stock ni costos. */
export async function guardarOrdenEnTx(tx: Tx, companyId: string, e: EntradaOrden, ctx: ContextoAuditoria): Promise<ResultadoOrden> {
  const cab = validarCabeceraOrden(e.cabecera)
  if (!cab.ok) fallo(cab.codigo, cab.error)
  const lin = validarLineasOrden(e.lineas)
  if (!lin.ok) fallo(lin.codigo, lin.error)
  const clave = claveValida(e.idempotencyKey)
  const ahora = e.ahora ?? new Date()
  const c = cab.valor

  let editada: OrdenBloqueada | null = null
  if (e.ordenId) {
    editada = await bloquearOrden(tx, companyId, e.ordenId)
    exigirBorrador(editada)
  } else if (clave) {
    // Idempotencia, YA con el cerrojo de la clave: el segundo de dos envíos idénticos llega aquí tras el primero.
    await bloquearClave(tx, companyId, 'orden-compra', clave)
    const previa = await tx.inventoryPurchaseOrder.findFirst({
      where: { companyId, idempotencyKey: clave },
      select: { id: true, number: true, supplierId: true, locationId: true, lineCount: true, lines: { select: { catalogVariantId: true, quantityOrdered: true, unitCost: true } } },
    })
    if (previa) {
      const mismas =
        previa.supplierId === c.proveedorId &&
        previa.locationId === c.sucursalId &&
        previa.lines.length === lin.lineas.length &&
        lin.lineas.every((l) => previa.lines.some((p) => p.catalogVariantId === l.varianteId && p.quantityOrdered === l.cantidad && costoADecimal(costoDeDecimal(p.unitCost)) === l.costo))
      if (!mismas) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra orden distinta.')
      return { ordenId: previa.id, numero: previa.number, lineas: previa.lineCount, unidades: lin.unidades, valor: formatearMonto(lin.valor), repetido: true }
    }
  }

  const proveedor = await exigirProveedor(tx, companyId, c.proveedorId, true)
  const sucursal = await exigirSucursal(tx, companyId, c.sucursalId, true)
  await exigirVariantesControladas(tx, companyId, lin.lineas.map((l) => l.varianteId))

  let ordenId: string
  let numero: string
  if (editada) {
    ordenId = editada.id
    numero = editada.number
    await tx.inventoryPurchaseOrder.update({
      where: { id_companyId: { id: ordenId, companyId } },
      data: { supplierId: proveedor.id, locationId: sucursal.id, reference: c.referencia, note: c.nota, expectedAt: c.fechaPrevista, lineCount: lin.lineas.length },
    })
    await tx.inventoryPurchaseOrderLine.deleteMany({ where: { companyId, orderId: ordenId } })
  } else {
    numero = await siguienteNumero(tx, PREFIJO_ORDEN, (prefijo) => ultimaOrden(tx, companyId, prefijo), ahora, `compra:${companyId}`)
    try {
      const creada = await tx.inventoryPurchaseOrder.create({
        data: {
          companyId,
          number: numero,
          supplierId: proveedor.id,
          locationId: sucursal.id,
          reference: c.referencia,
          note: c.nota,
          expectedAt: c.fechaPrevista,
          idempotencyKey: clave,
          createdById: ctx.actorId,
          lineCount: lin.lineas.length,
        },
        select: { id: true },
      })
      ordenId = creada.id
    } catch (err) {
      if (esViolacionUnica(err)) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra orden distinta.')
      throw err
    }
  }
  await tx.inventoryPurchaseOrderLine.createMany({
    data: lin.lineas.map((l, idx) => ({ companyId, orderId: ordenId, catalogVariantId: l.varianteId, position: idx, quantityOrdered: l.cantidad, unitCost: l.costo })),
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    ordenId,
    { tipo: editada ? 'ORDEN_EDITADA' : 'ORDEN_CREADA', orden: numero, proveedor: proveedor.name, sucursal: sucursal.nombre, lineas: lin.lineas.length, unidades: lin.unidades, valor: formatearMonto(lin.valor), prevista: fechaPrevistaATexto(c.fechaPrevista) || null },
    'InventoryPurchaseOrder'
  )
  return { ordenId, numero, lineas: lin.lineas.length, unidades: lin.unidades, valor: formatearMonto(lin.valor), repetido: false }
}

// ── Orden: pedir ─────────────────────────────────────────────────────────────

export interface ResultadoPedir {
  ordenId: string
  numero: string
  estado: EstadoOrden
  unidades: number
  valor: string
  /** true si la orden ya estaba pedida: no se hizo nada nuevo. */
  repetido: boolean
}

/** Pide la orden al proveedor: desde aquí sus líneas se congelan y solo avanza (se recibe o se cierra). */
export async function pedirOrdenEnTx(tx: Tx, companyId: string, e: { ordenId: string; ahora?: Date }, ctx: ContextoAuditoria): Promise<ResultadoPedir> {
  const ahora = e.ahora ?? new Date()
  const orden = await bloquearOrden(tx, companyId, e.ordenId)
  const lineas = await lineasDeOrden(tx, companyId, orden.id)
  const unidades = lineas.reduce((s, l) => s + l.pedido, 0)
  const valor = lineas.reduce((s, l) => s + valorDe(l.pedido, l.costo), BigInt(0))
  if (orden.status === 'ORDERED' || orden.status === 'PARTIAL' || orden.status === 'RECEIVED') {
    return { ordenId: orden.id, numero: orden.number, estado: orden.status, unidades, valor: formatearMonto(valor), repetido: true }
  }
  if (orden.status === 'CANCELLED') fallo('ORDEN_CERRADA', `La orden ${orden.number} está cancelada: no admite cambios.`)
  if (lineas.length === 0) fallo('ORDEN_SIN_LINEAS', 'Agrega al menos un producto antes de pedir la orden.')

  const proveedor = await exigirProveedor(tx, companyId, orden.supplierId, true)
  const sucursal = await exigirSucursal(tx, companyId, orden.locationId, true)
  await exigirVariantesControladas(tx, companyId, lineas.map((l) => l.varianteId))

  await tx.inventoryPurchaseOrder.update({
    where: { id_companyId: { id: orden.id, companyId } },
    data: { status: 'ORDERED', orderedAt: ahora, orderedById: ctx.actorId, orderedUnits: unidades, lineCount: lineas.length },
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    orden.id,
    { tipo: 'ORDEN_PEDIDA', orden: orden.number, proveedor: proveedor.name, sucursal: sucursal.nombre, lineas: lineas.length, unidades, valor: formatearMonto(valor) },
    'InventoryPurchaseOrder'
  )
  return { ordenId: orden.id, numero: orden.number, estado: 'ORDERED', unidades, valor: formatearMonto(valor), repetido: false }
}

// ── Orden: cancelar ──────────────────────────────────────────────────────────

/** Cancela un borrador (se descarta) o una orden pedida sin nada recibido (con motivo). Una ya cancelada devuelve `repetido`. */
export async function cancelarOrdenEnTx(
  tx: Tx,
  companyId: string,
  e: { ordenId: string; motivo?: string | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ ordenId: string; numero: string; repetido: boolean }> {
  const ahora = e.ahora ?? new Date()
  const orden = await bloquearOrden(tx, companyId, e.ordenId)
  if (orden.status === 'CANCELLED') return { ordenId: orden.id, numero: orden.number, repetido: true }
  const v = validarCancelacionDeOrden(orden.status, e.motivo)
  if (!v.ok) fallo(v.codigo, v.error)

  const pedida = orden.status === 'ORDERED'
  if (pedida) {
    // Lo pedido que no llegó se cierra como faltante en cada línea, ANTES de cerrar la orden.
    await tx.$executeRaw`
      UPDATE "inventory_purchase_order_lines"
         SET "quantityCancelled" = "quantityOrdered" - "quantityReceived"
       WHERE "orderId" = ${orden.id} AND "companyId" = ${companyId}`
  }
  await tx.inventoryPurchaseOrder.update({
    where: { id_companyId: { id: orden.id, companyId } },
    data: {
      status: 'CANCELLED',
      closedAt: ahora,
      closedById: ctx.actorId,
      closeReason: v.motivo,
      ...(pedida ? { receivedUnits: 0, shortUnits: orden.orderedUnits ?? 0 } : {}),
    },
  })
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', orden.id, { tipo: 'ORDEN_CANCELADA', orden: orden.number, estabaPedida: pedida, motivo: v.motivo }, 'InventoryPurchaseOrder')
  return { ordenId: orden.id, numero: orden.number, repetido: false }
}

// ── Orden: recibir ───────────────────────────────────────────────────────────

export interface EntradaRecepcionOrden {
  ordenId: string
  /** Lo que llegó de cada producto. Si falta, `todo` debe venir. */
  lineas?: readonly LineaRecibida[]
  /** Recibir todo lo que falte por llegar. */
  todo?: boolean
  /** Cerrar lo que no llegó como faltante (la orden queda recibida). Exige motivo. */
  cerrarConFaltante?: boolean
  motivo?: string | null
  /** La factura o remisión del proveedor de esta tanda. */
  referencia?: string | null
  nota?: string | null
  idempotencyKey?: string | null
  ahora?: Date
}

export interface ResultadoRecepcionOrden {
  ordenId: string
  numero: string
  estado: EstadoOrden
  /** Unidades que entraron al stock en esta tanda. */
  recibidas: number
  /** Unidades que se cerraron como faltante en esta tanda. */
  cerradas: number
  /** Lo que sigue por llegar después de esta tanda. */
  pendientes: number
  /** La entrada de mercancía que creó esta tanda (null si solo se cerró un faltante o si fue un reintento sin entrada). */
  entradaId: string | null
  entradaNumero: string | null
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
}

/**
 * RECIBE mercancía de una orden pedida, en una o varias tandas. Cada tanda es UNA entrada de mercancía (todo o nada)
 * con el costo de cada línea de la orden: mueve el costo promedio y deja el último costo del proveedor en el producto.
 * Se puede cerrar lo que falta como faltante (con motivo). No se recibe más de lo pedido.
 */
export async function recibirOrdenEnTx(tx: Tx, companyId: string, e: EntradaRecepcionOrden, ctx: ContextoAuditoria): Promise<ResultadoRecepcionOrden> {
  const motivo = normalizarTextoLibre(e.motivo, MAX_MOTIVO_ORDEN, 'El motivo')
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  const referencia = normalizarTextoLibre(e.referencia, MAX_REFERENCIA_ORDEN, 'La referencia')
  if (!referencia.ok) fallo('REFERENCIA_INVALIDA', referencia.error)
  const nota = normalizarTextoLibre(e.nota, MAX_NOTA_ORDEN, 'La nota')
  if (!nota.ok) fallo('NOTA_INVALIDA', nota.error)
  const clave = claveValida(e.idempotencyKey)
  const ahora = e.ahora ?? new Date()

  const orden = await bloquearOrden(tx, companyId, e.ordenId)
  const lineas = await lineasDeOrden(tx, companyId, orden.id)
  const estadoActual = async (parcial: Pick<ResultadoRecepcionOrden, 'recibidas' | 'cerradas' | 'entradaId' | 'entradaNumero'>, repetido: boolean): Promise<ResultadoRecepcionOrden> => {
    const o = await tx.inventoryPurchaseOrder.findFirstOrThrow({ where: { id: orden.id, companyId }, select: { status: true } })
    const fresco = await lineasDeOrden(tx, companyId, orden.id)
    return { ordenId: orden.id, numero: orden.number, estado: o.status, ...parcial, pendientes: fresco.reduce((s, l) => s + pendienteDeOrden(l), 0), repetido }
  }

  // Idempotencia, YA con la orden bloqueada: el segundo de dos envíos idénticos llega aquí tras el primero.
  if (clave) {
    const previa = await tx.inventoryReceipt.findFirst({
      where: { companyId, idempotencyKey: clave },
      select: { id: true, number: true, purchaseOrderId: true, unitCount: true, lines: { select: { catalogVariantId: true, quantity: true } } },
    })
    if (previa) {
      if (previa.purchaseOrderId !== orden.id) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra recepción distinta.')
      // Misma recepción = mismos productos y cantidades (con `todo` no se puede comparar: cuenta lo que ya llegó con esa clave).
      if (!e.todo) {
        const pedidas = new Map((e.lineas ?? []).filter((l) => l?.cantidad > 0).map((l) => [l.varianteId, l.cantidad]))
        if (pedidas.size !== previa.lines.length || previa.lines.some((p) => pedidas.get(p.catalogVariantId) !== p.quantity)) {
          fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra recepción distinta.')
        }
      }
      return estadoActual({ recibidas: previa.unitCount, cerradas: 0, entradaId: previa.id, entradaNumero: previa.number }, true)
    }
  }
  if (orden.status === 'DRAFT') fallo('ORDEN_SIN_PEDIR', `La orden ${orden.number} sigue en borrador: pídela antes de recibir mercancía.`)
  if (!puedeRecibirse(orden.status)) {
    fallo('ORDEN_CERRADA', orden.status === 'RECEIVED' ? `La orden ${orden.number} ya está recibida: no admite cambios.` : `La orden ${orden.number} está cancelada: no admite cambios.`)
  }

  const plan = planDeRecepcionOrden(lineas, e.todo ? 'TODO' : [...(e.lineas ?? [])], e.cerrarConFaltante === true, motivo.valor)
  if (!plan.ok) fallo(plan.codigo, plan.error)

  const costoDe = new Map(lineas.map((l) => [l.varianteId, l.costo]))
  let entrada: { entradaId: string; numero: string } | null = null
  if (plan.recibir.length > 0) {
    const sucursal = await tx.sucursal.findFirst({ where: { id: orden.locationId, companyId }, select: { nombre: true, activa: true } })
    if (!sucursal) fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal de la orden ya no existe.')
    if (!sucursal.activa) fallo('SUCURSAL_INACTIVA', `La sucursal «${sucursal.nombre}» está desactivada. Actívala para recibir esta orden, o ciérrala con faltante si la mercancía no va a llegar.`)
    const r = await registrarEntradaMultipleEnTx(
      tx,
      companyId,
      {
        sucursalId: orden.locationId,
        lineas: plan.recibir.map((x) => ({ varianteId: x.varianteId, cantidad: x.cantidad, costo: costoADecimal(costoDe.get(x.varianteId)!) })),
        referencia: referencia.valor,
        nota: nota.valor,
        origen: 'MANUAL',
        idempotencyKey: clave,
        ordenCompraId: orden.id,
        ahora,
      },
      ctx
    )
    entrada = { entradaId: r.entradaId, numero: r.numero }
  }

  // Lo recibido y lo cerrado de cada línea: se escribe ANTES de cambiar el estado de la orden, que después no admite cambios.
  const recibidoAhora = new Map(plan.recibir.map((r) => [r.varianteId, r.cantidad]))
  const cerradoAhora = new Map(plan.cerrar.map((r) => [r.varianteId, r.cantidad]))
  const tocadas = lineas.filter((l) => recibidoAhora.has(l.varianteId) || cerradoAhora.has(l.varianteId))
  if (tocadas.length > 0) {
    const valores = tocadas.map((l) => Prisma.sql`(${l.id}, ${recibidoAhora.get(l.varianteId) ?? 0}::int, ${cerradoAhora.get(l.varianteId) ?? 0}::int)`)
    const escritas = await tx.$executeRaw`
      UPDATE "inventory_purchase_order_lines" AS l
         SET "quantityReceived" = l."quantityReceived" + v."recibido", "quantityCancelled" = l."quantityCancelled" + v."cerrado"
        FROM (VALUES ${Prisma.join(valores)}) AS v("id", "recibido", "cerrado")
       WHERE l."id" = v."id" AND l."companyId" = ${companyId} AND l."orderId" = ${orden.id}`
    if (escritas !== tocadas.length) fallo('LOTE_INCOMPLETO', 'No se pudieron actualizar todas las líneas de la orden.')
  }

  // El último costo de cada proveedor por producto: se crea el vínculo si no existía (en orden de producto) y se actualiza.
  if (plan.recibir.length > 0) {
    const ordenadas = [...plan.recibir].sort((a, b) => (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0))
    await tx.inventoryVariantSupplier.createMany({ data: ordenadas.map((x) => ({ companyId, catalogVariantId: x.varianteId, supplierId: orden.supplierId })), skipDuplicates: true })
    const valores = ordenadas.map((x) => Prisma.sql`(${x.varianteId}, ${costoADecimal(costoDe.get(x.varianteId)!)}::numeric)`)
    // `now() AT TIME ZONE 'UTC'` y no `now()`: la columna es `timestamp` sin zona y Prisma escribe en UTC.
    const vinculados = await tx.$executeRaw`
      UPDATE "inventory_variant_suppliers" AS t
         SET "lastCost" = v."costo", "lastCostAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM (VALUES ${Prisma.join(valores)}) AS v("id", "costo")
       WHERE t."catalogVariantId" = v."id" AND t."supplierId" = ${orden.supplierId} AND t."companyId" = ${companyId}`
    if (vinculados !== ordenadas.length) fallo('LOTE_INCOMPLETO', 'No se pudo guardar el último costo del proveedor en todos los productos.')
  }

  const recibidasAhora = plan.recibir.reduce((s, r) => s + r.cantidad, 0)
  const cerradasAhora = plan.cerrar.reduce((s, r) => s + r.cantidad, 0)
  if (plan.estadoFinal === 'RECEIVED') {
    const totalRecibido = lineas.reduce((s, l) => s + l.recibido, 0) + recibidasAhora
    const totalCerrado = lineas.reduce((s, l) => s + l.cancelado, 0) + cerradasAhora
    await tx.inventoryPurchaseOrder.update({
      where: { id_companyId: { id: orden.id, companyId } },
      data: { status: 'RECEIVED', closedAt: ahora, closedById: ctx.actorId, closeReason: cerradasAhora > 0 ? motivo.valor : null, receivedUnits: totalRecibido, shortUnits: totalCerrado },
    })
  } else if (orden.status === 'ORDERED') {
    await tx.inventoryPurchaseOrder.update({ where: { id_companyId: { id: orden.id, companyId } }, data: { status: 'PARTIAL' } })
  }
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    orden.id,
    { tipo: 'ORDEN_RECIBIDA', orden: orden.number, entrada: entrada?.numero ?? null, recibidas: recibidasAhora, cerradas: cerradasAhora, pendientes: plan.pendienteDespues, estado: plan.estadoFinal, motivo: cerradasAhora > 0 ? motivo.valor : null },
    'InventoryPurchaseOrder'
  )
  return {
    ordenId: orden.id,
    numero: orden.number,
    estado: plan.estadoFinal,
    recibidas: recibidasAhora,
    cerradas: cerradasAhora,
    pendientes: plan.pendienteDespues,
    entradaId: entrada?.entradaId ?? null,
    entradaNumero: entrada?.numero ?? null,
    repetido: false,
  }
}

// ── Producto ↔ proveedor ─────────────────────────────────────────────────────

export interface ResultadoVinculo {
  varianteId: string
  proveedorId: string
  preferido: boolean
}

/**
 * Registra (o actualiza) que un proveedor surte un producto: su código, cuánto tarda y si es el PREFERIDO (a lo sumo uno
 * por producto: marcar uno desmarca al anterior). El último costo no se escribe a mano: lo deja cada recepción.
 */
export async function vincularProveedorEnTx(tx: Tx, companyId: string, e: { varianteId: string; proveedorId: string; datos: unknown }, ctx: ContextoAuditoria): Promise<ResultadoVinculo> {
  const v = validarVinculo(e.datos)
  if (!v.ok) fallo(v.codigo, v.error)
  const varianteId = idObligatorio(e.varianteId, 'VARIANTE_NO_ENCONTRADA', 'El producto no existe.')
  const proveedorId = idObligatorio(e.proveedorId, 'PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const variantes = await exigirVariantesControladas(tx, companyId, [varianteId])
  const variante = variantes.get(varianteId)!
  // Quien ya está vinculado puede seguir editándose aunque su proveedor se haya desactivado; uno nuevo, no.
  const existente = await tx.inventoryVariantSupplier.findFirst({ where: { companyId, catalogVariantId: varianteId, supplierId: proveedorId }, select: { id: true } })
  const proveedor = await exigirProveedor(tx, companyId, proveedorId, !existente)
  const d = v.valor

  // Dos personas que marcan «preferido» a la vez sobre el mismo producto se turnan.
  await bloquearClave(tx, companyId, 'proveedor-preferido', varianteId)
  if (d.preferido) {
    await tx.inventoryVariantSupplier.updateMany({ where: { companyId, catalogVariantId: varianteId, preferred: true, NOT: { supplierId: proveedorId } }, data: { preferred: false } })
  }
  // Crear-si-falta y actualizar: la recepción de una orden también crea este vínculo, y las dos pueden coincidir.
  await tx.inventoryVariantSupplier.createMany({ data: [{ companyId, catalogVariantId: varianteId, supplierId: proveedorId }], skipDuplicates: true })
  await tx.inventoryVariantSupplier.updateMany({
    where: { companyId, catalogVariantId: varianteId, supplierId: proveedorId },
    data: { supplierSku: d.codigoProveedor, leadTimeDays: d.diasEntrega, preferred: d.preferido },
  })
  const nombre = variante.isDefault ? variante.item.name : `${variante.item.name} · ${variante.name}`
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    varianteId,
    { tipo: existente ? 'PROVEEDOR_DE_PRODUCTO_EDITADO' : 'PROVEEDOR_DE_PRODUCTO_AGREGADO', producto: nombre, proveedor: proveedor.name, codigo: d.codigoProveedor, diasEntrega: d.diasEntrega, preferido: d.preferido },
    'InventoryVariantSupplier'
  )
  return { varianteId, proveedorId, preferido: d.preferido }
}

/** Quita el vínculo producto↔proveedor. No toca las órdenes ni las entradas que ya existen. Repetirlo no hace nada. */
export async function desvincularProveedorEnTx(tx: Tx, companyId: string, e: { varianteId: string; proveedorId: string }, ctx: ContextoAuditoria): Promise<{ quitado: boolean }> {
  const varianteId = idObligatorio(e.varianteId, 'VARIANTE_NO_ENCONTRADA', 'El producto no existe.')
  const proveedorId = idObligatorio(e.proveedorId, 'PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const proveedor = await tx.inventorySupplier.findFirst({ where: { id: proveedorId, companyId }, select: { name: true } })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const borrados = await tx.inventoryVariantSupplier.deleteMany({ where: { companyId, catalogVariantId: varianteId, supplierId: proveedorId } })
  if (borrados.count === 0) return { quitado: false }
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', varianteId, { tipo: 'PROVEEDOR_DE_PRODUCTO_QUITADO', proveedor: proveedor.name }, 'InventoryVariantSupplier')
  return { quitado: true }
}
