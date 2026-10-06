import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import { exigirTransicion } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { calcularRepartoLinea, type BeneficioParaCalculo, type RepartoFinanciado } from '../core/financiacion'
import { esAutoaprobacion, MOTIVO_AUTOAPROBACION } from '../core/segregacion'
import { estadoAsignacionSegunUsos, MENSAJES_NO_ELEGIBLE, motivoNoElegible, TRANSICIONES_BENEFICIO, validarBeneficio, type DatosBeneficio } from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 6 · BENEFICIOS (§7–§12, §16, §20, §27).
 *
 * TODO dentro de la `tx` de quien llama. Orden de candados: BENEFICIO
 * (`FOR UPDATE`) → ASIGNACIÓN (`FOR UPDATE`). El checkout ya trae la oferta
 * bloqueada; el beneficio se toma después, siempre en este orden, así dos
 * checkouts por el mismo bono o por los últimos pesos del presupuesto se
 * serializan y solo uno pasa (§33). La base tiene la última palabra: CHECK
 * `supply_v2_benefits_budget` y `supply_v2_customer_benefits_uses`.
 *
 * El ledger (`supply_v2_benefit_movements`) es la verdad del presupuesto:
 * `budgetReserved` / `budgetConsumed` son caché y se escriben junto con el
 * movimiento que los explica (§12).
 */

const CERO = new Prisma.Decimal(0)

async function bloquearBeneficio(tx: Tx, benefitId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_benefits" WHERE "id" = ${benefitId} FOR UPDATE`
  const b = await tx.supplyV2Benefit.findUnique({ where: { id: benefitId }, include: { supplier: { select: { companyId: true } } } })
  if (!b) fallo('BENEFICIO_NO_ENCONTRADO', 'El beneficio no existe.')
  return b
}

async function movimiento(
  tx: Tx,
  b: { id: string; budgetReserved: Decimal; budgetConsumed: Decimal },
  d: { type: 'GRANTED' | 'RESERVED' | 'APPLIED' | 'RELEASED' | 'EXPIRED' | 'REVERSED'; reservedDelta?: Decimal; consumedDelta?: Decimal; supplierAmount?: Decimal; customerBenefitId?: string | null; reservationId?: string | null; reason?: string | null },
  actorId: string | null
): Promise<{ reserved: Decimal; consumed: Decimal }> {
  const reserved = b.budgetReserved.plus(d.reservedDelta ?? CERO)
  const consumed = b.budgetConsumed.plus(d.consumedDelta ?? CERO)
  if (reserved.isNegative() || consumed.isNegative()) fallo('PRESUPUESTO_INCONSISTENTE', 'El presupuesto del beneficio quedaría negativo.')
  await tx.supplyV2BenefitMovement.create({
    data: {
      benefitId: b.id,
      customerBenefitId: d.customerBenefitId ?? null,
      reservationId: d.reservationId ?? null,
      type: d.type,
      reservedDelta: d.reservedDelta ?? CERO,
      consumedDelta: d.consumedDelta ?? CERO,
      supplierAmount: d.supplierAmount ?? CERO,
      reservedAfter: reserved,
      consumedAfter: consumed,
      reason: d.reason ?? null,
      actorId,
    },
  })
  // El CHECK de la base rechaza aquí cualquier sobregiro que se cuele.
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { budgetReserved: reserved, budgetConsumed: consumed } })
  b.budgetReserved = reserved
  b.budgetConsumed = consumed
  return { reserved, consumed }
}

// ── Alta, aprobación, pausa, cancelación (§7, §29–§30) ──────────────────────

export interface BeneficioCreado {
  id: string
  code: string
  status: string
}

