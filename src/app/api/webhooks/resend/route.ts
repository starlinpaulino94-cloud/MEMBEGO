import { NextResponse } from 'next/server'
import { verificarFirmaSvix } from '@/lib/webhooks/svix'
import { procesarCorreoRecibido, type EventoCorreoRecibido } from '@/modules/soporte/entrante'

/**
 * WEBHOOK DE RESEND · correo entrante.
 *
 * Público por necesidad —Resend no puede llevar credenciales nuestras— y por
 * eso la firma es la ÚNICA puerta. Va antes que cualquier otra cosa: no se
 * parsea el JSON como objeto de confianza, no se toca la base y no se llama a
 * ninguna API hasta que la firma cuadra.
 *
 * La ruta está excluida del `matcher` del proxy en `src/proxy.ts`: si pasara
 * por el middleware de sesión, se la redirigiría a `/login` y Resend vería un
 * 307 en vez de un 200.
 *
 * SIEMPRE 200 CUANDO LA FIRMA ES VÁLIDA.
 *
 * Un correo que no podemos encajar —sin token, ticket borrado, empresa de
 * práctica— no es un fallo de Resend, y devolver 4xx/5xx haría que reintentara
 * durante horas un correo que nunca vamos a aceptar. Se responde 200 con el
 * motivo en el cuerpo, que queda visible en el panel de webhooks de Resend.
 *
 * La excepción es el fallo TRANSITORIO (la API de Resend no responde, la base
 * falla): ahí sí conviene el 500 para que el reintento sirva de algo.
 */

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  // Cuerpo CRUDO: la firma se calcula sobre los bytes exactos que llegaron.
  // Volver a serializar un objeto ya parseado cambiaría espacios y orden de
  // claves, y la firma no cuadraría nunca.
  const crudo = await request.text()

  const firma = verificarFirmaSvix(
    crudo,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    process.env.RESEND_WEBHOOK_SECRET,
    Math.floor(Date.now() / 1000)
  )
  if (!firma.valida) {
    console.warn('[webhook-resend] firma rechazada:', firma.motivo)
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }

  let evento: { type?: string; data?: EventoCorreoRecibido }
  try {
    evento = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  if (evento.type !== 'email.received') {
    // Otros tipos de evento (entregas, rebotes) todavía no se procesan aquí.
    return NextResponse.json({ ignorado: evento.type ?? 'sin tipo' })
  }
  if (!evento.data?.email_id) {
    return NextResponse.json({ ignorado: 'evento sin email_id' })
  }

  try {
    const res = await procesarCorreoRecibido(evento.data)
    if (!res.guardado) {
      console.warn('[webhook-resend] descartado:', res.motivo)
      return NextResponse.json({ guardado: false, motivo: res.motivo })
    }
    return NextResponse.json({ guardado: true, ticketId: res.ticketId })
  } catch (e) {
    console.error('[webhook-resend] error procesando:', e)
    // 500 a propósito: esto sí merece el reintento de Resend.
    return NextResponse.json({ error: 'error interno' }, { status: 500 })
  }
}
