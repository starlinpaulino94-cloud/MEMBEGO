/**
 * Envío de correo best-effort. Si existe RESEND_API_KEY se envía vía la API HTTP
 * de Resend (sin dependencias extra, usando fetch). Si no está configurada, el
 * correo se registra en consola y la función devuelve `false` sin lanzar, de modo
 * que las notificaciones internas siguen funcionando aunque no haya proveedor.
 *
 * No se usa WhatsApp API en ningún caso (requisito del módulo de soporte).
 */

export interface EmailPayload {
  to: string
  subject: string
  html?: string
  text?: string
  /**
   * Empresa que origina el correo. Si es de DEMOSTRACIÓN, no se envía nada.
   *
   * La comprobación vive AQUÍ y no en cada quien llama, porque el que llama es
   * quien se olvida. Un correo de "tu membresía venció" saliendo de una empresa
   * de práctica hacia una persona real es confuso en el mejor caso.
   */
  companyId?: string | null
  /**
   * Dirección a la que debe ir la respuesta si alguien pulsa Responder.
   *
   * La generan `crearDireccionRespuesta` y compañía (`lib/email/respuestas.ts`)
   * y llevan el ticket firmado dentro, para que el correo entrante sepa a qué
   * conversación pertenece sin fiarse del remitente.
   */
  replyTo?: string | null
}

export interface EmailResult {
  sent: boolean
  reason?: string
  /**
   * El código HTTP del proveedor, cuando hubo respuesta.
   *
   * Lo añadió el bloque 5 del Slice 9 y es aditivo: quien ya llamaba a esto no
   * tiene que cambiar nada. Hace falta porque un aviso que sale por el outbox
   * necesita distinguir «falló y vale la pena reintentar» (5xx, corte de red)
   * de «falló y reintentar ocho veces es tirar el tiempo» (4xx). Sin el código,
   * la única forma de saberlo sería leer la frase de `reason`, y una frase no
   * es una interfaz.
   */
  status?: number
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (payload.companyId) {
    const { esEmpresaDemo } = await import('@/modules/demo')
    if (await esEmpresaDemo(payload.companyId)) {
      return { sent: false, reason: 'empresa de demostración: no se envían correos' }
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'MembeGo <onboarding@resend.dev>'

  if (!payload.to || !/.+@.+\..+/.test(payload.to)) {
    return { sent: false, reason: 'destinatario inválido' }
  }

  if (!apiKey) {
    console.warn('[email] (no RESEND_API_KEY) →', {
      to: payload.to,
      subject: payload.subject,
    })
    return { sent: false, reason: 'RESEND_API_KEY no configurada' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html ?? undefined,
        text: payload.text ?? (payload.html ? undefined : payload.subject),
        reply_to: payload.replyTo ?? undefined,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[email] Resend error', res.status, detail)
      return { sent: false, reason: `Resend ${res.status}`, status: res.status }
    }
    return { sent: true }
  } catch (e) {
    console.error('[email] error', e)
    return { sent: false, reason: e instanceof Error ? e.message : 'error' }
  }
}
