import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'

/**
 * COMMERCE CORE · pedidos — bitácora DENTRO de la transacción.
 *
 * Una entrada por cada transición del pedido, cambio de monto o pago
 * registrado, con la misma `tx` que la operación: si el cambio se deshace, el
 * rastro también. `userId` es quien lo hizo (empresa, empleado o cliente) y
 * null cuando lo hace el sistema.
 */
export type AccionDePedido = Extract<
  AuditAccion,
  | 'ORDER_CREATED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_ADJUSTED'
  | 'ORDER_READY'
  | 'ORDER_CONFIRMED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'ORDER_REFUNDED'
  | 'ORDER_PAYMENT_RECORDED'
>

export async function auditarPedido(
  tx: Tx,
  ctx: ContextoAuditoria,
  companyId: string,
  accion: AccionDePedido,
  pedidoId: string,
  payload: Prisma.InputJsonObject
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId,
      userId: ctx.actorId,
      accion,
      entidadTipo: 'MembegoOrder',
      entidadId: pedidoId,
      payload,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  })
}
