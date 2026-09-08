import 'server-only'
import { pruebaDeSecreto, urlGraph, versionGraphDesdeEntorno } from '@/modules/connect/metaNucleo'
import {
  claseDeEstadoHttp,
  claseDeFalloDeRed,
  type ClaseError,
} from '@/modules/connect/proveedores/tipos'

/**
 * EL CLIENTE ÚNICO DE LA GRAPH API (Meta · Fase 1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNO SOLO
 *
 * Antes cada módulo armaba su `fetch` a `graph.facebook.com` con su propia
 * versión (v21 en el envío, v25 en el alta) y sin `appsecret_proof`. Tres
 * cosas que tienen que ser iguales en todas las llamadas viven aquí y solo
 * aquí:
 *
 *   · LA VERSIÓN: una, la de `META_GRAPH_VERSION`, para todo.
 *   · `appsecret_proof`: HMAC-SHA256 del token con el secreto de la app, en
 *     cada llamada que lleve token. Meta lo recomienda para todo lo que sale
 *     de un servidor y permite EXIGIRLO («Require App Secret»); con él, un
 *     token robado no sirve desde ningún otro sitio.
 *   · LO QUE SE LEE DE UN ERROR: estado, código, subcódigo, mensaje recortado
 *     y `x-fb-trace-id`. Nada más: en un cuerpo de error de Meta viajan
 *     teléfonos de clientes y, en un eco de autorización, el propio token.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NUNCA LANZA
 *
 * Devuelve `{ ok: false, respuesta }` con `status: 0` cuando no hubo
 * respuesta (red, tiempo). El `catch` no recibe la excepción a propósito: su
 * mensaje lleva la URL, y la URL lleva el token o el secreto.
 */

const TIMEOUT_MS = 10_000

export interface RespuestaGraph {
  /** 0 = no hubo respuesta (red o tiempo agotado). */
  status: number
  /** `x-fb-trace-id`: con esto Meta puede buscar la llamada. */
  requestId: string | null
  /** Mensaje corto y SANEADO (200 caracteres). Nunca el cuerpo entero. */
  mensaje: string
  codigo: number | null
  subcodigo: number | null
}

export type ResultadoGraph<T> =
  | { ok: true; datos: T; requestId: string | null }
  | { ok: false; respuesta: RespuestaGraph }

export async function leerErrorGraph(resp: Response): Promise<RespuestaGraph> {
  const requestId = resp.headers.get('x-fb-trace-id')
  try {
    const json = (await resp.json()) as {
      error?: { message?: string; code?: number; error_subcode?: number }
    }
    return {
      status: resp.status,
      requestId,
      mensaje: typeof json.error?.message === 'string' ? json.error.message.slice(0, 200) : '',
      codigo: typeof json.error?.code === 'number' ? json.error.code : null,
      subcodigo: typeof json.error?.error_subcode === 'number' ? json.error.error_subcode : null,
    }
  } catch {
    return { status: resp.status, requestId, mensaje: '', codigo: null, subcodigo: null }
  }
}

const SIN_RESPUESTA: RespuestaGraph = {
  status: 0,
  requestId: null,
  mensaje: 'red',
  codigo: null,
  subcodigo: null,
}

export async function llamarGraph<T = unknown>(input: {
  /** Ruta relativa a la versión: `/{id}/messages`, `/debug_token`… */
  ruta: string
  /** Token de usuario, de Página o de negocio. Va en `Authorization`. */
  token?: string
  metodo?: 'GET' | 'POST' | 'DELETE'
  cuerpo?: unknown
  query?: Record<string, string>
  version?: string
  timeoutMs?: number
}): Promise<ResultadoGraph<T>> {
  const version = input.version ?? versionGraphDesdeEntorno()
  const url = new URL(urlGraph(version, input.ruta))
  for (const [clave, valor] of Object.entries(input.query ?? {})) url.searchParams.set(clave, valor)

  const secreto = process.env.META_APP_SECRET
  if (input.token && secreto) {
    url.searchParams.set('appsecret_proof', pruebaDeSecreto(input.token, secreto))
  }

  const headers: Record<string, string> = {}
  if (input.token) headers.Authorization = `Bearer ${input.token}`
  if (input.cuerpo !== undefined) headers['Content-Type'] = 'application/json'

  try {
    const resp = await fetch(url, {
      method: input.metodo ?? 'GET',
      headers,
      body: input.cuerpo !== undefined ? JSON.stringify(input.cuerpo) : undefined,
      signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
    })
    if (!resp.ok) return { ok: false, respuesta: await leerErrorGraph(resp) }
    const datos = (await resp.json().catch(() => ({}))) as T
    return { ok: true, datos, requestId: resp.headers.get('x-fb-trace-id') }
  } catch {
    return { ok: false, respuesta: SIN_RESPUESTA }
  }
}

/**
 * DE UN ERROR DE META A UNA CLASE. Los códigos son los de la guía de errores
 * de la Graph API:
 *
 *   190           token caducado, revocado o inválido    → AUTH (reconectar)
 *   102           sesión inválida                         → AUTH
 *   10, 200–299   permiso que falta                       → PERMISSIONS
 *   4, 17         demasiadas llamadas (app, usuario)      → RATE_LIMIT
 *   368           bloqueo temporal por políticas: reintentar → RATE_LIMIT
 *
 * Solo los códigos que la guía documenta; ninguno más. Sin código, decide el
 * estado HTTP como en el resto de conectores.
 */
export function claseDeRespuestaGraph(r: RespuestaGraph): ClaseError {
  if (r.status === 0) return claseDeFalloDeRed()
  const c = r.codigo
  if (c === 190 || c === 102) return 'AUTH'
  if (c === 10 || (c !== null && c >= 200 && c <= 299)) return 'PERMISSIONS'
  if (c === 4 || c === 17 || c === 368 || r.status === 429) return 'RATE_LIMIT'
  return claseDeEstadoHttp(r.status)
}

/** El token de la APP (`{appId}|{secreto}`), para `debug_token`. */
export function tokenDeApp(): string | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim()
  const secreto = process.env.META_APP_SECRET?.trim()
  return appId && secreto ? `${appId}|${secreto}` : null
}
