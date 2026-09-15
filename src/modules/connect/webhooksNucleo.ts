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
 * FAMILIA de eventos: `automation.*` cubre todos los que empiecen por
 * `automation.`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UN COMODÍN
 *
 * Los avisos que manda una automatización se llaman `automation.<lo que la
 * regla decida>` (`estrategias/actionSink.ts`). Ese nombre lo inventa la propia
 * empresa al escribir la regla, así que NO se puede enumerar en una lista de
 * casillas: el día que alguien cree una regla nueva, su evento no estaría.
 *
 * Y sin comodín, el selector de eventos sería una trampa. Hasta ahora toda
 * suscripción tiene la lista vacía —o sea, TODO, automatizaciones incluidas—.
 * En cuanto alguien marcara «compras» para filtrar, sus avisos de
 * automatización dejarían de llegar sin que nadie se lo hubiera dicho, y sin un
 * solo error en ningún sitio. Un filtro que apaga en silencio algo que no
 * nombraste es peor que no tener filtro.
 */
export const COMODIN = '.*'

/** ¿Es esta entrada una familia (`automation.*`) y no un evento concreto? */
export function esFamilia(entrada: string): boolean {
  return entrada.endsWith(COMODIN)
}

/**
 * ¿Le toca este evento a esta suscripción?
 *
 * Una lista VACÍA significa «todos», y es deliberado: quien suscribe sin
 * elegir quiere enterarse de todo, y obligarle a enumerar eventos haría que
 * cada evento nuevo de MembeGo no le llegara hasta que se acordara de
 * añadirlo. Elegir explícitamente sigue disponible para quien quiera filtrar.
 *
 * Una entrada que termina en `.*` cubre su familia entera. El prefijo se
 * compara CON el punto (`automation.` y no `automation`) para que una familia
 * no se coma un evento que solo comparte el principio del nombre.
 */
export function suscripcionQuiere(eventos: readonly string[], evento: string): boolean {
  if (eventos.length === 0) return true
  return eventos.some((e) =>
    esFamilia(e) ? evento.startsWith(`${e.slice(0, -COMODIN.length)}.`) : e === evento
  )
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

// ── Rotación del secreto (A-7) ───────────────────────────────────────────────

/**
 * Los secretos con los que se firma una entrega: el vigente y, si hay una
 * rotación en curso, el que se está retirando.
 */
export interface SecretosDeFirma {
  secreto: string
  secretoAnterior: string | null
  secretoAnteriorHasta: Date | null
}

/**
 * Los secretos VIVOS ahora mismo, el vigente SIEMPRE el primero.
 *
 * El orden no es estético: la cabecera v1 no admite lista —su verificador hace
 * un único `timingSafeEqual`— y se firma con `secretos[0]`. Si el orden se
 * invirtiera, un receptor que siga en v1 se quedaría validando con el secreto
 * que se está retirando, y se le caería el día que venza el solape en vez del
 * día que le avisamos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SOLAPE SE ACABA SOLO
 *
 * Se compara contra el reloj en CADA envío, así que una rotación caducada deja
 * de firmar con el secreto viejo aunque nadie haya limpiado la fila. Si
 * dependiera de un trabajo que la borra, un trabajo que no corre dejaría el
 * secreto retirado firmando para siempre — o sea, lo contrario de rotar.
 *
 * Una fila a medias (secreto sin fecha, o fecha sin secreto) no revive nada:
 * hacen falta los dos.
 */
export function secretosVivos(s: SecretosDeFirma, ahora: Date = new Date()): string[] {
  // Las tres condiciones en un solo `if` y no en un booleano intermedio: así el
  // compilador ve que dentro `secretoAnterior` ya no puede ser null, y la
  // garantía queda en el tipo en vez de en un `!` que promete lo mismo sin que
  // nadie lo compruebe.
  if (
    s.secretoAnterior !== null &&
    s.secretoAnteriorHasta !== null &&
    s.secretoAnteriorHasta.getTime() > ahora.getTime()
  ) {
    return [s.secreto, s.secretoAnterior]
  }
  return [s.secreto]
}
