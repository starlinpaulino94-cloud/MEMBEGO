import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'

/**
 * COMMERCE CORE · inventario — bitácora DENTRO de la transacción.
 *
 * Reutiliza `AuditLog` de Membego Core, y SOLO para lo que una persona hace a
 * mano (mover existencias, transferir, fijar el umbral): lo que hace el sistema
 * —ventas, reservas, vencimientos— ya queda en el ledger, que es más fino. Se
 * escribe con la misma `tx` que la operación: si el cambio se deshace, el
 * rastro también.
 */
export interface ContextoAuditoria {
  actorId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function auditarInventario(
  tx: Tx,
  ctx: ContextoAuditoria,
  companyId: string,
  accion: Extract<AuditAccion, 'INVENTORY_STOCK_CHANGED' | 'INVENTORY_TRANSFERRED' | 'INVENTORY_CONFIGURED'>,
  entidadId: string,
  payload: Prisma.InputJsonObject
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId,
      userId: ctx.actorId,
      accion,
      entidadTipo: 'InventoryLevel',
      entidadId,
      payload,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  })
}
