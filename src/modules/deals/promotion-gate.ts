import { ActionExecutor, ActionRegistry, createDefaultConditionTypeRegistry, createDefaultOperatorRegistry, RuleContextBuilder, RuleEvaluator } from '@/lib/rule-engine'
import { PromotionEngine } from '@/lib/promotions'
import { mapPromotion } from '@/lib/promotions/infrastructure/mappers'
import { mapRule } from '@/lib/rule-engine/infrastructure/mappers'
import type { Tx } from '@/lib/tenant'
import { fallo } from './errores'

/**
 * Evalúa la Promotion asociada al reclamar, usando solo datos del servidor y
 * del tenant actual. Deal sigue controlando descuento, cupo y presupuesto.
 */
export async function validarPromotionParaReclamoEnTx(
  tx: Tx,
  companyId: string,
  promotionId: string,
  datos: {
    customerId: string
    locationId: string
    dealId: string
    catalogVariantId: string
    at: Date
  },
): Promise<{ promotionId: string; version: number; rules: { id: string; version: number }[] }> {
  const [customer, location] = await Promise.all([
    tx.cliente.findFirst({ where: { id: datos.customerId, companyId }, select: { id: true } }),
    tx.sucursal.findFirst({ where: { id: datos.locationId, companyId, activa: true }, select: { id: true } }),
  ])
  if (!customer) fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no está disponible en esta empresa.')
  if (!location) fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal no está disponible.')

  const row = await tx.promotion.findFirst({
    where: { id: promotionId, companyId },
    include: { rules: true, actions: true, restrictions: true },
  })
  if (!row) fallo('PROMOCION_NO_ENCONTRADA', 'La promoción asociada a esta oferta ya no está disponible.')

  const context = new RuleContextBuilder(companyId)
    .at(datos.at)
    .channel('marketplace')
    .set('cliente', { id: datos.customerId })
    .set('sucursal', { id: datos.locationId })
    .set('deal', { id: datos.dealId, catalogVariantId: datos.catalogVariantId })
    .build()

  const rulesEvaluadas: { id: string; version: number }[] = []
  const engine = new PromotionEngine({
    ruleEvaluator: new RuleEvaluator(createDefaultOperatorRegistry(), createDefaultConditionTypeRegistry()),
    actionExecutor: new ActionExecutor(new ActionRegistry()),
    loadRule: async (ruleId) => {
      const rule = await tx.rule.findFirst({
        where: { id: ruleId, companyId },
        include: { conditions: true, conditionGroups: true, actions: true, group: true },
      })
      if (!rule) return null
      const mapped = mapRule(rule)
      rulesEvaluadas.push({ id: mapped.id, version: mapped.version })
      return mapped
    },
  })
  const evaluation = await engine.evaluate(mapPromotion(row), context)
  if (!evaluation.eligible) {
    fallo('PROMOCION_NO_APLICA', 'No cumples las condiciones vigentes de esta oferta.')
  }
  return { promotionId: row.id, version: row.version, rules: rulesEvaluadas }
}
