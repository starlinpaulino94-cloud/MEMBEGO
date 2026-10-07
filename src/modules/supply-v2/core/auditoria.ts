import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY · bitácora DENTRO de la transacción (§21, §40).
 *
 * Reutiliza `AuditLog` de Membego Core: no hay una segunda auditoría. Se
 * escribe con la misma `tx` que la operación, así que si la operación se
 * deshace, la bitácora también: nunca queda un «recepción confirmada» sin
 * recepción.
 */

export interface ContextoAuditoria {
  actorId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function auditarEnTx(
  tx: Tx,
  ctx: ContextoAuditoria,
  accion: AuditAccion,
  entidadTipo: string,
  entidadId: string,
  payload: Prisma.InputJsonValue,
  companyId?: string | null
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: companyId ?? null,
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
