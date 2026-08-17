import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { resolverTicketDeDestinatarios } from '@/lib/email/respuestas'

/**
 * CORREO ENTRANTE → MENSAJE DE TICKET (17-08-2026).
 *
 * Cierra el bucle que estaba roto: hasta hoy el soporte era de ida. El correo
 * de «nuevo ticket» salía hacia el buzón de la empresa y, si alguien le daba a
 * Responder, esa respuesta no llegaba a ninguna parte.
 *
 * QUÉ HACE FALTA SABER DEL WEBHOOK DE RESEND
 *
 * El evento `email.received` trae SOLO metadatos: remitente, destinatarios,
 * asunto e ids. **No trae el cuerpo ni los adjuntos** —es una decisión de
 * Resend para no reventar el límite de tamaño de petición de los entornos sin
 * servidor—, así que hay que pedirlos aparte con el `email_id`.
 */

/** Lo que usamos del evento. Se ignora todo lo demás a propósito. */
export interface EventoCorreoRecibido {
  email_id: string
  from?: string
  to?: string[]
  cc?: string[]
  received_for?: string[]
  subject?: string
}

export type ResultadoEntrante =
  | { guardado: true; ticketId: string }
  | { guardado: false; motivo: string }

/**
 * Descarga el cuerpo del correo.
 *
 * ⚠️ ESTA URL NO ESTÁ VERIFICADA CONTRA LA API REAL. El proxy del entorno donde
 * se escribió este archivo bloquea `resend.com`, así que la ruta viene de la
 * documentación de recepción y no de una llamada comprobada. Antes de dar el
 * módulo por bueno, confirma el endpoint en
 * https://resend.com/docs/api-reference/emails/retrieve-received-email
 * y ajusta SOLO esta función: todo lo demás es independiente de ella.
 *
 * Se puede sobreescribir con `RESEND_RECEIVING_URL` (con `{id}` como marcador)
 * para corregirlo sin desplegar código.
 */
