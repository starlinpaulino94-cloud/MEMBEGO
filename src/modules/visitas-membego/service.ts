import type { AncillarySaleStatus, MembegoVisit, VisitDisputeStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { decimal, redondear2, type Decimal, type Monto } from '@/lib/commerce-primitives/dinero'
import { exigirTransicion } from '@/lib/commerce-primitives/estados'
import { siguienteNumero } from '@/lib/commerce-primitives/numeracion'
import { auditarEnTx, type ContextoAuditoria } from '@/modules/supply-v2/core/auditoria'
import { fallo } from '@/modules/supply-v2/core/errores'
import { emitirEfectoEnTx } from '@/modules/supply-v2/operations/outbox'
import {
  ajustarComisionDeVentaAdicionalEnTx,
  asentarComisionDeVentaAdicionalEnTx,
  revertirComisionDeVentaAdicionalEnTx,
  type ContextoFacturacion,
} from '@/modules/billing/service'
import {
  TRANSICIONES_DISPUTA,
  TRANSICIONES_VENTA,
  TRANSICIONES_VISITA,
  VENTAS_CONFIRMABLES,
  calcularComisionDeExtra,
  claveDeAjuste,
  claveDeCargo,
  claveDeReverso,
  correccionPorDisputa,
  dentroDeVentana,
  finDeVentana,
  resolverLineasDeExtra,
  resolverPoliticaDeExtras,
  seAsientaAlReportar,
  sumarVentas,
  totalCoincide,
  type LineaDeExtraEntrada,
  type PoliticaDeExtras,
} from './domain'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · VISITA ATRIBUIDA · servicio (§22–§38, §53–§57).
 *
 * TODO dentro de la `tx` de quien llama. Orden de candados fijo:
 *
 *   visita → venta adicional → cuenta de Merchant Billing
 *
 * La redención de Supply (derecho → voucher → sesión → lote) ocurre ANTES, en
 * la misma transacción del escáner, y aquí solo se referencia: la unidad que
 * Membego compró se mueve en el ledger de lotes y NUNCA entra en la base de
 * una venta adicional (§28, §63). Los eventos críticos van al outbox
 * transaccional de Supply (§57): si la transacción se deshace, no sale nada.
 */

export interface OperadorDeVisita {
  userId: string
  companyId: string
  supplierId: string | null
}

const NAMESPACE = 'visitas_membego'
const AGG_VISITA = 'MembegoVisit'
const AGG_VENTA = 'AncillarySale'

async function visitaBloqueada(tx: Tx, visitId: string) {
  await tx.$queryRaw`SELECT "id" FROM "membego_visits" WHERE "id" = ${visitId} FOR UPDATE`
  const v = await tx.membegoVisit.findUnique({ where: { id: visitId } })
  if (!v) fallo('VISITA_NO_ENCONTRADA', 'La visita no existe.')
  return v
}

async function ventaBloqueada(tx: Tx, saleId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ancillary_sales" WHERE "id" = ${saleId} FOR UPDATE`
  const s = await tx.ancillarySale.findUnique({ where: { id: saleId } })
  if (!s) fallo('VENTA_NO_ENCONTRADA', 'La venta adicional no existe.')
  return s
}

function politicaDe(v: MembegoVisit): PoliticaDeExtras {
  return {
    ancillaryCommissionEnabled: v.ancillaryCommissionEnabled,
    ancillaryCommissionRate: v.ancillaryCommissionRate.toFixed(2),
    attributionWindowMinutes: v.attributionWindowMinutes,
    requiresCustomerConfirmation: v.requiresCustomerConfirmation,
    receiptRequiredAbove: v.receiptRequiredAbove?.toFixed(2) ?? null,
  }
}

function comoFacturacion(ctx: ContextoAuditoria): ContextoFacturacion {
  return { ...ctx, actor: 'SISTEMA' }
}

async function recalcularTotalesEnTx(tx: Tx, visitId: string): Promise<{ ancillaryTotal: Decimal; commissionTotal: Decimal }> {
  const ventas = await tx.ancillarySale.findMany({ where: { visitId }, select: { status: true, subtotal: true, commissionAmount: true, commissionStatus: true, adjustmentEntry: { select: { amount: true } } } })
  const t = sumarVentas(ventas.map((v) => ({ ...v, commissionAdjustment: v.adjustmentEntry?.amount ?? null })))
  await tx.membegoVisit.update({ where: { id: visitId }, data: { ancillaryTotal: t.ancillaryTotal, commissionTotal: t.commissionTotal } })
  return t
}

async function emitir(tx: Tx, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>, correlationId: string, sufijo = ''): Promise<void> {
  await emitirEfectoEnTx(tx, { eventType, aggregateType, aggregateId, payload, correlationId, dedupeKey: `${eventType}:${aggregateId}${sufijo}` })
}

// ── Abrir la visita desde una redención de Supply (§23) ─────────────────────

export interface VisitaAbierta {
  id: string
  number: string
  status: 'OPEN' | 'CLOSED' | 'CANCELLED'
  customerName: string
  /** Lo que Membego incluyó: el producto entregado en la redención. */
  incluido: { producto: string; cantidad: number }
  politica: PoliticaDeExtras
  ventanaHasta: Date
  ancillaryTotal: string
  commissionTotal: string
  currency: string
  repetida: boolean
}

function nombreCliente(c: { name: string | null; email: string }): string {
  return c.name?.trim() || c.email.split('@')[0]!
}

/**
 * Abre (o devuelve) la visita de una redención de Supply. Idempotente por
 * redención: dos escáneres con la misma entrega no abren dos visitas.
 */
export async function abrirVisitaDeRedencionEnTx(
  tx: Tx,
  d: { redemptionId: string; operador: OperadorDeVisita; branchId?: string | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<VisitaAbierta> {
  // Dos escáneres con la misma entrega se serializan aquí: el candado de la redención (§56).
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_redemptions" WHERE "id" = ${d.redemptionId} FOR UPDATE`
  const r = await tx.supplyV2Redemption.findUnique({
    where: { id: d.redemptionId },
    select: {
      id: true,
      number: true,
      reversedAt: true,
      customerId: true,
      supplierId: true,
      branchId: true,
      quantity: true,
      redeemedAt: true,
      entitlementId: true,
      supplier: { select: { companyId: true, commercialName: true } },
      catalogItem: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      lot: { select: { agreementId: true, agreementVersionId: true, agreement: { select: { ancillaryCommissionEnabled: true, ancillaryCommissionRate: true, attributionWindowMinutes: true, requiresCustomerConfirmation: true, receiptRequiredAbove: true } }, agreementVersion: { select: { snapshot: true } } } },
      entitlement: { select: { agreementId: true, agreementVersionId: true, agreement: { select: { ancillaryCommissionEnabled: true, ancillaryCommissionRate: true, attributionWindowMinutes: true, requiresCustomerConfirmation: true, receiptRequiredAbove: true } }, agreementVersion: { select: { snapshot: true } } } },
      visit: { select: { id: true } },
    },
  })
  if (!r) fallo('REDENCION_NO_ENCONTRADA', 'La entrega no existe.')
  if (r.reversedAt) fallo('REDENCION_REVERSADA', 'Esa entrega fue reversada: no abre visita.')
  if (!r.supplier.companyId || r.supplier.companyId !== d.operador.companyId || r.supplierId !== d.operador.supplierId) {
    fallo('VISITA_AJENA', 'Esa entrega no es de tu empresa.')
  }

  const existente = r.visit ? await tx.membegoVisit.findUnique({ where: { id: r.visit.id } }) : null
  if (existente) return resumenDeVisita(existente, { producto: r.catalogItem.name, cantidad: r.quantity }, nombreCliente(r.customer), true)

  // La política: foto de la versión del acuerdo del lote (o del derecho), si la tiene; si no, el acuerdo vivo; si no, la cuenta de la empresa; si no, plataforma.
  const fuente = r.lot ?? r.entitlement
  const foto = (fuente?.agreementVersion?.snapshot ?? null) as Record<string, unknown> | null
  const vivo = fuente?.agreement ?? null
  const acuerdo = vivo
    ? {
        ancillaryCommissionEnabled: typeof foto?.ancillaryCommissionEnabled === 'boolean' ? foto.ancillaryCommissionEnabled : vivo.ancillaryCommissionEnabled,
        ancillaryCommissionRate: typeof foto?.ancillaryCommissionRate === 'string' ? foto.ancillaryCommissionRate : vivo.ancillaryCommissionRate,
        attributionWindowMinutes: typeof foto?.attributionWindowMinutes === 'number' ? foto.attributionWindowMinutes : vivo.attributionWindowMinutes,
        requiresCustomerConfirmation: typeof foto?.requiresCustomerConfirmation === 'boolean' ? foto.requiresCustomerConfirmation : vivo.requiresCustomerConfirmation,
        receiptRequiredAbove: typeof foto?.receiptRequiredAbove === 'string' ? foto.receiptRequiredAbove : vivo.receiptRequiredAbove,
      }
    : null
  const cuenta = await tx.merchantBillingConfig.findUnique({ where: { companyId: d.operador.companyId }, select: { percentageRate: true, currency: true } })
  const politica = resolverPoliticaDeExtras({ acuerdo, cuenta })

  const branchId = d.branchId ?? r.branchId ?? null
  if (branchId) {
    const s = await tx.sucursal.findFirst({ where: { id: branchId, companyId: d.operador.companyId }, select: { id: true } })
    if (!s) fallo('WRONG_BRANCH', 'Esa sucursal no es de tu empresa.')
  }

  const number = await siguienteNumero(tx, 'MBG-VI', async (pref) => {
    const u = await tx.membegoVisit.findFirst({ where: { number: { startsWith: pref } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, ahora, NAMESPACE)
  const v = await tx.membegoVisit.create({
    data: {
      number,
      companyId: d.operador.companyId,
      supplierId: r.supplierId,
      locationId: branchId,
      customerUserId: r.customerId,
      origin: 'MEMBEGO_SUPPLY',
      attributionChannel: 'SUPPLY_OFFER',
      sourceType: 'ENTITLEMENT',
      sourceId: r.entitlementId,
      redemptionId: r.id,
      status: 'OPEN',
      openedAt: ahora,
      openedByUserId: d.operador.userId,
      ancillaryCommissionEnabled: politica.ancillaryCommissionEnabled,
      ancillaryCommissionRate: politica.ancillaryCommissionRate,
      attributionWindowMinutes: politica.attributionWindowMinutes,
      requiresCustomerConfirmation: politica.requiresCustomerConfirmation,
      receiptRequiredAbove: politica.receiptRequiredAbove,
      currency: cuenta?.currency ?? 'DOP',
      agreementId: fuente?.agreementId ?? null,
      agreementVersionId: fuente?.agreementVersionId ?? null,
      idempotencyKey: `visit:redemption:${r.id}`,
    },
  })
  await auditarEnTx(tx, ctx, 'VISIT_OPENED', AGG_VISITA, v.id, { number, origin: 'MEMBEGO_SUPPLY', redemptionId: r.id, redemptionNumber: r.number, customerId: r.customerId, supplierId: r.supplierId, branchId, politica: { enabled: politica.ancillaryCommissionEnabled, rate: politica.ancillaryCommissionRate, windowMinutes: politica.attributionWindowMinutes, requiresConfirmation: politica.requiresCustomerConfirmation, receiptAbove: politica.receiptRequiredAbove } }, d.operador.companyId)
  await emitir(tx, 'visit.opened', AGG_VISITA, v.id, { number, companyId: d.operador.companyId, customerUserId: r.customerId, origin: 'MEMBEGO_SUPPLY', redemptionId: r.id }, v.id)
  return resumenDeVisita(v, { producto: r.catalogItem.name, cantidad: r.quantity }, nombreCliente(r.customer), false)
}

function resumenDeVisita(v: MembegoVisit, incluido: { producto: string; cantidad: number }, customerName: string, repetida: boolean): VisitaAbierta {
  const politica = politicaDe(v)
  return {
    id: v.id,
    number: v.number,
    status: v.status,
    customerName,
    incluido,
    politica,
    ventanaHasta: finDeVentana(v.openedAt, politica),
    ancillaryTotal: v.ancillaryTotal.toFixed(2),
    commissionTotal: v.commissionTotal.toFixed(2),
    currency: v.currency,
    repetida,
  }
}

// ── Ventas adicionales (§24–§28, §55–§56) ───────────────────────────────────

export interface VentaAdicionalRegistrada {
  id: string
  number: string
  subtotal: string
  commissionBase: string
  commissionRate: string
  commissionAmount: string
  commissionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'POSTED' | 'REVERSED'
  hasCustomLines: boolean
  lineas: { description: string; quantity: number; unitPrice: string; lineTotal: string; kind: 'CATALOG_ITEM' | 'CUSTOM_REPORTED_LINE' }[]
  visita: { ancillaryTotal: string; commissionTotal: string }
  repetida: boolean
}

async function asentarCargoSiTocaEnTx(tx: Tx, visita: MembegoVisit, saleId: string, ctx: ContextoAuditoria, ahora: Date): Promise<boolean> {
  const venta = await tx.ancillarySale.findUniqueOrThrow({ where: { id: saleId } })
  if (venta.commissionStatus !== 'PENDING') return false
  const { entryId } = await asentarComisionDeVentaAdicionalEnTx(
    tx,
    visita.companyId,
    { saleId: venta.id, commissionAmount: venta.commissionAmount, currency: venta.currency, idempotencyKey: claveDeCargo(venta.id), reason: `Comisión ${venta.commissionRate.toFixed(2)} % sobre la venta adicional ${venta.number} de la visita ${visita.number}.` },
    comoFacturacion(ctx),
    ahora
  )
  await tx.ancillarySale.update({ where: { id: venta.id }, data: { commissionStatus: 'POSTED', ledgerEntryId: entryId } })
  await auditarEnTx(tx, ctx, 'ANCILLARY_COMMISSION_POSTED', AGG_VENTA, venta.id, { number: venta.number, visitId: visita.id, amount: venta.commissionAmount.toFixed(2), rate: venta.commissionRate.toFixed(2), base: venta.commissionBase.toFixed(2), ledgerEntryId: entryId }, visita.companyId)
  await emitir(tx, 'commission.created', AGG_VENTA, venta.id, { companyId: visita.companyId, visitId: visita.id, saleId: venta.id, amount: venta.commissionAmount.toFixed(2), ledgerEntryId: entryId }, visita.id)
  return true
}

export async function registrarVentaAdicionalEnTx(
  tx: Tx,
  d: { visitId: string; operador: OperadorDeVisita; lineas: LineaDeExtraEntrada[]; idempotencyKey: string },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<VentaAdicionalRegistrada> {
  if (!d.idempotencyKey?.trim()) fallo('SIN_CLAVE', 'Registrar una venta adicional exige una clave de idempotencia.')
  const visita = await visitaBloqueada(tx, d.visitId)
  if (visita.companyId !== d.operador.companyId) fallo('VISITA_AJENA', 'Esa visita no es de tu empresa.')

  // Idempotencia (§56): la misma venta mandada dos veces es un solo registro.
  const previa = await tx.ancillarySale.findUnique({ where: { companyId_idempotencyKey: { companyId: visita.companyId, idempotencyKey: d.idempotencyKey } }, include: { lines: true } })
  if (previa) {
    return {
      id: previa.id, number: previa.number, subtotal: previa.subtotal.toFixed(2), commissionBase: previa.commissionBase.toFixed(2), commissionRate: previa.commissionRate.toFixed(2), commissionAmount: previa.commissionAmount.toFixed(2),
      commissionStatus: previa.commissionStatus, hasCustomLines: previa.hasCustomLines,
      lineas: previa.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2), kind: l.kind })),
      visita: { ancillaryTotal: visita.ancillaryTotal.toFixed(2), commissionTotal: visita.commissionTotal.toFixed(2) },
      repetida: true,
    }
  }

  if (visita.status !== 'OPEN') fallo('VISITA_CERRADA', `La visita ${visita.number} está ${visita.status === 'CLOSED' ? 'cerrada' : 'cancelada'}: no admite más compras.`)
  const politica = politicaDe(visita)
  if (!dentroDeVentana(visita.openedAt, politica, ahora)) fallo('VENTANA_CERRADA', 'La ventana de atribución de esta visita ya pasó (§38): no se le atribuyen más compras.')

  // Los precios se RELEEN del mini catálogo del proveedor; lo que mandó el navegador no es la verdad (§55).
  const catalogo = visita.supplierId
    ? await tx.supplyV2CatalogItem.findMany({ where: { supplierId: visita.supplierId }, select: { id: true, name: true, publicPrice: true, sellableAsExtra: true, status: true } })
    : []
  const r = resolverLineasDeExtra(d.lineas, catalogo)
  if ('error' in r) fallo('VENTA_INVALIDA', r.error)
  const comision = calcularComisionDeExtra(r.subtotal, politica)

  const number = await siguienteNumero(tx, 'MBG-VA', async (pref) => {
    const u = await tx.ancillarySale.findFirst({ where: { number: { startsWith: pref } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  }, ahora, NAMESPACE)
  const venta = await tx.ancillarySale.create({
    data: {
      number,
      companyId: visita.companyId,
      visitId: visita.id,
      status: 'REPORTED',
      evidenceLevel: 'MERCHANT_REPORTED',
      subtotal: r.subtotal,
      currency: visita.currency,
      commissionBase: comision.base,
      commissionRate: comision.rate,
      commissionAmount: comision.amount,
      commissionStatus: comision.status,
      hasCustomLines: r.hasCustomLines,
      reportedByUserId: d.operador.userId,
      reportedAt: ahora,
      idempotencyKey: d.idempotencyKey,
      lines: {
        create: r.lineas.map((l) => ({ kind: l.kind, supplyCatalogItemId: l.supplyCatalogItemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, priceSource: l.priceSource })),
      },
    },
  })
  await auditarEnTx(tx, ctx, 'ANCILLARY_SALE_RECORDED', AGG_VENTA, venta.id, {
    number,
    visitId: visita.id,
    visitNumber: visita.number,
    subtotal: r.subtotal.toFixed(2),
    commissionBase: comision.base.toFixed(2),
    commissionRate: comision.rate.toFixed(2),
    commissionAmount: comision.amount.toFixed(2),
    evidence: 'MERCHANT_REPORTED',
    hasCustomLines: r.hasCustomLines,
    customLines: r.lineas.filter((l) => l.kind === 'CUSTOM_REPORTED_LINE').map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2) })),
  }, visita.companyId)
  await emitir(tx, 'ancillary_sale.recorded', AGG_VENTA, venta.id, { companyId: visita.companyId, visitId: visita.id, customerUserId: visita.customerUserId, subtotal: r.subtotal.toFixed(2), number }, visita.id)

  // La comisión se asienta YA (MERCHANT_REPORTED) salvo que el acuerdo exija la confirmación del cliente (§37).
  if (comision.status === 'PENDING' && seAsientaAlReportar(politica)) await asentarCargoSiTocaEnTx(tx, visita, venta.id, ctx, ahora)

  const totales = await recalcularTotalesEnTx(tx, visita.id)
  const final = await tx.ancillarySale.findUniqueOrThrow({ where: { id: venta.id } })
  return {
    id: final.id, number: final.number, subtotal: final.subtotal.toFixed(2), commissionBase: final.commissionBase.toFixed(2), commissionRate: final.commissionRate.toFixed(2), commissionAmount: final.commissionAmount.toFixed(2),
    commissionStatus: final.commissionStatus, hasCustomLines: final.hasCustomLines,
    lineas: r.lineas.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2), kind: l.kind })),
    visita: { ancillaryTotal: totales.ancillaryTotal.toFixed(2), commissionTotal: totales.commissionTotal.toFixed(2) },
    repetida: false,
  }
}

