import type { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { costoDeDecimal, formatearCosto, formatearMonto, valorDe, type Costo } from './costos'
import { costoParaCampo, pendienteDeOrden, type EstadoOrden } from './compras'
import { armarCursor, leerCursor, type FiltrosOrdenes } from './filtros'
import { buscarVariantesParaEntradaEnTx, nombresDeUsuarios, rangoDeFechas, type VarianteBuscable } from './queries'

/**
 * COMMERCE CORE · inventario — INV-3b: lecturas de proveedores y órdenes de compra.
 *
 * Solo lectura, siempre dentro de `conEmpresa` y filtradas por `companyId`. TODAS leen costos
 * (una orden es, ante todo, lo que se va a gastar), así que solo se llaman detrás de la función
 * `comprar`: la página y la ruta de exportación la piden antes de llegar aquí.
 */

const cargo = (v: { toFixed(n: number): string }): Costo => costoDeDecimal(v)

// ── Proveedores ──────────────────────────────────────────────────────────────

export interface FilaProveedor {
  id: string
  nombre: string
  rnc: string | null
  contacto: string | null
  telefono: string | null
  correo: string | null
  diasCredito: number
  notas: string | null
  activo: boolean
  /** Órdenes pedidas o recibidas en parte: mercancía que se espera. */
  ordenesAbiertas: number
  /** Productos que surte. */
  productos: number
}

export const MAX_PROVEEDORES_LISTA = 500

/** Los proveedores de la empresa por nombre; por defecto solo los activos. */
export async function proveedoresDeLaEmpresaEnTx(tx: Tx, companyId: string, f: { q?: string; incluirInactivos?: boolean } = {}): Promise<{ filas: FilaProveedor[]; truncado: boolean }> {
  const q = f.q?.trim().slice(0, 80)
  const filas = await tx.inventorySupplier.findMany({
    where: {
      companyId,
      ...(f.incluirInactivos ? {} : { active: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { taxId: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_PROVEEDORES_LISTA + 1,
    select: {
      id: true,
      name: true,
      taxId: true,
      contactName: true,
      phone: true,
      email: true,
      creditDays: true,
      notes: true,
      active: true,
      _count: { select: { variantLinks: true, orders: { where: { status: { in: ['ORDERED', 'PARTIAL'] } } } } },
    },
  })
  const truncado = filas.length > MAX_PROVEEDORES_LISTA
  return {
    truncado,
    filas: (truncado ? filas.slice(0, MAX_PROVEEDORES_LISTA) : filas).map((p) => ({
      id: p.id,
      nombre: p.name,
      rnc: p.taxId,
      contacto: p.contactName,
      telefono: p.phone,
      correo: p.email,
      diasCredito: p.creditDays,
      notas: p.notes,
      activo: p.active,
      ordenesAbiertas: p._count.orders,
      productos: p._count.variantLinks,
    })),
  }
}

export interface OpcionProveedor {
  id: string
  nombre: string
}

/** Los proveedores activos, para elegir uno (orden nueva, vínculo con un producto). */
export async function proveedoresActivosEnTx(tx: Tx, companyId: string): Promise<OpcionProveedor[]> {
  const filas = await tx.inventorySupplier.findMany({ where: { companyId, active: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: MAX_PROVEEDORES_LISTA, select: { id: true, name: true } })
  return filas.map((p) => ({ id: p.id, nombre: p.name }))
}

export interface ProductoDeProveedor {
  varianteId: string
  sku: string
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  codigoProveedor: string | null
  ultimoCosto: string | null
  ultimoCostoEn: Date | null
  diasEntrega: number | null
  preferido: boolean
}

export interface DetalleProveedor extends FilaProveedor {
  creadoEn: Date
  productosSurtidos: ProductoDeProveedor[]
  /** Hasta 20 órdenes, de la más reciente a la más antigua. */
  ordenes: Array<{ id: string; numero: string; estado: EstadoOrden; creadoEn: Date; unidades: number }>
}

export async function proveedorDetalleEnTx(tx: Tx, companyId: string, id: string): Promise<DetalleProveedor | null> {
  if (typeof id !== 'string' || id === '' || id.length > 120) return null
  const p = await tx.inventorySupplier.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      name: true,
      taxId: true,
      contactName: true,
      phone: true,
      email: true,
      creditDays: true,
      notes: true,
      active: true,
      createdAt: true,
      _count: { select: { variantLinks: true, orders: { where: { status: { in: ['ORDERED', 'PARTIAL'] } } } } },
      variantLinks: {
        orderBy: [{ variant: { item: { name: 'asc' } } }, { catalogVariantId: 'asc' }],
        take: 200,
        select: {
          catalogVariantId: true,
          supplierSku: true,
          lastCost: true,
          lastCostAt: true,
          leadTimeDays: true,
          preferred: true,
          variant: { select: { sku: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      },
      orders: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, number: true, status: true, createdAt: true, lines: { select: { quantityOrdered: true } } } },
    },
  })
  if (!p) return null
  return {
    id: p.id,
    nombre: p.name,
    rnc: p.taxId,
    contacto: p.contactName,
    telefono: p.phone,
    correo: p.email,
    diasCredito: p.creditDays,
    notas: p.notes,
    activo: p.active,
    ordenesAbiertas: p._count.orders,
    productos: p._count.variantLinks,
    creadoEn: p.createdAt,
    productosSurtidos: p.variantLinks.map((l) => ({
      varianteId: l.catalogVariantId,
      sku: l.variant.sku,
      itemNombre: l.variant.item.name,
      nombreVariante: l.variant.name,
      esDefault: l.variant.isDefault,
      codigoProveedor: l.supplierSku,
      ultimoCosto: l.lastCost ? formatearCosto(cargo(l.lastCost)) : null,
      ultimoCostoEn: l.lastCostAt,
      diasEntrega: l.leadTimeDays,
      preferido: l.preferred,
    })),
    ordenes: p.orders.map((o) => ({ id: o.id, numero: o.number, estado: o.status, creadoEn: o.createdAt, unidades: o.lines.reduce((s, l) => s + l.quantityOrdered, 0) })),
  }
}

// ── Órdenes de compra ────────────────────────────────────────────────────────

export const POR_PAGINA_ORDENES = 30

export interface FilaOrden {
  id: string
  numero: string
  estado: EstadoOrden
  proveedorId: string
  proveedorNombre: string
  sucursalId: string
  sucursalNombre: string
  referencia: string | null
  nota: string | null
  creadoEn: Date
  pedidoEn: Date | null
  /** Cuándo se espera la mercancía (medianoche UTC del día indicado). */
  previstaEn: Date | null
  cerradoEn: Date | null
  creadoPorNombre: string | null
  lineas: number
  /** Unidades pedidas. */
  unidades: number
  /** Lo que cuesta lo pedido, con dos decimales. */
  valor: string
  recibidas: number
  /** Lo que sigue por llegar ahora mismo (0 si es borrador o ya se cerró). */
  pendientes: number
}

export interface OrdenesPagina {
  filas: FilaOrden[]
  siguiente: string | null
}

const SELECT_ORDEN = {
  id: true,
  number: true,
  status: true,
  supplierId: true,
  locationId: true,
  reference: true,
  note: true,
  createdAt: true,
  orderedAt: true,
  expectedAt: true,
  closedAt: true,
  createdById: true,
  lineCount: true,
  supplier: { select: { name: true } },
  location: { select: { nombre: true } },
  lines: { select: { quantityOrdered: true, quantityReceived: true, quantityCancelled: true, unitCost: true } },
} satisfies Prisma.InventoryPurchaseOrderSelect

type OrdenCruda = Prisma.InventoryPurchaseOrderGetPayload<{ select: typeof SELECT_ORDEN }>

function filaDeOrden(r: OrdenCruda, nombres: Map<string, string>): FilaOrden {
  const lineas = r.lines.map((l) => ({ pedido: l.quantityOrdered, recibido: l.quantityReceived, cancelado: l.quantityCancelled, costo: cargo(l.unitCost) }))
  return {
    id: r.id,
    numero: r.number,
    estado: r.status,
    proveedorId: r.supplierId,
    proveedorNombre: r.supplier.name,
    sucursalId: r.locationId,
    sucursalNombre: r.location.nombre,
    referencia: r.reference,
    nota: r.note,
    creadoEn: r.createdAt,
    pedidoEn: r.orderedAt,
    previstaEn: r.expectedAt,
    cerradoEn: r.closedAt,
    creadoPorNombre: r.createdById ? (nombres.get(r.createdById) ?? null) : null,
    lineas: r.lineCount,
    unidades: lineas.reduce((s, l) => s + l.pedido, 0),
    valor: formatearMonto(lineas.reduce((s, l) => s + valorDe(l.pedido, l.costo), BigInt(0))),
    recibidas: lineas.reduce((s, l) => s + l.recibido, 0),
    pendientes: r.status === 'ORDERED' || r.status === 'PARTIAL' ? lineas.reduce((s, l) => s + pendienteDeOrden(l), 0) : 0,
  }
}

/**
 * Las órdenes de la empresa, de la más reciente a la más antigua, con los filtros de la pantalla. `abiertas` trae
 * solo las que esperan mercancía (pedidas o recibidas en parte). Paginado por cursor (`createdAt|id`).
 */
export async function ordenesDeLaEmpresaEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosOrdenes,
  opciones: { zonaHoraria: string; cursor?: string | null; limite?: number; abiertas?: boolean }
): Promise<OrdenesPagina> {
  const limite = Math.max(1, Math.min(opciones.limite ?? POR_PAGINA_ORDENES, 200))
  const antes = leerCursor(opciones.cursor)
  const q = f.q?.trim()
  const fechas = rangoDeFechas(f, opciones.zonaHoraria)
  const filas = await tx.inventoryPurchaseOrder.findMany({
    where: {
      companyId,
      ...(f.proveedorId ? { supplierId: f.proveedorId } : {}),
      ...(f.sucursalId ? { locationId: f.sucursalId } : {}),
      ...(opciones.abiertas ? { status: { in: ['ORDERED', 'PARTIAL'] as EstadoOrden[] } } : f.estado ? { status: f.estado } : {}),
      ...(fechas.gte || fechas.lt ? { createdAt: fechas } : {}),
      AND: [
        ...(q
          ? [
              {
                OR: [
                  { number: { contains: q, mode: 'insensitive' as const } },
                  { reference: { contains: q, mode: 'insensitive' as const } },
                  { note: { contains: q, mode: 'insensitive' as const } },
                  { supplier: { name: { contains: q, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
        ...(antes ? [{ OR: [{ createdAt: { lt: antes.creadoEn } }, { createdAt: antes.creadoEn, id: { lt: antes.id } }] }] : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: SELECT_ORDEN,
  })
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const nombres = await nombresDeUsuarios(tx, pagina.map((r) => r.createdById))
  const ultimo = pagina[pagina.length - 1]
  return { filas: pagina.map((r) => filaDeOrden(r, nombres)), siguiente: hayMas && ultimo ? armarCursor(ultimo.createdAt, ultimo.id) : null }
}

export interface LineaDeOrdenVista {
  varianteId: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  pedido: number
  recibido: number
  cancelado: number
  pendiente: number
  /** El costo unitario para mostrar («12.50»). */
  costo: string
  /** El costo unitario para un campo de texto («12.5»). */
  costoCampo: string
  /** Lo que cuesta la línea pedida («125.00»). */
  valor: string
}

export interface EntradaDeOrden {
  id: string
  numero: string
  creadoEn: Date
  referencia: string | null
  unidades: number
  usuarioNombre: string | null
}

export interface DetalleOrden extends FilaOrden {
  proveedorActivo: boolean
  pedidoPorNombre: string | null
  cerradoPorNombre: string | null
  motivoCierre: string | null
  /** Lo que ya llegó y se cerró como faltante, al terminar. */
  faltantes: number
  valorRecibido: string
  valorPendiente: string
  detalle: LineaDeOrdenVista[]
  /** Las entradas de mercancía que esta orden produjo, una por tanda. */
  entradas: EntradaDeOrden[]
}

/** Una orden con todas sus líneas y sus entradas; null si no existe o es de otra empresa (se ven igual a propósito). */
export async function ordenDetalleEnTx(tx: Tx, companyId: string, id: string): Promise<DetalleOrden | null> {
  if (typeof id !== 'string' || id === '' || id.length > 120) return null
  const r = await tx.inventoryPurchaseOrder.findFirst({
    where: { id, companyId },
    select: {
      ...SELECT_ORDEN,
      orderedById: true,
      closedById: true,
      closeReason: true,
      supplier: { select: { name: true, active: true } },
      lines: {
        orderBy: [{ position: 'asc' }],
        select: {
          catalogVariantId: true,
          quantityOrdered: true,
          quantityReceived: true,
          quantityCancelled: true,
          unitCost: true,
          variant: { select: { sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      },
      receipts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200, select: { id: true, number: true, createdAt: true, reference: true, unitCount: true, userId: true } },
    },
  })
  if (!r) return null
  const nombres = await nombresDeUsuarios(tx, [r.createdById, r.orderedById, r.closedById, ...r.receipts.map((e) => e.userId)])
  const detalle: LineaDeOrdenVista[] = r.lines.map((l) => {
    const costo = cargo(l.unitCost)
    return {
      varianteId: l.catalogVariantId,
      sku: l.variant.sku,
      barcode: l.variant.barcode,
      itemNombre: l.variant.item.name,
      nombreVariante: l.variant.name,
      esDefault: l.variant.isDefault,
      pedido: l.quantityOrdered,
      recibido: l.quantityReceived,
      cancelado: l.quantityCancelled,
      pendiente: pendienteDeOrden({ pedido: l.quantityOrdered, recibido: l.quantityReceived, cancelado: l.quantityCancelled }),
      costo: formatearCosto(costo),
      costoCampo: costoParaCampo(costo),
      valor: formatearMonto(valorDe(l.quantityOrdered, costo)),
    }
  })
  const costos = new Map(r.lines.map((l) => [l.catalogVariantId, cargo(l.unitCost)]))
  const valorRecibido = r.lines.reduce((s, l) => s + valorDe(l.quantityReceived, costos.get(l.catalogVariantId)!), BigInt(0))
  const abierta = r.status === 'ORDERED' || r.status === 'PARTIAL'
  const valorPendiente = abierta ? r.lines.reduce((s, l) => s + valorDe(pendienteDeOrden({ pedido: l.quantityOrdered, recibido: l.quantityReceived, cancelado: l.quantityCancelled }), costos.get(l.catalogVariantId)!), BigInt(0)) : BigInt(0)
  return {
    ...filaDeOrden(r, nombres),
    proveedorActivo: r.supplier.active,
    pedidoPorNombre: r.orderedById ? (nombres.get(r.orderedById) ?? null) : null,
    cerradoPorNombre: r.closedById ? (nombres.get(r.closedById) ?? null) : null,
    motivoCierre: r.closeReason,
    faltantes: r.lines.reduce((s, l) => s + l.quantityCancelled, 0),
    valorRecibido: formatearMonto(valorRecibido),
    valorPendiente: formatearMonto(valorPendiente),
    detalle,
    entradas: r.receipts.map((e) => ({ id: e.id, numero: e.number, creadoEn: e.createdAt, referencia: e.reference, unidades: e.unitCount, usuarioNombre: e.userId ? (nombres.get(e.userId) ?? null) : null })),
  }
}

// ── Para buscar productos al armar una orden ─────────────────────────────────

export interface ProductoParaOrden extends VarianteBuscable {
  /** El último costo al que se le compró este producto a ESTE proveedor, listo para el campo; null = nunca. */
  costoSugerido: string | null
}

/**
 * Productos que controlan inventario, para añadir a una orden: lo mismo que buscar para una entrada (nombre, SKU o
 * código de barras), con lo disponible en la sucursal que recibe y, si ya se le compró a este proveedor, el último costo.
 */
export async function buscarProductosParaOrdenEnTx(tx: Tx, companyId: string, q: string, sucursalId: string | null, proveedorId: string | null): Promise<ProductoParaOrden[]> {
  const productos = await buscarVariantesParaEntradaEnTx(tx, companyId, q, sucursalId)
  if (productos.length === 0) return []
  const vinculos = proveedorId
    ? await tx.inventoryVariantSupplier.findMany({ where: { companyId, supplierId: proveedorId, catalogVariantId: { in: productos.map((p) => p.id) } }, select: { catalogVariantId: true, lastCost: true } })
    : []
  const ultimo = new Map(vinculos.map((v) => [v.catalogVariantId, v.lastCost]))
  return productos.map((p) => {
    const c = ultimo.get(p.id)
    return { ...p, costoSugerido: c ? costoParaCampo(cargo(c)) : null }
  })
}

// ── En la ficha del producto ─────────────────────────────────────────────────

export interface ProveedorDeProducto {
  proveedorId: string
  nombre: string
  activo: boolean
  codigoProveedor: string | null
  ultimoCosto: string | null
  ultimoCostoEn: Date | null
  diasEntrega: number | null
  preferido: boolean
}

/** Qué proveedores surten un producto: el preferido primero, después por nombre. */
export async function proveedoresDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string): Promise<ProveedorDeProducto[]> {
  const filas = await tx.inventoryVariantSupplier.findMany({
    where: { companyId, catalogVariantId: varianteId },
    orderBy: [{ preferred: 'desc' }, { supplier: { name: 'asc' } }, { supplierId: 'asc' }],
    take: 100,
    select: { supplierId: true, supplierSku: true, lastCost: true, lastCostAt: true, leadTimeDays: true, preferred: true, supplier: { select: { name: true, active: true } } },
  })
  return filas.map((l) => ({
    proveedorId: l.supplierId,
    nombre: l.supplier.name,
    activo: l.supplier.active,
    codigoProveedor: l.supplierSku,
    ultimoCosto: l.lastCost ? formatearCosto(cargo(l.lastCost)) : null,
    ultimoCostoEn: l.lastCostAt,
    diasEntrega: l.leadTimeDays,
    preferido: l.preferred,
  }))
}

export interface PedidoDeVariante {
  total: number
  ordenes: Array<{ id: string; numero: string; proveedorNombre: string; sucursalNombre: string; pendiente: number; previstaEn: Date | null }>
}

/**
 * Lo que de UNA variante está PEDIDO a proveedores y todavía no ha llegado (órdenes pedidas o recibidas en parte). Se
 * lee en su propia transacción desde la ficha para que, si la migración aún no se aplicó, la ficha siga funcionando sin
 * esta tarjeta.
 */
export async function pedidoEnCaminoDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string): Promise<PedidoDeVariante> {
  const lineas = await tx.inventoryPurchaseOrderLine.findMany({
    where: { companyId, catalogVariantId: varianteId, order: { status: { in: ['ORDERED', 'PARTIAL'] } } },
    orderBy: [{ order: { createdAt: 'asc' } }],
    take: 200,
    select: {
      quantityOrdered: true,
      quantityReceived: true,
      quantityCancelled: true,
      order: { select: { id: true, number: true, expectedAt: true, supplier: { select: { name: true } }, location: { select: { nombre: true } } } },
    },
  })
  const ordenes = lineas
    .map((l) => ({
      id: l.order.id,
      numero: l.order.number,
      proveedorNombre: l.order.supplier.name,
      sucursalNombre: l.order.location.nombre,
      pendiente: pendienteDeOrden({ pedido: l.quantityOrdered, recibido: l.quantityReceived, cancelado: l.quantityCancelled }),
      previstaEn: l.order.expectedAt,
    }))
    .filter((o) => o.pendiente > 0)
  return { total: ordenes.reduce((s, o) => s + o.pendiente, 0), ordenes }
}

export interface OrdenDeEntrada {
  id: string
  numero: string
  proveedorNombre: string
}

/**
 * La orden de compra a la que responde una entrada de mercancía, si la hay (las entradas a mano y las de un CSV no tienen).
 * Va aparte de `entradaDetalleEnTx` para que la entrada se lea igual con o sin la migración de compras, y para que solo
 * la lea quien tiene la función `comprar`.
 */
export async function ordenDeEntradaEnTx(tx: Tx, companyId: string, entradaId: string): Promise<OrdenDeEntrada | null> {
  if (typeof entradaId !== 'string' || entradaId === '' || entradaId.length > 120) return null
  const r = await tx.inventoryReceipt.findFirst({
    where: { id: entradaId, companyId, purchaseOrderId: { not: null } },
    select: { purchaseOrder: { select: { id: true, number: true, supplier: { select: { name: true } } } } },
  })
  return r?.purchaseOrder ? { id: r.purchaseOrder.id, numero: r.purchaseOrder.number, proveedorNombre: r.purchaseOrder.supplier.name } : null
}
