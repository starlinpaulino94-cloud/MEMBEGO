import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { accessTokenVigente } from '@/modules/connect/oauth'
import { anotarSalud } from '@/modules/connect/registro'
import { configOauthDe } from '@/modules/connect/oauthRutas'
import { metadatosCredencial } from '@/modules/connect/credenciales'
import { oauthGoogleCalendar } from '@/modules/connect/proveedores/googleCalendar'
import {
  borradoYaHecho,
  creacionYaHecha,
  cuerpoEvento,
  idEventoDeCita,
  sincronizaConfirmadas,
  type EventoCita,
} from '@/modules/connect/googleCalendarNucleo'
import {
  claseDeEstadoHttp,
  claseDeFalloDeRed,
  type ClaseError,
} from '@/modules/connect/proveedores/tipos'

/**
 * CONECTOR DE GOOGLE CALENDAR (Fase 6 · completado en la Fase 12 · ciclo de
 * vida completo con la referencia v3).
 *
 * Lleva las citas confirmadas a la agenda del negocio, que es donde su equipo
 * ya mira. La dirección es de ida: MembeGo escribe en Google. Traer eventos de
 * Google a MembeGo sería otra cosa —resolución de conflictos, borrados,
 * cursores— y no se hace aquí para no fingir una sincronización bidireccional
 * que no está construida.
 *
 * El token lo sirve `accessTokenVigente`, que refresca solo si hace falta: por
 * eso este archivo no sabe nada de refrescos ni de vencimientos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LA FASE 12 AÑADIÓ
 *
 *   · listar los calendarios de la cuenta, para poder ELEGIR uno;
 *   · validar la conexión SIN ESCRIBIR NADA en la agenda del cliente;
 *   · escribir en el calendario elegido en vez de en «primary» a ciegas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE FALTABA PARA ESTAR INTEGRADO DE VERDAD
 *
 *   · CREAR ES IDEMPOTENTE: el id del evento se deriva de la cita
 *     (`events.insert` admite un id propio) y un 409 se lee como «ya estaba».
 *     La cita guarda ese id.
 *   · BORRAR: `events.delete` al cancelar, con `sendUpdates=none` para no
 *     mandar correos de «evento cancelado» desde la cuenta del negocio; 404 y
 *     410 cuentan como hecho.
 *   · LA OPCIÓN DEL ALTA SE RESPETA: `sincronizarConfirmadas: false` se
 *     guardaba y se ignoraba.
 *
 * Las reglas puras (id, cuerpo, qué respuesta cuenta como hecha) viven en
 * `googleCalendarNucleo.ts` y se prueban sin red.
 */

const API = 'https://www.googleapis.com/calendar/v3'
const TIMEOUT_MS = 10_000

export type { EventoCita }

export type ResultadoEvento =
  | { ok: true; eventoId: string | null }
  | {
      ok: false
      motivo: 'sin_conexion' | 'sin_token' | 'sin_configurar' | 'desactivado' | 'proveedor'
      detalle?: string
    }

interface ConexionCalendario {
  id: string
  config: Record<string, unknown>
}

async function conexionCalendario(companyId: string): Promise<ConexionCalendario | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId, estado: 'CONNECTED', conector: { slug: 'google-calendar' } },
      select: { id: true, config: true },
    })
  ).catch(() => null)
  if (!fila) return null
  const config =
    fila.config && typeof fila.config === 'object' && !Array.isArray(fila.config)
      ? (fila.config as Record<string, unknown>)
      : {}
  return { id: fila.id, config }
}

/** ¿Puede esta empresa escribir en su agenda de Google AHORA? */
export async function calendarioDisponible(companyId: string): Promise<boolean> {
  const c = await conexionCalendario(companyId)
  return c !== null && typeof c.config.calendarId === 'string'
}

/**
 * GOOGLE Y EL 403 AMBIGUO.
 *
 * Google usa 403 para dos cosas muy distintas: «te falta un permiso» y «te
 * pasaste de cuota». Tratarlas igual haría que un pico de citas le pidiera al
 * dueño del negocio reconectar una cuenta que está perfectamente. El cuerpo de
 * la respuesta lo distingue, y es lo único que se mira de él.
 */
function claseDeGoogle(estado: number, razon: string | null): ClaseError {
  if (estado === 403 && razon && /rateLimit|quota|userRateLimit/i.test(razon)) return 'RATE_LIMIT'
  return claseDeEstadoHttp(estado)
}

