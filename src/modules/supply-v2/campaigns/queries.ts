import 'server-only'

import type {
  SupplyV2BenefitFunding,
  SupplyV2CampaignAudience,
  SupplyV2CampaignOrganizer,
  SupplyV2CampaignStatus,
  SupplyV2CouponKind,
  SupplyV2CouponStatus,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { calcularRepartoLinea } from '../core/financiacion'
import { politicaDeVersion } from '../finance/domain'
import { RUTA_OFERTAS_PUBLICAS } from '../core/catalogo'
import { fueraDePublico, fueraDeVigencia, metricasDeCampana, presupuestoDeCampana, textoDesdeMinutos, type MetricasCampana, type VentaDeCampana } from './domain'
import { historialDelClienteEnTx } from './coupons'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · lecturas de CAMPAÑAS (§18–§19, §21–§26).
 *
 * Cuatro públicos, cuatro DTOs:
 *   · ADMIN: presupuesto, subsidio, resultado económico y bitácora.
 *   · CLIENTE: qué promociones hay, dónde valen y qué cupones tiene. Nunca
 *     presupuesto, nunca costos, nunca comisión.
 *   · PROVEEDOR: lo que él financia, su valor contractual y sus ventas
 *     atribuibles. Nunca el presupuesto de Membego.
 *   · MARKETPLACE: la vitrina, que es el DTO del cliente recortado.
 *
 * Las métricas salen de operaciones REALES: pedidos con la campaña congelada.
 */

const CERO = new Prisma.Decimal(0)
const d2 = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toFixed(2))

// ── ADMIN · listado y tablero (§26) ─────────────────────────────────────────

export interface CampanaEnLista {
  id: string
  code: string
  name: string
  status: SupplyV2CampaignStatus
  organizer: SupplyV2CampaignOrganizer
  funding: SupplyV2BenefitFunding
  audience: SupplyV2CampaignAudience
  proveedor: string | null
  currency: string
  budgetTotal: string | null
  budgetReservado: string
  budgetConsumido: string
  budgetDisponible: string | null
  sinTopeAutorizado: boolean
  ofertas: number
  promociones: number
  cupones: number
  startsAt: Date
  endsAt: Date | null
  horario: string | null
  /** Ventas confirmadas y GMV atribuidos, de operaciones reales. */
  ventasConfirmadas: number
  gmv: string
  subsidio: string
  vigenteAhora: boolean
}

export interface FiltroCampanas {
  status?: SupplyV2CampaignStatus | null
  supplierId?: string | null
  desde?: Date | null
  hasta?: Date | null
}

export async function listarCampanas(f: FiltroCampanas = {}, ahora = new Date()): Promise<CampanaEnLista[]> {
  const where: Prisma.SupplyV2CampaignWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.desde || f.hasta
      ? {
          AND: [
            ...(f.hasta ? [{ startsAt: { lte: f.hasta } }] : []),
            ...(f.desde ? [{ OR: [{ endsAt: null }, { endsAt: { gte: f.desde } }] }] : []),
          ],
        }
      : {}),
  }
  const filas = await sinEmpresa('Supply 2.0: listado de campañas', (tx) =>
    tx.supplyV2Campaign.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startsAt: 'desc' }],
      take: 200,
      include: {
        supplier: { select: { commercialName: true } },
        benefits: { select: { budgetTotal: true, budgetReserved: true, budgetConsumed: true } },
        _count: { select: { offers: true, coupons: true, benefits: true } },
        orders: { select: { id: true, status: true, contractualValue: true, supplierDiscountTotal: true, membegoSubsidyTotal: true, total: true, commissionAmount: true, supplierNet: true } },
      },
    })
  )
  return filas.map((c) => {
    const p = presupuestoDeCampana(c.budgetTotal, c.benefits)
    const m = metricasDeCampana(
      c.orders.map((o) => ({
        orderId: o.id,
        status: o.status,
        gmv: o.contractualValue.plus(o.supplierDiscountTotal),
        contractualValue: o.contractualValue,
        supplierDiscount: o.supplierDiscountTotal,
        membegoSubsidy: o.membegoSubsidyTotal,
        customerPaid: o.total,
        commission: o.commissionAmount ?? CERO,
        supplierNet: o.supplierNet ?? CERO,
        derechosEmitidos: 0,
        derechosRedimidos: 0,
        derechosVencidos: 0,
      }))
    )
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      organizer: c.organizer,
      funding: c.funding,
      audience: c.audience,
      proveedor: c.supplier?.commercialName ?? null,
      currency: c.currency,
      budgetTotal: d2(c.budgetTotal),
      budgetReservado: p.reservado.toFixed(2),
      budgetConsumido: p.consumido.toFixed(2),
      budgetDisponible: p.disponible ? p.disponible.toFixed(2) : null,
      sinTopeAutorizado: c.budgetTotal == null && c.budgetWaiverById != null,
      ofertas: c._count.offers,
      promociones: c._count.benefits,
      cupones: c._count.coupons,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      horario: c.activeFromMinute != null ? `${textoDesdeMinutos(c.activeFromMinute)}–${textoDesdeMinutos(c.activeToMinute)}` : null,
      ventasConfirmadas: m.ventasConfirmadas,
      gmv: m.gmv.toFixed(2),
      subsidio: m.subsidioMembego.toFixed(2),
      vigenteAhora: c.status === 'ACTIVE' && fueraDeVigencia(c, ahora) === null,
    }
  })
}

