import type { MembegoOrderStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { toQrDataUrl } from '@/lib/qr'
import { ESTADOS_CANCELABLES_POR_CLIENTE, ESTADOS_CONFIRMABLES, qrDePedidoVencido } from './domain'

/**
 * COMMERCE CORE · pedidos — lecturas del CLIENTE (Fase 3).
 *
 * Una persona tiene una ficha de `Cliente` POR EMPRESA, y sus pedidos cuelgan de
 * ellas: por eso se lee con `sinEmpresa` (cruza empresas) y lo único que acota
 * la consulta son los ids de SUS fichas, que salen de la sesión
 * (`misClienteIds`) y nunca de lo que mande el navegador. Un pedido ajeno
 * responde «no existe», igual que uno inexistente.
 */

export interface FilaMiPedido {
  id: string
  code: string
  status: MembegoOrderStatus
  total: string
  currency: string
  createdAt: Date
  empresaNombre: string
  resumen: string
  /** El monto cambió o aún no lo confirmó: lo primero que la persona debería ver. */
  requiereConfirmacion: boolean
}

const MAX_LISTA = 100

const dos = (d: { toFixed(n: number): string }) => d.toFixed(2)

function resumir(lineas: { description: string; quantity: number }[]): string {
  if (lineas.length === 0) return 'Sin líneas'
  const p = lineas[0]
  const base = p.quantity > 1 ? `${p.quantity} × ${p.description}` : p.description
  return lineas.length > 1 ? `${base} y ${lineas.length - 1} más` : base
}

export async function misPedidos(clienteIds: readonly string[]): Promise<FilaMiPedido[]> {
  if (clienteIds.length === 0) return []
  const filas = await sinEmpresa('pedidos: mis pedidos (todas mis fichas)', (tx) =>
    tx.membegoOrder.findMany({
      where: { customerId: { in: [...clienteIds] } },
      select: {
        id: true,
        code: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        company: { select: { name: true } },
        lines: { select: { description: true, quantity: true }, orderBy: { createdAt: 'asc' } },
        confirmation: { select: { confirmedTotal: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LISTA,
    })
  )
  return filas.map((p) => ({
    id: p.id,
    code: p.code,
    status: p.status,
    total: dos(p.total),
    currency: p.currency,
    createdAt: p.createdAt,
    empresaNombre: p.company.name,
    resumen: resumir(p.lines),
    requiereConfirmacion: ESTADOS_CONFIRMABLES.includes(p.status) && p.status !== 'COMPLETED' && !(p.confirmation && p.confirmation.confirmedTotal.equals(p.total)),
  }))
}

export interface DetalleMiPedido {
  id: string
  code: string
  status: MembegoOrderStatus
  currency: string
  subtotal: string
  discount: string
  adjustment: string
  adjustmentReason: string | null
  tax: string
  total: string
  notes: string | null
  cancelReason: string | null
  refundReason: string | null
  createdAt: Date
  readyAt: Date | null
  completedAt: Date | null
  qrExpiresAt: Date | null
  empresa: { name: string; slug: string }
  sucursal: { nombre: string; direccion: string | null; telefono: string | null }
  lineas: { id: string; description: string; quantity: number; unitPrice: string; discount: string; lineTotal: string }[]
  /** Lo que ya confirmó y si sigue siendo el monto vigente. */
  confirmacion: { confirmedTotal: string; vigente: boolean } | null
  /** QR como imagen (data URL) — solo si el pedido está LISTO y el QR no venció. */
  qrImagen: string | null
  qrVencido: boolean
  /** Si el pedido es el cupón de una oferta con descuento: cuál y hasta cuándo vale. */
  oferta: { titulo: string; venceEl: Date; estado: string } | null
  /** Lo que la persona puede hacer ahora (decidido en el servidor). */
  puede: { confirmar: boolean; cancelar: boolean; renovarQr: boolean }
}

export async function miPedido(clienteIds: readonly string[], pedidoId: string, ahora = new Date()): Promise<DetalleMiPedido | null> {
  if (clienteIds.length === 0 || typeof pedidoId !== 'string' || pedidoId === '') return null
  const p = await sinEmpresa('pedidos: detalle de mi pedido', (tx) =>
    tx.membegoOrder.findFirst({
      where: { id: pedidoId, customerId: { in: [...clienteIds] } },
      include: {
        company: { select: { name: true, slug: true } },
        location: { select: { nombre: true, direccion: true, telefono: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        confirmation: true,
      },
    })
  )
  if (!p) return null
  const reclamo = await sinEmpresa('pedidos: ¿mi pedido es el cupón de una oferta?', (tx) =>
    tx.dealClaim.findFirst({ where: { orderId: p.id, companyId: p.companyId }, select: { status: true, expiresAt: true, deal: { select: { title: true } } } })
  )

  const vigente = !!p.confirmation && p.confirmation.confirmedTotal.equals(p.total)
  const qrVigente = p.status === 'READY' && !!p.qrToken && !qrDePedidoVencido(p.qrExpiresAt, ahora)
  return {
    id: p.id,
    code: p.code,
    status: p.status,
    currency: p.currency,
    subtotal: dos(p.subtotal),
    discount: dos(p.discount),
    adjustment: dos(p.adjustment),
    adjustmentReason: p.adjustmentReason,
    tax: dos(p.tax),
    total: dos(p.total),
    notes: p.notes,
    cancelReason: p.cancelReason,
    refundReason: p.refundReason,
    createdAt: p.createdAt,
    readyAt: p.readyAt,
    completedAt: p.completedAt,
    qrExpiresAt: p.qrExpiresAt,
    empresa: p.company,
    sucursal: p.location,
    lineas: p.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: dos(l.unitPrice), discount: dos(l.discount), lineTotal: dos(l.lineTotal) })),
    confirmacion: p.confirmation ? { confirmedTotal: dos(p.confirmation.confirmedTotal), vigente } : null,
    qrImagen: qrVigente && p.qrToken ? await toQrDataUrl(p.qrToken, 220) : null,
    qrVencido: p.status === 'READY' && !qrVigente,
    oferta: reclamo ? { titulo: reclamo.deal.title, venceEl: reclamo.expiresAt, estado: reclamo.status } : null,
    puede: {
      confirmar: ESTADOS_CONFIRMABLES.includes(p.status) && !vigente,
      cancelar: ESTADOS_CANCELABLES_POR_CLIENTE.includes(p.status),
      renovarQr: p.status === 'READY',
    },
  }
}