/**
 * Saca SOLO el campo `reason` del error de Google. Nada más del cuerpo se lee
 * ni se registra: en una respuesta de error puede viajar información de la
 * cuenta del cliente.
 */
async function razonDe(resp: Response): Promise<string | null> {
  try {
    const json = (await resp.json()) as {
      error?: { errors?: { reason?: string }[]; status?: string }
    }
    return json.error?.errors?.[0]?.reason ?? json.error?.status ?? null
  } catch {
    return null
  }
}

async function tokenDe(
  companyId: string,
  conexionId: string
): Promise<{ ok: true; token: string } | { ok: false; motivo: string }> {
  const config = configOauthDe('google-calendar')
  if (!config) return { ok: false, motivo: 'sin_configurar' }
  const token = await accessTokenVigente({ companyId, conexionId, config })
  if (!token.ok) return { ok: false, motivo: token.motivo }
  return { ok: true, token: token.accessToken }
}

// ─── Listar calendarios ──────────────────────────────────────────────────────

export interface CalendarioGoogle {
  id: string
  nombre: string
  /** El principal de la cuenta. Se ofrece primero. */
  principal: boolean
  /** ¿Podemos crear eventos en él? `reader` y `freeBusyReader` NO pueden. */
  puedeEscribir: boolean
  zonaHoraria: string | null
}

export type ResultadoCalendarios =
  | { ok: true; calendarios: CalendarioGoogle[] }
  | { ok: false; clase: ClaseError; detalle: string }

/**
 * Los calendarios de la cuenta conectada, con si podemos escribir en cada uno.
 *
 * `accessRole` es la razón por la que esto existe y no basta con listar
 * nombres: una cuenta puede tener suscrito el calendario de festivos del país,
 * y elegirlo produciría un fallo en cada cita durante meses sin que nadie
 * entendiera por qué.
 */
