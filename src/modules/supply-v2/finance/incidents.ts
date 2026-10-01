import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 · INCIDENCIAS FINANCIERAS (§33).
 *
 * Lo que no se puede deshacer en silencio (una entrega reversada cuyo neto ya
 * se pagó) queda aquí, abierto, hasta que una persona explique cómo se
 * resolvió (nota de crédito del proveedor, descuento en la próxima
 * liquidación, se acepta la pérdida...). Nunca se borra.
 */
export async function resolverIncidenciaFinancieraEnTx(tx: Tx, incidentId: string, notas: string, ctx: ContextoAuditoria): Promise<void> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Resolver una incidencia necesita quién lo hace.')
  if (!notas?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Resolver una incidencia exige explicar cómo se resolvió.')
  const i = await tx.supplyV2FinanceIncident.findUnique({ where: { id: incidentId }, select: { id: true, status: true, type: true, amount: true, supplier: { select: { companyId: true } } } })
  if (!i) fallo('INCIDENCIA_NO_ENCONTRADA', 'La incidencia no existe.')
  if (i.status === 'RESOLVED') return
  await tx.supplyV2FinanceIncident.update({ where: { id: i.id }, data: { status: 'RESOLVED', resolvedById: ctx.actorId, resolvedAt: new Date(), resolutionNotes: notas.trim() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED', 'SupplyV2FinanceIncident', i.id, { type: i.type, amount: i.amount.toFixed(2), notas: notas.trim() }, i.supplier.companyId)
}
