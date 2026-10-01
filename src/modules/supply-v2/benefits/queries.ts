import 'server-only'

import type { SupplyV2BenefitFunding, SupplyV2BenefitScope, SupplyV2BenefitStatus, SupplyV2BenefitValueType, SupplyV2CustomerBenefitStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { calcularRepartoLinea } from '../core/financiacion'
import { politicaDeVersion } from '../finance/domain'
import { RUTA_OFERTAS_PUBLICAS } from '../core/catalogo'
import { cubreOferta, motivoNoElegible, presupuestoDisponible, saldoDeMovimientosBeneficio, type MotivoNoElegible } from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · lecturas de BENEFICIOS (§29, §31, §32).
 *
 * Tres públicos, tres DTOs distintos:
 *   · ADMIN (§29): presupuesto, ledger, subsidio y resultado económico.
 *   · CLIENTE (§31): lo que tiene, dónde vale y hasta cuándo. Nunca presupuesto,
 *     nunca costo, nunca cuánto subsidia Membego en total.
 *   · PROVEEDOR (§32): lo que él financia y su importe contractual. Nunca el
 *     bono de Membego como si fuera suyo, nunca el presupuesto de Membego.
 */

const CERO = new Prisma.Decimal(0)
const d2 = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toFixed(2))

// ── ADMIN: listado (§29) ─────────────────────────────────────────────────────

export interface BeneficioEnLista {
  id: string
  code: string
  name: string
  status: SupplyV2BenefitStatus
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  membegoValue: string
  supplierValue: string
  scope: SupplyV2BenefitScope
  alcance: string
  currency: string
  budgetTotal: string | null
  budgetReserved: string
  budgetConsumed: string
  budgetDisponible: string | null
  perCustomerLimit: number
  requiresAssignment: boolean
  asignaciones: number
  aplicaciones: number
  reservasVivas: number
  startsAt: Date
  endsAt: Date | null
}

export async function listarBeneficios(): Promise<BeneficioEnLista[]> {
  const filas = await sinEmpresa('Supply 2.0: listado de beneficios', (tx) =>
    tx.supplyV2Benefit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        funding: true,
        valueType: true,
        membegoValue: true,
        supplierValue: true,
        scope: true,
        currency: true,
        budgetTotal: true,
        budgetReserved: true,
        budgetConsumed: true,
        perCustomerLimit: true,
        requiresAssignment: true,
        startsAt: true,
        endsAt: true,
        offer: { select: { title: true } },
        catalogItem: { select: { name: true } },
        supplier: { select: { commercialName: true } },
        _count: { select: { grants: true } },
        reservations: { select: { status: true } },
      },
    })
  )
  return filas.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    status: b.status,
    funding: b.funding,
    valueType: b.valueType,
    membegoValue: b.membegoValue.toFixed(2),
    supplierValue: b.supplierValue.toFixed(2),
    scope: b.scope,
    alcance: b.scope === 'SPECIFIC_OFFER' ? (b.offer?.title ?? '—') : b.scope === 'CATALOG_ITEM' ? (b.catalogItem?.name ?? '—') : (b.supplier?.commercialName ?? '—'),
    currency: b.currency,
    budgetTotal: d2(b.budgetTotal),
    budgetReserved: b.budgetReserved.toFixed(2),
    budgetConsumed: b.budgetConsumed.toFixed(2),
    budgetDisponible: d2(presupuestoDisponible(b)),
    perCustomerLimit: b.perCustomerLimit,
    requiresAssignment: b.requiresAssignment,
    asignaciones: b._count.grants,
    aplicaciones: b.reservations.filter((r) => r.status === 'APPLIED').length,
    reservasVivas: b.reservations.filter((r) => r.status === 'ACTIVE').length,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
  }))
}

// ── ADMIN: ficha (§29) ───────────────────────────────────────────────────────

