import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ActionContext, ActionExecutionReport, Rule, RuleContext, RuleResult, RuleEvaluator, ActionExecutor } from '../src/lib/rule-engine'
import { PromotionEngine } from '../src/lib/promotions/application/promotion-engine'
import type { Promotion } from '../src/lib/promotions/domain/types'

const now = new Date('2030-06-01T12:00:00.000Z')

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    companyId: 'company-1',
    name: 'Promo',
    description: null,
    category: null,
    status: 'ACTIVE',
    priority: 0,
    startsAt: new Date('2030-06-01T12:00:00.000Z'),
    endsAt: new Date('2030-06-01T12:00:00.000Z'),
    config: {},
    metadata: {},
    version: 1,
    createdById: null,
    updatedById: null,
    rules: [],
    actions: [],
    restrictions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    companyId: 'company-1',
    group: null,
    name: 'Rule',
    description: null,
    status: 'PUBLISHED',
    isActive: true,
    priority: 0,
    version: 1,
    matchType: 'ALL',
    validFrom: null,
    validUntil: null,
    conditions: [],
    conditionTree: null,
    actions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function engine(rules: Record<string, Rule | null> = {}) {
  const loaded: string[] = []
  const evaluator = {
    evaluateToResult: (_rule: Rule, _context: RuleContext) => ({ valid: true }) as RuleResult,
  } as unknown as RuleEvaluator
  const executor = {
    execute: async (_rule: Rule, _context: ActionContext) => ({} as ActionExecutionReport),
  } as unknown as ActionExecutor
  return {
    loaded,
    subject: new PromotionEngine({
      ruleEvaluator: evaluator,
      actionExecutor: executor,
      loadRule: async (id) => {
        loaded.push(id)
        return rules[id] ?? null
      },
    }),
  }
}

const context: RuleContext = { companyId: 'company-1', timestamp: now, data: {}, meta: {} }

test('PromotionEngine: solo evalúa una promoción activa dentro de vigencia (límites inclusivos)', async () => {
  const { subject } = engine()
  const result = await subject.evaluate(promotion(), context)

  assert.equal(result.eligible, true)
  assert.deepEqual(result.ineligibleReasons, [])
})

test('PromotionEngine: no evalúa promoción inactiva, aún no iniciada, vencida o de otra empresa', async () => {
  const { subject, loaded } = engine()
  const cases: [Promotion, RuleContext, string][] = [
    [promotion({ status: 'DRAFT', rules: [{ id: 'map-1', ruleId: 'rule-1', order: 0 }] }), context, 'NOT_ACTIVE'],
    [promotion({ startsAt: new Date(now.getTime() + 1) }), context, 'NOT_STARTED'],
    [promotion({ endsAt: new Date(now.getTime() - 1) }), context, 'ENDED'],
    [promotion(), { ...context, companyId: 'company-2' }, 'COMPANY_MISMATCH'],
    [promotion({ actions: [{ id: 'a1', type: 'apply_discount_percent', params: { value: 10 }, order: 0, required: true, maxRetries: 0, enabled: true, version: 1 }] }), context, 'UNSUPPORTED_ACTIONS'],
    [promotion({ restrictions: [{ id: 'r1', type: 'max_uses_total', value: 10, config: {}, enabled: true }] }), context, 'UNSUPPORTED_RESTRICTIONS'],
  ]

  for (const [candidate, ruleContext, reason] of cases) {
    const result = await subject.evaluate(candidate, ruleContext)
    assert.equal(result.eligible, false)
    assert.ok(result.ineligibleReasons.includes(reason as typeof result.ineligibleReasons[number]))
  }
  assert.deepEqual(loaded, [], 'no se consultan reglas cuando la promoción no aplica')
})

test('PromotionEngine: rechaza referencias a reglas faltantes, inactivas o de otra empresa', async () => {
  const { subject } = engine({
    inactive: rule({ id: 'inactive', isActive: false }),
    foreign: rule({ id: 'foreign', companyId: 'company-2' }),
    draft: rule({ id: 'draft', status: 'DRAFT' }),
    future: rule({ id: 'future', validFrom: new Date(now.getTime() + 1) }),
    expired: rule({ id: 'expired', validUntil: new Date(now.getTime() - 1) }),
  })
  const result = await subject.evaluate(promotion({
    rules: [
      { id: 'map-1', ruleId: 'inactive', order: 0 },
      { id: 'map-2', ruleId: 'foreign', order: 1 },
      { id: 'map-3', ruleId: 'draft', order: 2 },
      { id: 'map-4', ruleId: 'future', order: 3 },
      { id: 'map-5', ruleId: 'expired', order: 4 },
      { id: 'map-6', ruleId: 'missing', order: 5 },
    ],
  }), context)

  assert.equal(result.eligible, false)
  assert.deepEqual(result.ineligibleRuleIds, ['inactive', 'foreign', 'draft', 'future', 'expired'])
  assert.deepEqual(result.missingRuleIds, ['missing'])
  assert.equal(result.ruleResults.length, 0, 'reglas fuera de vigencia o de otro tenant no llegan al evaluador')
})
