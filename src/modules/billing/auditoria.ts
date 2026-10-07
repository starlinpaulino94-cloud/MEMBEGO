import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'

/**
 * COMMERCE CORE · Merchant Billing — bitácora DENTRO de la transacción.
 *
 * Solo lo que hace una persona sobre la cuenta (configurar el cobro, asentar un
 * pago/ajuste/crédito) y los cambios de estado de la cuenta. Las comisiones que
 * escribe el sistema no auditan aquí: su rastro es el libro, que es inmutable.
 */
export type AccionDeFacturacion = Extract<AuditAccion, 'BILLING_CONFIG_CHANGED' | 'BILLING_ENTRY_RECORDED' | 'BILLING_STATUS_CHANGED'>

export async function auditarFacturacion(
  tx: Tx,
  ctx: ContextoAuditoria,
  companyId: string,
  accion: AccionDeFacturacion,
  entidadTipo: 'MerchantBillingConfig' | 'MerchantLedgerEntry',
  entidadId: string,
  payload: Prisma.InputJsonObject
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId,
      userId: ctx.actorId,
      accion,
      entidadTipo,
      entidadId,
      payload,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  })
}
