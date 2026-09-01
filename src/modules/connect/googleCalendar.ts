import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { accessTokenVigente } from '@/modules/connect/oauth'
import { anotarSalud } from '@/modules/connect/registro'
import { configOauthDe } from '@/modules/connect/oauthRutas'

/**
 * CONECTOR DE GOOGLE CALENDAR (Membego Connect · Fase 6).
 *
 * Lleva las citas confirmadas a la agenda del negocio, que es donde su equipo
 * ya mira. La dirección es de ida: MembeGo escribe en Google. Traer eventos de
 * Google a MembeGo sería otra cosa —resolución de conflictos, borrados,
 * cursores— y no se hace aquí para no fingir una sincronización bidireccional
 * que no está construida.
 *
 * El token lo sirve `accessTokenVigente`, que refresca solo si hace falta: por
 * eso este archivo no sabe nada de refrescos ni de vencimientos.
 */

const API = 'https://www.googleapis.com/calendar/v3'
const TIMEOUT_MS = 10_000

/** Calendario destino. `primary` es el principal de la cuenta conectada. */
const CALENDARIO_POR_DEFECTO = 'primary'

export type ResultadoEvento =
  | { ok: true; eventoId: string | null }
  | { ok: false; motivo: 'sin_conexion' | 'sin_token' | 'proveedor'; detalle?: string }

async function conexionCalendario(companyId: string): Promise<string | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId, estado: 'CONNECTED', conector: { slug: 'google-calendar' } },
      select: { id: true },
    })
  ).catch(() => null)
  return fila?.id ?? null
}

/** ¿Puede esta empresa escribir en su agenda de Google AHORA? */
export async function calendarioDisponible(companyId: string): Promise<boolean> {
  return (await conexionCalendario(companyId)) !== null
}

export interface EventoCita {
  titulo: string
  descripcion?: string
  inicio: Date
  fin: Date
  /** IANA («America/Santo_Domingo»). Google la exige junto a la hora. */
  zonaHoraria: string
}

/**
 * Crea el evento. Best-effort: devuelve el motivo en vez de lanzar, porque
 * quien llama está confirmando una cita y ESA operación no puede fallar
 * porque Google esté caído.
 */
export async function crearEventoCalendario(input: {
  companyId: string
  evento: EventoCita
}): Promise<ResultadoEvento> {
  const conexionId = await conexionCalendario(input.companyId)
  if (!conexionId) return { ok: false, motivo: 'sin_conexion' }

  const config = configOauthDe('google-calendar')
  if (!config) return { ok: false, motivo: 'sin_conexion' }

  const token = await accessTokenVigente({
    companyId: input.companyId,
    conexionId,
    config,
  })
  if (!token.ok) return { ok: false, motivo: 'sin_token', detalle: token.motivo }

  try {
    const resp = await fetch(
      `${API}/calendars/${encodeURIComponent(CALENDARIO_POR_DEFECTO)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: input.evento.titulo,
          description: input.evento.descripcion,
          // `dateTime` + `timeZone`: sin la zona, Google interpreta la hora en
          // la del calendario, y una cita de las 9:00 en Santo Domingo
          // aparecería a otra hora para un calendario configurado en otro país.
          start: {
            dateTime: input.evento.inicio.toISOString(),
            timeZone: input.evento.zonaHoraria,
          },
          end: { dateTime: input.evento.fin.toISOString(), timeZone: input.evento.zonaHoraria },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )

    if (!resp.ok) {
      const detalle = `Google respondió ${resp.status}`
      await anotarSalud({
        companyId: input.companyId,
        conexionId,
        resultado: { ok: false, error: detalle },
      })
      return { ok: false, motivo: 'proveedor', detalle }
    }

    const json = (await resp.json().catch(() => ({}))) as { id?: string }
    await anotarSalud({ companyId: input.companyId, conexionId, resultado: { ok: true } })
    return { ok: true, eventoId: json.id ?? null }
  } catch (e) {
    const detalle = e instanceof Error ? e.message : 'no se pudo contactar con Google'
    await anotarSalud({
      companyId: input.companyId,
      conexionId,
      resultado: { ok: false, error: detalle },
    })
    return { ok: false, motivo: 'proveedor', detalle }
  }
}
