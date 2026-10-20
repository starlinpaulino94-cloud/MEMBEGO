import React, { useCallback, useEffect, useState } from 'react'
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  MapPin,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { syncPushTokenIfGranted } from '../../lib/push-notifications'
import { colors } from '../../theme/tokens'

type PermissionState = {
  readonly granted: boolean
  readonly canAskAgain: boolean
}

interface WizardProps {
  readonly onFinish: () => void
}

export function NativePermissionsWizard({ onFinish }: WizardProps) {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState<0 | 1>(0)
  const [locationPermission, setLocationPermission] = useState<PermissionState | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<PermissionState | null>(null)
  const [checking, setChecking] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)

  const refreshPermissions = useCallback(async () => {
    setChecking(true)
    try {
      const [location, notifications] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
      ])
      setLocationPermission({ granted: location.granted, canAskAgain: location.canAskAgain })
      setNotificationPermission({ granted: notifications.granted, canAskAgain: notifications.canAskAgain })
      setError(null)
    } catch (permissionError: unknown) {
      setError(permissionError instanceof Error
        ? 'No pudimos consultar los permisos. Puedes volver a intentarlo.'
        : 'No pudimos consultar los permisos. Intenta de nuevo.')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshPermissions()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermissions()
    })
    return () => subscription.remove()
  }, [refreshPermissions])

  const currentPermission = step === 0 ? locationPermission : notificationPermission
  const granted = currentPermission?.granted ?? false
  const needsSettings = currentPermission !== null && !granted && !currentPermission.canAskAgain
  const title = step === 0 ? 'Ubicación mientras usas la app' : 'Notificaciones importantes'
  const description = step === 0
    ? 'La usamos para encontrar comercios y ofertas cerca de ti cuando abres Cerca de mí. No seguimos tu ubicación en segundo plano.'
    : 'Te avisamos sobre novedades relevantes de tus beneficios y membresías. Puedes seguir usando la app si prefieres no recibirlas.'

  function continueWizard() {
    if (step === 0) {
      setStep(1)
      setError(null)
      return
    }
    onFinish()
  }

  async function requestCurrentPermission() {
    if (checking || requesting) return
    setError(null)
    if (granted) {
      continueWizard()
      return
    }
    if (needsSettings) {
      try {
        await Linking.openSettings()
      } catch (settingsError: unknown) {
        setError(settingsError instanceof Error
          ? 'No pudimos abrir los ajustes del dispositivo.'
          : 'Abre los ajustes del dispositivo para cambiar este permiso.')
      }
      return
    }

    setRequesting(true)
    setSyncNotice(null)
    try {
      if (step === 0) {
        const result = await Location.requestForegroundPermissionsAsync()
        setLocationPermission({ granted: result.granted, canAskAgain: result.canAskAgain })
      } else {
        const result = await Notifications.requestPermissionsAsync()
        setNotificationPermission({ granted: result.granted, canAskAgain: result.canAskAgain })
        if (result.granted) {
          try {
            await syncPushTokenIfGranted()
          } catch (syncError: unknown) {
            setSyncNotice(syncError instanceof Error
              ? 'El permiso está activo; completaremos el registro de avisos cuando haya conexión.'
              : 'El permiso está activo; el registro de avisos se reintentará más tarde.')
          }
        }
      }
    } catch (permissionError: unknown) {
      setError(permissionError instanceof Error
        ? 'No pudimos solicitar este permiso. Intenta de nuevo.'
        : 'No pudimos solicitar este permiso. Revisa los ajustes del dispositivo.')
    } finally {
      setRequesting(false)
    }
  }

  const icon = step === 0
    ? <MapPin size={24} color={colors.primary.DEFAULT} />
    : <BellRing size={24} color={colors.primary.DEFAULT} />
  const primaryLabel = checking
    ? 'Consultando…'
    : needsSettings
      ? 'Abrir ajustes'
      : granted
        ? step === 0 ? 'Continuar' : 'Terminar'
        : step === 0 ? 'Permitir ubicación' : 'Permitir notificaciones'

  return (
    <View
      className="flex-1 bg-vibe-fondo"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="w-full flex-1 self-center px-5 py-5" style={{ maxWidth: 560 }}>
          <View className="mb-8 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <ShieldCheck size={20} color={colors.primary.DEFAULT} />
              <Text className="text-sm font-inter-semibold text-primary">Permisos del dispositivo</Text>
            </View>
            <Pressable
              className="size-11 items-center justify-center rounded-full bg-card"
              onPress={onFinish}
              accessibilityRole="button"
              accessibilityLabel="Configurar permisos después"
            >
              <X size={20} color={colors.surface.foreground} />
            </Pressable>
          </View>

          <View className="mb-6">
            <Text className="text-2xl font-inter-extrabold text-foreground">
              {step === 0 ? 'Tu experiencia, a tu manera' : 'Ya casi terminamos'}
            </Text>
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              Activa solo lo que te resulte útil. Puedes cambiar estos permisos después en los ajustes del teléfono.
            </Text>
          </View>

          <View className="mb-6 gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-inter-semibold text-foreground">Permiso {step + 1} de 2</Text>
              <Text className="text-sm font-inter-semibold text-primary">{step === 0 ? '50%' : '100%'}</Text>
            </View>
            <View className="h-2 overflow-hidden rounded-full bg-muted">
              <View className="h-full rounded-full bg-primary" style={{ width: step === 0 ? '50%' : '100%' }} />
            </View>
          </View>

          <Card className="gap-5 border-primary/20 p-5">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-2xl bg-primary/10">
                {icon}
              </View>
              <View className="flex-1 gap-1">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-base font-inter-semibold text-foreground">{title}</Text>
                  {granted ? (
                    <CheckCircle2 size={17} color={colors.state.success} />
                  ) : null}
                </View>
                <Text className="text-sm leading-5 text-muted-foreground">{description}</Text>
              </View>
            </View>

            <View className={granted
              ? 'rounded-xl border border-success/20 bg-success/5 px-3 py-2'
              : 'rounded-xl border border-border bg-muted/70 px-3 py-2'}>
              <Text className={granted
                ? 'text-sm font-inter-medium text-success'
                : 'text-sm font-inter-medium text-muted-foreground'}>
                {granted ? 'Permiso activado' : needsSettings ? 'Requiere ajustes del teléfono' : 'Todavía no activado'}
              </Text>
            </View>

            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            {syncNotice && step === 1 ? <Text className="text-sm text-muted-foreground">{syncNotice}</Text> : null}

            <Button
              variant="default"
              size="lg"
              loading={requesting || checking}
              disabled={checking}
              onPress={() => void requestCurrentPermission()}
              icon={needsSettings
                ? <Settings2 size={18} color={colors.surface.background} />
                : <ArrowRight size={18} color={colors.surface.background} />}
            >
              {primaryLabel}
            </Button>

            <Button
              variant="outline"
              onPress={() => {
                if (step === 0) {
                  setStep(1)
                  setError(null)
                  return
                }
                onFinish()
              }}
            >
              {step === 0 ? 'Continuar sin ubicación' : 'Terminar sin notificaciones'}
            </Button>
          </Card>

          <Text className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            Los comprobantes se adjuntan con el selector del sistema; MembeGo no necesita acceso amplio a tus fotos o archivos.
          </Text>
          <Pressable
            className="mt-auto min-h-11 items-center justify-center py-5"
            onPress={onFinish}
            accessibilityRole="button"
          >
            <Text className="text-sm text-muted-foreground underline">Configurar después</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}