export interface FichaBeneficio {
  id: string
  code: string
  name: string
  description: string | null
  objective: string | null
  status: SupplyV2BenefitStatus
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  membegoValue: string
  supplierValue: string
  maxMembegoAmount: string | null
  maxSupplierAmount: string | null
  scope: SupplyV2BenefitScope
  alcance: string
  offerId: string | null
  catalogItemId: string | null
  supplierId: string | null
  proveedor: string | null
  currency: string
  budgetTotal: string | null
  budgetReserved: string
  budgetConsumed: string
  budgetDisponible: string | null
  /** El ledger es la verdad (§12): si la caché no cuadra, la ficha lo dice. */
  ledger: { reserved: string; consumed: string; cuadra: boolean }
  perCustomerLimit: number
  requiresAssignment: boolean
  combinable: boolean
  startsAt: Date
  endsAt: Date | null
  creadoPor: string
  aprobadoPor: string | null
  approvedAt: Date | null
  cancelledAt: Date | null
  cancelledReason: string | null
  /** Resultado económico del beneficio (§28): lo que Membego subsidió y lo que cobró. */
  economia: { subsidioAplicado: string; descuentoProveedor: string; valorContractual: string; cobradoAlCliente: string; comision: string; ordenes: number }
  asignaciones: {
    id: string
    cliente: string
    email: string
    status: SupplyV2CustomerBenefitStatus
    usesAllowed: number
    usesConsumed: number
    expiresAt: Date | null
    note: string | null
    grantedAt: Date
    otorgadoPor: string
  }[]
  usos: {
    id: string
    orderNumber: string
    orderId: string
    cliente: string
    status: string
    quantity: number
    supplierAmount: string
    membegoAmount: string
    createdAt: Date
    appliedAt: Date | null
    reversedReason: string | null
  }[]
  movimientos: { id: string; type: string; reservedDelta: string; consumedDelta: string; reservedAfter: string; consumedAfter: string; reason: string | null; actor: string | null; createdAt: Date }[]
}

