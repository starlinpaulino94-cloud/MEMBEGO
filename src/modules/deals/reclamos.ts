import { Prisma, type DealStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'
import { auditarOferta } from './auditoria'
import { estadoPorPresupuesto, puedePasarOferta } from './domain'
import { fallo } from './errores'

/**
 * COMMERCE CORE · ofertas con presupuesto — la LIQUIDACIÓN de un reclamo (Fase 5).
 *
 * Lo que el servicio de PEDIDOS llama cuando un pedido que nació de una oferta se completa,
 * se cancela o se reembolsa, dentro de la MISMA transacción que mueve el pedido:
 *
 *   · `liquidarReclamoEnTx`          canje: lo reservado pasa a gastado y el reclamo a REDEEMED;
 *   · `cerrarReclamoSinCanjeEnTx`    cancelación o vencimiento: se libera el cupo y lo reservado;
 *   · `revertirReclamoEnTx`          reembolso: el pedido ya canjeado devuelve lo gastado.
 *
 * Vive APARTE del servicio de ofertas (`service.ts`) a propósito: el servicio de ofertas crea
 * pedidos (importa los pedidos) y los pedidos llaman a esto (importan este archivo). Si fueran
 * el mismo archivo, pedidos y ofertas se importarían en círculo. Este archivo NO importa los
 * pedidos ni Merchant Billing (lo vigila `tests/deals-separacion.test.ts`): trabaja solo con
 * las tablas de las ofertas.
 *
 * ORDEN DE CANDADOS (único, para que nada se interbloquee): pedido → oferta → inventario →
 * cuenta de billing. El reclamo (`reclamarOfertaEnTx`) toma la oferta antes de crear el pedido
 * y reservar el stock; el canje, la cancelación y el reembolso toman el pedido (ya lo tiene el
 * servicio de pedidos), luego la oferta (aquí) y solo después el inventario y la cuenta.
 *
 * Todo es idempotente: repetir una liquidación ya hecha no mueve el presupuesto otra vez.
 */

interface FilaOferta {
  id: string
  status: DealStatus
  maxClaims: number
  claimsActive: number
  feePerRedemption: Prisma.Decimal
  budgetTotal: Prisma.Decimal
  budgetReserved: Prisma.Decimal
  budgetSpent: Prisma.Decimal
  endsAt: Date | null
  title: string
}

const COLUMNAS = Prisma.sql`"id", "status", "maxClaims", "claimsActive", "feePerRedemption", "budgetTotal", "budgetReserved", "budgetSpent", "endsAt", "title"`

const dec = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v))

function aFila(f: Record<string, unknown>): FilaOferta {
  return {
    id: String(f.id),
    status: f.status as DealStatus,
    maxClaims: Number(f.maxClaims),
    claimsActive: Number(f.claimsActive),
    feePerRedemption: dec(f.feePerRedemption),
    budgetTotal: dec(f.budgetTotal),
    budgetReserved: dec(f.budgetReserved),
    budgetSpent: dec(f.budgetSpent),
    endsAt: f.endsAt instanceof Date ? f.endsAt : f.endsAt ? new Date(String(f.endsAt)) : null,
    title: String(f.title),
  }
}

export type ContextoOferta = ContextoAuditoria

/**
 * Tras mover el presupuesto: una oferta ACTIVE sin presupuesto para otro canje pasa sola a
 * BUDGET_EXHAUSTED (la «auto-pausa»), y una BUDGET_EXHAUSTED a la que se le liberó o se le
 * amplió el presupuesto vuelve a ACTIVE si sigue vigente. Una pausada, terminada o archivada no
 * se toca. SOLO con la fila de la oferta ya bloqueada.
 */
