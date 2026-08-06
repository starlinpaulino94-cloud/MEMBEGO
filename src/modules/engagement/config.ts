import { conEmpresa } from '@/lib/tenant'
import {
  normalizeEngagementConfig,
  type EngagementConfig,
} from '@/lib/engagementConfig'

/**
 * Engagement Engine · Fase 7 — lee la personalización del motor de una empresa.
 * Nunca lanza: ante cualquier fallo devuelve la configuración por defecto
 * (todo activado, color por defecto).
 */
export async function getEngagementConfig(companyId: string): Promise<EngagementConfig> {
  try {
    const c = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { engagementConfig: true, colorPrimario: true },
      })
    )
    return normalizeEngagementConfig(c?.engagementConfig, c?.colorPrimario ?? null)
  } catch (e) {
    console.error('[engagement] getEngagementConfig:', e)
    return normalizeEngagementConfig(null, null)
  }
}
