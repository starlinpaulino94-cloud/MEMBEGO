import type { MembegoOrderStatus, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'

/**
 * COMMERCE CORE · pedidos — lecturas (Fase 3).
 *
 * Solo lectura, siempre dentro de `conEmpresa` y filtradas por `companyId` (el
 * aislamiento no depende de que la RLS esté encendida). Los montos salen como
 * texto de dos decimales: el panel no hace aritmética con ellos.
 */

export const POR_PAGINA = 25

export interface FiltrosPedidos {
  q?: string
  estado?: MembegoOrderStatus
  pagina?: number
}

export interface FilaPedido {
  id: string
  code: string
  status: MembegoOrderStatus
  origin: string
  verificationLevel: string
  total: string
  currency: string
  createdAt: Date
  clienteNombre: string
  sucursalNombre: string
  /** «Lavado completo» o «Lavado completo y 2 más». */
  resumen: string
}

export interface ListaPedidos {
  filas: FilaPedido[]
  total: number
  pagina: number
  paginas: number
  /** Cuántos pedidos hay en cada estado (antes de filtrar por estado), para los chips. */
  conteos: Record<MembegoOrderStatus, number>
}

const ESTADOS_VACIOS: Record<MembegoOrderStatus, number> = {
  CREATED: 0,
  AWAITING_MERCHANT: 0,
  IN_PROGRESS: 0,
  READY: 0,
  COMPLETED: 0,
  CANCELLED: 0,
  REFUNDED: 0,
}

const dosDecimales = (d: Prisma.Decimal): string => d.toFixed(2)

function resumirLineas(lineas: { description: string; quantity: number }[]): string {
  if (lineas.length === 0) return 'Sin líneas'
  const primera = lineas[0]
  const nombre = primera.quantity > 1 ? `${primera.quantity} × ${primera.description}` : primera.description
  return lineas.length > 1 ? `${nombre} y ${lineas.length - 1} más` : nombre
}

export async function listarPedidosEnTx(tx: Tx, companyId: string, f: FiltrosPedidos = {}): Promise<ListaPedidos> {
  const q = f.q?.trim()
  const filtroTexto: Prisma.MembegoOrderWhereInput | null = q
    ? {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { customer: { nombre: { contains: q, mode: 'insensitive' } } },
          { customer: { email: { contains: q, mode: 'insensitive' } } },
          { lines: { some: { description: { contains: q, mode: 'insensitive' } } } },
        ],
      }
    : null
  const base: Prisma.MembegoOrderWhereInput = { companyId, ...(filtroTexto ?? {}) }

  const [porEstado, total] = await Promise.all([
    tx.membegoOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    tx.membegoOrder.count({ where: { ...base, ...(f.estado ? { status: f.estado } : {}) } }),
  ])
  const conteos = { ...ESTADOS_VACIOS }
  for (const g of porEstado) conteos[g.status] = g._count._all

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Math.trunc(f.pagina ?? 1) || 1), paginas)
  const filas = await tx.membegoOrder.findMany({
    where: { ...base, ...(f.estado ? { status: f.estado } : {}) },
    select: {
      id: true,
      code: true,
      status: true,
      origin: true,
      verificationLevel: true,
      total: true,
      currency: true,
      createdAt: true,
      customer: { select: { nombre: true } },
      location: { select: { nombre: true } },
      lines: { select: { description: true, quantity: true }, orderBy: { createdAt: 'asc' } },
    },
    // Lo más reciente primero (los que esperan a la empresa se encuentran con el filtro de estado).
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (pagina - 1) * POR_PAGINA,
    take: POR_PAGINA,
  })

  return {
    filas: filas.map((p) => ({
      id: p.id,
      code: p.code,
      status: p.status,
      origin: p.origin,
      verificationLevel: p.verificationLevel,
      total: dosDecimales(p.total),
      currency: p.currency,
      createdAt: p.createdAt,
      clienteNombre: p.customer.nombre,
      sucursalNombre: p.location.nombre,
      resumen: resumirLineas(p.lines),
    })),
    total,
    pagina,
    paginas,
    conteos,
  }
}

export interface LineaDetalle {
  id: string
  description: string
  sku: string
  quantity: number
  unitPrice: string
  discount: string
  lineTotal: string
  /** `true` si esta línea aparta inventario. */
  controlaInventario: boolean
}

export interface EventoPedido {
  id: string
  accion: string
  createdAt: Date
  por: string | null
  detalle: Record<string, unknown>
}

