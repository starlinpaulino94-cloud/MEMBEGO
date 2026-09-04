import 'server-only'
import type { ManejadorEvento } from '@/modules/connect/meta/webhookDispatcher'
import { aplicarEstadoWhatsapp, registrarEntranteWhatsapp } from '@/modules/mensajeria/entrantes'

/**
 * LOS MANEJADORES DE MENSAJERÍA para el despachador de webhooks de Meta
 * (Fase 2). El despachador los carga con `import()` cuando llega un evento
 * de su objeto y campo: así `mensajeria` puede depender de `connect` sin
 * que `connect` dependa de `mensajeria`.
 */

export const entranteWhatsapp: ManejadorEvento = (ev) => registrarEntranteWhatsapp(ev)

export const estadoWhatsapp: ManejadorEvento = (ev) => aplicarEstadoWhatsapp(ev)

/** Meta avisa de que una plantilla cambió de estado: se resincronizan todas. */
export const plantillaActualizada: ManejadorEvento = async (ev) => {
  const { sincronizarPlantillas } = await import('@/modules/mensajeria/plantillas')
  const r = await sincronizarPlantillas(ev.companyId)
  return r.ok ? `plantillas resincronizadas (${r.total})` : `sin resincronizar: ${r.motivo}`
}