export async function listarCalendarios(input: {
  companyId: string
  conexionId: string
}): Promise<ResultadoCalendarios> {
  const token = await tokenDe(input.companyId, input.conexionId)
  if (!token.ok) return { ok: false, clase: 'AUTH', detalle: token.motivo }

  try {
    const resp = await fetch(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`, {
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) {
      const clase = claseDeGoogle(resp.status, await razonDe(resp))
      return { ok: false, clase, detalle: `Google respondió ${resp.status}` }
    }
    const json = (await resp.json()) as {
      items?: {
        id?: string
        summary?: string
        primary?: boolean
        accessRole?: string
        timeZone?: string
      }[]
    }
    const calendarios = (json.items ?? [])
      .filter((c): c is { id: string } & typeof c => typeof c.id === 'string')
      .map((c) => ({
        id: c.id,
        nombre: c.summary ?? c.id,
        principal: c.primary === true,
        puedeEscribir: c.accessRole === 'owner' || c.accessRole === 'writer',
        zonaHoraria: c.timeZone ?? null,
      }))
      // El principal primero: es el que elige casi todo el mundo.
      .sort((a, b) => Number(b.principal) - Number(a.principal) || a.nombre.localeCompare(b.nombre))
    return { ok: true, calendarios }
  } catch (e) {
    return {
      ok: false,
      clase: claseDeFalloDeRed(),
      detalle: e instanceof Error ? e.message : 'no se pudo contactar con Google',
    }
  }
}

// ─── Validar ─────────────────────────────────────────────────────────────────

export interface ComprobacionValidacion {
  clave: string
  titulo: string
  ok: boolean
  /** Qué hacer si falló, dicho para quien administra un negocio. */
  detalle: string
}

export type ResultadoValidacion = {
  ok: boolean
  comprobaciones: ComprobacionValidacion[]
  clase?: ClaseError
}

const PERMISO_EVENTOS = 'https://www.googleapis.com/auth/calendar.events'

/**
 * VALIDAR LA CONEXIÓN SIN ESCRIBIR NADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE CREA UN EVENTO DE PRUEBA
 *
 * Era lo primero que se me ocurrió y es peor de lo que parece: un evento,
 * aunque se borre en el mismo segundo, DISPARA NOTIFICACIONES a los invitados
 * del calendario y puede saltar en los teléfonos del equipo del negocio antes
 * de que lo borremos. Y si la creación va bien y el borrado falla, queda
 * basura en la agenda de un cliente.
 *
 * Las cinco comprobaciones de abajo prueban lo mismo sin tocar nada. La quinta
 * —`accessRole` del calendario elegido— es la que de verdad importa: es la que
 * detecta AHORA lo que si no fallaría en la primera cita confirmada.
 */
export async function validarCalendario(input: {
  companyId: string
  conexionId: string
  calendarId: string
}): Promise<ResultadoValidacion> {
  const comprobaciones: ComprobacionValidacion[] = []

  // 1 y 2 · La credencial y su refresh, sin abrir el secreto.
  const meta = await metadatosCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'OAUTH_TOKENS',
  })
  comprobaciones.push({
    clave: 'credencial',
    titulo: 'Tu cuenta de Google está enlazada',
    ok: meta !== null,
    detalle: 'No encontramos el enlace con Google. Vuelve a conectar la cuenta.',
  })
  if (!meta) return { ok: false, comprobaciones, clase: 'AUTH' }

  comprobaciones.push({
    clave: 'refresco',
    titulo: 'El enlace se puede renovar solo',
    ok: meta.tieneRefresh === true,
    detalle:
      'Google no nos dio permiso para renovar el acceso, así que caducaría en una hora. Vuelve a conectar la cuenta.',
  })

  // 3 · Los permisos CONCEDIDOS, que pueden ser menos que los pedidos si la
  //     persona desmarcó alguno en la pantalla de Google.
  const concedidos = Array.isArray(meta.scopes) ? (meta.scopes as string[]) : []
  comprobaciones.push({
    clave: 'permisos',
    titulo: 'Nos diste permiso para crear eventos',
    ok: concedidos.length === 0 || concedidos.includes(PERMISO_EVENTOS),
    detalle:
      'Falta el permiso para crear eventos. Vuelve a conectar y acepta todas las casillas.',
  })

  // 4 y 5 · La lista responde, y el calendario elegido está en ella y admite
  //         escritura.
  const lista = await listarCalendarios({
    companyId: input.companyId,
    conexionId: input.conexionId,
  })
  comprobaciones.push({
    clave: 'lista',
    titulo: 'Podemos leer tus calendarios',
    ok: lista.ok,
    detalle: lista.ok ? '' : 'Google no respondió. Inténtalo de nuevo en unos minutos.',
  })
  if (!lista.ok) return { ok: false, comprobaciones, clase: lista.clase }

  const elegido = lista.calendarios.find((c) => c.id === input.calendarId)
  comprobaciones.push({
    clave: 'calendario',
    titulo: 'El calendario elegido sigue existiendo',
    ok: Boolean(elegido),
    detalle: 'Ese calendario ya no está en tu cuenta. Elige otro.',
  })
  comprobaciones.push({
    clave: 'escritura',
    titulo: 'Podemos crear eventos en ese calendario',
    ok: elegido?.puedeEscribir === true,
    detalle:
      'Solo puedes verlo, no escribir en él (pasa con los calendarios compartidos o de festivos). Elige uno tuyo.',
  })

  const fallo = comprobaciones.find((c) => !c.ok)
  return {
    ok: !fallo,
    comprobaciones,
    clase: fallo ? (fallo.clave === 'escritura' ? 'CONFIGURATION' : 'PERMISSIONS') : undefined,
  }
}

// ─── Escribir ────────────────────────────────────────────────────────────────

/** Lo común a crear y borrar: la conexión viva, su calendario y un token. */
async function prepararEscritura(companyId: string) {
  const conexion = await conexionCalendario(companyId)
  if (!conexion) return { ok: false as const, motivo: 'sin_conexion' as const }

  const calendarId = conexion.config.calendarId
  if (typeof calendarId !== 'string' || !calendarId) {
    return { ok: false as const, motivo: 'sin_configurar' as const }
  }

  const token = await tokenDe(companyId, conexion.id)
  if (!token.ok) return { ok: false as const, motivo: 'sin_token' as const, detalle: token.motivo }

  return { ok: true as const, conexion, calendarId, token: token.token }
}

/**
 * Crea el evento EN EL CALENDARIO ELEGIDO. Best-effort: devuelve el motivo en
 * vez de lanzar, porque quien llama está confirmando una cita y ESA operación
 * no puede fallar porque Google esté caído.
 *
 * Sin calendario elegido NO se escribe en «primary» por si acaso: el alta
 * quedó a medias y adivinar el destino es cómo un negocio acaba con sus citas
 * en la agenda personal de quien conectó la cuenta.
 *
 * IDEMPOTENTE: el id del evento sale de la cita (`cuerpoEvento`). Si ya
 * existía —un reintento, una confirmación repetida—, Google responde 409 y
 * aquí se lee como «hecho», devolviendo el mismo id.
 */
export async function crearEventoCalendario(input: {
  companyId: string
  /** La cita de la que es el evento: de ella sale su id en Google. */
  citaId: string
  evento: EventoCita
}): Promise<ResultadoEvento> {
  const prep = await prepararEscritura(input.companyId)
  if (!prep.ok) return prep

  // La casilla del alta desmarcada: la conexión está viva para otras cosas
  // (o lo estará), pero las citas confirmadas no se llevan.
  if (!sincronizaConfirmadas(prep.conexion.config)) {
    return { ok: false, motivo: 'desactivado' }
  }

  const eventoId = idEventoDeCita(input.citaId)

  try {
    const resp = await fetch(`${API}/calendars/${encodeURIComponent(prep.calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${prep.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpoEvento(input.citaId, input.evento)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (creacionYaHecha(resp.status)) {
      // Ya estaba en la agenda con nuestro id: es el resultado que se quería.
      await anotarSalud({
        companyId: input.companyId,
        conexionId: prep.conexion.id,
        resultado: { ok: true },
      })
      return { ok: true, eventoId }
    }

    if (!resp.ok) {
      const clase = claseDeGoogle(resp.status, await razonDe(resp))
      const detalle = `Google respondió ${resp.status}`
      await anotarSalud({
        companyId: input.companyId,
        conexionId: prep.conexion.id,
        resultado: { ok: false, error: detalle, clase },
      })
      return { ok: false, motivo: 'proveedor', detalle }
    }

    const json = (await resp.json().catch(() => ({}))) as { id?: string }
    await anotarSalud({
      companyId: input.companyId,
      conexionId: prep.conexion.id,
      resultado: { ok: true },
    })
    return { ok: true, eventoId: json.id ?? eventoId }
  } catch (e) {
    const detalle = e instanceof Error ? e.message : 'no se pudo contactar con Google'
    await anotarSalud({
      companyId: input.companyId,
      conexionId: prep.conexion.id,
      resultado: { ok: false, error: detalle, clase: claseDeFalloDeRed() },
    })
    return { ok: false, motivo: 'proveedor', detalle }
  }
}

/**
 * Borra el evento de una cita cancelada. Best-effort, como crear.
 *
 * `sendUpdates=none`: borrar un evento con invitados manda, por defecto, un
 * correo de «evento cancelado» desde la cuenta del negocio. La cancelación ya
 * se la contamos al cliente por MembeGo; Google no tiene que repetirla.
 *
 * 404 y 410 cuentan como hecho: el evento no está, que es lo que se quería.
 */
export type ResultadoBorrado =
  | { ok: true }
  | {
      ok: false
      motivo: 'sin_conexion' | 'sin_token' | 'sin_configurar' | 'proveedor'
      detalle?: string
    }

export async function eliminarEventoCalendario(input: {
  companyId: string
  eventoId: string
}): Promise<ResultadoBorrado> {
  const prep = await prepararEscritura(input.companyId)
  if (!prep.ok) return prep

  try {
    const resp = await fetch(
      `${API}/calendars/${encodeURIComponent(prep.calendarId)}/events/${encodeURIComponent(
        input.eventoId
      )}?sendUpdates=none`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${prep.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )

    if (!resp.ok && !borradoYaHecho(resp.status)) {
      const clase = claseDeGoogle(resp.status, await razonDe(resp))
      const detalle = `Google respondió ${resp.status}`
      await anotarSalud({
        companyId: input.companyId,
        conexionId: prep.conexion.id,
        resultado: { ok: false, error: detalle, clase },
      })
      return { ok: false, motivo: 'proveedor', detalle }
    }

    await anotarSalud({
      companyId: input.companyId,
      conexionId: prep.conexion.id,
      resultado: { ok: true },
    })
    return { ok: true }
  } catch (e) {
    const detalle = e instanceof Error ? e.message : 'no se pudo contactar con Google'
    await anotarSalud({
      companyId: input.companyId,
      conexionId: prep.conexion.id,
      resultado: { ok: false, error: detalle, clase: claseDeFalloDeRed() },
    })
    return { ok: false, motivo: 'proveedor', detalle }
  }
}

// Reexportado para que el asistente resuelva la configuración OAuth desde un
// solo sitio, sin volver a importar el registro de proveedores.
export { oauthGoogleCalendar }
