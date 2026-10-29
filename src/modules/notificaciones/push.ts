import 'server-only'
import { z } from 'zod'
import { sinEmpresa } from '@/lib/tenant'
import { enviarWebPushNotificaciones } from './web-push'

export interface NotificacionPush {
  readonly id: string
  readonly userId: string
  readonly titulo: string
  readonly mensaje: string
  readonly href: string | null
}

const ticketSchema = z.object({
  status: z.enum(['ok', 'error']),
  details: z.object({ error: z.string().optional() }).optional(),
})

const responseSchema = z.object({ data: z.array(ticketSchema) })

interface ExpoMessage {
  readonly to: string
  readonly title: string
  readonly body: string
  readonly sound: 'default'
  readonly channelId: 'default'
  readonly data: {
    readonly notificationId: string
    readonly href: string
  }
}

/**
 * Un aviso recién creado sale por los DOS canales a la vez: la app nativa
 * (Expo, `push_tokens`) y el navegador (Web Push, `web_push_suscripciones`,
 * que es como llega a la PWA instalada mientras MembeGo no está en las
 * tiendas). Cada canal es fail-open por su cuenta; que uno falle no retiene al
 * otro, y ninguno de los dos retrasa a quien llamó más que una ida a la red.
 */
export async function enviarPushNotificaciones(
  notificaciones: readonly NotificacionPush[],
): Promise<void> {
  if (notificaciones.length === 0) return
  await Promise.all([enviarExpoPushNotificaciones(notificaciones), enviarWebPushNotificaciones(notificaciones)])
}

async function enviarExpoPushNotificaciones(notificaciones: readonly NotificacionPush[]): Promise<void> {
  try {
    const userIds = [...new Set(notificaciones.map((notification) => notification.userId))]
    const tokens = await sinEmpresa('push: buscar tokens de destinatarios', (tx) =>
      tx.pushToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true, userId: true },
      }),
    )
    if (tokens.length === 0) return

    const tokensByUser = new Map<string, string[]>()
    for (const token of tokens) {
      const current = tokensByUser.get(token.userId) ?? []
      current.push(token.token)
      tokensByUser.set(token.userId, current)
    }

    const messages: ExpoMessage[] = []
    for (const notification of notificaciones) {
      for (const token of tokensByUser.get(notification.userId) ?? []) {
        messages.push({
          to: token,
          title: notification.titulo,
          body: notification.mensaje,
          sound: 'default',
          channelId: 'default',
          data: {
            notificationId: notification.id,
            href: notification.href ?? '/notificaciones',
          },
        })
      }
    }

    for (let start = 0; start < messages.length; start += 100) {
      const batch = messages.slice(start, start + 100)
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) {
          console.error('[push] Expo rechazó el envío', { status: response.status })
          continue
        }

        const body: unknown = await response.json().catch(() => null)
        const parsed = responseSchema.safeParse(body)
        if (!parsed.success) {
          console.error('[push] Expo devolvió una respuesta inválida')
          continue
        }

        const invalidTokens = parsed.data.data.flatMap((ticket, index) =>
          ticket.details?.error === 'DeviceNotRegistered' && batch[index]
            ? [batch[index].to]
            : [],
        )
        if (invalidTokens.length > 0) {
          await sinEmpresa('push: retirar tokens de dispositivos no registrados', (tx) =>
            tx.pushToken.deleteMany({ where: { token: { in: invalidTokens } } }),
          )
        }
      } catch {
        console.error('[push] No se pudo contactar Expo Push Service')
      }
    }
  } catch {
    console.error('[push] No se pudieron preparar notificaciones push')
  }
}