export async function crearBeneficioEnTx(tx: Tx, d: DatosBeneficio, ctx: ContextoAuditoria): Promise<BeneficioCreado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un beneficio necesita quién lo crea.')
  const error = validarBeneficio(d)
  if (error) fallo('BENEFICIO_INVALIDO', error)
  let currency = 'DOP'
  let companyId: string | null = null
  if (d.supplierId) {
    const s = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, status: true, currency: true, companyId: true } })
    if (!s) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
    if (s.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')
    currency = s.currency
    companyId = s.companyId
  }
  if (d.scope === 'SPECIFIC_OFFER') {
    const o = await tx.supplyV2Offer.findUnique({ where: { id: d.offerId! }, select: { id: true, supplierId: true, currency: true, status: true } })
    if (!o) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
    if (d.supplierId && d.supplierId !== o.supplierId) fallo('PROVEEDOR_DISTINTO', 'La oferta no es del proveedor que financia el descuento.')
    if (['ENDED', 'CANCELLED'].includes(o.status)) fallo('OFERTA_CERRADA', 'La oferta ya terminó.')
    currency = o.currency
  }
  if (d.scope === 'CATALOG_ITEM') {
    const i = await tx.supplyV2CatalogItem.findUnique({ where: { id: d.catalogItemId! }, select: { id: true, supplierId: true, currency: true } })
    if (!i) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
    if (d.supplierId && d.supplierId !== i.supplierId) fallo('PROVEEDOR_DISTINTO', 'El producto no es del proveedor que financia el descuento.')
    currency = i.currency
  }
  const code = await siguienteNumero(tx, 'MBG-BN', async (prefijo) => {
    const u = await tx.supplyV2Benefit.findFirst({ where: { code: { startsWith: prefijo } }, orderBy: { code: 'desc' }, select: { code: true } })
    return u?.code ?? null
  }, d.startsAt)
  const b = await tx.supplyV2Benefit.create({
    data: {
      code,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      objective: d.objective?.trim() || null,
      funding: d.funding,
      valueType: d.valueType,
      membegoValue: d.membegoValue != null && d.membegoValue !== '' ? redondear2(decimal(d.membegoValue)) : CERO,
      supplierValue: d.supplierValue != null && d.supplierValue !== '' ? redondear2(decimal(d.supplierValue)) : CERO,
      maxMembegoAmount: d.maxMembegoAmount != null && d.maxMembegoAmount !== '' ? redondear2(decimal(d.maxMembegoAmount)) : null,
      maxSupplierAmount: d.maxSupplierAmount != null && d.maxSupplierAmount !== '' ? redondear2(decimal(d.maxSupplierAmount)) : null,
      scope: d.scope,
      offerId: d.scope === 'SPECIFIC_OFFER' ? d.offerId : null,
      catalogItemId: d.scope === 'CATALOG_ITEM' ? d.catalogItemId : null,
      supplierId: d.supplierId ?? null,
      currency,
      budgetTotal: d.budgetTotal != null && d.budgetTotal !== '' ? redondear2(decimal(d.budgetTotal)) : null,
      perCustomerLimit: d.perCustomerLimit ?? 1,
      requiresAssignment: d.requiresAssignment ?? true,
      requiresCoupon: d.requiresCoupon ?? false,
      combinable: d.combinable ?? false,
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, status: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_CREATED', 'SupplyV2Benefit', b.id, {
    code: b.code,
    name: d.name.trim(),
    funding: d.funding,
    valueType: d.valueType,
    membegoValue: String(d.membegoValue ?? 0),
    supplierValue: String(d.supplierValue ?? 0),
    scope: d.scope,
    budgetTotal: d.budgetTotal != null && d.budgetTotal !== '' ? String(d.budgetTotal) : null,
  }, companyId)
  return b
}