// ── Cerrar la visita (§23, §38) ─────────────────────────────────────────────

export async function cerrarVisitaEnTx(tx: Tx, d: { visitId: string; operador: OperadorDeVisita | null; motivo?: string }, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string; number: string; repetida: boolean; ancillaryTotal: string }> {
  const v = await visitaBloqueada(tx, d.visitId)
  if (d.operador && v.companyId !== d.operador.companyId) fallo('VISITA_AJENA', 'Esa visita no es de tu empresa.')
  if (v.status === 'CLOSED') return { id: v.id, number: v.number, repetida: true, ancillaryTotal: v.ancillaryTotal.toFixed(2) }
  exigirTransicion(TRANSICIONES_VISITA, v.status, 'CLOSED', 'Visita')
  const totales = await recalcularTotalesEnTx(tx, v.id)
  await tx.membegoVisit.update({ where: { id: v.id }, data: { status: 'CLOSED', closedAt: ahora, closedByUserId: d.operador?.userId ?? null } })
  await auditarEnTx(tx, ctx, 'VISIT_CLOSED', AGG_VISITA, v.id, { number: v.number, ancillaryTotal: totales.ancillaryTotal.toFixed(2), commissionTotal: totales.commissionTotal.toFixed(2), motivo: d.motivo ?? 'cierre por el operador' }, v.companyId)
  await emitir(tx, 'visit.closed', AGG_VISITA, v.id, { number: v.number, companyId: v.companyId, customerUserId: v.customerUserId, ancillaryTotal: totales.ancillaryTotal.toFixed(2), currency: v.currency, requiresCustomerConfirmation: v.requiresCustomerConfirmation }, v.id)
  return { id: v.id, number: v.number, repetida: false, ancillaryTotal: totales.ancillaryTotal.toFixed(2) }
}