/** Cifras del tablero (§26): suma de lo que las campañas movieron de verdad. */
export interface TableroCampanas {
  activas: number
  enRevision: number
  programadas: number
  totales: number
  gmv: string
  subsidio: string
  comision: string
  contribucion: string
  ventasConfirmadas: number
  pedidosEnCurso: number
  presupuestoAprobado: string
  presupuestoComprometido: string
  presupuestoConsumido: string
  campanasSinTope: number
}

export async function tableroCampanas(f: FiltroCampanas = {}): Promise<TableroCampanas> {
  const campanas = await listarCampanas(f)
  const metricas = await metricasDeTodas(f)
  const suma = (k: 'budgetTotal' | 'budgetConsumido') => campanas.reduce((t, c) => t.plus(new Prisma.Decimal(c[k] ?? 0)), CERO)
  return {
    activas: campanas.filter((c) => c.status === 'ACTIVE').length,
    enRevision: campanas.filter((c) => c.status === 'PENDING_APPROVAL').length,
    programadas: campanas.filter((c) => c.status === 'SCHEDULED').length,
    totales: campanas.length,
    gmv: metricas.gmv.toFixed(2),
    subsidio: metricas.subsidioMembego.toFixed(2),
    comision: metricas.comision.toFixed(2),
    contribucion: metricas.contribucionTrasSubsidio.toFixed(2),
    ventasConfirmadas: metricas.ventasConfirmadas,
    pedidosEnCurso: metricas.pedidosEnCurso,
    presupuestoAprobado: suma('budgetTotal').toFixed(2),
    presupuestoComprometido: campanas.reduce((t, c) => t.plus(new Prisma.Decimal(c.budgetReservado)).plus(new Prisma.Decimal(c.budgetConsumido)), CERO).toFixed(2),
    presupuestoConsumido: suma('budgetConsumido').toFixed(2),
    campanasSinTope: campanas.filter((c) => c.budgetTotal == null).length,
  }
}

/** Métricas agregadas de todas las campañas del filtro, sin contar dos veces un pedido. */
async function metricasDeTodas(f: FiltroCampanas): Promise<MetricasCampana> {
  const ventas = await ventasAtribuidas({ supplierId: f.supplierId ?? null, desde: f.desde ?? null, hasta: f.hasta ?? null })
  return metricasDeCampana(ventas)
}

/**
 * Pedidos con una campaña CONGELADA. Es la única fuente de la analítica: un
 * pedido aparece una vez, con la campaña que se guardó al comprarlo (§25).
 */