export async function fichaBeneficio(id: string): Promise<FichaBeneficio | null> {
  const b = await sinEmpresa('Supply 2.0: ficha de un beneficio', (tx) =>
    tx.supplyV2Benefit.findUnique({
      where: { id },
      include: {
        offer: { select: { id: true, title: true } },
        catalogItem: { select: { id: true, name: true } },
        supplier: { select: { id: true, commercialName: true } },
        createdBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
        grants: {
          orderBy: { grantedAt: 'desc' },
          take: 200,
          include: { customer: { select: { name: true, email: true } }, grantedBy: { select: { name: true, email: true } } },
        },
        reservations: {
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            customer: { select: { name: true, email: true } },
            order: { select: { id: true, number: true, contractualValue: true, total: true, commissionAmount: true } },
          },
        },
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 300,
          include: { actor: { select: { name: true, email: true } } },
        },
      },
    })
  )
  if (!b) return null
  const ledger = saldoDeMovimientosBeneficio(b.movements)
  const aplicadas = b.reservations.filter((r) => r.status === 'APPLIED')
  const economia = aplicadas.reduce(
    (t, r) => ({
      subsidioAplicado: t.subsidioAplicado.plus(r.membegoAmount),
      descuentoProveedor: t.descuentoProveedor.plus(r.supplierAmount),
      valorContractual: t.valorContractual.plus(r.order.contractualValue),
      cobradoAlCliente: t.cobradoAlCliente.plus(r.order.total),
      comision: t.comision.plus(r.order.commissionAmount ?? CERO),
    }),
    { subsidioAplicado: CERO, descuentoProveedor: CERO, valorContractual: CERO, cobradoAlCliente: CERO, comision: CERO }
  )
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    description: b.description,
    objective: b.objective,
    status: b.status,
    funding: b.funding,
    valueType: b.valueType,
    membegoValue: b.membegoValue.toFixed(2),
    supplierValue: b.supplierValue.toFixed(2),
    maxMembegoAmount: d2(b.maxMembegoAmount),
    maxSupplierAmount: d2(b.maxSupplierAmount),
    scope: b.scope,
    alcance: b.scope === 'SPECIFIC_OFFER' ? (b.offer?.title ?? '—') : b.scope === 'CATALOG_ITEM' ? (b.catalogItem?.name ?? '—') : (b.supplier?.commercialName ?? '—'),
    offerId: b.offerId,
    catalogItemId: b.catalogItemId,
    supplierId: b.supplierId,
    proveedor: b.supplier?.commercialName ?? null,
    currency: b.currency,
    budgetTotal: d2(b.budgetTotal),
    budgetReserved: b.budgetReserved.toFixed(2),
    budgetConsumed: b.budgetConsumed.toFixed(2),
    budgetDisponible: d2(presupuestoDisponible(b)),
    ledger: {
      reserved: ledger.reserved.toFixed(2),
      consumed: ledger.consumed.toFixed(2),
      cuadra: ledger.reserved.equals(b.budgetReserved) && ledger.consumed.equals(b.budgetConsumed),
    },
    perCustomerLimit: b.perCustomerLimit,
    requiresAssignment: b.requiresAssignment,
    combinable: b.combinable,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    creadoPor: b.createdBy.name,
    aprobadoPor: b.approvedBy?.name ?? null,
    approvedAt: b.approvedAt,
    cancelledAt: b.cancelledAt,
    cancelledReason: b.cancelledReason,
    economia: {
      subsidioAplicado: economia.subsidioAplicado.toFixed(2),
      descuentoProveedor: economia.descuentoProveedor.toFixed(2),
      valorContractual: economia.valorContractual.toFixed(2),
      cobradoAlCliente: economia.cobradoAlCliente.toFixed(2),
      comision: economia.comision.toFixed(2),
      ordenes: aplicadas.length,
    },
    asignaciones: b.grants.map((g) => ({
      id: g.id,
      cliente: g.customer.name,
      email: g.customer.email,
      status: g.status,
      usesAllowed: g.usesAllowed,
      usesConsumed: g.usesConsumed,
      expiresAt: g.expiresAt,
      note: g.note,
      grantedAt: g.grantedAt,
      otorgadoPor: g.grantedBy.name,
    })),
    usos: b.reservations.map((r) => ({
      id: r.id,
      orderNumber: r.order.number,
      orderId: r.order.id,
      cliente: r.customer.name,
      status: r.status,
      quantity: r.quantity,
      supplierAmount: r.supplierAmount.toFixed(2),
      membegoAmount: r.membegoAmount.toFixed(2),
      createdAt: r.createdAt,
      appliedAt: r.appliedAt,
      reversedReason: r.reversedReason,
    })),
    movimientos: b.movements.map((m) => ({
      id: m.id,
      type: m.type,
      reservedDelta: m.reservedDelta.toFixed(2),
      consumedDelta: m.consumedDelta.toFixed(2),
      reservedAfter: m.reservedAfter.toFixed(2),
      consumedAfter: m.consumedAfter.toFixed(2),
      reason: m.reason,
      actor: m.actor?.name ?? null,
      createdAt: m.createdAt,
    })),
  }
}

/** Ofertas y productos para el asistente de alta (§30). */
export interface OpcionesBeneficio {
  ofertas: { id: string; title: string; supplierId: string; supplierName: string; catalogItemId: string; sourceType: string; salePrice: string; currency: string; commissionPercentage: string | null }[]
  productos: { id: string; name: string; supplierId: string; supplierName: string; currency: string }[]
  proveedores: { id: string; name: string; currency: string }[]
}

