import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { createAutomationEngine, type AutomationEngineBundle } from '@/lib/automation'
import { LiveActionSink } from './actionSink'
import { encolar } from '@/modules/jobs/cola'

/**
 * Bus de eventos de estrategias: puente entre los flujos REALES de la app
 * (registro, visitas, pagos, referidos…) y las automatizaciones instaladas
 * desde el Marketplace de Estrategias.
 *
 * `emitirEventoEstrategia` es fire-and-safe y ASÍNCRONO (Fase 4 · Componente 5):
 * persiste el evento con `processed=false` y encola su id. El despacho —buscar
 * automatizaciones publicadas, evaluar condiciones y ejecutar acciones, correo
 * incluido— corre en el worker `/api/jobs` (patrón outbox B-6). Sin QStash,
 * `encolar` ejecuta el mismo trabajo en línea, igual que antes.
 *
 * NUNCA lanza: un fallo del bus jamás rompe el flujo de negocio que lo emitió.
 * Sin 'use server': solo invocable desde servidor.
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
    // 1. Persistir el evento pendiente. Es la fuente de verdad: aunque QStash
    // caiga, el cron de barrido encuentra `processed=false` y lo repone.
    const creado = await conEmpresa(evento.companyId, (tx) =>
      tx.automationEvent.create({
        data: {
          companyId: evento.companyId,
          type: evento.type,
          subjectId: evento.subjectId ?? null,
          payload: (evento.payload ?? {}) as object,
          source: 'app',
          processed: false,
        },
      })
    )

    // 2. Fuera del request: el worker hace el flip y despacha.
    await encolar({ tipo: 'evento-estrategia', eventoId: creado.id, companyId: evento.companyId })
  } catch (e) {
    // El bus nunca rompe el flujo de negocio que emitió el evento.
    console.error(`[estrategias] evento ${evento.type} falló`, e)
  }
}

/**
 * Despacha un evento pendiente (worker `/api/jobs` y barrido del cron).
 *
 * El flip atómico processed:false → true da exclusión mutua: si QStash reintenta
 * (500) o el cron barre el mismo evento, el segundo llega con processed:true y
 * no re-despacha. Si el despacho falla se REABRE el evento y se relanza el
 * error para que QStash reintente — repetir es seguro, perder el evento no lo es.
 */
export async function despacharEventoEstrategia(
  eventoId: string
): Promise<{ procesados: number; detalle?: string }> {
  const flip = await sinEmpresa('estrategias: flip atómico del evento por id (worker, cross-tenant)', (tx) =>
    tx.automationEvent.updateMany({
      where: { id: eventoId, processed: false },
      data: { processed: true },
    })
  )
  if (flip.count === 0) return { procesados: 0, detalle: 'ya procesado' }

  try {
    const evento = await sinEmpresa('estrategias: evento por id (worker, cross-tenant)', (tx) =>
      tx.automationEvent.findUnique({ where: { id: eventoId } })
    )
    if (!evento) return { procesados: 0, detalle: 'evento no encontrado' }

    const payload = (evento.payload ?? {}) as Record<string, unknown>

    // 1. Despachar automatizaciones publicadas suscritas al evento.
    await liveBundle().dispatcher.dispatch({
      companyId: evento.companyId,
      type: evento.type,
      subjectId: evento.subjectId ?? null,
      payload,
    })

    // 2. Reenviar a los sistemas satélite conectados (car wash, etc.): mismo
    // contrato best-effort — un satélite caído no rompe el flujo (el outbox +
    // cron se encargan de reintentar).
    const { reenviarEventoASistemas } = await import('@/modules/integraciones/despacho')
    await reenviarEventoASistemas({
      companyId: evento.companyId,
      tipo: evento.type,
      subjectId: evento.subjectId ?? null,
      payload,
    })

    return { procesados: 1 }
  } catch (e) {
    // Reabrir el evento para que el reintento (o el barrido) lo vuelva a tomar.
    await sinEmpresa('estrategias: reabrir evento por id (worker, cross-tenant)', (tx) =>
      tx.automationEvent
        .updateMany({ where: { id: eventoId, processed: true }, data: { processed: false } })
        .catch((err) => console.error('[estrategias] no se pudo reabrir el evento', err))
    )
    throw e
  }
}

/**
 * Barrido de resiliencia del bus (cron diario): re-encola eventos que quedaron
 * `processed:false` — QStash caído en el momento del emit, worker que falló más
 * allá de sus reintentos, o un proceso muerto entre el create y el flip. El
 * flip atómico de `despacharEventoEstrategia` evita dobles despachos con una
 * entrega de QStash en curso; y si la cola sigue caída, `encolar` degrada a
 * ejecución en línea. Acotado: solo eventos viejos y un lote máximo por barrido.
 */
export async function barrerEventosEstrategia(): Promise<{ reencolados: number }> {
  const corte = new Date(Date.now() - 6 * 60 * 60 * 1000)
  const pendientes = await sinEmpresa('estrategias: barrido global de eventos pendientes (cron)', (tx) =>
    tx.automationEvent.findMany({
      where: { processed: false, occurredAt: { lt: corte } },
      select: { id: true, companyId: true },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    })
  )

  let reencolados = 0
  for (const ev of pendientes) {
    try {
      await encolar({ tipo: 'evento-estrategia', eventoId: ev.id, companyId: ev.companyId })
      reencolados++
    } catch (e) {
      console.error('[estrategias] barrido: no se pudo re-encolar el evento', ev.id, e)
    }
  }
  return { reencolados }
}