async function ventasAtribuidas(f: { campaignId?: string | null; supplierId?: string | null; desde?: Date | null; hasta?: Date | null }): Promise<VentaDeCampana[]> {
  const filas = await sinEmpresa('Supply 2.0: pedidos atribuidos a campañas', (tx) =>
    tx.supplyV2CustomerOrder.findMany({
      where: {
        campaignId: f.campaignId ? f.campaignId : { not: null },
        ...(f.supplierId ? { lines: { some: { offer: { supplierId: f.supplierId } } } } : {}),
        ...(f.desde || f.hasta ? { createdAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        status: true,
        contractualValue: true,
        supplierDiscountTotal: true,
        membegoSubsidyTotal: true,
        total: true,
        commissionAmount: true,
        supplierNet: true,
        entitlements: { select: { status: true } },
      },
    })
  )
  return filas.map((o) => ({
    orderId: o.id,
    status: o.status,
    gmv: o.contractualValue.plus(o.supplierDiscountTotal),
    contractualValue: o.contractualValue,
    supplierDiscount: o.supplierDiscountTotal,
    membegoSubsidy: o.membegoSubsidyTotal,
    customerPaid: o.total,
    commission: o.commissionAmount ?? CERO,
    supplierNet: o.supplierNet ?? CERO,
    derechosEmitidos: o.entitlements.length,
    derechosRedimidos: o.entitlements.filter((e) => e.status === 'REDEEMED').length,
    derechosVencidos: o.entitlements.filter((e) => e.status === 'EXPIRED').length,
  }))
}

// ── ADMIN · ficha de una campaña (§24, §26) ─────────────────────────────────

export interface FichaCampana {
  id: string
  code: string
  name: string
  description: string | null
  objective: string | null
  status: SupplyV2CampaignStatus
  organizer: SupplyV2CampaignOrganizer
  funding: SupplyV2BenefitFunding
  audience: SupplyV2CampaignAudience
  proveedor: string | null
  supplierId: string | null
  currency: string
  budgetTotal: string | null
  budgetWaiverReason: string | null
  autorizadaSinTopePor: string | null
  presupuesto: { aprobado: string | null; comprometido: string; reservado: string; consumido: string; disponible: string | null; algunBeneficioSinTope: boolean }
  startsAt: Date
  endsAt: Date | null
  horario: string | null
  maxRedemptions: number | null
  maxPerCustomer: number
  vigenteAhora: boolean
  creadaPor: string
  aprobadaPor: string | null
  approvedAt: Date | null
  publicadaPor: string | null
  publishedAt: Date | null
  reviewNotes: string | null
  cancelledAt: Date | null
  cancelledReason: string | null
  completedAt: Date | null
  metricas: {
    pedidos: number
    pedidosEnCurso: number
    ventasConfirmadas: number
    gmv: string
    valorContractual: string
    aportacionProveedor: string
    subsidioMembego: string
    costoPromocional: string
    cobradoAlCliente: string
    comision: string
    netoProveedor: string
    ingresoMembego: string
    derechosEmitidos: number
    derechosRedimidos: number
    derechosVencidos: number
    contribucionTrasSubsidio: string
  }
  ofertas: {
    id: string
    offerId: string
    titulo: string
    proveedor: string
    producto: string
    slug: string
    salePrice: string
    sourceType: string
    featured: boolean
    benefitId: string | null
    promocion: string | null
    promocionValor: string | null
    presupuestoPromocion: string | null
    consumidoPromocion: string
    exigeCupon: boolean
    /** Lo guardado, tal cual, para poder AJUSTAR la promoción desde la ficha (§16). */
    promocionActual: {
      nombre: string
      valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'
      membegoValue: string
      supplierValue: string
      maxMembegoAmount: string | null
      budgetTotal: string | null
      requiresCoupon: boolean
      requiresAssignment: boolean
    } | null
  }[]
  cupones: {
    id: string
    code: string
    kind: SupplyV2CouponKind
    status: SupplyV2CouponStatus
    cliente: string | null
    maxRedemptions: number | null
    maxPerCustomer: number
    minPurchase: string | null
    timesRedeemed: number
    expiresAt: Date | null
    promocion: string
  }[]
  lotes: { id: string; name: string; kind: SupplyV2CouponKind; requested: number; generated: number; prefix: string | null; createdAt: Date; creadoPor: string }[]
  eventos: { id: string; type: string; detail: string | null; actor: string | null; createdAt: Date }[]
}

export async function fichaCampana(id: string, ahora = new Date()): Promise<FichaCampana | null> {
  const c = await sinEmpresa('Supply 2.0: ficha de una campaña', (tx) =>
    tx.supplyV2Campaign.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, commercialName: true } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        publishedBy: { select: { name: true } },
        budgetWaiverBy: { select: { name: true } },
        benefits: { select: { id: true, code: true, name: true, valueType: true, membegoValue: true, supplierValue: true, budgetTotal: true, budgetReserved: true, budgetConsumed: true, requiresCoupon: true } },
        offers: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            offer: { select: { id: true, title: true, slug: true, salePrice: true, sourceType: true, supplier: { select: { commercialName: true } }, catalogItem: { select: { name: true } } } },
            benefit: { select: { id: true, code: true, name: true, valueType: true, membegoValue: true, supplierValue: true, maxMembegoAmount: true, budgetTotal: true, budgetConsumed: true, requiresCoupon: true, requiresAssignment: true } },
          },
        },
        coupons: {
          orderBy: { createdAt: 'desc' },
          take: 300,
          include: { customer: { select: { name: true, email: true } }, benefit: { select: { code: true, name: true } } },
        },
        distributions: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } } },
        events: { orderBy: { createdAt: 'desc' }, take: 200, include: { actor: { select: { name: true } } } },
      },
    })
  )
  if (!c) return null
  const p = presupuestoDeCampana(c.budgetTotal, c.benefits)
  const m = metricasDeCampana(await ventasAtribuidas({ campaignId: c.id }))
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    objective: c.objective,
    status: c.status,
    organizer: c.organizer,
    funding: c.funding,
    audience: c.audience,
    proveedor: c.supplier?.commercialName ?? null,
    supplierId: c.supplierId,
    currency: c.currency,
    budgetTotal: d2(c.budgetTotal),
    budgetWaiverReason: c.budgetWaiverReason,
    autorizadaSinTopePor: c.budgetWaiverBy?.name ?? null,
    presupuesto: {
      aprobado: p.aprobado ? p.aprobado.toFixed(2) : null,
      comprometido: p.comprometido.toFixed(2),
      reservado: p.reservado.toFixed(2),
      consumido: p.consumido.toFixed(2),
      disponible: p.disponible ? p.disponible.toFixed(2) : null,
      algunBeneficioSinTope: p.algunBeneficioSinTope,
    },
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    horario: c.activeFromMinute != null ? `${textoDesdeMinutos(c.activeFromMinute)}–${textoDesdeMinutos(c.activeToMinute)}` : null,
    maxRedemptions: c.maxRedemptions,
    maxPerCustomer: c.maxPerCustomer,
    vigenteAhora: c.status === 'ACTIVE' && fueraDeVigencia(c, ahora) === null,
    creadaPor: c.createdBy.name,
    aprobadaPor: c.approvedBy?.name ?? null,
    approvedAt: c.approvedAt,
    publicadaPor: c.publishedBy?.name ?? null,
    publishedAt: c.publishedAt,
    reviewNotes: c.reviewNotes,
    cancelledAt: c.cancelledAt,
    cancelledReason: c.cancelledReason,
    completedAt: c.completedAt,
    metricas: {
      pedidos: m.pedidos,
      pedidosEnCurso: m.pedidosEnCurso,
      ventasConfirmadas: m.ventasConfirmadas,
      gmv: m.gmv.toFixed(2),
      valorContractual: m.contractualValue.toFixed(2),
      aportacionProveedor: m.aportacionProveedor.toFixed(2),
      subsidioMembego: m.subsidioMembego.toFixed(2),
      costoPromocional: m.costoPromocional.toFixed(2),
      cobradoAlCliente: m.cobradoAlCliente.toFixed(2),
      comision: m.comision.toFixed(2),
      netoProveedor: m.netoProveedor.toFixed(2),
      ingresoMembego: m.ingresoMembego.toFixed(2),
      derechosEmitidos: m.derechosEmitidos,
      derechosRedimidos: m.derechosRedimidos,
      derechosVencidos: m.derechosVencidos,
      contribucionTrasSubsidio: m.contribucionTrasSubsidio.toFixed(2),
    },
    ofertas: c.offers.map((o) => ({
      id: o.id,
      offerId: o.offerId,
      titulo: o.offer.title,
      proveedor: o.offer.supplier.commercialName,
      producto: o.offer.catalogItem.name,
      slug: o.offer.slug,
      salePrice: o.offer.salePrice.toFixed(2),
      sourceType: o.offer.sourceType,
      featured: o.featured,
      benefitId: o.benefitId,
      promocion: o.benefit ? `${o.benefit.code} · ${o.benefit.name}` : null,
      promocionValor: o.benefit
        ? o.benefit.valueType === 'PERCENTAGE'
          ? `${o.benefit.membegoValue.plus(o.benefit.supplierValue).toFixed(2)} %`
          : o.benefit.membegoValue.plus(o.benefit.supplierValue).toFixed(2)
        : null,
      presupuestoPromocion: d2(o.benefit?.budgetTotal ?? null),
      consumidoPromocion: (o.benefit?.budgetConsumed ?? CERO).toFixed(2),
      exigeCupon: o.benefit?.requiresCoupon ?? false,
      promocionActual: o.benefit
        ? {
            nombre: o.benefit.name,
            valueType: o.benefit.valueType,
            membegoValue: o.benefit.membegoValue.toFixed(2),
            supplierValue: o.benefit.supplierValue.toFixed(2),
            maxMembegoAmount: d2(o.benefit.maxMembegoAmount),
            budgetTotal: d2(o.benefit.budgetTotal),
            requiresCoupon: o.benefit.requiresCoupon,
            requiresAssignment: o.benefit.requiresAssignment,
          }
        : null,
    })),
    cupones: c.coupons.map((k) => ({
      id: k.id,
      code: k.code,
      kind: k.kind,
      status: k.status,
      cliente: k.customer ? `${k.customer.name} · ${k.customer.email}` : null,
      maxRedemptions: k.maxRedemptions,
      maxPerCustomer: k.maxPerCustomer,
      minPurchase: d2(k.minPurchase),
      timesRedeemed: k.timesRedeemed,
      expiresAt: k.expiresAt,
      promocion: `${k.benefit.code} · ${k.benefit.name}`,
    })),
    lotes: c.distributions.map((l) => ({ id: l.id, name: l.name, kind: l.kind, requested: l.requested, generated: l.generated, prefix: l.prefix, createdAt: l.createdAt, creadoPor: l.createdBy.name })),
    eventos: c.events.map((e) => ({ id: e.id, type: e.type, detail: e.detail, actor: e.actor?.name ?? null, createdAt: e.createdAt })),
  }
}

