/**
 * NÚCLEO PURO del conector de WhatsApp (Meta Cloud API · Fase 6).
 *
 * Sin red: el formato del número y la forma del mensaje se prueban aquí.
 */

/**
 * Normaliza un teléfono al formato que Meta espera: SOLO DÍGITOS, con código
 * de país y sin `+`, espacios ni guiones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CASO DOMINICANO, QUE ES EL 99 % DE LOS NÚMEROS DE ESTA BASE
 *
 * En República Dominicana la gente escribe su número como `809-555-1234` o
 * `(829) 555 1234`: diez dígitos, sin código de país, porque dentro del país
 * no hace falta. Meta rechaza eso — necesita `1` delante. Añadirlo cuando el
 * número tiene diez dígitos y empieza por un código de área dominicano
 * (809/829/849) es lo que hace que el envío funcione con los datos que ya
 * están guardados, en vez de exigir que alguien reescriba miles de fichas.
 *
 * Un número que ya trae código de país se deja como está: adivinar dos veces
 * produciría `11809…`, que no es de nadie.
 */
const AREAS_RD = new Set(['809', '829', '849'])

export function normalizarTelefonoWhatsapp(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '')
  if (!digitos) return null

  // Diez dígitos con área dominicana: le falta el 1 del código de país.
  if (digitos.length === 10 && AREAS_RD.has(digitos.slice(0, 3))) return `1${digitos}`

  // Once dígitos que ya empiezan por 1 y siguen con área dominicana: correcto.
  if (digitos.length === 11 && digitos.startsWith('1') && AREAS_RD.has(digitos.slice(1, 4))) {
    return digitos
  }

  // Cualquier otro: se acepta si tiene un largo plausible de E.164 (mínimo 8,
  // máximo 15 según la norma). Ni se adivina el país ni se rechaza a un
  // extranjero por no ser dominicano.
  if (digitos.length >= 8 && digitos.length <= 15) return digitos

  return null
}

/** Cuerpo del envío de texto simple (Cloud API · `/messages`). */
export function cuerpoMensajeTexto(paraE164: string, texto: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: paraE164,
    type: 'text',
    // `preview_url: false`: un enlace en el mensaje no debe generar una tarjeta
    // de vista previa que dispare peticiones desde el teléfono del cliente.
    text: { preview_url: false, body: texto },
  }
}

/** Largo máximo del cuerpo de un mensaje de texto en la Cloud API. */
export const MAX_TEXTO_WHATSAPP = 4096

export function recortarTexto(texto: string): string {
  const t = (texto ?? '').trim()
  return t.length <= MAX_TEXTO_WHATSAPP ? t : `${t.slice(0, MAX_TEXTO_WHATSAPP - 1)}…`
}

/** Lo que guardamos (cifrado) de la credencial de WhatsApp de una empresa. */
export interface CredencialWhatsapp {
  /** Token permanente del Usuario del Sistema, emitido por Meta. */
  token: string
  /** Id del número de teléfono en la Cloud API (no es el número en sí). */
  phoneNumberId: string
  /** El número visible, solo para enseñarlo en el panel. */
  numeroVisible?: string
}

export function esCredencialWhatsapp(v: unknown): v is CredencialWhatsapp {
  const c = v as CredencialWhatsapp | null
  return Boolean(c && typeof c.token === 'string' && c.token && typeof c.phoneNumberId === 'string' && c.phoneNumberId)
}