/** APROBAR (§34): otra persona autorizada. DRAFT → ACTIVE. Idempotente. */
export async function aprobarBeneficioEnTx(tx: Tx, benefitId: string, ctx: ContextoAuditoria): Promise<{ id: string; code: string; status: string; repetido: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Aprobar un beneficio necesita quién lo aprueba.')
  const b = await bloquearBeneficio(tx, benefitId)
  if (b.status === 'ACTIVE') return { id: b.id, code: b.code, status: b.status, repetido: true }
  exigirTransicion(TRANSICIONES_BENEFICIO, b.status, 'ACTIVE', 'Beneficio')
  if (b.status !== 'DRAFT') fallo('BENEFICIO_NO_APROBABLE', `Un beneficio ${b.status} no se aprueba; se reactiva.`)
  const autoaprobada = esAutoaprobacion(b.createdById, ctx.actorId)
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'ACTIVE', approvedById: ctx.actorId, approvedAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_APPROVED', 'SupplyV2Benefit', b.id, {
    code: b.code,
    createdById: b.createdById,
    budgetTotal: b.budgetTotal?.toFixed(2) ?? null,
    autoaprobada: autoaprobada,
    ...(autoaprobada ? { motivo: MOTIVO_AUTOAPROBACION } : {}),
  }, b.supplier?.companyId ?? null)
  return { id: b.id, code: b.code, status: 'ACTIVE', repetido: false }
}

export async function pausarBeneficioEnTx(tx: Tx, benefitId: string, ctx: ContextoAuditoria): Promise<void> {
  const b = await bloquearBeneficio(tx, benefitId)
  if (b.status === 'PAUSED') return
  exigirTransicion(TRANSICIONES_BENEFICIO, b.status, 'PAUSED', 'Beneficio')
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'PAUSED' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_PAUSED', 'SupplyV2Benefit', b.id, { code: b.code, antes: b.status }, b.supplier?.companyId ?? null)
}

export async function reanudarBeneficioEnTx(tx: Tx, benefitId: string, ctx: ContextoAuditoria): Promise<void> {
  const b = await bloquearBeneficio(tx, benefitId)
  if (b.status === 'ACTIVE') return
  exigirTransicion(TRANSICIONES_BENEFICIO, b.status, 'ACTIVE', 'Beneficio')
  if (b.status === 'EXHAUSTED' && b.budgetTotal && b.budgetTotal.minus(b.budgetReserved).minus(b.budgetConsumed).lessThanOrEqualTo(0)) {
    fallo('PRESUPUESTO_AGOTADO', 'El presupuesto sigue agotado: amplíalo antes de reactivar.')
  }
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'ACTIVE' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_RESUMED', 'SupplyV2Benefit', b.id, { code: b.code, antes: b.status }, b.supplier?.companyId ?? null)
}

