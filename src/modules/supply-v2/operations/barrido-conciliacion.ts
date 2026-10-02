import { prisma } from '@/lib/prisma'
import { sinEmpresa } from '@/lib/tenant'
import type { ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { conciliarPagoExterno } from './conciliacion'
import { estadoExternoDeEvento, type PuertoDePasarela, type TransaccionDePasarela } from './pasarela'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 3 · CONCILIAR SIN QUE NADIE LO PIDA
 * (§16) Y CUANDO ALGUIEN LO PIDE (§17).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UN BARRIDO SI EL WEBHOOK YA CONCILIA
 *
 * El webhook concilia lo que LLEGA. Lo que no llega no se concilia solo, y hay
 * tres formas de que no llegue:
 *
 *   · el aviso se perdió —la pasarela lo mandó y nosotros no lo recibimos—;
 *   · el aviso llegó, falló al procesarse y se quedó en la escalera;
 *   · nunca hubo aviso: la pasarela cobró y no avisó de nada.
 *
 * Los dos primeros los ve este barrido con lo que ya tenemos. El tercero exige
 * la API del proveedor, y por eso existe el puerto `PuertoDePasarela`: el día
 * que haya una pasarela conectada, se enchufa aquí sin tocar el dominio.
 *
 * Y una regla que no cambia: el barrido NO corrige. Mira, concilia y, si no
 * cuadra, abre el incidente. Decidir sigue siendo de una persona.
 */

export interface ResultadoBarridoConciliacion {
  revisados: number
  cuadraron: number
  discrepancias: number
  esperando: number
  ignorados: number
  incidentesAbiertos: string[]
}

/** La ventana que el barrido mira por defecto: lo de las últimas 48 horas. */
export const VENTANA_MS = 48 * 60 * 60 * 1000

/**
 * BARRIDO · los eventos externos recientes contra la realidad interna.
 *
 * Mira TODOS los eventos recientes, incluidos los que se procesaron bien: un
 * evento PROCESSED cuya orden alguien canceló después es exactamente el tipo de
 * desacuerdo que nadie descubre hasta que falta dinero.
 */
export async function barrerConciliacionDePagos(
  ctx: ContextoAuditoria,
  ahora = new Date(),
  ventanaMs = VENTANA_MS,
  limite = 200
): Promise<ResultadoBarridoConciliacion> {
  const desde = new Date(ahora.getTime() - ventanaMs)
  const eventos = await prisma.supplyV2ExternalEvent.findMany({
    where: { receivedAt: { gte: desde }, eventType: { in: ['PAYMENT_CONFIRMED', 'PAYMENT_REJECTED'] } },
    orderBy: { receivedAt: 'asc' },
    take: limite,
    select: { id: true, provider: true, externalEventId: true, eventType: true, payload: true, orderId: true, correlationId: true },
  })

  const r: ResultadoBarridoConciliacion = {
    revisados: 0,
    cuadraron: 0,
    discrepancias: 0,
    esperando: 0,
    ignorados: 0,
    incidentesAbiertos: [],
  }

  for (const e of eventos) {
    const pago = pagoDelPayload(e.payload)
    const resultado = await conciliarPagoExterno(
      {
        provider: e.provider,
        externalTransactionId: pago.externalTransactionId,
        externalEventRowId: e.id,
        orderId: e.orderId,
        correlationId: e.correlationId,
        externo: {
          estado: estadoExternoDeEvento(e.eventType, pago.providerStatus),
          monto: pago.amount,
          moneda: pago.currency,
        },
      },
      ctx,
      ahora
    )
    r.revisados++
    if (resultado.veredicto.resultado === 'MATCHED') r.cuadraron++
    else if (resultado.veredicto.resultado === 'WAITING') r.esperando++
    else if (resultado.veredicto.resultado === 'IGNORED') r.ignorados++
    else {
      r.discrepancias++
      if (resultado.incidentId && !resultado.incidenteRepetido) r.incidentesAbiertos.push(resultado.incidentId)
    }
  }
  return r
}

/**
 * CONCILIACIÓN MANUAL. Tres formas de pedirla, porque son las tres preguntas
 * que alguien se hace de verdad:
 *
 *   «¿qué pasó con ESTA compra?»            → orderId
 *   «¿qué pasó con ESTE cobro?»             → externalTransactionId
 *   «¿está todo bien con ESTA pasarela?»    → provider
 *
 * Sin pantalla todavía: servicio y pruebas. La pantalla llega con el Centro de
 * Operaciones, y para entonces esto ya tendrá incidentes de verdad que mostrar.
 */
export async function conciliarAPeticion(
  d: { orderId?: string; externalTransactionId?: string; provider?: string; limite?: number },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ResultadoBarridoConciliacion> {
  if (!d.orderId && !d.externalTransactionId && !d.provider) {
    fallo('SIN_CRITERIO', 'Hay que decir qué conciliar: una compra, una transacción o una pasarela.')
  }

  const eventos = await prisma.supplyV2ExternalEvent.findMany({
    where: {
      eventType: { in: ['PAYMENT_CONFIRMED', 'PAYMENT_REJECTED'] },
      ...(d.orderId ? { orderId: d.orderId } : {}),
      ...(d.provider ? { provider: d.provider.trim().toUpperCase() } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: d.limite ?? 100,
    select: { id: true, provider: true, eventType: true, payload: true, orderId: true, correlationId: true },
  })

  // Por transacción se filtra en memoria: vive dentro del cuerpo conservado, y
  // una consulta por JSON aquí sería un índice que nadie más necesita.
  const referencia = d.externalTransactionId?.trim()
  const elegidos = referencia
    ? eventos.filter((e) => pagoDelPayload(e.payload).externalTransactionId === referencia)
    : eventos

  const r: ResultadoBarridoConciliacion = {
    revisados: 0,
    cuadraron: 0,
    discrepancias: 0,
    esperando: 0,
    ignorados: 0,
    incidentesAbiertos: [],
  }

  for (const e of elegidos) {
    const pago = pagoDelPayload(e.payload)
    const resultado = await conciliarPagoExterno(
      {
        provider: e.provider,
        externalTransactionId: pago.externalTransactionId,
        externalEventRowId: e.id,
        orderId: e.orderId,
        correlationId: e.correlationId,
        externo: { estado: estadoExternoDeEvento(e.eventType, pago.providerStatus), monto: pago.amount, moneda: pago.currency },
      },
      ctx,
      ahora
    )
    r.revisados++
    if (resultado.veredicto.resultado === 'MATCHED') r.cuadraron++
    else if (resultado.veredicto.resultado === 'WAITING') r.esperando++
    else if (resultado.veredicto.resultado === 'IGNORED') r.ignorados++
    else {
      r.discrepancias++
      if (resultado.incidentId && !resultado.incidenteRepetido) r.incidentesAbiertos.push(resultado.incidentId)
    }
  }
  return r
}

/**
 * EL PUERTO, IMPLEMENTADO CON EL INBOX.
 *
 * Lo que `TEST_GATEWAY` nos dijo está en `supply_v2_external_events`, firmado y
 * verificado. Esto lo expone con la forma del contrato, de modo que el día que
 * exista una pasarela de verdad se sustituya esta implementación y nada más.
 */
export const pasarelaDesdeElInbox = (provider: string): PuertoDePasarela => ({
  provider: provider.trim().toUpperCase(),

  async listarTransacciones(desde: Date, hasta: Date, limite = 200): Promise<TransaccionDePasarela[]> {
    const filas = await sinEmpresa('Supply 2.0: transacciones vistas por la pasarela', (tx) =>
      tx.supplyV2ExternalEvent.findMany({
        where: {
          provider: provider.trim().toUpperCase(),
          receivedAt: { gte: desde, lte: hasta },
          eventType: { in: ['PAYMENT_CONFIRMED', 'PAYMENT_REJECTED'] },
        },
        orderBy: { receivedAt: 'asc' },
        take: limite,
        select: { id: true, provider: true, eventType: true, payload: true, correlationId: true, receivedAt: true },
      })
    )
    return filas.map((f) => aTransaccion(f))
  },

  async buscarTransaccion(externalTransactionId: string): Promise<TransaccionDePasarela | null> {
    const referencia = externalTransactionId.trim()
    if (!referencia) return null
    const filas = await sinEmpresa('Supply 2.0: buscar una transacción de la pasarela', (tx) =>
      tx.supplyV2ExternalEvent.findMany({
        where: { provider: provider.trim().toUpperCase(), eventType: { in: ['PAYMENT_CONFIRMED', 'PAYMENT_REJECTED'] } },
        orderBy: { receivedAt: 'desc' },
        take: 500,
        select: { id: true, provider: true, eventType: true, payload: true, correlationId: true, receivedAt: true },
      })
    )
    const encontrada = filas.find((f) => pagoDelPayload(f.payload).externalTransactionId === referencia)
    return encontrada ? aTransaccion(encontrada) : null
  },
})

// ── Internos ────────────────────────────────────────────────────────────────

interface PagoLeido {
  externalTransactionId: string | null
  amount: string | null
  currency: string | null
  orderNumber: string | null
  providerStatus: string | null
}

/**
 * Lo que el adaptador dejó escrito, leído con cuidado.
 *
 * Lee `payload.pago` —la traducción del adaptador— y busca el id de transacción
 * y el estado del proveedor en el cuerpo conservado, que es donde el bloque 2
 * los puso. No vuelve a interpretar el cuerpo crudo: ese defecto ya se cerró.
 */
export function pagoDelPayload(payload: unknown): PagoLeido {
  const vacio: PagoLeido = { externalTransactionId: null, amount: null, currency: null, orderNumber: null, providerStatus: null }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return vacio
  const raiz = payload as Record<string, unknown>
  const pago = objeto(raiz.pago)
  const cuerpo = objeto(raiz.cuerpo)
  return {
    externalTransactionId: texto(raiz.externalTransactionId) ?? texto(cuerpo.externalTransactionId),
    amount: texto(pago.amount) ?? numero(pago.amount),
    currency: texto(pago.currency),
    orderNumber: texto(pago.orderNumber),
    providerStatus: texto(raiz.providerStatus) ?? texto(cuerpo.providerStatus),
  }
}

function aTransaccion(f: {
  id: string
  provider: string
  eventType: string
  payload: unknown
  correlationId: string
  receivedAt: Date
}): TransaccionDePasarela {
  const pago = pagoDelPayload(f.payload)
  return {
    provider: f.provider,
    externalTransactionId: pago.externalTransactionId ?? f.id,
    externalEventRowId: f.id,
    estado: estadoExternoDeEvento(f.eventType, pago.providerStatus),
    monto: pago.amount,
    moneda: pago.currency,
    orderReference: pago.orderNumber,
    correlationId: f.correlationId,
    vistaEn: f.receivedAt,
  }
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function numero(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : null
}
