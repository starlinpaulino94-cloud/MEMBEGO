import type { AuditAccion, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'

/**
 * COMMERCE CORE · catálogo — bitácora DENTRO de la transacción.
 *
 * Reutiliza `AuditLog` de Membego Core. Se escribe con la misma `tx` que la
 * operación: si el cambio se deshace, el rastro también, y nunca queda un
 * «precio cambiado» sin cambio.
 */
export interface ContextoAuditoria {
  actorId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function auditarCatalogo(
  tx: Tx,
  ctx: ContextoAuditoria,
  companyId: string,
  accion: Extract<
    AuditAccion,
    'CATALOG_ITEM_CREATED' | 'CATALOG_ITEM_UPDATED' | 'CATALOG_ITEM_STATUS_CHANGED' | 'CATALOG_VARIANT_CHANGED'
  >,
  entidadTipo: 'CatalogItem' | 'CatalogVariant',
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