/** Ofertas que se pueden añadir a una campaña (§5, paso 3 del asistente). */
export async function ofertasParaCampana(supplierId: string | null): Promise<{ id: string; title: string; proveedor: string; supplierId: string; producto: string; salePrice: string; currency: string; sourceType: string; commissionPercentage: string | null }[]> {
  const filas = await sinEmpresa('Supply 2.0: ofertas que pueden entrar en una campaña', (tx) =>
    tx.supplyV2Offer.findMany({
      where: { status: { in: ['ACTIVE', 'SCHEDULED', 'DRAFT'] }, ...(supplierId ? { supplierId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, title: true, supplierId: true, salePrice: true, currency: true, sourceType: true, commissionPercentage: true, supplier: { select: { commercialName: true } }, catalogItem: { select: { name: true } } },
    })
  )
  return filas.map((o) => ({
    id: o.id,
    title: o.title,
    proveedor: o.supplier.commercialName,
    supplierId: o.supplierId,
    producto: o.catalogItem.name,
    salePrice: o.salePrice.toFixed(2),
    currency: o.currency,
    sourceType: o.sourceType,
    commissionPercentage: d2(o.commissionPercentage),
  }))
}

// ── MARKETPLACE y CLIENTE (§18–§19, §21) ────────────────────────────────────

export interface CampanaPublica {
  id: string
  code: string
  name: string
  description: string | null
  startsAt: Date
  endsAt: Date | null
  horario: string | null
  empresas: string[]
  ofertas: { slug: string; titulo: string; producto: string; proveedor: string; salePrice: string; currency: string; featured: boolean; href: string; rebaja: string | null; exigeCupon: boolean }[]
  /** Si la sesión es de un cliente: si encaja en el público de la campaña. */
  paraTi: boolean | null
  condiciones: string[]
}

/**
 * Campañas ACTIVAS y vigentes AHORA para el marketplace (§18). La vigencia se
 * comprueba aquí también, no solo en el cron: una campaña fuera de su horario
 * no se enseña como disponible.
 */
export async function campanasPublicas(customerId: string | null, ahora = new Date(), limite = 24): Promise<CampanaPublica[]> {
  const filas = await sinEmpresa('Supply 2.0: campañas activas para el marketplace', (tx) =>
    tx.supplyV2Campaign.findMany({
      where: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
      orderBy: [{ publishedAt: 'desc' }],
      take: limite * 2,
      include: {
        offers: {
          orderBy: [{ featured: 'desc' }, { position: 'asc' }],
          include: {
            offer: { select: { slug: true, title: true, status: true, salePrice: true, currency: true, supplier: { select: { commercialName: true } }, catalogItem: { select: { name: true } } } },
            benefit: { select: { valueType: true, membegoValue: true, supplierValue: true, status: true, requiresCoupon: true } },
          },
        },
      },
    })
  )
  const vigentes = filas.filter((c) => fueraDeVigencia(c, ahora) === null)
  const historial = customerId ? await sinEmpresa('Supply 2.0: historial del cliente para el público de campañas', (tx) => historialDelClienteEnTx(tx, customerId, null)) : null
  return vigentes.slice(0, limite).map((c) => {
    const ofertas = c.offers.filter((o) => o.offer.status === 'ACTIVE')
    const condiciones: string[] = []
    if (c.endsAt) condiciones.push(`Válida hasta el ${c.endsAt.toISOString().slice(0, 10)}.`)
    if (c.activeFromMinute != null) condiciones.push(`Solo de ${textoDesdeMinutos(c.activeFromMinute)} a ${textoDesdeMinutos(c.activeToMinute)}.`)
    condiciones.push(c.maxPerCustomer === 1 ? 'Un uso por persona.' : `Hasta ${c.maxPerCustomer} usos por persona.`)
    if (ofertas.some((o) => o.benefit?.requiresCoupon)) condiciones.push('Algunas promociones piden su código en el checkout.')
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      horario: c.activeFromMinute != null ? `${textoDesdeMinutos(c.activeFromMinute)}–${textoDesdeMinutos(c.activeToMinute)}` : null,
      empresas: [...new Set(ofertas.map((o) => o.offer.supplier.commercialName))],
      ofertas: ofertas.map((o) => ({
        slug: o.offer.slug,
        titulo: o.offer.title,
        producto: o.offer.catalogItem.name,
        proveedor: o.offer.supplier.commercialName,
        salePrice: o.offer.salePrice.toFixed(2),
        currency: o.offer.currency,
        featured: o.featured,
        href: `${RUTA_OFERTAS_PUBLICAS}/${o.offer.slug}`,
        rebaja:
          o.benefit && o.benefit.status === 'ACTIVE'
            ? o.benefit.valueType === 'PERCENTAGE'
              ? `${o.benefit.membegoValue.plus(o.benefit.supplierValue).toFixed(0)} %`
              : o.benefit.membegoValue.plus(o.benefit.supplierValue).toFixed(2)
            : null,
        exigeCupon: o.benefit?.requiresCoupon ?? false,
      })),
      paraTi: historial ? fueraDePublico(c.audience, historial) === null : null,
      condiciones,
    }
  })
}

export async function campanaPublicaPorCodigo(code: string, customerId: string | null, ahora = new Date()): Promise<CampanaPublica | null> {
  const todas = await campanasPublicas(customerId, ahora, 200)
  return todas.find((c) => c.code.toUpperCase() === code.toUpperCase()) ?? null
}

export interface CuponDelCliente {
  id: string
  code: string
  kind: SupplyV2CouponKind
  campanaNombre: string
  campanaCode: string
  promocion: string
  valor: string
  valueType: string
  currency: string
  status: SupplyV2CouponStatus
  usados: number
  maxPerCustomer: number
  minPurchase: string | null
  expiresAt: Date | null
  usable: boolean
  motivo: string | null
  ofertas: { slug: string; titulo: string; proveedor: string; salePrice: string; href: string }[]
}

/**
 * «Mis cupones» (§21): los privados del cliente y los públicos de las campañas
 * en cuyo público encaja. Nunca presupuesto ni costos; si uno no se puede usar,
 * se dice por qué en una frase.
 */
export async function misCupones(customerId: string, ahora = new Date()): Promise<CuponDelCliente[]> {
  const datos = await sinEmpresa('Supply 2.0: cupones del cliente de la sesión', async (tx) => {
    const cupones = await tx.supplyV2Coupon.findMany({
      where: {
        OR: [{ customerId }, { kind: 'PUBLIC', status: 'ACTIVE' }],
        campaign: { status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        benefit: { select: { id: true, code: true, name: true, valueType: true, membegoValue: true, supplierValue: true, status: true } },
        campaign: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            currency: true,
            audience: true,
            startsAt: true,
            endsAt: true,
            activeFromMinute: true,
            activeToMinute: true,
            maxPerCustomer: true,
            offers: { include: { offer: { select: { slug: true, title: true, status: true, salePrice: true, supplier: { select: { commercialName: true } } } } } },
          },
        },
      },
    })
    const usos = await tx.supplyV2CouponRedemption.groupBy({ by: ['couponId'], where: { customerId, status: { in: ['RESERVED', 'APPLIED'] } }, _count: { _all: true } })
    const historial = await historialDelClienteEnTx(tx, customerId, null)
    return { cupones, usos: new Map(usos.map((u) => [u.couponId, u._count._all])), historial }
  })
  const { cupones, usos, historial } = datos
  return cupones.map((k) => {
    const usados = usos.get(k.id) ?? 0
    const fuera = fueraDeVigencia(k.campaign, ahora)
    const fueraPublico = fueraDePublico(k.campaign.audience, historial)
    let motivo: string | null = null
    if (k.status === 'CANCELLED') motivo = 'Este cupón se canceló.'
    else if (k.status === 'EXPIRED' || (k.expiresAt && k.expiresAt <= ahora)) motivo = 'Este cupón ya venció.'
    else if (k.status === 'EXHAUSTED') motivo = 'Este cupón ya se agotó.'
    else if (usados >= k.maxPerCustomer) motivo = 'Ya usaste este cupón.'
    else if (k.campaign.status !== 'ACTIVE') motivo = 'Su promoción no está activa ahora.'
    else if (fuera === 'NO_EMPEZO') motivo = 'Su promoción todavía no empieza.'
    else if (fuera === 'TERMINO') motivo = 'Su promoción ya terminó.'
    else if (fuera === 'FUERA_DE_HORARIO') motivo = `Solo vale de ${textoDesdeMinutos(k.campaign.activeFromMinute)} a ${textoDesdeMinutos(k.campaign.activeToMinute)}.`
    else if (fueraPublico) motivo = 'Este cupón es para otro grupo de clientes.'
    const ofertas = k.campaign.offers.filter((o) => o.offer.status === 'ACTIVE')
    if (!motivo && ofertas.length === 0) motivo = 'Ahora mismo no hay ofertas activas donde usarlo.'
    return {
      id: k.id,
      code: k.code,
      kind: k.kind,
      campanaNombre: k.campaign.name,
      campanaCode: k.campaign.code,
      promocion: k.benefit.name,
      valor: k.benefit.membegoValue.plus(k.benefit.supplierValue).toFixed(2),
      valueType: k.benefit.valueType,
      currency: k.campaign.currency,
      status: k.status,
      usados,
      maxPerCustomer: k.maxPerCustomer,
      minPurchase: d2(k.minPurchase),
      expiresAt: k.expiresAt,
      usable: motivo === null,
      motivo,
      ofertas: ofertas.slice(0, 6).map((o) => ({ slug: o.offer.slug, titulo: o.offer.title, proveedor: o.offer.supplier.commercialName, salePrice: o.offer.salePrice.toFixed(2), href: `${RUTA_OFERTAS_PUBLICAS}/${o.offer.slug}` })),
    }
  })
}

