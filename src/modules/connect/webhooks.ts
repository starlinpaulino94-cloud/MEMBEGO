import 'server-only'
import { randomBytes } from 'node:crypto'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { firmarHmac } from '@/modules/integraciones/nucleo'
import { dentroDelLimite } from '@/modules/connect/entitlements'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  FALLOS_PARA_APAGAR,
  suscripcionQuiere,
  validarUrlWebhook,
  type MotivoUrl,
} from '@/modules/connect/webhooksNucleo'

/**
 * WEBHOOKS SALIENTES a cualquier URL (Membego Connect · Fase 3).
 *
 * El hermano abierto del despacho a satélites: mismo patrón outbox —la entrega
 * se registra ANTES de intentarse, así que un receptor caído no pierde nada—
 * pero el destino lo pone la empresa, no el superadmin.
 *
 * AISLAMIENTO: el fan-out parte del `companyId` DEL EVENTO y busca las
 * suscripciones de esa empresa. Nunca al revés. Una suscripción no puede
 * pedir eventos de otra empresa porque nadie le pregunta de qué empresa
 * quiere: se le da lo suyo.
 */

const MAX_INTENTOS = 8
const TIMEOUT_MS = 10_000

export type ResultadoCrearSuscripcion =
  | { ok: true; id: string; secreto: string }
  | { ok: false; motivo: 'limite_alcanzado' }
  | { ok: false; motivo: 'url_invalida'; detalle: MotivoUrl }

/**
 * Crea una suscripción. Devuelve el secreto de firma UNA vez —igual que las
 * claves de API— aunque aquí también se puede volver a ver desde el panel:
 * quien integra tiene que copiarlo a su servidor para verificar las firmas.
 */
export async function crearSuscripcion(input: {
  companyId: string
  nombre: string
  url: string
  eventos?: string[]
  creadoPor?: string | null
}): Promise<ResultadoCrearSuscripcion> {
  const url = validarUrlWebhook(input.url)
  if (!url.ok) return { ok: false, motivo: 'url_invalida', detalle: url.motivo }

  const activas = await conEmpresa(input.companyId, (tx) =>
    tx.suscripcionWebhook.count({
      where: { companyId: input.companyId, estado: { in: ['ACTIVE', 'PAUSED'] } },
    })
  )
  if (!(await dentroDelLimite(input.companyId, 'webhooks.max', activas))) {
    return { ok: false, motivo: 'limite_alcanzado' }
  }

  const secreto = `whs_${randomBytes(24).toString('hex')}`
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.suscripcionWebhook.create({
      data: {
        companyId: input.companyId,
        nombre: input.nombre.slice(0, 120),
        url: url.url,
        eventos: input.eventos ?? [],
        secreto,
        creadoPor: input.creadoPor ?? null,
      },
      select: { id: true },
    })
  )

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'webhook.suscrito',
    // El host SÍ (identifica el destino en el panel); el secreto jamás.
    detalle: { host: new URL(url.url).hostname, eventos: (input.eventos ?? []).length },
  })

  return { ok: true, id: fila.id, secreto }
}

/** Las suscripciones de una empresa, para el panel. */
export async function suscripcionesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    })
  )
}

/** Pausa, reactiva o desactiva. La empresa decide; el sistema solo DISABLED. */
export async function cambiarEstadoSuscripcion(
  companyId: string,
  id: string,
  estado: 'ACTIVE' | 'PAUSED'
): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.updateMany({
      where: { id, companyId },
      // Reactivar limpia el contador: si no, una suscripción que ya se apagó
      // sola volvería a apagarse al primer fallo.
      data: estado === 'ACTIVE' ? { estado, fallosSeguidos: 0 } : { estado },
    })
  )
  return { ok: r.count > 0 }
}

/** El sobre que viaja. Estable: es contrato con quien integra. */
export interface SobreWebhook {
  id: string
  event: string
  companyId: string
  createdAt: string
  data: Record<string, unknown>
}

/**
 * FAN-OUT: registra una entrega por cada suscripción interesada y hace UN
 * intento inmediato. Best-effort — nunca lanza: el flujo de negocio que emitió
 * el evento no puede romperse porque el servidor de un tercero esté caído.
 */
export async function repartirEventoAWebhooks(input: {
  companyId: string
  /** Nombre del evento tal como viaja por el cable (v2). */
  evento: string
  eventoId?: string | null
  datos: Record<string, unknown>
}): Promise<void> {
  try {
    const suscripciones = await conEmpresa(input.companyId, (tx) =>
      tx.suscripcionWebhook.findMany({
        where: { companyId: input.companyId, estado: 'ACTIVE' },
        select: { id: true, url: true, secreto: true, eventos: true },
      })
    )
    const interesadas = suscripciones.filter((s) => suscripcionQuiere(s.eventos, input.evento))
    if (interesadas.length === 0) return

    for (const s of interesadas) {
      const entrega = await conEmpresa(input.companyId, (tx) =>
        tx.entregaWebhook.create({
          data: {
            suscripcionId: s.id,
            companyId: input.companyId,
            evento: input.evento,
            eventoId: input.eventoId ?? null,
            payload: input.datos as object,
          },
          select: { id: true, createdAt: true },
        })
      ).catch(anotarFallo('connect:webhook:outbox', { evento: input.evento }))
      if (!entrega) continue

      const sobre: SobreWebhook = {
        id: entrega.id,
        event: input.evento,
        companyId: input.companyId,
        createdAt: entrega.createdAt.toISOString(),
        data: input.datos,
      }
      const resultado = await entregar(s.url, s.secreto, sobre)
      await registrarResultado(input.companyId, entrega.id, s.id, resultado, 1)
    }
  } catch (e) {
    console.error('[connect] fan-out de webhooks:', e)
  }
}

