import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * DIRECCIONES DE RESPUESTA FIRMADAS (correo entrante · 17-08-2026).
 *
 * EL PROBLEMA QUE RESUELVEN
 *
 * Cuando llega un correo a nuestro dominio de recepción hay que decidir a qué
 * ticket pertenece. La respuesta ingenua es mirar el remitente y buscar su
 * ticket abierto. Es insegura: **cualquiera puede enviar un correo poniendo el
 * `From` que quiera**. Aceptar por remitente equivale a dejar que un
 * desconocido escriba en el ticket de otra persona.
 *
 * LA SOLUCIÓN
 *
 * El `Reply-To` de los correos que enviamos lleva el ticket dentro, firmado:
 *
 *     t-<ticketId>-<firma>@respuestas.membego.com
 *
 * La firma es un HMAC-SHA256 del id del ticket con un secreto que solo vive en
 * el servidor. Al recibir se recalcula y se compara en tiempo constante. Sin
 * firma válida, el correo se descarta. Un atacante necesitaría el secreto:
 * conocer el id del ticket no le sirve de nada.
 *
 * POR QUÉ HEXADECIMAL Y RECORTADA A 20
 *
 * La parte local de una dirección es sensible a mayúsculas según el RFC, pero
 * en la práctica hay sistemas de correo que la normalizan. Una firma en
 * base64url —que usa mayúsculas y minúsculas como símbolos distintos— se
 * rompería en cuanto un intermediario la tocara. En hexadecimal eso no puede
 * pasar: se compara siempre en minúsculas y el resultado es el mismo.
 *
 * 20 caracteres hex son 80 bits. Adivinar una firma a ciegas exige del orden de
 * 2^79 intentos, cada uno un correo entregado a nuestro servidor: no es una vía
 * practicable. La firma entera daría 64 caracteres y una dirección que parece
 * spam.
 *
 * SOBRE EL SUBDOMINIO
 *
 * `EMAIL_REPLY_DOMAIN` tiene que ser un SUBDOMINIO (p. ej.
 * `respuestas.membego.com`), nunca el dominio raíz. Recibir correo exige un
 * registro MX, y el MX de `membego.com` apunta a Zoho, que es el correo de la
 * empresa: cambiarlo la dejaría sin recibir su propio correo. El subdominio
 * recibe sin tocar nada de eso.
 */

/** Prefijo del buzón. Descarta de un vistazo lo que no es nuestro. */
const PREFIJO = 't-'
const LARGO_FIRMA = 20

/**
 * Firma sobre el id en minúsculas. Los `cuid` de Prisma ya lo son; hacerlo
 * explícito evita que la verificación dependa de que un intermediario haya
 * respetado o no las mayúsculas.
 */
function firmar(ticketId: string, secreto: string): string {
  return createHmac('sha256', secreto)
    .update(ticketId.toLowerCase())
    .digest('hex')
    .slice(0, LARGO_FIRMA)
}

function igualesSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Dirección de respuesta para un ticket, o `null` si falta configuración.
 *
 * El null es deliberado: sin dominio o sin secreto se envía el correo SIN
 * `Reply-To` en vez de poner una dirección que después no sabríamos verificar.
 * Mismo criterio que `sendEmail` sin `RESEND_API_KEY`: degradar, no reventar.
 */
export function crearDireccionRespuesta(
  ticketId: string,
  dominio = process.env.EMAIL_REPLY_DOMAIN,
  secreto = process.env.EMAIL_REPLY_SECRET
): string | null {
  if (!ticketId || !dominio || !secreto) return null
  return `${PREFIJO}${ticketId.toLowerCase()}-${firmar(ticketId, secreto)}@${dominio}`
}

/**
 * Extrae el id del ticket de UNA dirección, verificando la firma.
 * Devuelve null ante cualquier duda: prefijo raro, dominio ajeno, firma mala.
 */
export function resolverTicketDeDireccion(
  direccion: string,
  dominio = process.env.EMAIL_REPLY_DOMAIN,
  secreto = process.env.EMAIL_REPLY_SECRET
): string | null {
  if (!direccion || !dominio || !secreto) return null

  // Un destinatario puede venir como «Soporte <buzón@dominio>».
  const limpia = (direccion.match(/<([^>]+)>/)?.[1] ?? direccion).trim().toLowerCase()
  const arroba = limpia.lastIndexOf('@')
  if (arroba <= 0) return null
  const buzon = limpia.slice(0, arroba)
  const host = limpia.slice(arroba + 1)

  if (host !== dominio.toLowerCase()) return null
  if (!buzon.startsWith(PREFIJO)) return null

  // El id va entre el prefijo y el ÚLTIMO guion. Partir por el último es lo
  // correcto aunque algún día los ids lleven guiones dentro.
  const resto = buzon.slice(PREFIJO.length)
  const corte = resto.lastIndexOf('-')
  if (corte <= 0) return null
  const ticketId = resto.slice(0, corte)
  const firma = resto.slice(corte + 1)
  if (!ticketId || firma.length !== LARGO_FIRMA) return null

  return igualesSeguro(firma, firmar(ticketId, secreto)) ? ticketId : null
}

/**
 * Recorre todos los destinatarios de un correo entrante y devuelve el primer
 * ticket válido. Se miran `to`, `cc` y `received_for` porque un reenvío puede
 * dejar nuestra dirección en cualquiera de los tres.
 */
export function resolverTicketDeDestinatarios(
  destinatarios: readonly string[],
  dominio = process.env.EMAIL_REPLY_DOMAIN,
  secreto = process.env.EMAIL_REPLY_SECRET
): string | null {
  for (const d of destinatarios) {
    const id = resolverTicketDeDireccion(d, dominio, secreto)
    if (id) return id
  }
  return null
}