export async function ajustarEstadoPorPresupuestoEnTx(tx: Tx, ctx: ContextoOferta, companyId: string, oferta: FilaOferta, ahora: Date, motivo: string): Promise<DealStatus> {
  const deseado = estadoPorPresupuesto(oferta)
  if (deseado === oferta.status || !puedePasarOferta(oferta.status, deseado)) return oferta.status
  // Una oferta cuya vigencia ya terminó no vuelve a la vida porque se libere presupuesto.
  if (deseado === 'ACTIVE' && oferta.endsAt !== null && oferta.endsAt.getTime() <= ahora.getTime()) return oferta.status
  const razon = deseado === 'BUDGET_EXHAUSTED' ? 'El presupuesto ya no alcanza para otro canje.' : 'Volvió a haber presupuesto para otro canje.'
  await tx.deal.update({ where: { id: oferta.id }, data: { status: deseado, statusReason: razon, statusChangedAt: ahora } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_STATUS_CHANGED', 'Deal', oferta.id, { de: oferta.status, a: deseado, motivo: razon, origen: motivo })
  return deseado
}

export interface ReclamoLiquidado {
  claimId: string
  dealId: string
  /** La cuota que se cobró por este canje (la fotografía del reclamo). */
  fee: Prisma.Decimal
}

/**
 * CANJE. El pedido de un reclamo acaba de pasar a COMPLETED (el servicio de pedidos ya lo
 * escribió: la base exige que el pedido esté COMPLETED para marcar el reclamo REDEEMED): lo
 * reservado pasa a gastado y el reclamo a REDEEMED. Devuelve la cuota que Merchant Billing
 * tiene que cobrar, o `null` si el pedido no nació de una oferta.
 */
export async function liquidarReclamoEnTx(tx: Tx, ctx: ContextoOferta, companyId: string, pedidoId: string, ahora: Date): Promise<ReclamoLiquidado | null> {
  const reclamo = await tx.dealClaim.findFirst({ where: { orderId: pedidoId, companyId } })
  if (!reclamo) return null
  if (reclamo.status === 'REDEEMED') return { claimId: reclamo.id, dealId: reclamo.dealId, fee: reclamo.fee }
  if (reclamo.status !== 'CLAIMED') fallo('RECLAMO_CERRADO', 'El cupón de esta oferta ya no vale.')
  if (reclamo.expiresAt.getTime() <= ahora.getTime()) {
    fallo('RECLAMO_VENCIDO', 'El cupón de esta oferta venció. La oferta ya no se puede canjear con este pedido.')
  }
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    UPDATE "deals"
       SET "budgetReserved" = "budgetReserved" - ${reclamo.fee.toFixed(2)}::numeric,
           "budgetSpent"    = "budgetSpent"    + ${reclamo.fee.toFixed(2)}::numeric,
           "updatedAt"      = ${ahora}
     WHERE "id" = ${reclamo.dealId} AND "companyId" = ${companyId} AND "budgetReserved" >= ${reclamo.fee.toFixed(2)}::numeric
 RETURNING ${COLUMNAS}`
  if (filas.length === 0) fallo('PRESUPUESTO_INCOHERENTE', 'El presupuesto de la oferta no coincide con sus reclamos. Avisa a Membego.')
  const oferta = aFila(filas[0])
  await tx.dealClaim.update({ where: { id: reclamo.id }, data: { status: 'REDEEMED', redeemedAt: ahora } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_REDEEMED', 'DealClaim', reclamo.id, {
    oferta: oferta.id,
    titulo: oferta.title,
    pedido: pedidoId,
    cuota: reclamo.fee.toFixed(2),
    gastado: oferta.budgetSpent.toFixed(2),
    presupuesto: oferta.budgetTotal.toFixed(2),
  })
  await ajustarEstadoPorPresupuestoEnTx(tx, ctx, companyId, oferta, ahora, 'canje')
  return { claimId: reclamo.id, dealId: reclamo.dealId, fee: reclamo.fee }
}

/**
 * CANCELACIÓN O VENCIMIENTO. El pedido del reclamo acaba de pasar a CANCELLED: se libera el
 * cupo y lo reservado. `motivo`: EXPIRED si lo cerró el sistema por vencimiento, CANCELLED si
 * alguien cancelaba el pedido. Devuelve true si había un reclamo que cerrar.
 */
export async function cerrarReclamoSinCanjeEnTx(tx: Tx, ctx: ContextoOferta, companyId: string, pedidoId: string, motivo: 'EXPIRED' | 'CANCELLED', ahora: Date): Promise<boolean> {
  const reclamo = await tx.dealClaim.findFirst({ where: { orderId: pedidoId, companyId } })
  if (!reclamo) return false
  if (reclamo.status === 'EXPIRED' || reclamo.status === 'CANCELLED') return true
  if (reclamo.status !== 'CLAIMED') fallo('RECLAMO_CERRADO', 'Un cupón ya canjeado no se cancela: se reembolsa.')
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    UPDATE "deals"
       SET "claimsActive"   = "claimsActive" - 1,
           "budgetReserved" = "budgetReserved" - ${reclamo.fee.toFixed(2)}::numeric,
           "updatedAt"      = ${ahora}
     WHERE "id" = ${reclamo.dealId} AND "companyId" = ${companyId} AND "claimsActive" >= 1 AND "budgetReserved" >= ${reclamo.fee.toFixed(2)}::numeric
 RETURNING ${COLUMNAS}`
  if (filas.length === 0) fallo('PRESUPUESTO_INCOHERENTE', 'El presupuesto de la oferta no coincide con sus reclamos. Avisa a Membego.')
  const oferta = aFila(filas[0])
  await tx.dealClaim.update({ where: { id: reclamo.id }, data: { status: motivo, closedAt: ahora } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_CLAIM_CLOSED', 'DealClaim', reclamo.id, { oferta: oferta.id, titulo: oferta.title, pedido: pedidoId, estado: motivo, liberado: reclamo.fee.toFixed(2) })
  await ajustarEstadoPorPresupuestoEnTx(tx, ctx, companyId, oferta, ahora, motivo === 'EXPIRED' ? 'vencimiento' : 'cancelación')
  return true
}

/**
 * REEMBOLSO. El pedido de un reclamo ya canjeado acaba de pasar a REFUNDED (y Merchant Billing
 * revierte la cuota): lo gastado se devuelve al presupuesto y el cupo se libera. Devuelve true
 * si había un reclamo que revertir.
 */
export async function revertirReclamoEnTx(tx: Tx, ctx: ContextoOferta, companyId: string, pedidoId: string, ahora: Date): Promise<boolean> {
  const reclamo = await tx.dealClaim.findFirst({ where: { orderId: pedidoId, companyId } })
  if (!reclamo) return false
  if (reclamo.status === 'REFUNDED') return true
  if (reclamo.status !== 'REDEEMED') fallo('RECLAMO_CERRADO', 'Solo se reembolsa un cupón ya canjeado.')
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    UPDATE "deals"
       SET "claimsActive" = "claimsActive" - 1,
           "budgetSpent"  = "budgetSpent" - ${reclamo.fee.toFixed(2)}::numeric,
           "updatedAt"    = ${ahora}
     WHERE "id" = ${reclamo.dealId} AND "companyId" = ${companyId} AND "claimsActive" >= 1 AND "budgetSpent" >= ${reclamo.fee.toFixed(2)}::numeric
 RETURNING ${COLUMNAS}`
  if (filas.length === 0) fallo('PRESUPUESTO_INCOHERENTE', 'El presupuesto de la oferta no coincide con sus reclamos. Avisa a Membego.')
  const oferta = aFila(filas[0])
  await tx.dealClaim.update({ where: { id: reclamo.id }, data: { status: 'REFUNDED', closedAt: ahora } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_CLAIM_CLOSED', 'DealClaim', reclamo.id, { oferta: oferta.id, titulo: oferta.title, pedido: pedidoId, estado: 'REFUNDED', devuelto: reclamo.fee.toFixed(2) })
  await ajustarEstadoPorPresupuestoEnTx(tx, ctx, companyId, oferta, ahora, 'reembolso')
  return true
}

export type { FilaOferta }
export { aFila as filaDeOferta, COLUMNAS as COLUMNAS_DE_OFERTA }
