import { prisma } from '@/lib/prisma'
import { createAutomationEngine, type AutomationEngineBundle } from '@/lib/automation'
import { LiveActionSink } from './actionSink'

/**
 * Bus de eventos de estrategias: puente entre los flujos REALES de la app
 * (registro, visitas, pagos, referidos…) y las automatizaciones instaladas
 * desde el Marketplace de Estrategias.
 *
 * `emitirEventoEstrategia` es fire-and-safe: registra el evento (métricas) y
 * despacha las automatizaciones PUBLICADAS suscritas a ese evento con handlers
 * reales (LiveActionSink). NUNCA lanza — un fallo del bus jamás rompe el flujo
 * de negocio que lo emitió. Sin 'use server': solo invocable desde servidor.
 */

let bundle: AutomationEngineBundle | null = null

function liveBundle(): AutomationEngineBundle {
  if (!bundle) {
    const sink = new LiveActionSink()
    bundle = createAutomationEngine({ actionSink: sink })
    sink.bindEngine(bundle.engine, bundle.repository)
  }
  return bundle
}

export interface EventoEstrategia {
  companyId: string
  /** Tipo del catálogo (ej. 'cliente.registrado', 'cliente.primera_compra'). */
  type: string
  /** Ficha Cliente sobre la que ocurre el evento. */
  subjectId?: string | null
  /** Hechos por namespace para condiciones/variables (ej. { cliente: {...} }). */
  payload?: Record<string, unknown>
}

export async function emitirEventoEstrategia(evento: EventoEstrategia): Promise<void> {
  try {
    // 1. Registrar el evento entrante (métricas/auditoría del embudo).
    await prisma.automationEvent
      .create({
        data: {
          companyId: evento.companyId,
          type: evento.type,
          subjectId: evento.subjectId ?? null,
          payload: (evento.payload ?? {}) as object,
          source: 'app',
          processed: true,
        },
      })
      .catch((e) => console.error('[estrategias] registrar evento', e))

    // 2. Despachar automatizaciones publicadas suscritas al evento.
    await liveBundle().dispatcher.dispatch({
      companyId: evento.companyId,
      type: evento.type,
      subjectId: evento.subjectId ?? null,
      payload: evento.payload,
    })

    // 3. Reenviar a los sistemas satélite conectados (car wash, etc.): mismo
    // punto único, mismo contrato best-effort — un satélite caído jamás rompe
    // el flujo de negocio (el outbox + cron se encargan de reintentar).
    const { reenviarEventoASistemas } = await import('@/modules/integraciones/despacho')
    await reenviarEventoASistemas({
      companyId: evento.companyId,
      tipo: evento.type,
      subjectId: evento.subjectId ?? null,
      payload: evento.payload,
    })
  } catch (e) {
    // El bus nunca rompe el flujo de negocio que emitió el evento.
    console.error(`[estrategias] evento ${evento.type} falló`, e)
  }
}