export interface DetallePedido {
  id: string
  code: string
  status: MembegoOrderStatus
  origin: string
  paymentMethod: string | null
  verificationLevel: string
  currency: string
  subtotal: string
  discount: string
  adjustment: string
  adjustmentReason: string | null
  commissionableBase: string
  tax: string
  total: string
  notes: string | null
  cancelReason: string | null
  refundReason: string | null
  createdAt: Date
  acceptedAt: Date | null
  readyAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  refundedAt: Date | null
  customerConfirmedAt: Date | null
  qrExpiresAt: Date | null
  cliente: { id: string; nombre: string; telefono: string | null; email: string }
  sucursal: { id: string; nombre: string }
  lineas: LineaDetalle[]
  atribucion: { channel: string; campaignId: string | null; promotionId: string | null; referralCode: string | null; supplyV2OfferId: string | null } | null
  confirmacion: { confirmedTotal: string; confirmedAt: Date; vigente: boolean } | null
  pago: { method: string; amount: string; reference: string | null; notes: string | null; recordedAt: Date } | null
  eventos: EventoPedido[]
}

/** El detalle de un pedido de la empresa, o null si no existe o es de otra (es lo mismo para quien mira). */
export async function detallePedidoEnTx(tx: Tx, companyId: string, pedidoId: string): Promise<DetallePedido | null> {
  const p = await tx.membegoOrder.findFirst({
    where: { id: pedidoId, companyId },
    include: {
      customer: { select: { id: true, nombre: true, telefono: true, email: true } },
      location: { select: { id: true, nombre: true } },
      lines: { orderBy: { createdAt: 'asc' } },
      attribution: true,
      confirmation: true,
      payment: true,
    },
  })
  if (!p) return null

  const bitacora = await tx.auditLog.findMany({
    where: { companyId, entidadTipo: 'MembegoOrder', entidadId: p.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, accion: true, createdAt: true, payload: true, user: { select: { name: true } } },
  })

  return {
    id: p.id,
    code: p.code,
    status: p.status,
    origin: p.origin,
    paymentMethod: p.paymentMethod,
    verificationLevel: p.verificationLevel,
    currency: p.currency,
    subtotal: dosDecimales(p.subtotal),
    discount: dosDecimales(p.discount),
    adjustment: dosDecimales(p.adjustment),
    adjustmentReason: p.adjustmentReason,
    commissionableBase: dosDecimales(p.commissionableBase),
    tax: dosDecimales(p.tax),
    total: dosDecimales(p.total),
    notes: p.notes,
    cancelReason: p.cancelReason,
    refundReason: p.refundReason,
    createdAt: p.createdAt,
    acceptedAt: p.acceptedAt,
    readyAt: p.readyAt,
    completedAt: p.completedAt,
    cancelledAt: p.cancelledAt,
    refundedAt: p.refundedAt,
    customerConfirmedAt: p.customerConfirmedAt,
    qrExpiresAt: p.qrExpiresAt,
    cliente: p.customer,
    sucursal: p.location,
    lineas: p.lines.map((l) => ({
      id: l.id,
      description: l.description,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: dosDecimales(l.unitPrice),
      discount: dosDecimales(l.discount),
      lineTotal: dosDecimales(l.lineTotal),
      controlaInventario: l.inventoryReservationId !== null,
    })),
    atribucion: p.attribution
      ? {
          channel: p.attribution.channel,
          campaignId: p.attribution.campaignId,
          promotionId: p.attribution.promotionId,
          referralCode: p.attribution.referralCode,
          supplyV2OfferId: p.attribution.supplyV2OfferId,
        }
      : null,
    confirmacion: p.confirmation
      ? { confirmedTotal: dosDecimales(p.confirmation.confirmedTotal), confirmedAt: p.confirmation.confirmedAt, vigente: p.confirmation.confirmedTotal.equals(p.total) }
      : null,
    pago: p.payment
      ? { method: p.payment.method, amount: dosDecimales(p.payment.amount), reference: p.payment.reference, notes: p.payment.notes, recordedAt: p.payment.recordedAt }
      : null,
    eventos: bitacora.map((e) => ({
      id: e.id,
      accion: e.accion,
      createdAt: e.createdAt,
      por: e.user?.name ?? null,
      detalle: (typeof e.payload === 'object' && e.payload !== null && !Array.isArray(e.payload) ? e.payload : {}) as Record<string, unknown>,
    })),
  }
}

/** Cuántos pedidos esperan a la empresa (para el aviso del panel). */
export async function pedidosPendientesEnTx(tx: Tx, companyId: string): Promise<number> {
  return tx.membegoOrder.count({ where: { companyId, status: 'AWAITING_MERCHANT' } })
}
