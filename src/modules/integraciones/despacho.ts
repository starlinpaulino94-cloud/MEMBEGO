import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { getPlatformEventPrivateKey } from '@/lib/env'
import { firmarHmac, EVENTOS_REENVIADOS } from '@/modules/integraciones/nucleo'
import { sistemasDeEmpresa } from '@/modules/plataforma/registro'
import { construirSobre, cuerpoDelSobre } from '@/modules/plataforma/eventos'
import {
  CABECERA_EVENTO,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  clavePrivadaDesde,
  firmarEd25519,
} from '@/modules/plataforma/firma'

/**
 * DESPACHO DE EVENTOS a los sistemas satélite conectados.
 *
 * Patrón outbox: el evento queda registrado en `eventos_salientes` ANTES de
 * intentar enviarlo — si el satélite está caído no se pierde nada; el cron
 * reintenta.
 *
 * AISLAMIENTO (regla de oro): cada evento lleva el companyId de UNA empresa y
 * solo va a los sistemas que ESA empresa tiene habilitados
 * (`modules/plataforma/registro`). El satélite jamás recibe datos de empresas
 * que no lo usan — antes bastaba con compartir categoría, ahora hace falta la
 * habilitación, que es más estrecho y nunca más ancho.
 *
 * FIRMA (Fase 3): salen las DOS. `X-Membego-Firma` es el HMAC de siempre;
 * `X-Membego-Signature` es Ed25519 sobre `timestamp.eventId.cuerpo`. Cambiar de
 * una a otra de golpe exigiría que Core y satélites desplegaran el mismo
 * minuto; con las dos juntas, cada satélite migra cuando puede.
 *
 * CUERPO (Fase 3): el sobre v2 con las claves del formato anterior duplicadas
 * dentro. Un satélite que hoy lee `tipo` y `payload` sigue funcionando sin
 * desplegar nada — y con Car Wash en producción eso no es una comodidad, es la
 * diferencia entre un despliegue y una parada.
 */

const MAX_INTENTOS = 8
const TIMEOUT_MS = 10_000

/** Estado terminal del outbox: ya no se reintenta solo; alguien tiene que mirar. */
const DESCARTADO = 'DEAD_LETTER'

interface EventoParaEnviar {
  companyId: string
  tipo: string
  subjectId?: string | null
  payload?: Record<string, unknown>
  /** Hilo de la operación. Sin él, cada evento es su propio hilo. */
  traceId?: string | null
}

/**
 * La clave se parsea UNA vez por proceso y no en cada envío: `createPrivateKey`
 * no es gratis y el cron manda cien eventos seguidos.
 */
let clavePrivada: ReturnType<typeof clavePrivadaDesde> | undefined
function claveEventos() {
  if (clavePrivada === undefined) clavePrivada = clavePrivadaDesde(getPlatformEventPrivateKey())
  return clavePrivada
}

/**
 * Sistemas que la empresa tiene habilitados Y que reciben webhooks.
 *
 * `excluirSlug` quita del reparto al satélite que PROVOCÓ el evento. No es un
 * ahorro: un satélite que canjea por la API ya tiene la respuesta síncrona, y
 * devolverle por webhook la noticia de su propia acción es un eco. Una
 * implementación ingenua lo trata como un evento nuevo, actúa otra vez y vuelve
 * a llamarnos — un bucle que solo se nota cuando ya se ha multiplicado.
 */
async function sistemasDestino(
  companyId: string,
  excluirSlug?: string | null
): Promise<{ id: string; urlWebhook: string; secreto: string }[]> {
  try {
    const sistemas = await sistemasDeEmpresa(companyId, { conSecreto: true })
    return sistemas
      .filter((s) => s.urlWebhook !== null && s.secreto !== undefined)
      .filter((s) => !excluirSlug || s.slug !== excluirSlug)
      .map((s) => ({ id: s.id, urlWebhook: s.urlWebhook!, secreto: s.secreto! }))
  } catch {
    return []
  }
}

/**
 * Slug del satélite que provocó el evento, si lo hubo.
 *
 * Viaja dentro del payload y no como columna porque el evento cruza el bus de
 * automatizaciones (`AutomationEvent`), cuyo `payload` es Json: añadir una
 * columna allí para un dato de integración sería meter la plataforma dentro del
 * motor de reglas.
 */
function sistemaOrigenDe(payload: Record<string, unknown> | undefined): string | null {
  const v = payload?.sistemaOrigen
  return typeof v === 'string' && v ? v : null
}

