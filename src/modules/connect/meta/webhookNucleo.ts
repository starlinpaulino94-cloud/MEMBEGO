import { createHash } from 'node:crypto'
import type { TipoActivo } from '@/modules/connect/meta/activos'

/**
 * DESGLOSE DE UNA NOTIFICACIÓN DE META · reglas puras (Fase 1).
 *
 * Meta manda UN cuerpo con muchas cosas dentro: varios `entry`, cada uno con
 * varios `changes` (Cloud API, Instagram) o `messaging` (Messenger,
 * Instagram), y dentro de un `change` de WhatsApp varios mensajes y estados.
 * Y reintenta durante 36 horas sin garantizar orden ni ausencia de
 * duplicados.
 *
 * Este archivo convierte ese cuerpo en ITEMS individuales, cada uno con:
 *
 *   · su CLAVE DE DEDUPLICACIÓN, estable: el id del mensaje o del estado
 *     cuando Meta lo da, y un hash del contenido cuando no. La base la hace
 *     UNIQUE, así que un reintento es inofensivo por construcción.
 *   · los CANDIDATOS A DUEÑO, en orden: para WhatsApp primero el número
 *     (`metadata.phone_number_id`) y después la cuenta (`entry.id`); para
 *     Messenger la Página; para Instagram la cuenta profesional.
 *   · el PAYLOAD del item, ya recortado a lo suyo: un mensaje no arrastra los
 *     otros veinte de su lote.
 *
 * Sin red y sin base: se prueba con cuerpos de ejemplo de la documentación.
 */

export const OBJETOS_META = ['whatsapp_business_account', 'page', 'instagram'] as const
export type ObjetoMeta = (typeof OBJETOS_META)[number]

export interface CandidatoDueno {
  tipo: TipoActivo
  idExterno: string
}

export interface ItemNotificacion {
  objeto: ObjetoMeta
  entryId: string
  /** `messages`, `statuses`, `account_update`, `message_deliveries`… */
  campo: string
  claveDedupe: string
  candidatos: CandidatoDueno[]
  payload: Record<string, unknown>
  /** El instante que Meta declara, si lo declara. */
  timestamp: Date | null
}

type Obj = Record<string, unknown>

function esObj(v: unknown): v is Obj {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Huella corta y estable de un fragmento, para los items sin id propio. */
export function huella(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(valor ?? null)).digest('hex').slice(0, 24)
}

/** Meta da segundos (WhatsApp) o milisegundos (Messenger). Se distinguen por tamaño. */
export function fechaDeMeta(v: unknown): Date | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n < 1e12 ? n * 1000 : n)
}

// ─── WhatsApp Cloud API ──────────────────────────────────────────────────────

function itemsDeWhatsapp(entryId: string, cambio: Obj): ItemNotificacion[] {
  const campo = texto(cambio.field) ?? 'desconocido'
  const value = esObj(cambio.value) ? cambio.value : {}
  const metadata = esObj(value.metadata) ? value.metadata : {}
  const phoneNumberId = texto(metadata.phone_number_id)

  const candidatos: CandidatoDueno[] = []
  if (phoneNumberId) candidatos.push({ tipo: 'PHONE_NUMBER', idExterno: phoneNumberId })
  candidatos.push({ tipo: 'WABA', idExterno: entryId })

  const items: ItemNotificacion[] = []

  if (campo === 'messages') {
    const contacts = Array.isArray(value.contacts) ? value.contacts : []
    for (const m of Array.isArray(value.messages) ? value.messages : []) {
      if (!esObj(m)) continue
      const id = texto(m.id)
      items.push({
        objeto: 'whatsapp_business_account',
        entryId,
        campo: 'messages',
        claveDedupe: id ? `wa:msg:${id}` : `wa:msg:${entryId}:${huella(m)}`,
        candidatos,
        payload: { metadata, contacts, message: m },
        timestamp: fechaDeMeta(m.timestamp),
      })
    }
    for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
      if (!esObj(s)) continue
      const id = texto(s.id)
      const estado = texto(s.status) ?? 'desconocido'
      items.push({
        objeto: 'whatsapp_business_account',
        entryId,
        campo: 'statuses',
        claveDedupe: id ? `wa:st:${id}:${estado}` : `wa:st:${entryId}:${huella(s)}`,
        candidatos,
        payload: { metadata, status: s },
        timestamp: fechaDeMeta(s.timestamp),
      })
    }
    for (const e of Array.isArray(value.errors) ? value.errors : []) {
      items.push({
        objeto: 'whatsapp_business_account',
        entryId,
        campo: 'errors',
        claveDedupe: `wa:err:${entryId}:${huella(e)}`,
        candidatos,
        payload: { metadata, error: e },
        timestamp: null,
      })
    }
    return items
  }

  // Cualquier otro campo (account_update, message_template_status_update,
  // phone_number_quality_update…): el `value` entero es el item.
  items.push({
    objeto: 'whatsapp_business_account',
    entryId,
    campo,
    claveDedupe: `wa:${campo}:${entryId}:${huella(value)}`,
    candidatos,
    payload: value,
    timestamp: null,
  })
  return items
}

