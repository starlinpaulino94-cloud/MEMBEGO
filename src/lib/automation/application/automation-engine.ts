/**
 * AutomationEngine: núcleo del Automation Engine (Fase E1).
 *
 * Ejecuta una automatización siguiendo la arquitectura del documento:
 *   trigger → variables → ventana/límites → [condición (Rule) → acciones
 *   (Action) → espera]* → finalización → registro (auditoría) → evento.
 *
 * No contiene lógica de negocio: las condiciones las decide el Rule Engine (vía
 * ConditionEvaluator) y las acciones las ejecuta el Action Engine (vía
 * ActionDispatcher). Nada se ejecuta directamente aquí.
 */

import { withinLimits, withinWindow, limitWindowStart } from '../domain/schedule'
import { AUTOMATION_EVENTS } from '../domain/events'
import { interpolateParams, type VariableContext } from '../domain/variables'
import type {
  Automation,
  AutomationRun,
  EvaluatedRule,
  ExecutedAction,
} from '../domain/types'
import type {
  ActionDispatcher,
  AutomationRepository,
  ConditionEvaluator,
  EventStore,
  VariableResolver,
} from './ports'
import { anotarFallo } from '@/lib/prisma-errors'

export interface AutomationEngineDeps {
  readonly repo: AutomationRepository
  readonly conditions: ConditionEvaluator
  readonly actions: ActionDispatcher
  readonly variables: VariableResolver
  readonly events?: EventStore
}

export interface RunInput {
  readonly subjectId?: string | null
  readonly subjectKind?: string
  readonly triggeredBy?: string | null
  /** Datos del trigger (evento/segmento) para armar variables. */
  readonly triggerData?: Record<string, unknown>
  readonly now?: Date
}

export interface RunOutcome {
  readonly run: AutomationRun
  readonly executed: boolean
  readonly waiting: boolean
}

export class AutomationEngine {
  private readonly repo: AutomationRepository
  private readonly conditions: ConditionEvaluator
  private readonly actions: ActionDispatcher
  private readonly variables: VariableResolver
  private readonly events?: EventStore

  constructor(deps: AutomationEngineDeps) {
    this.repo = deps.repo
    this.conditions = deps.conditions
    this.actions = deps.actions
    this.variables = deps.variables
    this.events = deps.events
  }

  /** Ejecuta una automatización para un sujeto. Siempre registra el run. */
  async run(automation: Automation, input: RunInput = {}): Promise<RunOutcome> {
    const now = input.now ?? new Date()
    const subjectId = input.subjectId ?? null
    const started = Date.now()

    const run = await this.repo.startRun({
      companyId: automation.companyId,
      automationId: automation.id,
      subjectId,
      subjectKind: input.subjectKind ?? null,
      triggeredBy: input.triggeredBy ?? null,
    })

    const rulesEvaluated: EvaluatedRule[] = []
    const actionsRun: ExecutedAction[] = []

    // 1. Ventana de horario/días/fechas.
    const win = withinWindow(automation.config.schedule, now)
    if (!win.allowed) {
      return this.finish(run, 'SKIPPED', rulesEvaluated, actionsRun, { skipped: win.denials }, null, started)
    }

    // 2. Límites por sujeto y totales.
    const limits = automation.config.limits
    if (limits) {
      const [subjectRuns, totalRuns] = await Promise.all([
        subjectId ? this.repo.countRunsForSubject(automation.id, subjectId, limitWindowStart(limits, now)) : Promise.resolve(0),
        limits.maxTotal != null ? this.repo.countRuns(automation.id) : Promise.resolve(0),
      ])
      const lim = withinLimits(limits, { subjectRuns, totalRuns })
      if (!lim.allowed) {
        return this.finish(run, 'SKIPPED', rulesEvaluated, actionsRun, { skipped: lim.denials }, null, started)
      }
    }

    // 3. Variables del sujeto/contexto.
    let variables: VariableContext
    try {
      variables = await this.variables.resolve({
        companyId: automation.companyId,
        subjectId,
        trigger: input.triggerData ?? {},
      })
    } catch (e) {
      return this.finish(run, 'FAILED', rulesEvaluated, actionsRun, {}, errMsg(e), started)
    }

    // 4. Pasos: condición (Rule) → acciones (Action) → espera.
    try {
      for (const step of automation.config.steps) {
        if (step.condition) {
          const res = await this.conditions.evaluate(step.condition, variables)
          rulesEvaluated.push({ expr: step.condition, passed: res.passed, detail: res.detail })
          if (!res.passed) continue // este paso no aplica; sigue con el próximo
        }

        for (const action of step.actions ?? []) {
          const params = interpolateParams(action.params, variables)
          const out = await this.actions.dispatch(
            { type: action.type, params },
            { companyId: automation.companyId, subjectId, variables },
          )
          actionsRun.push({ type: action.type, ok: out.ok, detail: out.detail })
          if (!out.ok && action.required) {
            return this.finish(run, 'FAILED', rulesEvaluated, actionsRun, {}, `Acción obligatoria falló: ${action.type}`, started)
          }
        }

        // Encadenado: emite un evento que otra automatización puede consumir.
        if (step.chain?.event && this.events) {
          await this.events.emit({
            companyId: automation.companyId,
            type: step.chain.event,
            subjectId,
            payload: { fromAutomation: automation.id },
            source: automation.id,
          })
        }

        // Espera: se pausa aquí (se reanuda por tiempo/evento en otra ejecución).
        if (step.wait && (step.wait.ms || step.wait.untilEvent)) {
          return this.finish(run, 'WAITING', rulesEvaluated, actionsRun, { waitingOn: step.wait }, null, started)
        }
      }
    } catch (e) {
      return this.finish(run, 'FAILED', rulesEvaluated, actionsRun, {}, errMsg(e), started)
    }

    // 5. Finalización + evento de fin (para encadenar/analytics).
    if (this.events) {
      await this.events.emit({
        companyId: automation.companyId,
        type: AUTOMATION_EVENTS.AUTOMATION_FINISHED,
        subjectId,
        payload: { automationId: automation.id },
        source: automation.id,
      }).catch(anotarFallo('automation:evento-finalizacion'))
    }
    return this.finish(run, 'SUCCESS', rulesEvaluated, actionsRun, { actions: actionsRun.length }, null, started)
  }

  private async finish(
    run: AutomationRun,
    status: AutomationRun['status'],
    rulesEvaluated: EvaluatedRule[],
    actionsRun: ExecutedAction[],
    result: Record<string, unknown>,
    error: string | null,
    started: number,
  ): Promise<RunOutcome> {
    const finished = await this.repo.finishRun(run.id, {
      status,
      rulesEvaluated,
      actionsRun,
      result,
      error,
      durationMs: Date.now() - started,
    })
    return { run: finished, executed: status === 'SUCCESS', waiting: status === 'WAITING' }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