export async function descargarCuerpo(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ text?: string; html?: string } | null> {
  const plantilla =
    process.env.RESEND_RECEIVING_URL ?? 'https://api.resend.com/emails/receiving/{id}'
  try {
    const res = await fetchImpl(plantilla.replace('{id}', encodeURIComponent(emailId)), {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.error('[correo-entrante] cuerpo', res.status, await res.text().catch(() => ''))
      return null
    }
    const cuerpo = (await res.json()) as { text?: string; html?: string }
    return cuerpo
  } catch (e) {
    console.error('[correo-entrante] cuerpo', e)
    return null
  }
}

/**
 * Convierte HTML a texto legible cuando el correo no trae versión de texto.
 * No pretende ser un conversor completo: quita `<style>`/`<script>` enteros,
 * convierte los saltos de bloque y limpia las etiquetas restantes. Lo que se
 * guarda es una conversación de soporte, no un documento.
 */
export function htmlATexto(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Recorta la parte citada de una respuesta.
 *
 * Sin esto, cada respuesta arrastra el hilo entero y el ticket se vuelve
 * ilegible a la tercera vuelta. Se cortan los separadores habituales de Gmail,
 * Outlook, Apple Mail y Zoho, y las líneas que empiezan por `>`.
 *
 * Es heurístico y se queda corto a propósito: **ante la duda, conserva texto**.
 * Perder el mensaje de alguien por recortar de más es peor que arrastrar una
 * cita de más.
 */
const CORTES = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{2,}\s*Mensaje original\s*-{2,}/im,
  /^_{10,}/m,
  /^On .+ wrote:$/m,
  /^El .+ escribió:$/m,
  /^De:\s.+$/m,
  /^From:\s.+$/m,
  /^Enviado desde mi /im,
]

export function quitarCita(texto: string): string {
  let corte = texto.length
  for (const re of CORTES) {
    const m = re.exec(texto)
    if (m && m.index < corte) corte = m.index
  }
  const cuerpo = texto
    .slice(0, corte)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .trim()
  // Si el recorte se lo comió todo, se devuelve el original: más vale una cita
  // de sobra que un mensaje vacío en el ticket.
  return cuerpo.length > 0 ? cuerpo : texto.trim()
}

/** Límite de lo que se guarda. Un correo con la firma corporativa y tres
 *  reenvíos puede pesar cientos de kB, y esto va a una columna de texto que se
 *  lee en pantalla. */
const MAX_CUERPO = 20_000

/**
 * Procesa un evento `email.received` ya verificado criptográficamente.
 *
 * La firma del webhook la comprueba quien llama (la ruta): aquí se da por
 * hecho que el evento viene de Resend. Lo que SÍ se comprueba aquí es que el
 * destinatario lleve un token de ticket válido — son dos cosas distintas y las
 * dos hacen falta.
 */
export async function procesarCorreoRecibido(
  evento: EventoCorreoRecibido,
  opciones: { apiKey?: string; fetchImpl?: typeof fetch } = {}
): Promise<ResultadoEntrante> {
  const destinatarios = [
    ...(evento.to ?? []),
    ...(evento.cc ?? []),
    ...(evento.received_for ?? []),
  ]
  const ticketId = resolverTicketDeDestinatarios(destinatarios)
  if (!ticketId) {
    return { guardado: false, motivo: 'sin dirección de respuesta válida' }
  }

  // Cross-tenant a propósito, y con envoltorio: el ticket se busca por su id y
  // la empresa se deriva de él. No hay usuario en sesión —esto lo dispara un
  // servidor de correo—, así que no existe una empresa "actual" con la que
  // acotar. Mismo patrón que `loadTicketForAdmin` en `actions.ts`.
  const ticket = await sinEmpresa(
    'correo entrante: buscar ticket por su token firmado (cross-tenant)',
    (tx) =>
      tx.supportTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, companyId: true, estado: true },
      })
  ).catch(() => null)
  if (!ticket) return { guardado: false, motivo: 'el ticket no existe' }

  const { esEmpresaDemo } = await import('@/modules/demo')
  if (await esEmpresaDemo(ticket.companyId)) {
    return { guardado: false, motivo: 'empresa de demostración' }
  }

  const apiKey = opciones.apiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) return { guardado: false, motivo: 'RESEND_API_KEY no configurada' }

  const cuerpo = await descargarCuerpo(evento.email_id, apiKey, opciones.fetchImpl)
  if (!cuerpo) return { guardado: false, motivo: 'no se pudo descargar el cuerpo' }

  const texto = cuerpo.text?.trim() || (cuerpo.html ? htmlATexto(cuerpo.html) : '')
  const limpio = quitarCita(texto).slice(0, MAX_CUERPO)
  if (!limpio) return { guardado: false, motivo: 'cuerpo vacío' }

  const remitente = evento.from?.trim() || 'Desconocido'

  await conEmpresa(ticket.companyId, (tx) =>
    Promise.all([
      tx.ticketMensaje.create({
        data: {
          ticketId: ticket.id,
          // Entra como CLIENTE: es una respuesta que llega de fuera del panel.
          // El nombre lleva el remitente real para que el admin vea de quién
          // vino sin tener que fiarse de él — el `From` de un correo es
          // falsificable; lo que autentica el mensaje es el token, no esto.
          autorTipo: 'CLIENTE',
          autorNombre: remitente,
          cuerpo: limpio,
        },
      }),
      // Un ticket cerrado que recibe respuesta vuelve a la bandeja: si no,
      // el mensaje entra y nadie lo ve nunca.
      tx.supportTicket.update({
        where: { id: ticket.id },
        data: { estado: ticket.estado === 'CERRADO' ? 'NUEVO' : 'EN_PROCESO' },
      }),
    ])
  )

  return { guardado: true, ticketId: ticket.id }
}
