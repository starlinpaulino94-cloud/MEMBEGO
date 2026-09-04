/**
 * MENSAJERÍA · reglas puras (Meta · Fase 2). Sin red y sin base.
 *
 * Aquí se decide cómo se lee un mensaje o un estado de WhatsApp, cuándo la
 * ventana de servicio está abierta, cómo avanza el estado de un saliente y
 * qué cuerpo se manda a la Cloud API. Todo se prueba con cargas de ejemplo.
 */

export const CANALES = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM'] as const
export type Canal = (typeof CANALES)[number]

// ─── La ventana de servicio de 24 h ──────────────────────────────────────────

/**
 * Meta solo permite texto libre por WhatsApp si el cliente escribió al
 * negocio en las últimas 24 horas (error 131047 fuera de ella). Fuera de la
 * ventana, únicamente plantillas aprobadas.
 */
export const VENTANA_SERVICIO_MS = 24 * 60 * 60 * 1000

export function ventanaAbierta(ultimoEntranteAt: Date | null | undefined, ahora = Date.now()): boolean {
  if (!ultimoEntranteAt) return false
  return ahora - ultimoEntranteAt.getTime() < VENTANA_SERVICIO_MS
}

// ─── Lectura de un mensaje entrante de WhatsApp ──────────────────────────────

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Tipos con un medio adjunto identificado por `id` en la Cloud API. */
export const TIPOS_CON_MEDIO = ['image', 'audio', 'video', 'document', 'sticker'] as const

export interface MensajeEntranteWhatsapp {
  idExterno: string
  /** El wa_id del remitente (E.164 sin «+»). */
  de: string
  nombre: string | null
  tipo: string
  texto: string | null
  adjuntos: Record<string, unknown> | null
  contextoIdExterno: string | null
  timestamp: Date
}

/**
 * Lee el item `messages` que dejó el desglose del webhook
 * (`{ metadata, contacts, message }`). El texto sale de donde cada tipo lo
 * lleva; para los medios se guardan SOLO los identificadores (el binario se
 * descarga de Meta cuando hace falta; sus URLs caducan a los 5 minutos).
 * Lo que no se entiende se guarda con su tipo y sin texto: nunca se pierde.
 */
export function leerEntranteWhatsapp(payload: unknown): MensajeEntranteWhatsapp | null {
  if (!esObj(payload) || !esObj(payload.message)) return null
  const m = payload.message
  const id = texto(m.id)
  const de = texto(m.from)
  const tipo = texto(m.type) ?? 'unsupported'
  if (!id || !de) return null

  const ts = typeof m.timestamp === 'string' ? Number(m.timestamp) : typeof m.timestamp === 'number' ? m.timestamp : NaN
  const timestamp = Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date()

  const contactos = Array.isArray(payload.contacts) ? payload.contacts : []
  const contacto = contactos.find((c) => esObj(c) && c.wa_id === de) as Obj | undefined
  const nombre = contacto && esObj(contacto.profile) ? texto(contacto.profile.name) : null

  let cuerpo: string | null = null
  let adjuntos: Record<string, unknown> | null = null

  if (tipo === 'text' && esObj(m.text)) {
    cuerpo = texto(m.text.body)
  } else if (tipo === 'button' && esObj(m.button)) {
    cuerpo = texto(m.button.text)
    adjuntos = { payload: m.button.payload ?? null }
  } else if (tipo === 'interactive' && esObj(m.interactive)) {
    const i = m.interactive
    const r = esObj(i.button_reply) ? i.button_reply : esObj(i.list_reply) ? i.list_reply : null
    cuerpo = r ? texto(r.title) : null
    adjuntos = r ? { interactive: i.type ?? null, id: r.id ?? null } : null
  } else if (tipo === 'reaction' && esObj(m.reaction)) {
    cuerpo = texto(m.reaction.emoji)
    adjuntos = { reaccionA: m.reaction.message_id ?? null }
  } else if (tipo === 'location' && esObj(m.location)) {
    const l = m.location
    cuerpo = [texto(l.name), texto(l.address)].filter(Boolean).join(' · ') || null
    adjuntos = { latitude: l.latitude ?? null, longitude: l.longitude ?? null }
  } else if (tipo === 'contacts' && Array.isArray(m.contacts)) {
    adjuntos = { contacts: m.contacts }
  } else if ((TIPOS_CON_MEDIO as readonly string[]).includes(tipo) && esObj(m[tipo])) {
    // Solo identificadores y metadatos del medio; el `caption` es texto del cliente.
    const medio = m[tipo] as Obj
    cuerpo = texto(medio.caption)
    adjuntos = {
      medio: {
        tipo,
        id: medio.id ?? null,
        mime_type: medio.mime_type ?? null,
        filename: medio.filename ?? null,
        sha256: medio.sha256 ?? null,
      },
    }
  }

  const contexto = esObj(m.context) ? texto(m.context.id) : null

  return { idExterno: id, de, nombre, tipo, texto: cuerpo, adjuntos, contextoIdExterno: contexto, timestamp }
}

