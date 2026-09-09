import { NextResponse, type NextRequest } from 'next/server'
import { anotarFallo } from '@/lib/prisma-errors'
import { firmaWebhookValida, respuestaDeVerificacion } from '@/modules/connect/metaNucleo'

export const dynamic = 'force-dynamic'

/**
 * WEBHOOK DE META (Connect · Fase 14; despacho en cola desde Meta · Fase 1).
 *
 * Una sola URL para los tres objetos —`whatsapp_business_account`, `page`,
 * `instagram`—: es por donde Meta avisa de que una empresa terminó el alta
 * (`account_update`), y por donde llegan los mensajes de sus clientes y los
 * estados de entrega de los nuestros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PÚBLICA, Y POR ESO NO SE FÍA DE NADA
 *
 * Meta llama sin sesión, así que lo único que separa un aviso legítimo de uno
 * inventado es la FIRMA. Se comprueba antes de mirar el contenido y sobre el
 * cuerpo CRUDO: parsearlo y volver a serializarlo rompería la firma de un
 * aviso bueno por una coma de diferencia.
 *
 * Sin `META_APP_SECRET` la ruta responde 404 y no 500: si la app de Meta no
 * está configurada aquí, este endpoint no existe para nadie.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA RUTA NO INTERPRETA NADA
 *
 * Firma, guarda cada item con su clave única, encola y responde 200. Meta
 * reintenta durante 36 horas cualquier cosa que no sea 2xx y no garantiza
 * orden ni ausencia de duplicados: el trabajo de verdad —a quién pertenece,
 * qué significa— ocurre fuera de la petición, en `webhookDispatcher`, sobre
 * un evento que ya es nuestro y se puede reprocesar desde la base.
 */

/** El apretón de manos de alta de la URL. */
export async function GET(req: NextRequest) {
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN ?? ''
  const res = respuestaDeVerificacion(req.nextUrl.searchParams, esperado)
  if (!res.ok) return new NextResponse('Forbidden', { status: 403 })
  // Meta exige el challenge en crudo, no envuelto en JSON.
  return new NextResponse(res.challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

export async function POST(req: NextRequest) {
  const secreto = process.env.META_APP_SECRET
  if (!secreto) return new NextResponse('Not found', { status: 404 })

  // El cuerpo CRUDO, y una sola vez: `req.text()` no se puede repetir.
  const crudo = await req.text()

  if (!firmaWebhookValida(crudo, req.headers.get('x-hub-signature-256'), secreto)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    // Firmado pero ilegible: se acepta para que Meta no reintente en bucle.
    // Devolver error aquí solo produciría más entregas iguales.
    return NextResponse.json({ ok: true })
  }

  // Guardar y encolar. Nunca lanza, y aunque algo fallara por dentro el 200
  // sale igual: lo que no se pudo guardar queda anotado, y Meta no arregla
  // nada reenviando lo mismo.
  const { recibirNotificacion } = await import('@/modules/connect/meta/webhookDispatcher')
  await recibirNotificacion(cuerpo).catch(anotarFallo('connect:webhook-meta'))

  return NextResponse.json({ ok: true })
}
