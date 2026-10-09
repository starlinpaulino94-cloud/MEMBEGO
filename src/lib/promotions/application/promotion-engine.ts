/**
 * PromotionEngine: puente que REUTILIZA el Rule Engine (Fases 1-2) y el Action
 * Engine (Fase 3). La promoción no evalúa condiciones ni ejecuta acciones por su
 * cuenta: delega íntegramente en los motores ya construidos.
 *
 * - Evaluar elegibilidad → carga las reglas mapeadas y las evalúa con el
 *   RuleEvaluator (obtiene RuleResult por regla).
 * - Ejecutar acciones → convierte las acciones de la promoción a la forma que
 *   consume el ActionExecutor y las ejecuta (sin handlers en esta fase → NO_HANDLER).
 *
 * NO contiene lógica comercial: es orquestación genérica.
 */

import type {
  ActionContext,
  ActionExecutionReport,
  ActionExecutor,
  Rule,
  RuleAction,
  RuleContext,
  RuleEvaluator,
  RuleResult,
} from '@/lib/rule-engine'
import type { Promotion, PromotionActionDef } from '../domain/types'
import { isRuleEvaluable } from '@/lib/rule-engine'

export interface PromotionEngineDeps {
  readonly ruleEvaluator: RuleEvaluator
  readonly actionExecutor: ActionExecutor
  /** Cargador de reglas del Rule Engine (reutiliza su repositorio). */
  readonly loadRule: (ruleId: string) => Promise<Rule | null>
}

/** Resultado de evaluar la elegibilidad de una promoción. */
export interface PromotionEvaluation {
  readonly promotionId: string
  /** Elegible si TODAS las reglas mapeadas se cumplen (AND). */
  readonly eligible: boolean
  /** Razones por las que la promoción no se puede aplicar en este instante. */
  readonly ineligibleReasons: readonly PromotionIneligibleReason[]
  /** Resultado por regla (del Rule Engine). */
  readonly ruleResults: readonly RuleResult[]
  /** Ids de reglas mapeadas que no se encontraron (config inconsistente). */
  readonly missingRuleIds: readonly string[]
  /** Reglas encontradas que están inactivas, fuera de vigencia o pertenecen a otra empresa. */
  readonly ineligibleRuleIds: readonly string[]
}

export type PromotionIneligibleReason =
  | 'NOT_ACTIVE'
  | 'NOT_STARTED'
  | 'ENDED'
  | 'COMPANY_MISMATCH'
  | 'UNSUPPORTED_ACTIONS'
  | 'UNSUPPORTED_RESTRICTIONS'

export class PromotionEngine {
  constructor(private readonly deps: PromotionEngineDeps) {}

  /**
   * Evalúa la elegibilidad reutilizando el Rule Engine: carga cada regla mapeada
   * y la evalúa contra el contexto. Elegible = todas válidas.
   */
  async evaluate(promotion: Promotion, context: RuleContext): Promise<PromotionEvaluation> {
    const ruleResults: RuleResult[] = []
    const missingRuleIds: string[] = []
    const ineligibleRuleIds: string[] = []
    const ineligibleReasons: PromotionIneligibleReason[] = []

    if (promotion.companyId !== context.companyId) ineligibleReasons.push('COMPANY_MISMATCH')
    if (promotion.status !== 'ACTIVE') ineligibleReasons.push('NOT_ACTIVE')
    if (promotion.startsAt && context.timestamp < promotion.startsAt) ineligibleReasons.push('NOT_STARTED')
    if (promotion.endsAt && context.timestamp > promotion.endsAt) ineligibleReasons.push('ENDED')
    if (promotion.actions.some((action) => action.enabled)) ineligibleReasons.push('UNSUPPORTED_ACTIONS')
    if (promotion.restrictions.some((restriction) => restriction.enabled)) ineligibleReasons.push('UNSUPPORTED_RESTRICTIONS')

    // Do not even load/evaluate rules when the promotion itself is not applicable.
    if (ineligibleReasons.length > 0) {
      return {
        promotionId: promotion.id,
        eligible: false,
        ineligibleReasons,
        ruleResults,
        missingRuleIds,
        ineligibleRuleIds,
      }
    }

    const ordered = [...promotion.rules].sort((a, b) => a.order - b.order)
    for (const ref of ordered) {
      const rule = await this.deps.loadRule(ref.ruleId)
      if (!rule) {
        missingRuleIds.push(ref.ruleId)
        continue
      }
      // PromotionRule has no database-level tenant constraint. Enforce ownership
      // and the Rule lifecycle here so a stale or cross-tenant mapping fails closed.
      if (rule.companyId !== promotion.companyId || !isRuleEvaluable(rule, context.timestamp)) {
        ineligibleRuleIds.push(ref.ruleId)
        continue
      }
      ruleResults.push(this.deps.ruleEvaluator.evaluateToResult(rule, context))
    }

    // Sin reglas mapeadas → elegible (promoción incondicional). Con reglas → AND.
    const eligible =
      missingRuleIds.length === 0 && ineligibleRuleIds.length === 0 && ruleResults.every((r) => r.valid)

    return { promotionId: promotion.id, eligible, ineligibleReasons, ruleResults, missingRuleIds, ineligibleRuleIds }
  }

  /**
   * Ejecuta las acciones de la promoción reutilizando el Action Engine. En esta
   * fase no hay handlers registrados: el informe reflejará NO_HANDLER.
   */
  async executeActions(
    promotion: Promotion,
    context: ActionContext,
  ): Promise<ActionExecutionReport> {
    const syntheticRule = promotionAsActionCarrier(promotion)
    return this.deps.actionExecutor.execute(syntheticRule, context)
  }
}

/** Convierte una acción de promoción a la forma RuleAction del Action Engine. */
export function toRuleAction(action: PromotionActionDef): RuleAction {
  return {
    id: action.id,
    type: action.type,
    params: action.params,
    order: action.order,
    required: action.required,
    maxRetries: action.maxRetries,
    enabled: action.enabled,
    version: action.version,
  }
}

/**
 * Construye una "regla portadora" mínima con las acciones de la promoción, para
 * pasarla al ActionExecutor sin duplicar su API. No se evalúa: solo transporta
 * las acciones y la identidad de la promoción.
 */
function promotionAsActionCarrier(promotion: Promotion): Rule {
  return {
    id: promotion.id,
    companyId: promotion.companyId,
    group: null,
    name: promotion.name,
    description: promotion.description,
    status: 'PUBLISHED',
    isActive: true,
    priority: promotion.priority,
    version: promotion.version,
    matchType: 'ALL',
    validFrom: null,
    validUntil: null,
    conditions: [],
    conditionTree: null,
    actions: [...promotion.actions].sort((a, b) => a.order - b.order).map(toRuleAction),
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  }
}
