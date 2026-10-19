import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { Platform } from 'react-native'
import { z } from 'zod'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { resolveNotificationHref } from '../../lib/notificacion-navegacion'
import { syncPushTokenIfGranted } from '../../lib/push-notifications'

const notificationDataSchema = z.object({
  notificationId: z.string().optional(),
  href: z.string().nullable().optional(),
}).passthrough()

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

export function PushNotificationManager() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user, isCliente, isLoading } = useAuth()

  useEffect(() => {
    if (Platform.OS === 'web' || isLoading || !user || !isCliente) return
    void syncPushTokenIfGranted().catch(() => {
      console.warn('[push] No se pudo sincronizar el dispositivo.')
    })
  }, [isCliente, isLoading, user?.id])

  useEffect(() => {
    if (Platform.OS === 'web') return
    const handledResponses = new Set<string>()

    function openResponse(response: Notifications.NotificationResponse) {
      const request = response.notification.request
      if (handledResponses.has(request.identifier)) return
      handledResponses.add(request.identifier)

      const parsed = notificationDataSchema.safeParse(request.content.data)
      const data = parsed.success ? parsed.data : null
      const destination = resolveNotificationHref(data?.href ?? null) ?? '/notificaciones'

      if (data?.notificationId) {
        void api.marcarNotificacionLeida(data.notificationId)
          .then(() => queryClient.invalidateQueries({ queryKey: ['cliente', 'notificaciones'] }))
          .catch(() => console.warn('[push] No se pudo actualizar el estado de la notificación.'))
      }

      router.push(destination)
      void Notifications.clearLastNotificationResponseAsync()
    }

    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ['cliente', 'notificaciones'] })
    })
    const response = Notifications.addNotificationResponseReceivedListener(openResponse)
    const lastResponse = Notifications.getLastNotificationResponse()
    if (lastResponse) openResponse(lastResponse)

    return () => {
      received.remove()
      response.remove()
    }
  }, [queryClient, router])

  return null
}
