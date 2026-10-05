import { registrarEvento } from '@/modules/observabilidad/eventos'
import { sinEmpresa } from '@/lib/tenant'
import { cifrasOperativas, resumenOperativo } from './salud'
import { estadoDeWhatsapp } from '../notifications/whatsapp'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · MÉTRICAS OPERATIVAS (§14, §15).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE CONSTRUYE UN PROMETHEUS CASERO
 *
 * `modules/observabilidad/eventos.ts` ya emite eventos estructurados que
 * cualquier recolector sabe contar y agrupar, y lo hace con una decisión de
 * diseño que aquí viene regalada: `extra` SOLO acepta números, booleanos y
 * etiquetas cortas de `[a-z][a-z0-9_-]*`. Un identificador de compra, un
 * correo o un teléfono NO CABEN en esa forma.
 *
 * Eso es exactamente lo que §14 pide —«no usar identificadores de orden o
 * customer como labels de alta cardinalidad»— y no hace falta acordarse: la
 * forma lo impide. Un `orderId` como etiqueta multiplicaría las series por el
 * número de compras y reventaría cualquier recolector, además de meter un dato
 * de negocio en un sistema con otra retención y otros permisos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA FOTO, NO UNA FILA POR MÉTRICA
 *
 * Esto emite los CONTADORES del momento, una vez por pasada del cron. No
 * guarda nada en la base: §15 dice de no escribir una fila por métrica si la
 * infraestructura ya sabe emitirlas, y la de Membego sabe. Las series
 * temporales las arma el recolector a partir de estos eventos.
 *
 * Las LATENCIAS no se emiten aquí: ya salen donde se miden, dentro de la
 * petición. `anotarYContar` las emite en el camino del webhook
 * (`webhook_processing_ms`) y el despacho del outbox las emite por efecto.
 * Repetirlas desde el cron daría una media de medias, que no es una latencia.
 */

/** Los contadores que se emiten por pasada. Nombres estables, sin identificadores. */
export interface MetricasOperativas {
  payment_events_received: number
  payment_events_rejected: number
  payment_reconciliation_mismatch: number
  open_finance_incidents: number
  high_finance_incidents: number
  outbox_pending: number
  outbox_dead: number
  job_dead_letters: number
  /** 0 sano · 1 degradado · 2 no disponible · 3 sin configurar. */
  readiness_status: number
  /** 1 si el canal de WhatsApp de plataforma está configurado. */
  whatsapp_configured: number
}

const PESO_ESTADO: Record<string, number> = {
  HEALTHY: 0,
  DEGRADED: 1,
  UNAVAILABLE: 2,
  NOT_CONFIGURED: 3,
}

/**
 * Lee las cifras y las emite como un evento estructurado.
 *
 * Nunca lanza: una métrica que tumba el cron es peor que una métrica perdida,
 * y el cron de este archivo es el que además entrega pagos y avisos.
 */
export async function emitirMetricasOperativas(ahora = new Date()): Promise<MetricasOperativas | null> {
  try {
    const [cifras, resumen, recibidos] = await Promise.all([
      cifrasOperativas(ahora),
      resumenOperativo(ahora),
      /**
       * «Eventos recibidos en total» se lee AQUÍ y no se añade a las cifras de
       * salud, a propósito: `CifrasOperativas` existe para JUZGAR el estado
       * —cada campo decide si un componente está sano— y un total acumulado no
       * juzga nada. Como contador monótono sí vale para el recolector, que es
       * el que calcula el ritmo.
       */
      sinEmpresa('Supply 2.0: métrica de eventos externos recibidos', (tx) => tx.supplyV2ExternalEvent.count()),
    ])
    const m: MetricasOperativas = {
      payment_events_received: recibidos,
      payment_events_rejected: cifras.eventosFallidos + cifras.eventosMuertos,
      payment_reconciliation_mismatch: cifras.discrepancias,
      open_finance_incidents: cifras.incidentesAbiertos,
      high_finance_incidents: cifras.incidentesAltos,
      outbox_pending: cifras.outboxPendiente,
      outbox_dead: cifras.outboxMuertos,
      job_dead_letters: cifras.difuntosDeCola,
      readiness_status: PESO_ESTADO[resumen.estado] ?? 3,
      whatsapp_configured: estadoDeWhatsapp().estado === 'CONFIGURED' ? 1 : 0,
    }

    registrarEvento({
      dominio: 'pago',
      accion: 'metricas_supply_v2',
      ok: m.readiness_status === 0,
      // `motivo` en etiqueta, no en frase: es lo que permite agrupar por
      // estado sin leer texto.
      motivo: resumen.estado.toLowerCase(),
      extra: { ...m },
    })
    return m
  } catch {
    // Si las cifras no se pueden leer, la base está mal y eso YA lo dice
    // readiness. No se emiten ceros: un cero aquí se leería como «no hay
    // incidentes», que es la mentira más cara que puede contar un panel.
    return null
  }
}