/** CANCELAR: nunca con reservas vivas (hay checkouts en curso); lo aplicado queda aplicado. */
export async function cancelarBeneficioEnTx(tx: Tx, benefitId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar un beneficio exige un motivo.')
  const b = await bloquearBeneficio(tx, benefitId)
  if (b.status === 'CANCELLED') return
  exigirTransicion(TRANSICIONES_BENEFICIO, b.status, 'CANCELLED', 'Beneficio')
  const vivas = await tx.supplyV2BenefitReservation.count({ where: { benefitId: b.id, status: 'ACTIVE' } })
  if (vivas > 0) fallo('BENEFICIO_CON_RESERVAS', `Hay ${vivas} checkout(s) en curso con este beneficio: pausa el beneficio y espera a que se paguen o expiren.`)
  await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: motivo.trim() } })
  await tx.supplyV2CustomerBenefit.updateMany({ where: { benefitId: b.id, status: 'AVAILABLE' }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_CANCELLED', 'SupplyV2Benefit', b.id, { code: b.code, antes: b.status, motivo: motivo.trim() }, b.supplier?.companyId ?? null)
}

// ── Asignación a clientes (§10) ──────────────────────────────────────────────

export async function asignarBeneficioEnTx(
  tx: Tx,
  d: { benefitId: string; customerId: string; usesAllowed?: number | null; expiresAt?: Date | null; note?: string | null },
  ctx: ContextoAuditoria
): Promise<{ id: string; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Asignar un beneficio necesita quién lo asigna.')
  const b = await bloquearBeneficio(tx, d.benefitId)
  if (!['ACTIVE', 'DRAFT', 'PAUSED'].includes(b.status)) fallo('BENEFICIO_NO_ASIGNABLE', `Un beneficio ${b.status} no se asigna.`)
  const cliente = await tx.user.findUnique({ where: { id: d.customerId }, select: { id: true, role: true } })
  if (!cliente || cliente.role !== 'CLIENTE') fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no existe o no es un cliente de Membego.')
  const previa = await tx.supplyV2CustomerBenefit.findUnique({ where: { benefitId_customerId: { benefitId: b.id, customerId: d.customerId } }, select: { id: true, status: true } })
  if (previa && previa.status !== 'CANCELLED') return { id: previa.id, repetida: true }
  const uses = d.usesAllowed ?? b.perCustomerLimit
  if (!Number.isInteger(uses) || uses <= 0 || uses > b.perCustomerLimit) fallo('USOS_INVALIDOS', `Los usos tienen que estar entre 1 y ${b.perCustomerLimit}.`)
  if (d.expiresAt && b.endsAt && d.expiresAt > b.endsAt) fallo('VENCIMIENTO_INVALIDO', 'La asignación no puede vencer después que el beneficio.')
  const g = previa
    ? await tx.supplyV2CustomerBenefit.update({ where: { id: previa.id }, data: { status: 'AVAILABLE', usesAllowed: uses, usesConsumed: 0, expiresAt: d.expiresAt ?? null, note: d.note?.trim() || null, grantedById: ctx.actorId, grantedAt: new Date(), cancelledAt: null }, select: { id: true } })
    : await tx.supplyV2CustomerBenefit.create({ data: { benefitId: b.id, customerId: d.customerId, usesAllowed: uses, expiresAt: d.expiresAt ?? null, note: d.note?.trim() || null, grantedById: ctx.actorId }, select: { id: true } })
  await movimiento(tx, b, { type: 'GRANTED', customerBenefitId: g.id, reason: `Asignado a un cliente (${uses} uso(s)).` }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_GRANTED', 'SupplyV2CustomerBenefit', g.id, { benefitId: b.id, code: b.code, customerId: d.customerId, usesAllowed: uses, expiresAt: d.expiresAt?.toISOString() ?? null }, b.supplier?.companyId ?? null)
  return { id: g.id, repetida: false }
}

export async function cancelarAsignacionEnTx(tx: Tx, customerBenefitId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar una asignación exige un motivo.')
  const g = await tx.supplyV2CustomerBenefit.findUnique({ where: { id: customerBenefitId }, select: { id: true, status: true, benefitId: true, benefit: { select: { code: true, supplier: { select: { companyId: true } } } } } })
  if (!g) fallo('ASIGNACION_NO_ENCONTRADA', 'La asignación no existe.')
  if (g.status === 'CANCELLED') return
  const vivas = await tx.supplyV2BenefitReservation.count({ where: { customerBenefitId: g.id, status: 'ACTIVE' } })
  if (vivas > 0) fallo('ASIGNACION_CON_RESERVAS', 'El cliente tiene un checkout en curso con este beneficio.')
  await tx.supplyV2CustomerBenefit.update({ where: { id: g.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_GRANT_CANCELLED', 'SupplyV2CustomerBenefit', g.id, { benefitId: g.benefitId, code: g.benefit.code, motivo: motivo.trim() }, g.benefit.supplier?.companyId ?? null)
}

// ── Reserva → aplicación → liberación (§16, §20, §27) ───────────────────────

export interface ReservaDeBeneficio {
  reservationId: string
  benefitId: string
  customerBenefitId: string | null
  reparto: RepartoFinanciado
  beneficio: { id: string; code: string; name: string; funding: string; valueType: string; membegoValue: string; supplierValue: string; campaignId: string | null }
}

export interface OfertaParaReserva {
  id: string
  catalogItemId: string
  supplierId: string
  sourceType: 'PREPURCHASED_SUPPLY' | 'COMMISSION'
  currency: string
  salePrice: Decimal
  commissionPercentage: Decimal | null
  commissionBase: 'CONTRACTUAL_SALE_VALUE' | 'CUSTOMER_PAID_AMOUNT' | null
}

/**
 * Calcula y RESERVA el beneficio para una línea. Se llama con la oferta ya
 * bloqueada; bloquea beneficio y asignación; valida TODO en el servidor
 * (§16, §33) y deja la reserva ACTIVE hasta `expiresAt` (el de la orden).
 * Devuelve el reparto que la orden congela. Sin beneficio devuelve `null` y
 * el reparto plano lo calcula quien llama.
 */
export async function reservarBeneficioEnTx(
  tx: Tx,
  d: {
    customerId: string
    customerBenefitId?: string | null
    benefitId?: string | null
    oferta: OfertaParaReserva
    quantity: number
    orderId: string
    orderLineId: string
    expiresAt: Date
    /** Slice 7 (§9): quien llama ya resolvió y bloqueó un cupón para este beneficio. */
    conCupon?: boolean
    /**
     * Slice 7 (§20): promoción que se aplica SOLA. Si ya no cabe —presupuesto
     * agotado, límite del cliente, público— no se puede romper la compra: el
     * cliente no pidió esa promoción. Devuelve `null` y quien llama sigue a
     * precio normal. Se decide DENTRO del candado del beneficio, así que dos
     * checkouts por los últimos pesos no se sobregiran: el segundo ve el
     * presupuesto ya reservado y se va sin rebaja.
     */
    opcional?: boolean
  },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ReservaDeBeneficio | null> {
  let benefitId = d.benefitId ?? null
  let customerBenefitId = d.customerBenefitId ?? null
  if (customerBenefitId) {
    const g = await tx.supplyV2CustomerBenefit.findUnique({ where: { id: customerBenefitId }, select: { id: true, benefitId: true, customerId: true } })
    if (!g) fallo('SIN_ASIGNACION', MENSAJES_NO_ELEGIBLE.SIN_ASIGNACION)
    if (g.customerId !== d.customerId) fallo('ASIGNACION_AJENA', MENSAJES_NO_ELEGIBLE.ASIGNACION_AJENA)
    benefitId = g.benefitId
  }
  if (!benefitId) fallo('BENEFICIO_NO_ENCONTRADO', 'Elige un beneficio.')

  // Candados: beneficio → asignación.
  const b = await bloquearBeneficio(tx, benefitId)
  let asignacion = null as null | { id: string; customerId: string; status: 'AVAILABLE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED'; usesAllowed: number; usesConsumed: number; expiresAt: Date | null }
  if (b.requiresAssignment) {
    const g = customerBenefitId
      ? await tx.supplyV2CustomerBenefit.findUnique({ where: { id: customerBenefitId } })
      : await tx.supplyV2CustomerBenefit.findUnique({ where: { benefitId_customerId: { benefitId: b.id, customerId: d.customerId } } })
    if (!g) fallo('SIN_ASIGNACION', MENSAJES_NO_ELEGIBLE.SIN_ASIGNACION)
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_customer_benefits" WHERE "id" = ${g.id} FOR UPDATE`
    asignacion = { id: g.id, customerId: g.customerId, status: estadoAsignacionSegunUsos(g, ahora), usesAllowed: g.usesAllowed, usesConsumed: g.usesConsumed, expiresAt: g.expiresAt }
    customerBenefitId = g.id
  }
  const usosVivos = await tx.supplyV2BenefitReservation.count({ where: { benefitId: b.id, customerId: d.customerId, status: { in: ['ACTIVE', 'APPLIED'] } } })

  const reparto = calcularRepartoLinea({
    saleUnitPrice: d.oferta.salePrice,
    quantity: d.quantity,
    beneficio: b as BeneficioParaCalculo,
    sourceType: d.oferta.sourceType,
    commissionPercentage: d.oferta.commissionPercentage,
    commissionBase: d.oferta.commissionBase,
  })
  const veto = motivoNoElegible(b, d.oferta, d.customerId, asignacion, usosVivos, reparto.membegoSubsidy, ahora, d.conCupon ?? false)
  if (veto) {
    if (d.opcional) return null
    fallo(veto, MENSAJES_NO_ELEGIBLE[veto])
  }
  if (reparto.benefitApplied.lessThanOrEqualTo(0)) {
    if (d.opcional) return null
    fallo('BENEFICIO_SIN_EFECTO', 'Este beneficio no rebaja nada en esta compra.')
  }

  const r = await tx.supplyV2BenefitReservation.create({
    data: {
      benefitId: b.id,
      customerBenefitId,
      customerId: d.customerId,
      orderId: d.orderId,
      orderLineId: d.orderLineId,
      quantity: d.quantity,
      supplierAmount: reparto.supplierDiscount,
      membegoAmount: reparto.membegoSubsidy,
      status: 'ACTIVE',
      expiresAt: d.expiresAt,
    },
    select: { id: true },
  })
  await movimiento(tx, b, { type: 'RESERVED', reservedDelta: reparto.membegoSubsidy, supplierAmount: reparto.supplierDiscount, customerBenefitId, reservationId: r.id, reason: `Reserva del checkout (orden ${d.orderId}).` }, ctx.actorId)
  if (b.budgetTotal && b.budgetTotal.minus(b.budgetReserved).minus(b.budgetConsumed).lessThanOrEqualTo(0) && b.status === 'ACTIVE') {
    await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'EXHAUSTED' } })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_RESERVED', 'SupplyV2BenefitReservation', r.id, {
    benefitId: b.id,
    code: b.code,
    orderId: d.orderId,
    quantity: d.quantity,
    supplierDiscount: reparto.supplierDiscount.toFixed(2),
    membegoSubsidy: reparto.membegoSubsidy.toFixed(2),
    customerPayable: reparto.customerPayable.toFixed(2),
  }, b.supplier?.companyId ?? null)
  return {
    reservationId: r.id,
    benefitId: b.id,
    customerBenefitId,
    reparto,
    beneficio: { id: b.id, code: b.code, name: b.name, funding: b.funding, valueType: b.valueType, membegoValue: b.membegoValue.toFixed(2), supplierValue: b.supplierValue.toFixed(2), campaignId: b.campaignId },
  }
}

/** Al confirmar el pago (o la cobertura total): la reserva se CONSOLIDA (§20). Idempotente. */
export async function aplicarReservaEnTx(tx: Tx, reservationId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<'APLICADA' | 'YA_APLICADA'> {
  const r = await tx.supplyV2BenefitReservation.findUnique({ where: { id: reservationId }, select: { id: true, benefitId: true, customerBenefitId: true, status: true, membegoAmount: true, supplierAmount: true, expiresAt: true, orderId: true } })
  if (!r) fallo('RESERVA_NO_ENCONTRADA', 'La reserva del beneficio no existe.')
  if (r.status === 'APPLIED') return 'YA_APLICADA'
  if (r.status !== 'ACTIVE') fallo('RESERVA_NO_VIVA', `La reserva del beneficio está ${r.status}: no se puede aplicar. Vuelve a comprar.`)
  const b = await bloquearBeneficio(tx, r.benefitId)
  // Política segura (§20): si la reserva ya caducó pero NADIE la liberó (la orden sigue viva),
  // el presupuesto sigue reservado y la aplicación es consistente: se consolida. Si el cron la
  // liberó, está EXPIRED y la máquina de estados de la orden ya lo impidió antes de llegar aquí.
  if (r.customerBenefitId) {
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_customer_benefits" WHERE "id" = ${r.customerBenefitId} FOR UPDATE`
    const g = await tx.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: r.customerBenefitId } })
    if (g.status === 'CANCELLED') fallo('ASIGNACION_INACTIVA', MENSAJES_NO_ELEGIBLE.ASIGNACION_INACTIVA)
    if (g.usesConsumed + 1 > g.usesAllowed) fallo('SIN_USOS', MENSAJES_NO_ELEGIBLE.SIN_USOS)
    const usos = g.usesConsumed + 1
    await tx.supplyV2CustomerBenefit.update({ where: { id: g.id }, data: { usesConsumed: usos, status: estadoAsignacionSegunUsos({ ...g, usesConsumed: usos }, ahora) === 'EXHAUSTED' ? 'EXHAUSTED' : g.status } })
  }
  await tx.supplyV2BenefitReservation.update({ where: { id: r.id }, data: { status: 'APPLIED', appliedAt: ahora } })
  await movimiento(tx, b, { type: 'APPLIED', reservedDelta: r.membegoAmount.negated(), consumedDelta: r.membegoAmount, supplierAmount: r.supplierAmount, customerBenefitId: r.customerBenefitId, reservationId: r.id, reason: `Aplicado al confirmar la orden ${r.orderId}.` }, ctx.actorId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_APPLIED', 'SupplyV2BenefitReservation', r.id, { benefitId: b.id, code: b.code, orderId: r.orderId, membegoSubsidy: r.membegoAmount.toFixed(2), supplierDiscount: r.supplierAmount.toFixed(2) }, b.supplier?.companyId ?? null)
  return 'APLICADA'
}

/** Cancelar / rechazar / expirar el checkout: la reserva vuelve al presupuesto (§27). Idempotente. */
export async function liberarReservaEnTx(tx: Tx, reservationId: string, destino: 'RELEASED' | 'EXPIRED', motivo: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  const r = await tx.supplyV2BenefitReservation.findUnique({ where: { id: reservationId }, select: { id: true, benefitId: true, customerBenefitId: true, status: true, membegoAmount: true, supplierAmount: true, orderId: true } })
  if (!r || r.status !== 'ACTIVE') return false
  const b = await bloquearBeneficio(tx, r.benefitId)
  await tx.supplyV2BenefitReservation.update({ where: { id: r.id }, data: { status: destino, releasedAt: ahora } })
  await movimiento(tx, b, { type: destino, reservedDelta: r.membegoAmount.negated(), supplierAmount: r.supplierAmount, customerBenefitId: r.customerBenefitId, reservationId: r.id, reason: motivo }, ctx.actorId)
  if (b.status === 'EXHAUSTED' && (!b.budgetTotal || b.budgetTotal.minus(b.budgetReserved).minus(b.budgetConsumed).greaterThan(0))) {
    await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'ACTIVE' } })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_RELEASED', 'SupplyV2BenefitReservation', r.id, { benefitId: b.id, code: b.code, orderId: r.orderId, destino, membegoSubsidy: r.membegoAmount.toFixed(2), motivo }, b.supplier?.companyId ?? null)
  return true
}

