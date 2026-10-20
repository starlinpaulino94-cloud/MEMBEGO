import { useEffect, useState } from 'react'
import { AppState, Linking, Platform, Text, View } from 'react-native'
import { BellRing, Settings } from 'lucide-react-native'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import {
  activatePushNotifications,
  getPushPermissionState,
  type PushPermissionState,
} from '../../lib/push-notifications'
import { colors } from '../../theme/tokens'

export function PushNotificationActivation() {
  const [permission, setPermission] = useState<PushPermissionState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getPushPermissionState().then(setPermission).catch(() => {
      setError('No pudimos consultar los permisos de notificación.')
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPushPermissionState().then(setPermission)
    })
    return () => subscription.remove()
  }, [])

  if (Platform.OS === 'web') return null

  async function enableNotifications() {
    setError(null)
    setLoading(true)
    try {
      const result = await activatePushNotifications()
      if (result === 'denied') {
        setPermission(await getPushPermissionState())
        setError('El permiso está desactivado. Puedes habilitarlo en los ajustes del dispositivo.')
      } else if (result === 'enabled') {
        setPermission({ granted: true, canAskAgain: true })
      }
    } catch {
      setError('No pudimos activar las notificaciones. Intenta de nuevo más tarde.')
    } finally {
      setLoading(false)
    }
  }

  const needsSettings = permission?.canAskAgain === false && !permission.granted

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-start gap-3">
        <View className="size-11 items-center justify-center rounded-full bg-primary/10">
          <BellRing size={20} color={colors.primary.DEFAULT} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-base font-inter-semibold text-foreground">
            {permission?.granted ? 'Notificaciones activadas' : 'Entérate al momento'}
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {permission?.granted
              ? 'Este dispositivo puede recibir avisos de tus beneficios y membresías.'
              : 'Recibe avisos importantes de tus beneficios y membresías en este dispositivo.'}
          </Text>
        </View>
      </View>

      {permission?.granted ? null : (
        <Button
          variant="primary"
          loading={loading}
          icon={needsSettings ? <Settings size={17} color={colors.surface.background} /> : undefined}
          onPress={() => {
            if (needsSettings) {
              void Linking.openSettings()
              return
            }
            void enableNotifications()
          }}
        >
          {needsSettings ? 'Abrir ajustes' : 'Activar notificaciones'}
        </Button>
      )}

      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </Card>
  )
}