// ─── Messenger e Instagram (formato `messaging`) ─────────────────────────────

function campoDeMensajeria(m: Obj): string {
  if (esObj(m.message)) return 'messages'
  if (esObj(m.delivery)) return 'message_deliveries'
  if (esObj(m.read)) return 'message_reads'
  if (esObj(m.postback)) return 'messaging_postbacks'
  if (esObj(m.reaction)) return 'message_reactions'
  return 'messaging_otro'
}

function claveDeMensajeria(prefijo: string, entryId: string, m: Obj, campo: string): string {
  const sender = esObj(m.sender) ? texto(m.sender.id) : null
  switch (campo) {
    case 'messages': {
      const mid = esObj(m.message) ? texto(m.message.mid) : null
      return mid ? `${prefijo}:msg:${mid}` : `${prefijo}:msg:${entryId}:${huella(m)}`
    }
    case 'message_deliveries': {
      const wm = esObj(m.delivery) ? m.delivery.watermark : null
      return `${prefijo}:dl:${entryId}:${sender ?? '-'}:${String(wm ?? huella(m))}`
    }
    case 'message_reads': {
      const wm = esObj(m.read) ? m.read.watermark : null
      return `${prefijo}:rd:${entryId}:${sender ?? '-'}:${String(wm ?? huella(m))}`
    }
    case 'messaging_postbacks':
      return `${prefijo}:pb:${entryId}:${sender ?? '-'}:${String(m.timestamp ?? huella(m))}`
    default:
      return `${prefijo}:${campo}:${entryId}:${huella(m)}`
  }
}

function itemsDeMensajeria(
  objeto: 'page' | 'instagram',
  entryId: string,
  entrada: Obj
): ItemNotificacion[] {
  const prefijo = objeto === 'page' ? 'fb' : 'ig'
  const candidatos: CandidatoDueno[] = [
    { tipo: objeto === 'page' ? 'PAGE' : 'IG_ACCOUNT', idExterno: entryId },
  ]
  const items: ItemNotificacion[] = []

  for (const m of Array.isArray(entrada.messaging) ? entrada.messaging : []) {
    if (!esObj(m)) continue
    const campo = campoDeMensajeria(m)
    items.push({
      objeto,
      entryId,
      campo,
      claveDedupe: claveDeMensajeria(prefijo, entryId, m, campo),
      candidatos,
      payload: m,
      timestamp: fechaDeMeta(m.timestamp),
    })
  }

  // `changes`: comentarios, menciones y demás campos no conversacionales.
  for (const c of Array.isArray(entrada.changes) ? entrada.changes : []) {
    if (!esObj(c)) continue
    const campo = texto(c.field) ?? 'desconocido'
    const value = esObj(c.value) ? c.value : {}
    const id = texto(value.id) ?? (esObj(value.comment_id) ? null : texto(value.comment_id))
    items.push({
      objeto,
      entryId,
      campo,
      claveDedupe: id
        ? `${prefijo}:${campo}:${id}`
        : `${prefijo}:${campo}:${entryId}:${huella(value)}`,
      candidatos,
      payload: value,
      timestamp: fechaDeMeta(entrada.time),
    })
  }

  return items
}

// ─── El desglose ─────────────────────────────────────────────────────────────

export function esObjetoMeta(v: unknown): v is ObjetoMeta {
  return typeof v === 'string' && (OBJETOS_META as readonly string[]).includes(v)
}

/**
 * De un cuerpo de Meta a items. Un cuerpo de otro objeto, o sin `entry`,
 * produce cero items — y eso es una respuesta válida (se confirma a Meta y
 * se sigue), no un error.
 */
export function desglosarNotificacion(cuerpo: unknown): ItemNotificacion[] {
  if (!esObj(cuerpo) || !esObjetoMeta(cuerpo.object)) return []
  const objeto = cuerpo.object
  const items: ItemNotificacion[] = []

  for (const entrada of Array.isArray(cuerpo.entry) ? cuerpo.entry : []) {
    if (!esObj(entrada)) continue
    const entryId = texto(entrada.id)
    if (!entryId) continue

    if (objeto === 'whatsapp_business_account') {
      for (const cambio of Array.isArray(entrada.changes) ? entrada.changes : []) {
        if (esObj(cambio)) items.push(...itemsDeWhatsapp(entryId, cambio))
      }
      continue
    }
    items.push(...itemsDeMensajeria(objeto, entryId, entrada))
  }
  return items
}

/**
 * Lo que de un item se puede ANOTAR en la bitácora: identificadores del
 * activo y del campo. Nunca el contenido — ahí viajan teléfonos y textos de
 * clientes finales.
 */
export function resumenAnotable(item: ItemNotificacion): Record<string, string> {
  return { objeto: item.objeto, entryId: item.entryId, campo: item.campo }
}