/**
 * REVERSAR una aplicación (§27): solo de forma explícita y solo si ningún
 * derecho de la línea se entregó (todos EXPIRED o CANCELLED). Devuelve el
 * consumo al presupuesto y el uso a la asignación. Nunca toca pagos ni
 * obligaciones: eso es de finanzas.
 */
export async function reversarAplicacionBeneficioEnTx(tx: Tx, reservationId: string, motivo: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<void> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Reversar necesita quién lo hace.')
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Reversar una aplicación exige un motivo.')
  const r = await tx.supplyV2BenefitReservation.findUnique({ where: { id: reservationId }, select: { id: true, benefitId: true, customerBenefitId: true, status: true, membegoAmount: true, supplierAmount: true, orderId: true, orderLineId: true } })
  if (!r) fallo('RESERVA_NO_ENCONTRADA', 'La aplicación no existe.')
  if (r.status === 'REVERSED') return
  if (r.status !== 'APPLIED') fallo('NO_APLICADA', `La reserva está ${r.status}: no hay aplicación que reversar.`)
  const derechos = await tx.supplyV2Entitlement.findMany({ where: { orderLineId: r.orderLineId }, select: { status: true } })
  if (derechos.some((d) => d.status === 'ACTIVE' || d.status === 'REDEEMED')) {
    fallo('DERECHOS_VIVOS', 'Hay derechos vivos o entregados en esta compra: el beneficio aplicado no se reversa en silencio. Cancela o deja vencer los derechos primero.')
  }
  const b = await bloquearBeneficio(tx, r.benefitId)
  await tx.supplyV2BenefitReservation.update({ where: { id: r.id }, data: { status: 'REVERSED', reversedAt: ahora, reversedReason: motivo.trim() } })
  // Slice 7: si la reserva se abrió con un cupón, su uso se reversa con ella y
  // el cupón vuelve a estar disponible.
  const { liberarCuponEnTx } = await import('../campaigns/coupons')
  await liberarCuponEnTx(tx, r.id, motivo.trim(), ctx, 'REVERSED')
  await movimiento(tx, b, { type: 'REVERSED', consumedDelta: r.membegoAmount.negated(), supplierAmount: r.supplierAmount, customerBenefitId: r.customerBenefitId, reservationId: r.id, reason: motivo.trim() }, ctx.actorId)
  if (r.customerBenefitId) {
    const g = await tx.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: r.customerBenefitId } })
    const usos = Math.max(0, g.usesConsumed - 1)
    await tx.supplyV2CustomerBenefit.update({ where: { id: g.id }, data: { usesConsumed: usos, status: g.status === 'EXHAUSTED' ? estadoAsignacionSegunUsos({ ...g, usesConsumed: usos, status: 'AVAILABLE' }, ahora) : g.status } })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_BENEFIT_REVERSED', 'SupplyV2BenefitReservation', r.id, { benefitId: b.id, code: b.code, orderId: r.orderId, membegoSubsidy: r.membegoAmount.toFixed(2), motivo: motivo.trim() }, b.supplier?.companyId ?? null)
}

