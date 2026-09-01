/**
 * NÚCLEO PURO de los webhooks salientes (Membego Connect · Fase 3).
 *
 * Sin Prisma ni red: aquí viven las dos decisiones que más caro salen si se
 * equivocan —a QUÉ URL se permite entregar y QUIÉN recibe cada evento— y las
 * dos se pueden probar.
 */

/** Motivos por los que una URL de destino no se acepta. */
export type MotivoUrl = 'vacia' | 'no_https' | 'malformada' | 'host_interno' | 'demasiado_larga'

const MAX_URL = 500

/**
 * Hosts a los que NUNCA se entrega, aunque la URL sea https.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES PARANOIA
 *
 * La URL la escribe quien integra, y nuestro servidor es quien hace la
 * petición. Sin este filtro, cualquier empresa podría suscribir un webhook a
 * `https://169.254.169.254/…` —el servicio de metadatos de la nube— y usarnos
 * como puente para leer credenciales de infraestructura desde dentro. Es la
 * familia de fallos SSRF, y el momento de cortarla es al guardar la
 * suscripción, no al entregar.
 *
 * Se comprueba por NOMBRE de host y por rango privado. No cubre todos los
 * casos posibles (un dominio público puede resolver a una IP interna), pero
 * corta los que se explotan de verdad sin resolver DNS en cada guardado.
 */
const HOSTS_PROHIBIDOS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
])

function esHostInterno(host: string): boolean {
  const h = host.toLowerCase()
  if (HOSTS_PROHIBIDOS.has(h)) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true
  // Rangos privados IPv4: 10/8, 192.168/16, 172.16–31/12 y el enlace local.
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  const m = /^172\.(\d{1,3})\./.exec(h)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true
  return false
}

export type ResultadoUrl = { ok: true; url: string } | { ok: false; motivo: MotivoUrl }

/** ¿Se puede entregar a esta URL? Normaliza y decide, sin resolver DNS. */
export function validarUrlWebhook(bruto: string | null | undefined): ResultadoUrl {
  const v = (bruto ?? '').trim()
  if (!v) return { ok: false, motivo: 'vacia' }
  if (v.length > MAX_URL) return { ok: false, motivo: 'demasiado_larga' }

  let u: URL
  try {
    u = new URL(v)
  } catch {
    return { ok: false, motivo: 'malformada' }
  }
  // http:// mandaría datos de clientes en claro por la red. No es negociable.
  if (u.protocol !== 'https:') return { ok: false, motivo: 'no_https' }
  if (esHostInterno(u.hostname)) return { ok: false, motivo: 'host_interno' }

  return { ok: true, url: u.toString() }
}

/** Explicación para quien integra. El motivo técnico no le sirve de nada. */
export const MENSAJE_URL: Record<MotivoUrl, string> = {
  vacia: 'Escribe la dirección a la que quieres que te avisemos.',
  no_https: 'La dirección debe empezar por https:// — por http los datos viajarían sin cifrar.',
  malformada: 'Esa dirección no es válida. Debe verse como https://tu-servidor.com/webhook',
  host_interno: 'No podemos entregar a direcciones internas o locales. Usa un dominio público.',
  demasiado_larga: 'La dirección es demasiado larga.',
}

/**
 * ¿Le toca este evento a esta suscripción?
 *
 * Una lista VACÍA significa «todos», y es deliberado: quien suscribe sin
 * elegir quiere enterarse de todo, y obligarle a enumerar eventos haría que
 * cada evento nuevo de MembeGo no le llegara hasta que se acordara de
 * añadirlo. Elegir explícitamente sigue disponible para quien quiera filtrar.
 */
export function suscripcionQuiere(eventos: readonly string[], evento: string): boolean {
  return eventos.length === 0 || eventos.includes(evento)
}

/**
 * Fallos consecutivos tras los que una suscripción se apaga sola.
 *
 * No es un número mágico: es «lleva más de un día entero sin recibir nada».
 * Seguir golpeando una URL muerta para siempre es maleducado con el receptor y
 * caro para nosotros, y el estado DISABLED —distinto de PAUSED— le dice a la
 * empresa que fue el sistema quien la apagó y que hay algo que mirar.
 */
export const FALLOS_PARA_APAGAR = 20