/** Cron (§38): las visitas abiertas cuya ventana venció se cierran solas. Idempotente. */
export async function cerrarVisitasVencidasEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 100): Promise<number> {
  const abiertas = await tx.membegoVisit.findMany({ where: { status: 'OPEN' }, select: { id: true, openedAt: true, attributionWindowMinutes: true }, orderBy: { openedAt: 'asc' }, take: limite })
  let n = 0
  for (const v of abiertas) {
    if (ahora.getTime() <= finDeVentana(v.openedAt, { attributionWindowMinutes: v.attributionWindowMinutes }).getTime()) continue
    const r = await cerrarVisitaEnTx(tx, { visitId: v.id, operador: null, motivo: 'ventana de atribución vencida' }, ctx, ahora)
    if (!r.repetida) n++
  }
  return n
}

// ── El cliente confirma (§33) o disputa (§34) ───────────────────────────────

export async function confirmarVisitaComoClienteEnTx(
  tx: Tx,
  d: { visitId: string; customerUserId: string; totalVisto: Monto },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ id: string; number: string; confirmadas: number; repetida: boolean }> {
  const v = await visitaBloqueada(tx, d.visitId)
  if (v.customerUserId !== d.customerUserId) fallo('VISITA_AJENA', 'Esa visita no es tuya.')
  if (v.status === 'CANCELLED') fallo('VISITA_CANCELADA', 'Esa visita fue cancelada.')
  if (v.customerConfirmedAt) {
    if (!totalCoincide(v.customerConfirmedTotal ?? 0, d.totalVisto)) fallo('MONTO_DISTINTO', 'Ya confirmaste esta visita con otro total.')
    return { id: v.id, number: v.number, confirmadas: 0, repetida: true }
  }
  const totales = await recalcularTotalesEnTx(tx, v.id)
  if (!totalCoincide(totales.ancillaryTotal, d.totalVisto)) fallo('MONTO_DISTINTO', 'El total cambió desde que lo viste; revísalo de nuevo.')
  const ventas = await tx.ancillarySale.findMany({ where: { visitId: v.id, status: { in: [...VENTAS_CONFIRMABLES] } }, orderBy: { reportedAt: 'asc' } })
  let confirmadas = 0
  for (const s of ventas) {
    await ventaBloqueada(tx, s.id)
    exigirTransicion(TRANSICIONES_VENTA, s.status, 'CONFIRMED', 'Venta adicional')
    // CUSTOMER_CONFIRMED sube la confianza; NUNCA equivale a pago verificado (§33). Si ya había evidencia externa, no se baja.
    const evidencia = s.evidenceLevel === 'MERCHANT_REPORTED' ? 'CUSTOMER_CONFIRMED' : s.evidenceLevel
    await tx.ancillarySale.update({ where: { id: s.id }, data: { status: 'CONFIRMED', evidenceLevel: evidencia, customerConfirmedAt: ahora } })
    await auditarEnTx(tx, ctx, 'ANCILLARY_SALE_CONFIRMED', AGG_VENTA, s.id, { number: s.number, visitId: v.id, evidence: evidencia, subtotal: s.subtotal.toFixed(2) }, v.companyId)
    await emitir(tx, 'ancillary_sale.confirmed', AGG_VENTA, s.id, { companyId: v.companyId, visitId: v.id, subtotal: s.subtotal.toFixed(2) }, v.id)
    // Si el acuerdo exigía confirmación, la comisión se asienta ahora.
    await asentarCargoSiTocaEnTx(tx, v, s.id, ctx, ahora)
    confirmadas++
  }
  await tx.membegoVisit.update({ where: { id: v.id }, data: { customerConfirmedAt: ahora, customerConfirmedTotal: totales.ancillaryTotal } })
  await recalcularTotalesEnTx(tx, v.id)
  return { id: v.id, number: v.number, confirmadas, repetida: false }
}

