/**
 * Mappers Prisma ↔ dominio del Automation Engine (Fase E1).
 */

import type {
  Automation as PrismaAutomation,
  AutomationRun as PrismaRun,
  // El modelo Prisma se llama `DomainEvent` desde Membego Connect F1 (misma
  // tabla `automation_events`); la interfaz de dominio del motor conserva su
  // nombre porque su vocabulario es el del motor, no el de la plataforma.
  DomainEvent as PrismaEvent,
} from '@prisma/client'
import type {
  Automation,
  AutomationConfig,
  AutomationEvent,
  AutomationRun,
  AutomationStatus,
  AutomationTrigger,
  AutomationTriggerType,
  EvaluatedRule,
  ExecutedAction,
} from '../domain/types'

const STATUSES: readonly AutomationStatus[] = ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED']
function toStatus(raw: string): AutomationStatus {
  return (STATUSES as readonly string[]).includes(raw) ? (raw as AutomationStatus) : 'DRAFT'
}

export function mapAutomation(row: PrismaAutomation): Automation {
  const config = (row.config ?? {}) as AutomationConfig
  const trigger: AutomationTrigger = config.trigger ?? {
    type: row.triggerType as AutomationTriggerType,
    event: row.triggerEvent ?? undefined,
  }
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.nombre,
    description: row.descripcion,
    objective: row.objetivo,
    templateKey: row.templateKey,
    trigger,
    config,
    status: toStatus(row.status),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function mapRun(row: PrismaRun): AutomationRun {
  return {
    id: row.id,
    companyId: row.companyId,
    automationId: row.automationId,
    status: row.status,
    subjectId: row.subjectId,
    subjectKind: row.subjectKind,
    triggeredBy: row.triggeredBy,
    rulesEvaluated: (row.rulesEvaluated ?? []) as unknown as EvaluatedRule[],
    actionsRun: (row.actionsRun ?? []) as unknown as ExecutedAction[],
    result: (row.result ?? {}) as Record<string, unknown>,
    error: row.error,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  }
}

export function mapEvent(row: PrismaEvent): AutomationEvent {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    subjectId: row.subjectId,
    subjectKind: row.subjectKind ?? 'CLIENT',
    payload: (row.payload ?? {}) as Record<string, unknown>,
    source: row.source,
    processed: row.processed,
    occurredAt: row.occurredAt,
  }
}