/** POST firmado al satélite. Devuelve null si llegó, o el error si no. */
async function entregar(
  urlWebhook: string,
  secreto: string,
  cuerpo: string,
  eventId: string
): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000)
  const ed25519 = firmarEd25519(claveEventos(), timestamp, eventId, cuerpo)

  try {
    const resp = await fetch(urlWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // La de siempre. Se retira cuando ningún satélite la use.
        'X-Membego-Firma': firmarHmac(secreto, cuerpo),
        [CABECERA_TIMESTAMP]: String(timestamp),
        [CABECERA_EVENTO]: eventId,
        ...(ed25519 ? { [CABECERA_FIRMA]: ed25519 } : {}),
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
  traceId?: string | null
}): string {
  return cuerpoDelSobre(construirSobre(evento))
}

/**
 * Registra el evento en el outbox de cada sistema destino y hace UN intento
 * de entrega inmediata. Best-effort: nunca lanza — el bus de negocio no puede
 * romperse por un satélite caído.
 */
export async function reenviarEventoASistemas(evento: EventoParaEnviar): Promise<void> {
  try {
    if (!(EVENTOS_REENVIADOS as readonly string[]).includes(evento.tipo)) return
    const sistemas = await sistemasDestino(evento.companyId, sistemaOrigenDe(evento.payload))
    if (sistemas.length === 0) return

    for (const sistema of sistemas) {
      const fila = await conEmpresa(evento.companyId, (tx) =>
        tx.eventoSaliente.create({
          data: {
            sistemaId: sistema.id,
            companyId: evento.companyId,
            tipo: evento.tipo,
            traceId: evento.traceId ?? null,
            payload: {
              ...(evento.payload ?? {}),
              ...(evento.subjectId ? { clienteId: evento.subjectId } : {}),
            } as object,
          },
        })
      ).catch(anotarFallo('integraciones:outbox', { tipo: evento.tipo }))
      if (!fila) continue

      const error = await entregar(sistema.urlWebhook, sistema.secreto, cuerpoDe(fila), fila.id)
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

/**
 * Reintenta los PENDIENTES (cron). Al agotar los intentos pasan a DEAD_LETTER:
 * dejan de reintentarse solos y esperan a que alguien mire el panel. El payload
 * se conserva íntegro, así que reencolarlos es un botón.
 *
 * EL DESTINO SE VUELVE A COMPROBAR EN CADA REINTENTO, y no se da por bueno
 * porque el evento estuviera en la cola. Un evento encolado el lunes puede
 * salir el miércoles, y entre medias la empresa pudo perder la habilitación o
 * el sistema pudo suspenderse: entregarlo entonces sería mandar datos a un
 * sistema al que esa empresa ya no pertenece. Con el destino resuelto de nuevo,
 * revocar deja de ser una promesa a futuro y vacía también la cola.
 *
 * El coste es una consulta por empresa —no por evento— gracias al memo: cien
 * eventos pendientes suelen ser de dos o tres empresas.
 */
export async function reintentarPendientes(limite = 100): Promise<{ enviados: number; fallidos: number }> {
  let enviados = 0
  let fallidos = 0
  const pendientes = await sinEmpresa('integraciones: reintento global de eventos pendientes (cron)', (tx) =>
    tx.eventoSaliente.findMany({
      where: { estado: 'PENDIENTE' },
      orderBy: { createdAt: 'asc' },
      take: limite,
    })
  ).catch(() => [])

  const memo = new Map<string, Map<string, { urlWebhook: string; secreto: string }>>()
  const destinosDe = async (companyId: string) => {
    const cacheado = memo.get(companyId)
    if (cacheado) return cacheado
    const porId = new Map((await sistemasDestino(companyId)).map((s) => [s.id, s]))
    memo.set(companyId, porId)
    return porId
  }

  for (const ev of pendientes) {
    const destino = (await destinosDe(ev.companyId)).get(ev.sistemaId)
    if (!destino) {
      await sinEmpresa('integraciones: cerrar evento sin destino (cron global)', (tx) =>
        tx.eventoSaliente
          .update({ where: { id: ev.id }, data: { estado: DESCARTADO, ultimoError: 'Sistema no habilitado para esta empresa, inactivo o sin webhook.' } })
      ).catch(anotarFallo('integraciones:cerrar', { id: ev.id }))
      fallidos++
      continue
    }
    const error = await entregar(destino.urlWebhook, destino.secreto, cuerpoDe(ev), ev.id)
    const intentos = ev.intentos + 1
    await sinEmpresa('integraciones: marcar evento tras reintento (cron global)', (tx) =>
      tx.eventoSaliente.update({
        where: { id: ev.id },
        data: error
          ? {
              intentos,
              ultimoError: error.slice(0, 300),
              ...(intentos >= MAX_INTENTOS ? { estado: DESCARTADO } : {}),
            }
          : { estado: 'ENVIADO', intentos, enviadoAt: new Date() },
      })
    ).catch(anotarFallo('integraciones:marcar', { id: ev.id }))
    if (error) fallidos += intentos >= MAX_INTENTOS ? 1 : 0
    else enviados++
  }
  return { enviados, fallidos }
}
