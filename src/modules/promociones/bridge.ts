/**
 * Bridge Legacy ↔ Universal de Promociones (Fase B-1).
 *
 * Cada operación del panel admin sobre la tabla legacy `Promocion` se replica
 * en el Promotion Engine universal (`src/lib/promotions`). La dirección
 * legacy→universal convive mientras se migran los lectores (marketplace público,
 * portal del cliente). Todas las operaciones son fire-and-safe: un fallo del
 * lado universal NUNCA rompe el flujo legacy.
 *
 * Mapeo de estados:
 *   activo=true,  archivada=false  →  ACTIVE
 *   activo=false, archivada=false  →  PAUSED
 *   archivada=true                 →  ARCHIVED
 *
 * El enlace se mantiene en `Promotion.metadata.legacyId`.
 */

import { createPromotionService, type PromotionService } from '@/lib/promotions'
import type { PromotionStatus } from '@/lib/promotions'
import { RESTRICTION_TYPES } from '@/lib/promotions'
import { conEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { AUTOMATION_EVENTS } from '@/lib/automation'

let _service: PromotionService | null = null
function service(): PromotionService {
  if (!_service) _service = createPromotionService()
  return _service
}

export interface LegacyPromoData {
  titulo: string
  descripcion: string
  imagenUrl?: string | null
  tipo: string
  descuento?: number | null
  codigo?: string | null
  visibilidad: string
  vigenciaDesde: Date
  vigenciaHasta?: Date | null
  maxCanjes?: number | null
  prioridad: number
  campanaId?: string | null
  tags?: string[]
}

function legacyStatus(activo: boolean, archivada: boolean): PromotionStatus {
  if (archivada) return 'ARCHIVED'
  return activo ? 'ACTIVE' : 'PAUSED'
}

function legacyConfig(data: LegacyPromoData): Record<string, unknown> {
  return {
    tipo: data.tipo,
    descuento: data.descuento ?? null,
    codigo: data.codigo ?? null,
    visibilidad: data.visibilidad,
    imagenUrl: data.imagenUrl ?? null,
    campanaId: data.campanaId ?? null,
    tags: data.tags ?? [],
  }
}

async function findUniversalByLegacyId(legacyId: string, companyId: string) {
  const rows = await conEmpresa(companyId, (tx) =>
    tx.promotion.findMany({
      where: { metadata: { path: ['legacyId'], equals: legacyId } },
      select: { id: true, status: true },
      take: 1,
    })
  )
  return rows[0] ?? null
}

export async function syncCreate(
  legacyId: string,
  companyId: string,
  data: LegacyPromoData,
  userId?: string | null,
): Promise<void> {
  try {
    const existing = await findUniversalByLegacyId(legacyId, companyId)
    if (existing) return

    const promotion = await service().create({
      companyId,
      name: data.titulo,
      description: data.descripcion,
      category: data.tipo,
      priority: data.prioridad,
      startsAt: data.vigenciaDesde,
      endsAt: data.vigenciaHasta ?? null,
      config: legacyConfig(data),
      metadata: { legacyId },
      createdById: userId ?? null,
    })

    await service().activate(promotion.id, { userId })

    if (data.maxCanjes != null) {
      await service().setRestrictions(promotion.id, [{
        type: RESTRICTION_TYPES.MAX_USES_TOTAL,
        value: data.maxCanjes,
        config: {},
        enabled: true,

      }])
    }

    await emitirEventoEstrategia({
      companyId,
      type: AUTOMATION_EVENTS.PROMOTION_CREATED,
      payload: {
        promocion: {
          id: legacyId,
          universalId: promotion.id,
          titulo: data.titulo,
          tipo: data.tipo,
        },
      },
    })
  } catch (e) {
    console.error('[bridge-promociones] syncCreate', e)
  }
}

export async function syncUpdate(
  legacyId: string,
  companyId: string,
  data: LegacyPromoData,
  userId?: string | null,
): Promise<void> {
  try {
    const existing = await findUniversalByLegacyId(legacyId, companyId)
    if (!existing) {
      await syncCreate(legacyId, companyId, data, userId)
      return
    }

    await service().update(existing.id, {
      name: data.titulo,
      description: data.descripcion,
      category: data.tipo,
      priority: data.prioridad,
      startsAt: data.vigenciaDesde,
      endsAt: data.vigenciaHasta ?? null,
      config: legacyConfig(data),
      updatedById: userId ?? null,
    })

    if (data.maxCanjes != null) {
      await service().setRestrictions(existing.id, [{
        type: RESTRICTION_TYPES.MAX_USES_TOTAL,
        value: data.maxCanjes,
        config: {},
        enabled: true,

      }])
    } else {
      await service().setRestrictions(existing.id, [])
    }

    await emitirEventoEstrategia({
      companyId,
      type: AUTOMATION_EVENTS.PROMOTION_UPDATED,
      payload: {
        promocion: {
          id: legacyId,
          universalId: existing.id,
          titulo: data.titulo,
          tipo: data.tipo,
        },
      },
    })
  } catch (e) {
    console.error('[bridge-promociones] syncUpdate', e)
  }
}

export async function syncStatusChange(
  legacyId: string,
  companyId: string,
  activo: boolean,
  archivada: boolean,
  titulo: string,
  userId?: string | null,
): Promise<void> {
  try {
    const existing = await findUniversalByLegacyId(legacyId, companyId)
    if (!existing) return

    const target = legacyStatus(activo, archivada)
    if (existing.status === target) return

    await service().changeStatus(existing.id, target, { userId })

    const eventMap: Record<string, string> = {
      ACTIVE: AUTOMATION_EVENTS.PROMOTION_ACTIVATED,
      PAUSED: AUTOMATION_EVENTS.PROMOTION_PAUSED,
      ARCHIVED: AUTOMATION_EVENTS.PROMOTION_ARCHIVED,
    }
    const eventType = eventMap[target]
    if (eventType) {
      await emitirEventoEstrategia({
        companyId,
        type: eventType,
        payload: {
          promocion: {
            id: legacyId,
            universalId: existing.id,
            titulo,
            status: target,
          },
        },
      })
    }
  } catch (e) {
    console.error('[bridge-promociones] syncStatusChange', e)
  }
}

export async function syncDelete(
  legacyId: string,
  companyId: string,
  titulo: string,
): Promise<void> {
  try {
    const existing = await findUniversalByLegacyId(legacyId, companyId)
    if (!existing) return

    let currentStatus = existing.status
    if (currentStatus !== 'ARCHIVED' && currentStatus !== 'CANCELLED') {
      const r = await service().cancel(existing.id)
      if (r.ok) currentStatus = r.promotion.status
    }
    if (currentStatus !== 'ARCHIVED') {
      await service().archive(existing.id)
    }

    await emitirEventoEstrategia({
      companyId,
      type: AUTOMATION_EVENTS.PROMOTION_DELETED,
      payload: {
        promocion: {
          id: legacyId,
          universalId: existing.id,
          titulo,
        },
      },
    })
  } catch (e) {
    console.error('[bridge-promociones] syncDelete', e)
  }
}

export async function syncDuplicate(
  originalLegacyId: string,
  newLegacyId: string,
  companyId: string,
  data: LegacyPromoData,
  userId?: string | null,
): Promise<void> {
  try {
    const original = await findUniversalByLegacyId(originalLegacyId, companyId)

    if (original) {
      const copy = await service().duplicate(original.id, { userId })
      await conEmpresa(companyId, (tx) =>
        tx.promotion.update({
          where: { id: copy.id },
          data: {
            metadata: { ...(copy.metadata as Record<string, unknown>), legacyId: newLegacyId },
          },
        })
      )
      await emitirEventoEstrategia({
        companyId,
        type: AUTOMATION_EVENTS.PROMOTION_DUPLICATED,
        payload: {
          promocion: {
            id: newLegacyId,
            universalId: copy.id,
            titulo: data.titulo,
            originalLegacyId,
          },
        },
      })
    } else {
      await syncCreate(newLegacyId, companyId, data, userId)
    }
  } catch (e) {
    console.error('[bridge-promociones] syncDuplicate', e)
  }
}
