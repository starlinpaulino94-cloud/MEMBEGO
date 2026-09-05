/**
 * NÚCLEO PURO de parsing de mensajes entrantes de WhatsApp (Meta Cloud API).
 *
 * Sin Prisma ni red: extrae la información relevante del payload que Meta
 * entrega al webhook, en una función pura y testeable.
 *
 * Estructura esperada de Meta:
 * {
 *   entry: [{
 *     id: string,                          // WABA ID
 *     changes: [{
 *       field: "messages",
 *       value: {
 *         messages: [{
 *           from: string,                  // teléfono del remitente
 *           id: string,                    // ID del mensaje
 *           timestamp: string,             // unix timestamp como string
 *           type: "text",
 *           text: { body: string }         // contenido del mensaje
 *         }]
 *       }
 *     }]
 *   }]
 * }
 */

export interface MensajeWhatsApp {
  from: string
  texto: string
  msgId: string
  timestamp: number
}

export interface ResultadoParseo {
  wabaId: string
  mensajes: MensajeWhatsApp[]
}

function str(val: unknown): string | undefined {
  return typeof val === 'string' && val.length > 0 ? val : undefined
}

function ts(val: unknown): number | undefined {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = Number(val)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Parsea el payload de un webhook de WhatsApp (Meta Cloud API) y extrae
 * los mensajes de texto con su metadata básica.
 *
 * @returns `ResultadoParseo` si hay al menos un mensaje válido, `null` si
 *          el payload está malformado, vacío o no contiene mensajes.
 */
export function parsearMensajeWhatsApp(entry: unknown): ResultadoParseo | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null

  const e = entry as Record<string, unknown>
  const wabaId = str(e.id)
  if (!wabaId) return null

  const changes = Array.isArray(e.changes) ? e.changes : []
  const mensajes: MensajeWhatsApp[] = []

  for (const cambio of changes) {
    if (typeof cambio !== 'object' || cambio === null) continue
    const c = cambio as Record<string, unknown>
    const value = c.value
    if (typeof value !== 'object' || value === null) continue

    const v = value as Record<string, unknown>
    const rawMsgs = Array.isArray(v.messages) ? v.messages : []

    for (const rm of rawMsgs) {
      if (typeof rm !== 'object' || rm === null) continue
      const m = rm as Record<string, unknown>

      const from = str(m.from)
      const msgId = str(m.id)
      const timestamp = ts(m.timestamp)
      if (!from || !msgId || timestamp === undefined) continue

      const text = m.text
      if (typeof text !== 'object' || text === null) continue
      const texto = str((text as Record<string, unknown>).body)
      if (!texto) continue

      mensajes.push({ from, texto, msgId, timestamp })
    }
  }

  if (mensajes.length === 0) return null

  return { wabaId, mensajes }
}

/**
 * Detecta si un mensaje de texto contiene intención de reservar excursiones/actividades.
 * Usa regex con word-boundary para evitar falsos positivos ("papel" no matchea "pase").
 */
const KEYWORDS_EXCURSION = /\b(?:reserva|tour|actividad|excursi\w*|parque|cat[aá]logo|pase|boletos?|tickets?|disponibilidad|precio|horarios?)\b/i

export function detectarIntencionExcursiones(texto: string): boolean {
  if (!texto || typeof texto !== 'string') return false
  return KEYWORDS_EXCURSION.test(texto)
}