// ─── Lectura de un entrante de Messenger / Instagram ─────────────────────────

export interface MensajeEntranteMensajeria {
  idExterno: string
  /** PSID (Messenger) o IGSID (Instagram) del remitente. */
  de: string
  tipo: string
  texto: string | null
  adjuntos: Record<string, unknown> | null
  contextoIdExterno: string | null
  timestamp: Date
  /** Un eco de lo que enviamos nosotros: no es un entrante. */
  eco: boolean
}

/**
 * Lee un item `messaging` de la Messenger Platform (Messenger e Instagram
 * comparten formato): `sender.id`, `recipient.id`, `timestamp` (ms),
 * `message.mid`, `message.text`, `message.attachments[]`. De los adjuntos se
 * guarda lo que Meta manda (tipo y URL temporal), nunca el binario.
 */
export function leerEntranteMensajeria(payload: unknown): MensajeEntranteMensajeria | null {
  if (!esObj(payload) || !esObj(payload.message)) return null
  const m = payload.message
  const de = esObj(payload.sender) ? texto(payload.sender.id) : null
  const mid = texto(m.mid)
  if (!de || !mid) return null
  const ts = typeof payload.timestamp === 'number' ? payload.timestamp : typeof payload.timestamp === 'string' ? Number(payload.timestamp) : NaN
  const timestamp = Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date()
  const adjuntos = Array.isArray(m.attachments) && m.attachments.length > 0 ? m.attachments : null
  const primero = adjuntos && esObj(adjuntos[0]) ? texto((adjuntos[0] as Obj).type) : null
  const cuerpo = texto(m.text)
  return {
    idExterno: mid,
    de,
    tipo: cuerpo ? 'text' : (primero ?? 'unsupported'),
    texto: cuerpo,
    adjuntos: adjuntos ? { attachments: adjuntos } : null,
    contextoIdExterno: esObj(m.reply_to) ? texto(m.reply_to.mid) : null,
    timestamp,
    eco: m.is_echo === true,
  }
}

/** La vista previa de la lista: el texto, o el tipo entre corchetes. */
export function vistaPrevia(tipo: string, cuerpo: string | null): string {
  const t = (cuerpo ?? '').trim()
  if (t) return t.length > 120 ? `${t.slice(0, 119)}…` : t
  const etiqueta: Record<string, string> = {
    image: 'Imagen',
    audio: 'Audio',
    video: 'Vídeo',
    document: 'Documento',
    sticker: 'Sticker',
    location: 'Ubicación',
    contacts: 'Contacto',
    reaction: 'Reacción',
    template: 'Plantilla',
  }
  return `[${etiqueta[tipo] ?? 'Mensaje'}]`
}

// ─── Estados de los salientes ────────────────────────────────────────────────

export interface EstadoWhatsapp {
  idExterno: string
  /** sent | delivered | read | failed | deleted (Meta) */
  estadoMeta: string
  timestamp: Date | null
  errorCodigo: number | null
  errorDetalle: string | null
}

/** Lee el item `statuses` del desglose (`{ metadata, status }`). */
export function leerEstadoWhatsapp(payload: unknown): EstadoWhatsapp | null {
  if (!esObj(payload) || !esObj(payload.status)) return null
  const s = payload.status
  const id = texto(s.id)
  const estadoMeta = texto(s.status)
  if (!id || !estadoMeta) return null
  const ts = typeof s.timestamp === 'string' ? Number(s.timestamp) : typeof s.timestamp === 'number' ? s.timestamp : NaN
  const errores = Array.isArray(s.errors) ? s.errors : []
  const e = esObj(errores[0]) ? (errores[0] as Obj) : null
  return {
    idExterno: id,
    estadoMeta,
    timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : null,
    errorCodigo: e && typeof e.code === 'number' ? e.code : null,
    errorDetalle: e ? (texto(e.title) ?? texto(e.message)) : null,
  }
}

export const ESTADOS_SALIENTE = ['ENVIANDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO', 'ELIMINADO'] as const
export type EstadoSaliente = (typeof ESTADOS_SALIENTE)[number]

const DE_META: Record<string, EstadoSaliente> = {
  sent: 'ENVIADO',
  delivered: 'ENTREGADO',
  read: 'LEIDO',
  failed: 'FALLIDO',
  deleted: 'ELIMINADO',
}

export function estadoDesdeMeta(estadoMeta: string): EstadoSaliente | null {
  return DE_META[estadoMeta] ?? null
}

const ORDEN: Record<EstadoSaliente, number> = {
  ENVIANDO: 0,
  ENVIADO: 1,
  ENTREGADO: 2,
  LEIDO: 3,
  FALLIDO: 4,
  ELIMINADO: 4,
}

/**
 * Los estados llegan sin orden garantizado: un `read` puede adelantar a un
 * `delivered`. Solo se avanza; un estado anterior que llega tarde no
 * retrocede al mensaje. FALLIDO y ELIMINADO son terminales.
 */