/**
 * Promociones de campaña aplicables a UNA oferta para ESTE cliente, ya
 * simuladas (§20). Las que piden cupón se anuncian pero no se simulan: el
 * código lo tiene que escribir.
 */
export interface PromocionDeOferta {
  campaignId: string
  campaignCode: string
  campaignName: string
  benefitId: string
  nombre: string
  exigeCupon: boolean
  descuentoProveedor: string
  bonoMembego: string
  beneficioTotal: string
  aPagar: string
  cubreTodo: boolean
}

export async function promocionesParaOferta(customerId: string | null, offerId: string, quantity = 1, ahora = new Date()): Promise<PromocionDeOferta[]> {
  const datos = await sinEmpresa('Supply 2.0: promociones de campaña de una oferta', async (tx) => {
    const oferta = await tx.supplyV2Offer.findUnique({
      where: { id: offerId },
      select: { id: true, catalogItemId: true, supplierId: true, sourceType: true, currency: true, salePrice: true, commissionPercentage: true, agreementVersion: { select: { snapshot: true } } },
    })
    if (!oferta) return null
    const participaciones = await tx.supplyV2CampaignOffer.findMany({
      where: { offerId, campaign: { status: 'ACTIVE' }, benefitId: { not: null } },
      include: {
        campaign: { select: { id: true, code: true, name: true, audience: true, status: true, startsAt: true, endsAt: true, activeFromMinute: true, activeToMinute: true, maxPerCustomer: true } },
        benefit: true,
      },
    })
    const historial = customerId ? await historialDelClienteEnTx(tx, customerId, null) : null
    return { oferta, participaciones, historial }
  })
  if (!datos) return []
  const { oferta, participaciones, historial } = datos
  const commissionBase = oferta.sourceType === 'COMMISSION' ? politicaDeVersion(oferta.agreementVersion?.snapshot ?? null).commissionBase : null
  const out: PromocionDeOferta[] = []
  for (const p of participaciones) {
    if (!p.benefit || p.benefit.status !== 'ACTIVE') continue
    if (fueraDeVigencia(p.campaign, ahora) !== null) continue
    if (historial && fueraDePublico(p.campaign.audience, historial)) continue
    let reparto
    try {
      reparto = calcularRepartoLinea({ saleUnitPrice: oferta.salePrice, quantity, beneficio: p.benefit, sourceType: oferta.sourceType, commissionPercentage: oferta.commissionPercentage, commissionBase })
    } catch {
      continue
    }
    out.push({
      campaignId: p.campaign.id,
      campaignCode: p.campaign.code,
      campaignName: p.campaign.name,
      benefitId: p.benefit.id,
      nombre: p.benefit.name,
      exigeCupon: p.benefit.requiresCoupon,
      descuentoProveedor: reparto.supplierDiscount.toFixed(2),
      bonoMembego: reparto.membegoSubsidy.toFixed(2),
      beneficioTotal: reparto.benefitApplied.toFixed(2),
      aPagar: reparto.customerPayable.toFixed(2),
      cubreTodo: reparto.customerPayable.isZero(),
    })
  }
  // Orden determinista (§25): lo que más rebaja primero, luego por código.
  return out.sort((a, z) => Number(z.beneficioTotal) - Number(a.beneficioTotal) || a.campaignCode.localeCompare(z.campaignCode))
}

