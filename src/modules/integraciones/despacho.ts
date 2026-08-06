import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { firmarHmac, EVENTOS_REENVIADOS } from '@/modules/integraciones/nucleo'

/**
 * DESPACHO DE EVENTOS a los sistemas satélite conectados.
 *
 * Patrón outbox: el evento queda registrado en `eventos_salientes` ANTES de
 * intentar enviarlo — si el satélite está caído no se pierde nada; el cron
 * reintenta. El envío es un POST JSON firmado (HMAC-SHA256 del cuerpo con el
 * secreto compartido del sistema) para que el satélite verifique que viene de
 * MembeGo y no de un tercero.
 *
 * AISLAMIENTO (regla de oro): cada evento lleva el companyId de UNA empresa y
 * solo va a sistemas cuya categoría coincide con la de esa empresa. El satélite
 * jamás recibe datos de empresas ajenas a su vertical.
 */

const MAX_INTENTOS = 8
const TIMEOUT_MS = 10_000

interface EventoParaEnviar {
  companyId: string
  tipo: string
  subjectId?: string | null
  payload?: Record<string, unknown>
}

/** Sistemas activos que atienden la categoría de la empresa y reciben webhooks. */
async function sistemasDestino(companyId: string) {
  try {
    const { getCapacidadesEmpresa } = await import('@/modules/capacidades/resolver')
    const { categoria } = await getCapacidadesEmpresa(companyId)
    return await conEmpresa(companyId, (tx) =>
      tx.sistemaConectado.findMany({
        where: { activo: true, categoria, urlWebhook: { not: null } },
        select: { id: true, urlWebhook: true, secreto: true },
      })
    )
  } catch {
    return []
  }
}

/** POST firmado al satélite. Devuelve null si llegó, o el error si no. */
async function entregar(
  urlWebhook: string,
  secreto: string,
  cuerpo: string
): Promise<string | null> {
  try {
    const resp = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Membego-Firma': firmarHmac(secreto, cuerpo),
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.ok) return null
    // El código solo no alcanza: un 404 de la plataforma de alojamiento («el
    // dominio no apunta a nada») y un 404 de la aplicación («falta la ruta»)
    // se arreglan en sitios distintos, y sin el cuerpo son indistinguibles.
    const detalle = (await resp.text().catch(() => '')).trim().replace(/\s+/g, ' ')
    return detalle ? `HTTP ${resp.status} · ${detalle.slice(0, 200)}` : `HTTP ${resp.status}`
  } catch (e) {
    return e instanceof Error ? e.message : 'fetch falló'
  }
}

function cuerpoDe(evento: {
  id: string
  companyId: string
  tipo: string
  payload: unknown
  createdAt: Date
}): string {
  return JSON.stringify({
    id: evento.id, // idempotencia en el satélite: mismo id = mismo evento
    tipo: evento.tipo,
    companyId: evento.companyId,
    payload: evento.payload ?? {},
    emitidoEn: evento.createdAt.toISOString(),
  })
}

/**
 * Registra el evento en el outbox de cada sistema destino y hace UN intento
 * de entrega inmediata. Best-effort: nunca lanza — el bus de negocio no puede
 * romperse por un satélite caído.
 */
export async function reenviarEventoASistemas(evento: EventoParaEnviar): Promise<void> {
  try {
    if (!(EVENTOS_REENVIADOS as readonly string[]).includes(evento.tipo)) return
    const sistemas = await sistemasDestino(evento.companyId)
    if (sistemas.length === 0) return

    for (const sistema of sistemas) {
      const fila = await conEmpresa(evento.companyId, (tx) =>
        tx.eventoSaliente.create({
          data: {
            sistemaId: sistema.id,
            companyId: evento.companyId,
            tipo: evento.tipo,
            payload: {
              ...(evento.payload ?? {}),
              ...(evento.subjectId ? { clienteId: evento.subjectId } : {}),
            } as object,
          },
        })
      ).catch(anotarFallo('integraciones:outbox', { tipo: evento.tipo }))
      if (!fila || !sistema.urlWebhook) continue

      const error = await entregar(sistema.urlWebhook, sistema.secreto, cuerpoDe(fila))
      await conEmpresa(evento.companyId, (tx) =>
        tx.eventoSaliente.update({
          where: { id: fila.id },
          data: error
            ? { intentos: 1, ultimoError: error.slice(0, 300) }
            : { estado: 'ENVIADO', intentos: 1, enviadoAt: new Date() },
        })
      ).catch(anotarFallo('integraciones:marcar', { id: fila.id }))
    }
  } catch (e) {
    console.error('[integraciones] reenviar evento:', e)
  }
}

/** Reintenta los PENDIENTES (cron). Marca FALLIDO al agotar los intentos. */
export async function reintentarPendientes(limite = 100): Promise<{ enviados: number; fallidos: number }> {
  let enviados = 0
  let fallidos = 0
  const pendientes = await sinEmpresa('integraciones: reintento global de eventos pendientes (cron)', (tx) =>
    tx.eventoSaliente.findMany({
      where: { estado: 'PENDIENTE' },
      orderBy: { createdAt: 'asc' },
      take: limite,
      include: { sistema: { select: { urlWebhook: true, secreto: true, activo: true } } },
    })
  ).catch(() => [])

  for (const ev of pendientes) {
    if (!ev.sistema.activo || !ev.sistema.urlWebhook) {
      await sinEmpresa('integraciones: cerrar evento sin destino (cron global)', (tx) =>
        tx.eventoSaliente
          .update({ where: { id: ev.id }, data: { estado: 'FALLIDO', ultimoError: 'Sistema inactivo o sin webhook.' } })
      ).catch(anotarFallo('integraciones:cerrar', { id: ev.id }))
      fallidos++
      continue
    }
    const error = await entregar(ev.sistema.urlWebhook, ev.sistema.secreto, cuerpoDe(ev))
    const intentos = ev.intentos + 1
    await sinEmpresa('integraciones: marcar evento tras reintento (cron global)', (tx) =>
      tx.eventoSaliente.update({
        where: { id: ev.id },
        data: error
          ? {
              intentos,
              ultimoError: error.slice(0, 300),
              ...(intentos >= MAX_INTENTOS ? { estado: 'FALLIDO' } : {}),
            }
          : { estado: 'ENVIADO', intentos, enviadoAt: new Date() },
      })
    ).catch(anotarFallo('integraciones:marcar', { id: ev.id }))
    if (error) fallidos += intentos >= MAX_INTENTOS ? 1 : 0
    else enviados++
  }
  return { enviados, fallidos }
}