interface ResultadoEntrega {
  ok: boolean
  status: number | null
  error: string | null
}

/** POST firmado. La firma es HMAC-SHA256 del cuerpo, con el secreto. */
async function entregar(
  url: string,
  secreto: string,
  sobre: SobreWebhook
): Promise<ResultadoEntrega> {
  const cuerpo = JSON.stringify(sobre)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Membego-Event': sobre.event,
        'X-Membego-Delivery': sobre.id,
        'X-Membego-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Membego-Signature': firmarHmac(secreto, cuerpo),
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.ok) return { ok: true, status: resp.status, error: null }
    // El cuerpo del error ayuda a quien integra a arreglarlo: un 404 de la
    // plataforma de alojamiento y uno de la aplicación se corrigen en sitios
    // distintos y sin el texto son indistinguibles.
    const detalle = (await resp.text().catch(() => '')).trim().replace(/\s+/g, ' ')
    return {
      ok: false,
      status: resp.status,
      error: detalle ? `HTTP ${resp.status} · ${detalle.slice(0, 200)}` : `HTTP ${resp.status}`,
    }
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : 'fetch falló' }
  }
}

/**
 * Anota cómo fue la entrega y mueve la salud de la suscripción.
 *
 * Al octavo intento la entrega pasa a DEAD_LETTER (deja de reintentarse sola);
 * a los `FALLOS_PARA_APAGAR` fallos SEGUIDOS, la suscripción entera se apaga.
 * Son dos umbrales distintos porque responden a preguntas distintas: uno es
 * «este mensaje no llega», el otro «este destino está muerto».
 */
async function registrarResultado(
  companyId: string,
  entregaId: string,
  suscripcionId: string,
  r: ResultadoEntrega,
  intentos: number
): Promise<void> {
  await conEmpresa(companyId, (tx) =>
    tx.entregaWebhook.update({
      where: { id: entregaId },
      data: r.ok
        ? { estado: 'ENVIADO', intentos, estadoHttp: r.status, enviadoAt: new Date() }
        : {
            intentos,
            estadoHttp: r.status,
            ultimoError: r.error?.slice(0, 300) ?? null,
            ...(intentos >= MAX_INTENTOS ? { estado: 'DEAD_LETTER' } : {}),
          },
    })
  ).catch(anotarFallo('connect:webhook:marcar', { entregaId }))

  if (r.ok) {
    await conEmpresa(companyId, (tx) =>
      tx.suscripcionWebhook.update({
        where: { id: suscripcionId },
        data: { fallosSeguidos: 0, ultimoOkAt: new Date(), ultimoError: null },
      })
    ).catch(anotarFallo('connect:webhook:salud-ok', { suscripcionId }))
    return
  }

  const actualizada = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.update({
      where: { id: suscripcionId },
      data: {
        fallosSeguidos: { increment: 1 },
        ultimoErrorAt: new Date(),
        ultimoError: r.error?.slice(0, 300) ?? null,
      },
      select: { fallosSeguidos: true },
    })
  ).catch(anotarFallo('connect:webhook:salud-fallo', { suscripcionId }))

  if (actualizada && actualizada.fallosSeguidos >= FALLOS_PARA_APAGAR) {
    await conEmpresa(companyId, (tx) =>
      tx.suscripcionWebhook.updateMany({
        where: { id: suscripcionId, estado: 'ACTIVE' },
        data: { estado: 'DISABLED' },
      })
    ).catch(anotarFallo('connect:webhook:apagar', { suscripcionId }))
    await anotarConector({
      companyId,
      origen: 'CONEXION',
      origenId: suscripcionId,
      nivel: 'ERROR',
      evento: 'webhook.apagado_por_fallos',
      detalle: { fallosSeguidos: actualizada.fallosSeguidos },
    })
  }
}

/**
 * Reintenta las entregas PENDIENTES (cron). El destino se vuelve a resolver en
 * cada reintento: una suscripción pausada entre medias deja de recibir, en vez
 * de vaciar la cola encima de quien pidió que paráramos.
 */
export async function reintentarWebhooksPendientes(limite = 100): Promise<{
  enviados: number
  agotados: number
}> {
  let enviados = 0
  let agotados = 0

  const pendientes = await sinEmpresa(
    'connect: entregas de webhook pendientes (cron global)',
    (tx) =>
      tx.entregaWebhook.findMany({
        where: { estado: 'PENDIENTE' },
        orderBy: { createdAt: 'asc' },
        take: limite,
        include: {
          suscripcion: { select: { id: true, url: true, secreto: true, estado: true } },
        },
      })
  ).catch(() => [])

  for (const e of pendientes) {
    if (e.suscripcion.estado !== 'ACTIVE') {
      await sinEmpresa('connect: cerrar entrega de suscripción inactiva (cron)', (tx) =>
        tx.entregaWebhook.update({
          where: { id: e.id },
          data: { estado: 'DEAD_LETTER', ultimoError: 'La suscripción ya no está activa.' },
        })
      ).catch(anotarFallo('connect:webhook:cerrar', { id: e.id }))
      agotados++
      continue
    }

    const sobre: SobreWebhook = {
      id: e.id,
      event: e.evento,
      companyId: e.companyId,
      createdAt: e.createdAt.toISOString(),
      data: (e.payload ?? {}) as Record<string, unknown>,
    }
    const r = await entregar(e.suscripcion.url, e.suscripcion.secreto, sobre)
    const intentos = e.intentos + 1
    await registrarResultado(e.companyId, e.id, e.suscripcion.id, r, intentos)
    if (r.ok) enviados++
    else if (intentos >= MAX_INTENTOS) agotados++
  }

  return { enviados, agotados }
}
