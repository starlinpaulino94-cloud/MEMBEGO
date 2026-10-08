import type { DealClaimStatus, DealStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { puedeCrearCampanas } from '@/modules/billing/domain'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { precioDeLaOferta, presupuestoLibre, reclamosPosibles, rendimientoDeTotales, type RendimientoDeOferta, type TotalesPorEstado } from './domain'

/**
 * COMMERCE CORE · ofertas — lecturas del panel de la empresa (Fase 5).
 *
 * Todo dentro de la `tx` de `conEmpresa(companyId, …)` y acotado por `companyId`. Los importes
 * salen como texto con dos decimales (nunca `number`): la interfaz solo los formatea.
 */

const dos = (d: { toFixed: (n: number) => string }) => d.toFixed(2)

export interface FilaDeOferta {
  id: string
  title: string
  status: DealStatus
  statusReason: string | null
  currency: string
  itemName: string
  variantName: string
  discountType: string
  discountValue: string
  startsAt: Date
  endsAt: Date | null
  maxClaims: number
  claimsActive: number
  fee: string
  budgetTotal: string
  budgetSpent: string
  budgetReserved: string
  budgetFree: string
  /** Cuántos reclamos más admite (cupos y presupuesto). */
  posibles: number
  rendimiento: RendimientoDeOferta
}

export async function listarOfertasEnTx(tx: Tx, companyId: string): Promise<FilaDeOferta[]> {
  const ofertas = await tx.deal.findMany({
    where: { companyId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 200,
    include: { variant: { select: { name: true, item: { select: { name: true } } } } },
  })
  if (ofertas.length === 0) return []
  // Agregado en la base: una oferta con miles de reclamos no se carga renglón por renglón.
  const grupos = await tx.dealClaim.groupBy({
    by: ['dealId', 'status'],
    where: { companyId, dealId: { in: ofertas.map((o) => o.id) } },
    _count: { _all: true },
    _sum: { fee: true, savings: true },
  })
  const porOferta = new Map<string, TotalesPorEstado[]>()
  for (const g of grupos) {
    const fila: TotalesPorEstado = { status: g.status, cantidad: g._count._all, fee: g._sum.fee ?? 0, savings: g._sum.savings ?? 0 }
    porOferta.set(g.dealId, [...(porOferta.get(g.dealId) ?? []), fila])
  }
  return ofertas.map((o) => ({
    id: o.id,
    title: o.title,
    status: o.status,
    statusReason: o.statusReason,
    currency: o.currency,
    itemName: o.variant.item.name,
    variantName: o.variant.name,
    discountType: o.discountType,
    discountValue: dos(o.discountValue),
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    maxClaims: o.maxClaims,
    claimsActive: o.claimsActive,
    fee: dos(o.feePerRedemption),
    budgetTotal: dos(o.budgetTotal),
    budgetSpent: dos(o.budgetSpent),
    budgetReserved: dos(o.budgetReserved),
    budgetFree: dos(presupuestoLibre(o)),
    posibles: reclamosPosibles(o),
    rendimiento: rendimientoDeTotales(porOferta.get(o.id) ?? []),
  }))
}

export interface ReclamoDeOferta {
  id: string
  status: DealClaimStatus
  clienteNombre: string
  orderId: string
  orderCode: string
  orderStatus: string
  savings: string
  fee: string
  claimedAt: Date
  expiresAt: Date
  redeemedAt: Date | null
}

export interface DetalleDeOferta extends FilaDeOferta {
  catalogVariantId: string
  description: string | null
  voucherDays: number
  newCustomersOnly: boolean
  publishedAt: Date | null
  precioLista: string
  precioOferta: string
  ahorro: string
  editableTodo: boolean
  reclamos: ReclamoDeOferta[]
  /** Cuántos reclamos tiene en total (la lista de arriba muestra solo los más recientes). */
  reclamosTotal: number
}

/** Cuántos reclamos se listan en el detalle; el resultado se calcula sobre TODOS, no sobre estos. */
export const RECLAMOS_EN_LISTA = 200

export async function detalleOfertaEnTx(tx: Tx, companyId: string, id: string): Promise<DetalleDeOferta | null> {
  if (typeof id !== 'string' || id === '' || id.length > 60) return null
  const o = await tx.deal.findFirst({
    where: { id, companyId },
    include: { variant: { select: { name: true, price: true, item: { select: { name: true } } } } },
  })
  if (!o) return null
  const reclamos = await tx.dealClaim.findMany({
    where: { dealId: o.id, companyId },
    orderBy: [{ claimedAt: 'desc' }, { id: 'asc' }],
    take: RECLAMOS_EN_LISTA,
    include: { customer: { select: { nombre: true } }, order: { select: { code: true, status: true } } },
  })
  const grupos = await tx.dealClaim.groupBy({ by: ['status'], where: { dealId: o.id, companyId }, _count: { _all: true }, _sum: { fee: true, savings: true } })
  const totales: TotalesPorEstado[] = grupos.map((g) => ({ status: g.status, cantidad: g._count._all, fee: g._sum.fee ?? 0, savings: g._sum.savings ?? 0 }))
  const { precio, ahorro } = precioDeLaOferta(o.variant.price, o.discountType, o.discountValue)
  return {
    id: o.id,
    title: o.title,
    status: o.status,
    statusReason: o.statusReason,
    currency: o.currency,
    itemName: o.variant.item.name,
    variantName: o.variant.name,
    discountType: o.discountType,
    discountValue: dos(o.discountValue),
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    maxClaims: o.maxClaims,
    claimsActive: o.claimsActive,
    fee: dos(o.feePerRedemption),
    budgetTotal: dos(o.budgetTotal),
    budgetSpent: dos(o.budgetSpent),
    budgetReserved: dos(o.budgetReserved),
    budgetFree: dos(presupuestoLibre(o)),
    posibles: reclamosPosibles(o),
    rendimiento: rendimientoDeTotales(totales),
    reclamosTotal: totales.reduce((t, g) => t + g.cantidad, 0),
    catalogVariantId: o.catalogVariantId,
    description: o.description,
    voucherDays: o.voucherDays,
    newCustomersOnly: o.newCustomersOnly,
    publishedAt: o.publishedAt,
    precioLista: dos(o.variant.price),
    precioOferta: dos(precio),
    ahorro: dos(ahorro),
    editableTodo: o.status === 'DRAFT',
    reclamos: reclamos.map((r) => ({
      id: r.id,
      status: r.status,
      clienteNombre: r.customer.nombre,
      orderId: r.orderId,
      orderCode: r.order.code,
      orderStatus: r.order.status,
      savings: dos(r.savings),
      fee: dos(r.fee),
      claimedAt: r.claimedAt,
      expiresAt: r.expiresAt,
      redeemedAt: r.redeemedAt,
    })),
  }
}

export interface OpcionDeProducto {
  id: string
  etiqueta: string
  precio: string
  currency: string
}

export interface OpcionesParaOferta {
  productos: OpcionDeProducto[]
  /** La cuota por canje de la cuenta, o `null` si aún no tiene cuenta (se fija al crear). */
  cuota: string | null
  currency: string | null
  suspendida: boolean
}

/** Lo que el formulario de una oferta nueva necesita: qué se puede ofrecer y cuánto cuesta cada canje. */
export async function opcionesParaOfertaEnTx(tx: Tx, companyId: string): Promise<OpcionesParaOferta> {
  const [variantes, cuenta] = await Promise.all([
    tx.catalogVariant.findMany({
      where: { companyId, status: 'ACTIVE', item: { status: 'ACTIVE', source: 'MERCHANT' } },
      orderBy: [{ item: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true, name: true, price: true, item: { select: { name: true, type: true, capabilities: true, currency: true, variants: { select: { id: true } } } } },
    }),
    tx.merchantBillingConfig.findUnique({ where: { companyId }, select: { cpaAmount: true, currency: true, status: true } }),
  ])
  return {
    productos: variantes
      .filter((v) => normalizarCapacidades(v.item.type, v.item.capabilities).availableMarketplace)
      .map((v) => ({
        id: v.id,
        etiqueta: v.item.variants.length > 1 ? `${v.item.name} · ${v.name}` : v.item.name,
        precio: dos(v.price),
        currency: v.item.currency,
      })),
    cuota: cuenta ? dos(cuenta.cpaAmount) : null,
    currency: cuenta?.currency ?? null,
    suspendida: cuenta ? !puedeCrearCampanas(cuenta.status) : false,
  }
}
