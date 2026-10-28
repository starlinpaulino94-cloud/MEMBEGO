import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiClientUser } from '@/lib/auth/api-guard'
import { esDelMismoOrigen } from '@/lib/auth/mismo-origen'
import { sinEmpresa } from '@/lib/tenant'
import { webPushConfigurado } from '@/modules/notificaciones/web-push'

export const dynamic = 'force-dynamic'

/**
 * WEB PUSH · ALTA Y BAJA DE UN NAVEGADOR.
 *
 * `GET`    → si el servidor tiene claves VAPID y cuál es la pública (lo que
 *            `pushManager.subscribe` necesita). Es público: la clave pública
 *            viaja al navegador de todos modos.
 * `POST`   → guarda la suscripción del navegador para la persona con sesión.
 *            Cualquier rol: un administrador quiere enterarse de un pago igual
 *            que un cliente de una promoción.
 * `DELETE` → la retira (la persona apagó las notificaciones o cerró sesión).
 *            NO exige sesión: se llama desde la pantalla de entrada, adonde
 *            llega todo cierre de sesión, justo cuando ya no hay cookie. Basta
 *            el `endpoint`: es una URL de cientos de caracteres aleatorios que
 *            solo conoce el navegador dueño de la suscripción, así que tenerla
 *            ES ser ese navegador. Y como la fila se retira por endpoint sin
 *            mirar el dueño, un teléfono compartido deja de recibir los avisos
 *            de quien se fue aunque la cuenta siguiente sea otra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOLO DESDE NUESTRO PROPIO ORIGEN, Y POR QUÉ IMPORTA
 *
 * Esta ruta se usa con la cookie de sesión. Si aceptara peticiones de otro
 * sitio, una página ajena podría registrar SU endpoint push bajo la cuenta de
 * quien la visite y recibir los avisos de esa persona («tu pago fue aprobado»,
 * «tu membresía vence»…). Por eso no lleva cabeceras CORS —a diferencia de la
 * ruta de Expo, que la usa la app nativa— y las escrituras rechazan cualquier
 * `Origin` o `Sec-Fetch-Site` que no sea el nuestro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const suscripcionSchema = z.object({
  endpoint: z.string().trim().url().max(2048).refine((u) => u.startsWith('https://'), 'el endpoint debe ser https'),
  keys: z.object({
    p256dh: z.string().trim().min(80).max(120).regex(/^[A-Za-z0-9_-]+$/),
    auth: z.string().trim().min(16).max(32).regex(/^[A-Za-z0-9_-]+$/),
  }),
})

const bajaSchema = z.object({
  endpoint: z.string().trim().url().max(2048),
})

function sinSesion() {
  return NextResponse.json({ error: 'Inicia sesión para activar las notificaciones.' }, { status: 401 })
}

export async function GET() {
  return NextResponse.json(
    {
      configurado: webPushConfigurado(),
      clavePublica: webPushConfigurado() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? null : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  if (!esDelMismoOrigen(request)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 })
  }
  const user = await getApiClientUser(request)
  const userId = user?.metadata.dbUserId
  if (!user || !userId) return sinSesion()
  if (!webPushConfigurado()) {
    return NextResponse.json({ error: 'Las notificaciones push no están configuradas en este servidor.' }, { status: 503 })
  }

  const body = suscripcionSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'La suscripción del navegador no es válida.' }, { status: 400 })
  }

  const userAgent = request.headers.get('user-agent')?.slice(0, 200) ?? null
  try {
    await sinEmpresa('web push: registrar navegador de la persona', (tx) =>
      tx.webPushSuscripcion.upsert({
        where: { endpoint: body.data.endpoint },
        create: { userId, endpoint: body.data.endpoint, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth, userAgent },
        // Mismo navegador, otra cuenta (o claves nuevas): la fila cambia de
        // dueño en vez de duplicarse; así nadie recibe los avisos de otro.
        update: { userId, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth, userAgent },
      }),
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/v1/notificaciones/push-web] Error registrando navegador:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No pudimos activar las notificaciones en este dispositivo.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  if (!esDelMismoOrigen(request)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 })
  }

  const body = bajaSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'La suscripción del navegador no es válida.' }, { status: 400 })
  }

  try {
    await sinEmpresa('web push: retirar un navegador por su endpoint', (tx) =>
      tx.webPushSuscripcion.deleteMany({ where: { endpoint: body.data.endpoint } }),
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/v1/notificaciones/push-web] Error retirando navegador:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No pudimos desactivar las notificaciones en este dispositivo.' }, { status: 500 })
  }
}