export async function opcionesDeBeneficio(): Promise<OpcionesBeneficio> {
  return sinEmpresa('Supply 2.0: opciones para crear un beneficio', async (tx) => {
    const [ofertas, productos, proveedores] = await Promise.all([
      tx.supplyV2Offer.findMany({
        where: { status: { in: ['ACTIVE', 'SCHEDULED', 'DRAFT'] } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, supplierId: true, catalogItemId: true, sourceType: true, salePrice: true, currency: true, commissionPercentage: true, supplier: { select: { commercialName: true } } },
      }),
      tx.supplyV2CatalogItem.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        take: 300,
        select: { id: true, name: true, supplierId: true, currency: true, supplier: { select: { commercialName: true } } },
      }),
      tx.supplyV2Supplier.findMany({ where: { status: 'ACTIVE' }, orderBy: { commercialName: 'asc' }, take: 300, select: { id: true, commercialName: true, currency: true } }),
    ])
    return {
      ofertas: ofertas.map((o) => ({
        id: o.id,
        title: o.title,
        supplierId: o.supplierId,
        supplierName: o.supplier.commercialName,
        catalogItemId: o.catalogItemId,
        sourceType: o.sourceType,
        salePrice: o.salePrice.toFixed(2),
        currency: o.currency,
        commissionPercentage: d2(o.commissionPercentage),
      })),
      productos: productos.map((i) => ({ id: i.id, name: i.name, supplierId: i.supplierId, supplierName: i.supplier.commercialName, currency: i.currency })),
      proveedores: proveedores.map((s) => ({ id: s.id, name: s.commercialName, currency: s.currency })),
    }
  })
}

/** Clientes para asignar (§10): búsqueda por nombre o correo, solo rol CLIENTE. */
export async function buscarClientesParaBeneficio(query: string): Promise<{ id: string; nombre: string; email: string }[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const filas = await sinEmpresa('Supply 2.0: buscar clientes para asignar un beneficio', (tx) =>
    tx.user.findMany({
      where: { role: 'CLIENTE', OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, email: true },
    })
  )
  return filas.map((u) => ({ id: u.id, nombre: u.name, email: u.email }))
}

// ── CLIENTE: «Mis beneficios» (§31) ──────────────────────────────────────────

export interface BeneficioDelCliente {
  customerBenefitId: string
  benefitId: string
  code: string
  name: string
  description: string | null
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  /** Lo que el cliente ve como valor del beneficio: Membego + proveedor. */
  valor: string
  currency: string
  status: SupplyV2CustomerBenefitStatus
  usesAllowed: number
  usesConsumed: number
  expiresAt: Date | null
  /** Vencimiento efectivo: lo antes que venza la asignación o el beneficio. */
  vigenteHasta: Date | null
  usable: boolean
  motivo: string | null
  ofertas: { slug: string; title: string; supplier: string; salePrice: string; href: string }[]
}

const MOTIVO_CLIENTE: Partial<Record<MotivoNoElegible | 'SIN_OFERTAS', string>> = {
  BENEFICIO_INACTIVO: 'Este beneficio no está disponible ahora.',
  BENEFICIO_NO_VIGENTE: 'Este beneficio todavía no empieza.',
  BENEFICIO_VENCIDO: 'Este beneficio ya venció.',
  ASIGNACION_VENCIDA: 'Este beneficio ya venció.',
  ASIGNACION_INACTIVA: 'Este beneficio ya no está disponible.',
  SIN_USOS: 'Ya usaste este beneficio.',
  PRESUPUESTO_INSUFICIENTE: 'Este beneficio se agotó.',
  SIN_OFERTAS: 'Ahora mismo no hay ofertas activas donde usarlo.',
}

/**
 * Lo que el cliente tiene en su cuenta, con las ofertas vivas donde vale
 * (§31). Nunca presupuesto ni costos: solo su valor, hasta cuándo y dónde.
 */
