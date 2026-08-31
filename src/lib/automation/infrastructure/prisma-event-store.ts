/**
 * PrismaEventStore: adaptador del puerto EventStore (Fase E1). Persiste los
 * eventos del bus (automation_events) para el encadenado y la auditoría.
 */

import type { PrismaClient } from '@prisma/client'
import type { EventStore } from '../application/ports'
import type { AutomationEvent } from '../domain/types'
import { mapEvent } from './mappers'

export class PrismaEventStore implements EventStore {
  constructor(private readonly db: PrismaClient) {}

  async emit(event: {
    companyId: string
    type: string
    subjectId: string | null
    subjectKind?: string
    payload?: Record<string, unknown>
    source?: string | null
  }): Promise<AutomationEvent> {
    const row = await this.db.domainEvent.create({
      data: {
        companyId: event.companyId,
        type: event.type,
        subjectId: event.subjectId,
        subjectKind: event.subjectKind ?? 'CLIENT',
        payload: (event.payload ?? {}) as object,
        source: event.source ?? null,
      },
    })
    return mapEvent(row)
  }

  async markProcessed(id: string): Promise<void> {
    await this.db.domainEvent.update({ where: { id }, data: { processed: true } })
  }
}