export function avanzaEstado(actual: string, nuevo: EstadoSaliente): boolean {
  const a = ORDEN[actual as EstadoSaliente] ?? -1
  if (a >= 4) return false
  return ORDEN[nuevo] > a
}

// ─── Enlazar contactos con clientes ──────────────────────────────────────────

/**
 * Cómo puede estar escrito en `Cliente.telefono` el número que llega como
 * wa_id (E.164 sin «+»). `telefono` es texto libre: se buscan las formas más
 * habituales y, para números dominicanos, también sin el código de país.
 * Si ninguna coincide, el contacto queda sin enlazar — se enlaza a mano.
 */
export function candidatosTelefono(waId: string): string[] {
  const d = waId.replace(/\D/g, '')
  if (!d) return []
  const formas = new Set<string>([d, `+${d}`])
  const local = d.length === 11 && d.startsWith('1') && ['809', '829', '849'].includes(d.slice(1, 4)) ? d.slice(1) : null
  const diez = local ?? (d.length === 10 ? d : null)
  if (diez) {
    formas.add(diez)
    formas.add(`${diez.slice(0, 3)}-${diez.slice(3, 6)}-${diez.slice(6)}`)
    formas.add(`(${diez.slice(0, 3)}) ${diez.slice(3, 6)}-${diez.slice(6)}`)
    formas.add(`${diez.slice(0, 3)} ${diez.slice(3, 6)} ${diez.slice(6)}`)
    if (local) {
      formas.add(`1${diez}`)
      formas.add(`+1 ${diez.slice(0, 3)} ${diez.slice(3, 6)} ${diez.slice(6)}`)
      formas.add(`+1${diez}`)
    }
  }
  return [...formas]
}

// ─── Plantillas ──────────────────────────────────────────────────────────────

export interface PlantillaLeida {
  idExterno: string
  nombre: string
  idioma: string
  categoria: string
  estado: string
  componentes: unknown[]
  variables: number
}

/** Cuántos parámetros posicionales ({{1}}…{{n}}) lleva el BODY. */
export function variablesDelCuerpo(componentes: unknown[]): number {
  const body = componentes.find((c) => esObj(c) && c.type === 'BODY') as Obj | undefined
  const t = body ? texto(body.text) ?? '' : ''
  const n = new Set<string>()
  for (const m of t.matchAll(/\{\{(\d+)\}\}/g)) n.add(m[1])
  return n.size
}

/**
 * Lee `GET /{WABA_ID}/message_templates` (campos id, name, language, status,
 * category, components). Lo que no venga bien formado se salta: una
 * plantilla sin nombre no se puede enviar.
 */
export function leerPlantillasDeMeta(json: unknown): { plantillas: PlantillaLeida[]; siguiente: string | null } {
  const data = esObj(json) && Array.isArray(json.data) ? json.data : []
  const plantillas: PlantillaLeida[] = []
  for (const p of data) {
    if (!esObj(p)) continue
    const idExterno = texto(p.id)
    const nombre = texto(p.name)
    const idioma = texto(p.language)
    if (!idExterno || !nombre || !idioma) continue
    const componentes = Array.isArray(p.components) ? p.components : []
    plantillas.push({
      idExterno,
      nombre,
      idioma,
      categoria: texto(p.category) ?? 'UTILITY',
      estado: texto(p.status) ?? 'PENDING',
      componentes,
      variables: variablesDelCuerpo(componentes),
    })
  }
  const paging = esObj(json) && esObj(json.paging) ? json.paging : null
  const cursors = paging && esObj(paging.cursors) ? paging.cursors : null
  const siguiente = paging && texto(paging.next) && cursors ? texto(cursors.after) : null
  return { plantillas, siguiente }
}

// ─── Cuerpos hacia la Cloud API ──────────────────────────────────────────────

/** Marcar un entrante como leído (Cloud API · «Mark message as read»). */
export function cuerpoMarcarLeido(idExterno: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', status: 'read', message_id: idExterno }
}

/**
 * ⚠ VERIFICAR CONTRA LA COLECCIÓN DE POSTMAN ANTES DEL PRIMER ENVÍO REAL.
 *
 * El cuerpo de un mensaje de plantilla (type `template`, con `name`,
 * `language.code` y `components[].parameters[]` de tipo `text`) está escrito
 * según la estructura publicada de la Cloud API, pero la página oficial de
 * «Send message templates» no se pudo abrir durante la auditoría (error 500
 * del servidor) y por tanto NO está verificada línea a línea. Hasta
 * confirmarla, el envío de plantillas queda detrás de esta función y de su
 * prueba, que fija exactamente lo que se manda.
 */
export function cuerpoMensajePlantilla(
  paraE164: string,
  nombre: string,
  idioma: string,
  parametros: readonly string[]
): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: paraE164,
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma },
      components:
        parametros.length > 0
          ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) }]
          : [],
    },
  }
}
