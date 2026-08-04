/**
 * PrismaAutomationRepository: adaptador del puerto AutomationRepository.
 * Única pieza del Automation Engine que conoce Prisma.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationStatus,
  AutomationTriggerType,
  EvaluatedRule,
  ExecutedAction,
} from '../domain/types'
import type {
  AutomationRepository,
  CreateAutomationData,
  UpdateAutomationData,
} from '../application/ports'
import { mapAutomation, mapRun } from './mappers'

/** Cliente Prisma o transacción: permite enhebrar el contexto RLS (tenant.ts). */
type Db = PrismaClient | Prisma.TransactionClient

function json(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue
}

export class PrismaAutomationRepository implements AutomationRepository {
  constructor(private readonly db: Db) {}

  async createAutomation(data: CreateAutomationData): Promise<Automation> {
    const row = await this.db.automation.create({
      data: {
        companyId: data.companyId,
        nombre: data.name,
        descripcion: data.description ?? null,
        objetivo: data.objective ?? null,
        templateKey: data.templateKey ?? null,
        triggerType: data.triggerType,
        triggerEvent: data.triggerEvent ?? data.config.trigger.event ?? null,
        config: json(data.config),
        metadata: json(data.metadata),
      },
    })
    return mapAutomation(row)
  }

  async updateAutomation(id: string, data: UpdateAutomationData): Promise<Automation> {
    const row = await this.db.automation.update({
      where: { id },
      data: {
        nombre: data.name,
        descripcion: data.description,
        objetivo: data.objective,
        config: data.config === undefined ? undefined : json(data.config),
        triggerEvent: data.config?.trigger?.event,
        status: data.status,
        metadata: data.metadata === undefined ? undefined : json(data.metadata),
      },
    })
    return mapAutomation(row)
  }

  async findAutomation(id: string): Promise<Automation | null> {
    const row = await this.db.automation.findUnique({ where: { id } })
    return row ? mapAutomation(row) : null
  }

  async listAutomations(
    companyId: string,
    filter?: { status?: AutomationStatus; triggerType?: AutomationTriggerType },
  ): Promise<Automation[]> {
    const rows = await this.db.automation.findMany({
      where: {
        companyId,
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.triggerType ? { triggerType: filter.triggerType } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(mapAutomation)
  }

  async findByEvent(companyId: string, event: string): Promise<Automation[]> {
    const rows = await this.db.automation.findMany({
      where: { companyId, status: 'PUBLISHED', triggerType: 'EVENT', triggerEvent: event },
    })
    return rows.map(mapAutomation)
  }

  async startRun(data: {
    companyId: string
    automationId: string
    subjectId: string | null
    subjectKind: string | null
    triggeredBy: string | null
  }): Promise<AutomationRun> {
    const row = await this.db.automationRun.create({
      data: {
        companyId: data.companyId,
        automationId: data.automationId,
        subjectId: data.subjectId,
        subjectKind: data.subjectKind,
        triggeredBy: data.triggeredBy,
        status: 'RUNNING',
      },
    })
    return mapRun(row)
  }

  async finishRun(
    id: string,
    data: {
      status: AutomationRunStatus
      rulesEvaluated: EvaluatedRule[]
      actionsRun: ExecutedAction[]
      result: Record<string, unknown>
      error: string | null
      durationMs: number
    },
  ): Promise<AutomationRun> {
    const row = await this.db.automationRun.update({
      where: { id },
      data: {
        status: data.status,
        rulesEvaluated: json(data.rulesEvaluated),
        actionsRun: json(data.actionsRun),
        result: json(data.result),
        error: data.error,
        durationMs: data.durationMs,
        finishedAt: new Date(),
      },
    })
    return mapRun(row)
  }

  countRunsForSubject(automationId: string, subjectId: string, since?: Date): Promise<number> {
    // Solo ejecuciones COMPLETADAS consumen el cupo (no la propia en curso ni
    // las saltadas/fallidas).
    return this.db.automationRun.count({
      where: {
        automationId,
        subjectId,
        status: { in: ['SUCCESS', 'WAITING'] },
        ...(since ? { startedAt: { gte: since } } : {}),
      },
    })
  }

  countRuns(automationId: string): Promise<number> {
    return this.db.automationRun.count({
      where: { automationId, status: { in: ['SUCCESS', 'WAITING'] } },
    })
  }
}