// ── PROVEEDOR (§22) ─────────────────────────────────────────────────────────

export interface CampanaDelProveedor {
  id: string
  code: string
  name: string
  status: SupplyV2CampaignStatus
  organizer: SupplyV2CampaignOrganizer
  funding: SupplyV2BenefitFunding
  esPropuestaMia: boolean
  startsAt: Date
  endsAt: Date | null
  reviewNotes: string | null
  misOfertas: number
  /**
   * Lo que pone cada parte POR VENTA, en la promoción que más pone de las que
   * tocan a las ofertas de ESTE proveedor. No es una suma: sumar los valores
   * de varias promociones no da dinero, y las promociones de otros
   * proveedores no son asunto suyo.
   */
  miAporte: string
  aporteMembego: string
  /** true cuando esos valores son porcentajes del precio, no importes. */
  aporteEsPorcentaje: boolean
  ventasConfirmadas: number
  valorContractual: string
  descuentoAsumido: string
  netoContractual: string
  entregasPendientes: number
  entregasHechas: number
  currency: string
}

export async function campanasDelProveedor(supplierId: string): Promise<CampanaDelProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: campañas que afectan a un proveedor', (tx) =>
    tx.supplyV2Campaign.findMany({
      where: { OR: [{ supplierId }, { offers: { some: { offer: { supplierId } } } }] },
      orderBy: [{ status: 'asc' }, { startsAt: 'desc' }],
      take: 100,
      include: {
        offers: { where: { offer: { supplierId } }, select: { id: true, benefit: { select: { valueType: true, membegoValue: true, supplierValue: true } } } },
        orders: {
          where: { lines: { some: { offer: { supplierId } } } },
          select: { id: true, status: true, contractualValue: true, supplierDiscountTotal: true, supplierNet: true, entitlements: { select: { status: true } } },
        },
      },
    })
  )
  const mayor = (bs: { membegoValue: Prisma.Decimal; supplierValue: Prisma.Decimal }[], campo: 'membegoValue' | 'supplierValue') =>
    bs.reduce((t, b) => (b[campo].greaterThan(t) ? b[campo] : t), CERO)
  return filas.map((c) => {
    const pagadas = c.orders.filter((o) => o.status === 'PAID')
    const derechos = pagadas.flatMap((o) => o.entitlements)
    // Solo las promociones que tocan ofertas de este proveedor.
    const mias = c.offers.map((o) => o.benefit).filter((b): b is NonNullable<typeof b> => b !== null)
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      organizer: c.organizer,
      funding: c.funding,
      esPropuestaMia: c.organizer === 'SUPPLIER' && c.supplierId === supplierId,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      reviewNotes: c.reviewNotes,
      misOfertas: c.offers.length,
      miAporte: mayor(mias, 'supplierValue').toFixed(2),
      aporteMembego: mayor(mias, 'membegoValue').toFixed(2),
      aporteEsPorcentaje: mias.length > 0 && mias.every((b) => b.valueType === 'PERCENTAGE'),
      ventasConfirmadas: pagadas.length,
      valorContractual: pagadas.reduce((t, o) => t.plus(o.contractualValue), CERO).toFixed(2),
      descuentoAsumido: pagadas.reduce((t, o) => t.plus(o.supplierDiscountTotal), CERO).toFixed(2),
      netoContractual: pagadas.reduce((t, o) => t.plus(o.supplierNet ?? CERO), CERO).toFixed(2),
      entregasPendientes: derechos.filter((e) => e.status === 'ACTIVE').length,
      entregasHechas: derechos.filter((e) => e.status === 'REDEEMED').length,
      currency: c.currency,
    }
  })
}

/** Clientes para asignar una campaña o generar cupones privados (§14). */
export async function buscarClientesParaCampana(query: string): Promise<{ id: string; nombre: string; email: string }[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const filas = await sinEmpresa('Supply 2.0: buscar clientes para una campaña', (tx) =>
    tx.user.findMany({
      where: { role: 'CLIENTE', OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, email: true },
    })
  )
  return filas.map((u) => ({ id: u.id, nombre: u.name, email: u.email }))
}
