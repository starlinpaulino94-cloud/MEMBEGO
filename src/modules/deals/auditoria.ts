import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'

/**
 * COMMERCE CORE · ofertas con presupuesto — bitácora DENTRO de la transacción.
 *
 * Una entrada por cada cosa que pasa en una oferta o en un reclamo, con la misma `tx` que
 * la operación: si el cambio se deshace, el rastro también. `userId` es quien lo hizo
 * (null cuando lo hace el sistema o la persona que reclama, que puede no ser un `User`).
 */
export type AccionDeOferta = Extract<
  AuditAccion,
  'DEAL_CREATED' | 'DEAL_UPDATED' | 'DEAL_STATUS_CHANGED' | 'DEAL_CLAIMED' | 'DEAL_REDEEMED' | 'DEAL_CLAIM_CLOSED'
>

export async function auditarOferta(
  tx: Tx,
  ctx: ContextoAuditoria,
  companyId: string,
  accion: AccionDeOferta,
  entidadTipo: 'Deal' | 'DealClaim',
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