export async function misBeneficios(customerId: string, ahora = new Date()): Promise<BeneficioDelCliente[]> {
  const filas = await sinEmpresa('Supply 2.0: beneficios del cliente de la sesión', (tx) =>
    tx.supplyV2CustomerBenefit.findMany({
      where: { customerId },
      orderBy: [{ status: 'asc' }, { grantedAt: 'desc' }],
      take: 100,
      include: { benefit: true },
    })
  )
  if (filas.length === 0) return []
  const ofertas = await sinEmpresa('Supply 2.0: ofertas vivas donde valen los beneficios del cliente', (tx) =>
    tx.supplyV2Offer.findMany({
      where: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] },
      take: 300,
      select: { id: true, slug: true, title: true, catalogItemId: true, supplierId: true, sourceType: true, currency: true, salePrice: true, supplier: { select: { commercialName: true } } },
    })
  )
  return filas.map((g) => {
    const b = g.benefit
    const elegibles = ofertas.filter((o) => cubreOferta(b, o) && b.currency === o.currency && (b.funding === 'MEMBEGO' || (b.supplierId === o.supplierId && o.sourceType === 'COMMISSION')))
    const motivo = motivoNoElegible(b, elegibles[0] ?? { id: '', catalogItemId: '', supplierId: '', sourceType: 'COMMISSION', currency: b.currency }, customerId, g, g.usesConsumed, CERO, ahora)
    const sinOfertas = elegibles.length === 0
    const usable = !motivo && !sinOfertas
    const vence = [g.expiresAt, b.endsAt].filter((f): f is Date => f instanceof Date).sort((a, z) => a.getTime() - z.getTime())[0] ?? null
    return {
      customerBenefitId: g.id,
      benefitId: b.id,
      code: b.code,
      name: b.name,
      description: b.description,
      funding: b.funding,
      valueType: b.valueType,
      valor: b.membegoValue.plus(b.supplierValue).toFixed(2),
      currency: b.currency,
      status: g.status,
      usesAllowed: g.usesAllowed,
      usesConsumed: g.usesConsumed,
      expiresAt: g.expiresAt,
      vigenteHasta: vence,
      usable,
      motivo: usable ? null : (MOTIVO_CLIENTE[motivo ?? 'SIN_OFERTAS'] ?? 'Este beneficio no se puede usar ahora.'),
      ofertas: elegibles.slice(0, 6).map((o) => ({ slug: o.slug, title: o.title, supplier: o.supplier.commercialName, salePrice: o.salePrice.toFixed(2), href: `${RUTA_OFERTAS_PUBLICAS}/${o.slug}` })),
    }
  })
}

// ── CLIENTE: beneficios aplicables a UNA oferta (§17) ────────────────────────

export interface BeneficioAplicable {
  customerBenefitId: string
  benefitId: string
  code: string
  name: string
  funding: SupplyV2BenefitFunding
  /** Simulación para la cantidad pedida: lo que rebaja y lo que quedaría por pagar. */
  descuentoProveedor: string
  bonoMembego: string
  beneficioTotal: string
  aPagar: string
  cubreTodo: boolean
}

/**
 * Qué beneficios de ESTE cliente aplican a ESTA oferta, ya simulados para la
 * cantidad pedida (§17). Es una vista: el servidor revalida y reserva en el
 * checkout. Nunca inventa un beneficio que el cliente no tenga.
 */