// ── Cron (§27): vencimientos ─────────────────────────────────────────────────

/** Beneficios y asignaciones vencidos. Las reservas vencen con su orden (`expirarOrdenEnTx`). */
export async function expirarBeneficiosEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<{ beneficios: number; asignaciones: number }> {
  const vencidos = await tx.supplyV2Benefit.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED', 'EXHAUSTED'] }, endsAt: { lte: ahora } }, select: { id: true }, take: limite })
  let beneficios = 0
  for (const v of vencidos) {
    const b = await bloquearBeneficio(tx, v.id)
    if (b.status === 'EXPIRED' || b.status === 'CANCELLED') continue
    await tx.supplyV2Benefit.update({ where: { id: b.id }, data: { status: 'EXPIRED' } })
    await movimiento(tx, b, { type: 'EXPIRED', reason: 'Beneficio vencido.' }, ctx.actorId)
    await tx.supplyV2CustomerBenefit.updateMany({ where: { benefitId: b.id, status: 'AVAILABLE' }, data: { status: 'EXPIRED' } })
    beneficios++
  }
  const asignaciones = await tx.supplyV2CustomerBenefit.updateMany({ where: { status: 'AVAILABLE', expiresAt: { lte: ahora } }, data: { status: 'EXPIRED' } })
  return { beneficios, asignaciones: asignaciones.count }
}

/** Recalcula la caché del presupuesto desde el ledger (para auditoría y pruebas). */
export async function recalcularPresupuestoEnTx(tx: Tx, benefitId: string): Promise<{ reserved: Decimal; consumed: Decimal }> {
  const s = await tx.supplyV2BenefitMovement.aggregate({ where: { benefitId }, _sum: { reservedDelta: true, consumedDelta: true } })
  const reserved = s._sum.reservedDelta ?? CERO
  const consumed = s._sum.consumedDelta ?? CERO
  await tx.supplyV2Benefit.update({ where: { id: benefitId }, data: { budgetReserved: reserved, budgetConsumed: consumed } })
  return { reserved, consumed }
}