export async function disputarVisitaComoClienteEnTx(
  tx: Tx,
  d: { visitId: string; customerUserId: string; saleId?: string | null; claim: string; claimedTotal?: Monto | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ id: string; saleId: string | null; repetida: boolean }> {
  const claim = d.claim?.trim() ?? ''
  if (claim.length < 3) fallo('RECLAMO_VACIO', 'Cuéntanos qué pasó.')
  const v = await visitaBloqueada(tx, d.visitId)
  if (v.customerUserId !== d.customerUserId) fallo('VISITA_AJENA', 'Esa visita no es tuya.')
  if (v.status === 'CANCELLED') fallo('VISITA_CANCELADA', 'Esa visita fue cancelada.')
  let claimedTotal: Decimal | null = null
  if (d.claimedTotal != null && d.claimedTotal !== '') {
    claimedTotal = redondear2(decimal(d.claimedTotal))
    if (claimedTotal.isNegative()) fallo('MONTO_INVALIDO', 'El monto no puede ser negativo.')
  }
  const ventas = d.saleId
    ? [await ventaBloqueada(tx, d.saleId)]
    : await tx.ancillarySale.findMany({ where: { visitId: v.id, status: { in: ['REPORTED', 'CONFIRMED'] } } })
  if (d.saleId && ventas[0]!.visitId !== v.id) fallo('VENTA_AJENA', 'Esa venta no es de esta visita.')
  if (ventas.length === 0) fallo('SIN_VENTAS', 'Esta visita no tiene compras adicionales que disputar.')

  const viva = await tx.visitDispute.findFirst({ where: { visitId: v.id, saleId: d.saleId ?? null, status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true, saleId: true } })
  if (viva) return { id: viva.id, saleId: viva.saleId, repetida: true }

  const reportedTotal = d.saleId ? ventas[0]!.subtotal : ventas.reduce<Decimal>((t, s) => t.plus(s.subtotal), decimal(0))
  const disputa = await tx.visitDispute.create({
    data: { companyId: v.companyId, visitId: v.id, saleId: d.saleId ?? null, customerUserId: d.customerUserId, status: 'OPEN', customerClaim: claim.slice(0, 1000), claimedTotal, reportedTotal: redondear2(reportedTotal), openedAt: ahora },
  })
  for (const s of ventas) {
    if (s.status === 'DISPUTED') continue
    exigirTransicion(TRANSICIONES_VENTA, s.status, 'DISPUTED', 'Venta adicional')
    await tx.ancillarySale.update({ where: { id: s.id }, data: { status: 'DISPUTED' } })
  }
  await auditarEnTx(tx, ctx, 'VISIT_DISPUTE_OPENED', 'VisitDispute', disputa.id, { visitId: v.id, saleId: d.saleId ?? null, claim: claim.slice(0, 500), claimedTotal: claimedTotal?.toFixed(2) ?? null, reportedTotal: redondear2(reportedTotal).toFixed(2) }, v.companyId)
  await emitir(tx, 'visit.disputed', AGG_VISITA, v.id, { number: v.number, companyId: v.companyId, disputeId: disputa.id, customerUserId: v.customerUserId, reportedTotal: redondear2(reportedTotal).toFixed(2), claimedTotal: claimedTotal?.toFixed(2) ?? null }, v.id, `:${disputa.id}`)
  await recalcularTotalesEnTx(tx, v.id)
  return { id: disputa.id, saleId: disputa.saleId, repetida: false }
}

// ── Reversa de una venta (§36) ──────────────────────────────────────────────

async function revertirVentaInternaEnTx(tx: Tx, visita: MembegoVisit, saleId: string, motivo: string, actor: string | null, ctx: ContextoAuditoria, ahora: Date): Promise<void> {
  const s = await ventaBloqueada(tx, saleId)
  if (s.status === 'REVERSED') return
  exigirTransicion(TRANSICIONES_VENTA, s.status, 'REVERSED', 'Venta adicional')
  let reversalEntryId: string | null = null
  if (s.commissionStatus === 'POSTED') {
    // La comisión viva se revierte con su asiento (§36); si hubo ajuste parcial, se revierte lo que quedó vivo.
    const vivo = s.adjustmentEntryId ? (await tx.merchantLedgerEntry.findUniqueOrThrow({ where: { id: s.adjustmentEntryId }, select: { amount: true } })).amount.plus(s.commissionAmount) : s.commissionAmount
    const r = await revertirComisionDeVentaAdicionalEnTx(tx, visita.companyId, { saleId: s.id, commissionAmount: vivo, currency: s.currency, idempotencyKey: claveDeReverso(s.id), reason: `Reverso de la comisión de ${s.number}: ${motivo}` }, comoFacturacion(ctx), ahora)
    reversalEntryId = r.entryId
    await auditarEnTx(tx, ctx, 'ANCILLARY_COMMISSION_REVERSED', AGG_VENTA, s.id, { number: s.number, amount: vivo.toFixed(2), ledgerEntryId: r.entryId, motivo }, visita.companyId)
  }
  await tx.ancillarySale.update({
    where: { id: s.id },
    data: { status: 'REVERSED', reversedAt: ahora, reversedByUserId: actor, reversalReason: motivo, ...(reversalEntryId ? { commissionStatus: 'REVERSED', reversalEntryId } : s.commissionStatus === 'PENDING' ? { commissionStatus: 'NOT_APPLICABLE' } : {}) },
  })
  await auditarEnTx(tx, ctx, 'ANCILLARY_SALE_REVERSED', AGG_VENTA, s.id, { number: s.number, visitId: visita.id, motivo, subtotal: s.subtotal.toFixed(2) }, visita.companyId)
  await emitir(tx, 'ancillary_sale.reversed', AGG_VENTA, s.id, { companyId: visita.companyId, visitId: visita.id, customerUserId: visita.customerUserId, subtotal: s.subtotal.toFixed(2), motivo }, visita.id)
}

export async function reversarVentaAdicionalEnTx(tx: Tx, d: { saleId: string; operador: OperadorDeVisita | null; motivo: string }, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string; repetida: boolean }> {
  const motivo = d.motivo?.trim() ?? ''
  if (!motivo) fallo('MOTIVO_OBLIGATORIO', 'Reversar una venta adicional exige un motivo.')
  const s = await tx.ancillarySale.findUnique({ where: { id: d.saleId }, select: { visitId: true, status: true } })
  if (!s) fallo('VENTA_NO_ENCONTRADA', 'La venta adicional no existe.')
  const v = await visitaBloqueada(tx, s.visitId)
  if (d.operador && v.companyId !== d.operador.companyId) fallo('VISITA_AJENA', 'Esa venta no es de tu empresa.')
  if (s.status === 'REVERSED') return { id: d.saleId, repetida: true }
  await revertirVentaInternaEnTx(tx, v, d.saleId, motivo, d.operador?.userId ?? ctx.actorId, ctx, ahora)
  await recalcularTotalesEnTx(tx, v.id)
  return { id: d.saleId, repetida: false }
}

// ── Resolver una disputa (§34–§35) ──────────────────────────────────────────

export type ResolucionDeDisputa = Extract<VisitDisputeStatus, 'RESOLVED_MERCHANT' | 'RESOLVED_CUSTOMER' | 'DISMISSED'>

export async function resolverDisputaEnTx(
  tx: Tx,
  d: { disputeId: string; resolucion: ResolucionDeDisputa; notas: string; baseReconocida?: Monto | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ id: string; resultado: 'REVERSO' | 'AJUSTE' | 'NADA'; delta: string; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Resolver una disputa necesita quién la resuelve.')
  const notas = d.notas?.trim() ?? ''
  if (notas.length < 3) fallo('NOTAS_OBLIGATORIAS', 'Escribe la resolución.')
  const disputa = await tx.visitDispute.findUnique({ where: { id: d.disputeId } })
  if (!disputa) fallo('DISPUTA_NO_ENCONTRADA', 'La disputa no existe.')
  const v = await visitaBloqueada(tx, disputa.visitId)
  await tx.$queryRaw`SELECT "id" FROM "visit_disputes" WHERE "id" = ${disputa.id} FOR UPDATE`
  const actual = await tx.visitDispute.findUniqueOrThrow({ where: { id: disputa.id } })
  if (actual.status !== 'OPEN' && actual.status !== 'UNDER_REVIEW') return { id: actual.id, resultado: 'NADA', delta: '0.00', repetida: true }
  exigirTransicion(TRANSICIONES_DISPUTA, actual.status, d.resolucion, 'Disputa')

  const ventas = actual.saleId ? [await ventaBloqueada(tx, actual.saleId)] : await tx.ancillarySale.findMany({ where: { visitId: v.id, status: 'DISPUTED' }, orderBy: { reportedAt: 'asc' } })
  let resultado: 'REVERSO' | 'AJUSTE' | 'NADA' = 'NADA'
  let delta = decimal(0)
  let baseReconocidaTotal: Decimal | null = null

  if (d.resolucion === 'RESOLVED_CUSTOMER') {
    // Lo que el cliente reconoce (lo que dijo el superadmin, o lo que reclamó el cliente, o nada).
    let restante = redondear2(decimal(d.baseReconocida ?? actual.claimedTotal ?? 0))
    if (restante.isNegative()) restante = decimal(0)
    baseReconocidaTotal = restante
    for (const s of ventas) {
      if (s.status === 'REVERSED') continue
      const reconocidaDeEsta = restante.greaterThan(s.subtotal) ? s.subtotal : restante
      restante = restante.minus(reconocidaDeEsta)
      const c = correccionPorDisputa(s, reconocidaDeEsta)
      if (c.tipo === 'REVERSO' || (s.commissionStatus !== 'POSTED' && reconocidaDeEsta.isZero())) {
        await revertirVentaInternaEnTx(tx, v, s.id, `Disputa ${actual.id} resuelta a favor del cliente: ${notas}`, ctx.actorId, ctx, ahora)
        resultado = 'REVERSO'
        delta = delta.plus(c.delta)
        continue
      }
      if (c.tipo === 'AJUSTE') {
        const r = await ajustarComisionDeVentaAdicionalEnTx(tx, v.companyId, { saleId: s.id, delta: c.delta, idempotencyKey: claveDeAjuste(s.id, actual.id), reason: `Ajuste por disputa ${actual.id} (base reconocida ${c.baseReconocida.toFixed(2)} de ${s.commissionBase.toFixed(2)}): ${notas}` }, comoFacturacion(ctx), ahora)
        exigirTransicion(TRANSICIONES_VENTA, s.status, 'ADJUSTED', 'Venta adicional')
        await tx.ancillarySale.update({ where: { id: s.id }, data: { status: 'ADJUSTED', adjustmentEntryId: r.entryId } })
        await auditarEnTx(tx, ctx, 'ANCILLARY_SALE_ADJUSTED', AGG_VENTA, s.id, { number: s.number, disputeId: actual.id, baseReconocida: c.baseReconocida.toFixed(2), delta: c.delta.toFixed(2), ledgerEntryId: r.entryId }, v.companyId)
        resultado = resultado === 'REVERSO' ? 'REVERSO' : 'AJUSTE'
        delta = delta.plus(c.delta)
        continue
      }
      // Sin diferencia de comisión: la venta queda como confirmada por la revisión.
      exigirTransicion(TRANSICIONES_VENTA, s.status, 'CONFIRMED', 'Venta adicional')
      await tx.ancillarySale.update({ where: { id: s.id }, data: { status: 'CONFIRMED' } })
    }
  } else {
    // A favor del negocio o desestimada: la venta vuelve a su vida normal; nada se asienta ni se edita.
    for (const s of ventas) {
      if (s.status !== 'DISPUTED') continue
      const destino: AncillarySaleStatus = s.customerConfirmedAt ? 'CONFIRMED' : 'REPORTED'
      exigirTransicion(TRANSICIONES_VENTA, s.status, destino, 'Venta adicional')
      await tx.ancillarySale.update({ where: { id: s.id }, data: { status: destino } })
    }
  }

  await tx.visitDispute.update({ where: { id: actual.id }, data: { status: d.resolucion, resolution: notas.slice(0, 2000), resolvedByUserId: ctx.actorId, resolvedAt: ahora, resolvedBase: baseReconocidaTotal } })
  await auditarEnTx(tx, ctx, 'VISIT_DISPUTE_RESOLVED', 'VisitDispute', actual.id, { visitId: v.id, resolucion: d.resolucion, resultado, delta: delta.toFixed(2), baseReconocida: baseReconocidaTotal?.toFixed(2) ?? null, notas: notas.slice(0, 500) }, v.companyId)
  await emitir(tx, 'visit.dispute_resolved', 'VisitDispute', actual.id, { visitId: v.id, companyId: v.companyId, customerUserId: v.customerUserId, resolucion: d.resolucion, resultado, delta: delta.toFixed(2) }, v.id)
  await recalcularTotalesEnTx(tx, v.id)
  return { id: actual.id, resultado, delta: redondear2(delta).toFixed(2), repetida: false }
}

export async function marcarDisputaEnRevisionEnTx(tx: Tx, disputeId: string, ctx: ContextoAuditoria): Promise<void> {
  const d = await tx.visitDispute.findUnique({ where: { id: disputeId }, select: { id: true, status: true, companyId: true, visitId: true } })
  if (!d) fallo('DISPUTA_NO_ENCONTRADA', 'La disputa no existe.')
  if (d.status !== 'OPEN') return
  await tx.visitDispute.update({ where: { id: d.id }, data: { status: 'UNDER_REVIEW' } })
  await auditarEnTx(tx, ctx, 'VISIT_DISPUTE_OPENED', 'VisitDispute', d.id, { paso: 'UNDER_REVIEW', visitId: d.visitId }, d.companyId)
}

// ── Evidencia externa (§32): nunca la escribe el negocio ────────────────────

export async function verificarPagoDeVentaAdicionalEnTx(tx: Tx, d: { saleId: string; referencia: string; nivel?: 'PAYMENT_VERIFIED' | 'FISCALLY_RECONCILED' }, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string; repetida: boolean }> {
  const referencia = d.referencia?.trim() ?? ''
  if (!referencia) fallo('REFERENCIA_OBLIGATORIA', 'La verificación externa exige una referencia.')
  const s = await ventaBloqueada(tx, d.saleId)
  if (s.paymentVerifiedAt) return { id: s.id, repetida: true }
  const nivel = d.nivel ?? 'PAYMENT_VERIFIED'
  await tx.ancillarySale.update({ where: { id: s.id }, data: { evidenceLevel: nivel, paymentVerifiedAt: ahora, paymentVerificationRef: referencia } })
  await auditarEnTx(tx, ctx, 'ANCILLARY_SALE_CONFIRMED', AGG_VENTA, s.id, { number: s.number, evidence: nivel, referencia }, s.companyId)
  return { id: s.id, repetida: false }
}

/** Helpers de solo lectura para la transacción del escáner. */
export async function visitaDeRedencionEnTx(tx: Tx, redemptionId: string): Promise<{ id: string; status: string } | null> {
  return tx.membegoVisit.findUnique({ where: { redemptionId }, select: { id: true, status: true } })
}