export async function beneficiosParaOferta(customerId: string, offerId: string, quantity = 1, ahora = new Date()): Promise<BeneficioAplicable[]> {
  const datos = await sinEmpresa('Supply 2.0: beneficios del cliente aplicables a una oferta', async (tx) => {
    const oferta = await tx.supplyV2Offer.findUnique({
      where: { id: offerId },
      select: { id: true, catalogItemId: true, supplierId: true, sourceType: true, currency: true, salePrice: true, commissionPercentage: true, agreementVersion: { select: { snapshot: true } } },
    })
    if (!oferta) return null
    const grants = await tx.supplyV2CustomerBenefit.findMany({
      where: { customerId, status: 'AVAILABLE' },
      orderBy: { grantedAt: 'desc' },
      take: 50,
      include: { benefit: true },
    })
    const vivos = await tx.supplyV2BenefitReservation.groupBy({ by: ['benefitId'], where: { customerId, status: { in: ['ACTIVE', 'APPLIED'] } }, _count: { _all: true } })
    return { oferta, grants, vivos: new Map(vivos.map((v) => [v.benefitId, v._count._all])) }
  })
  if (!datos) return []
  const { oferta, grants, vivos } = datos
  const commissionBase = oferta.sourceType === 'COMMISSION' ? politicaDeVersion(oferta.agreementVersion?.snapshot ?? null).commissionBase : null
  const out: BeneficioAplicable[] = []
  for (const g of grants) {
    const b = g.benefit
    let reparto
    try {
      reparto = calcularRepartoLinea({
        saleUnitPrice: oferta.salePrice,
        quantity,
        beneficio: b,
        sourceType: oferta.sourceType,
        commissionPercentage: oferta.commissionPercentage,
        commissionBase,
      })
    } catch {
      continue
    }
    if (motivoNoElegible(b, oferta, customerId, g, vivos.get(b.id) ?? 0, reparto.membegoSubsidy, ahora)) continue
    if (reparto.benefitApplied.lessThanOrEqualTo(0)) continue
    out.push({
      customerBenefitId: g.id,
      benefitId: b.id,
      code: b.code,
      name: b.name,
      funding: b.funding,
      descuentoProveedor: reparto.supplierDiscount.toFixed(2),
      bonoMembego: reparto.membegoSubsidy.toFixed(2),
      beneficioTotal: reparto.benefitApplied.toFixed(2),
      aPagar: reparto.customerPayable.toFixed(2),
      cubreTodo: reparto.customerPayable.isZero(),
    })
  }
  return out.sort((a, z) => Number(z.beneficioTotal) - Number(a.beneficioTotal))
}

// ── PROVEEDOR (§32) ──────────────────────────────────────────────────────────

export interface BeneficioDelProveedor {
  id: string
  code: string
  name: string
  status: SupplyV2BenefitStatus
  funding: SupplyV2BenefitFunding
  valueType: SupplyV2BenefitValueType
  /** Lo que el proveedor financia. Lo de Membego se informa aparte y nunca como suyo. */
  miAporte: string
  aporteMembego: string
  alcance: string
  currency: string
  startsAt: Date
  endsAt: Date | null
  ventas: number
  /** Suma de lo que él descontó y del importe contractual que se le reconoce. */
  descuentoAsumido: string
  valorContractual: string
}

export async function beneficiosDelProveedor(supplierId: string): Promise<BeneficioDelProveedor[]> {
  const filas = await sinEmpresa('Supply 2.0: beneficios que afectan a un proveedor', (tx) =>
    tx.supplyV2Benefit.findMany({
      where: {
        OR: [{ supplierId }, { offer: { supplierId } }, { catalogItem: { supplierId } }],
        status: { in: ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED'] },
      },
      orderBy: { startsAt: 'desc' },
      take: 100,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        funding: true,
        valueType: true,
        membegoValue: true,
        supplierValue: true,
        scope: true,
        currency: true,
        startsAt: true,
        endsAt: true,
        offer: { select: { title: true } },
        catalogItem: { select: { name: true } },
        supplier: { select: { commercialName: true } },
        reservations: { where: { status: 'APPLIED' }, select: { supplierAmount: true, order: { select: { contractualValue: true } } } },
      },
    })
  )
  return filas.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    status: b.status,
    funding: b.funding,
    valueType: b.valueType,
    miAporte: b.supplierValue.toFixed(2),
    aporteMembego: b.membegoValue.toFixed(2),
    alcance: b.scope === 'SPECIFIC_OFFER' ? (b.offer?.title ?? '—') : b.scope === 'CATALOG_ITEM' ? (b.catalogItem?.name ?? '—') : (b.supplier?.commercialName ?? '—'),
    currency: b.currency,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    ventas: b.reservations.length,
    descuentoAsumido: b.reservations.reduce((t, r) => t.plus(r.supplierAmount), CERO).toFixed(2),
    valorContractual: b.reservations.reduce((t, r) => t.plus(r.order.contractualValue), CERO).toFixed(2),
  }))
}
