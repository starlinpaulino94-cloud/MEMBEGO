import React, { useState } from 'react'
import { Platform, ScrollView, Text, Pressable, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  ShieldCheck,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { resolveNotificationHref } from '../src/lib/notificacion-navegacion'
import {
  useMarcarNotificacionLeida,
  useMarcarTodasNotificacionesLeidas,
  useNotificaciones,
} from '../src/hooks/useNotificaciones'
import { BackHeader } from '../src/components/ui/BackHeader'
import { Button } from '../src/components/ui/Button'
import { EmptyState } from '../src/components/ui/EmptyState'
import { NotificationCard } from '../src/components/notificaciones/NotificationCard'
import { PushNotificationActivation } from '../src/components/notificaciones/PushNotificationActivation'
import { useNativePermissionsWizard } from '../src/components/permisos/NativePermissionsWizardProvider'
import {
  ResponsiveDetailSheet,
  useResponsiveDetailSheetBackgroundClass,
} from '../src/components/ui/ResponsiveDetailSheet'
import { Skeleton } from '../src/components/ui/Skeleton'
import { colors } from '../src/theme/tokens'

function NotificacionesScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const backgroundClass = useResponsiveDetailSheetBackgroundClass('bg-vibe-fondo')
  const { user, isAuthenticated, isCliente, isLoading: isAuthLoading } = useAuth()
  const { openWizard } = useNativePermissionsWizard()
  const userId = user?.id ?? null
  const { data, isLoading, isError, refetch } = useNotificaciones(
    userId,
    !isAuthLoading && isAuthenticated && isCliente,
  )
  const markOne = useMarcarNotificacionLeida(userId)
  const markAll = useMarcarTodasNotificacionesLeidas(userId)
  const [actionError, setActionError] = useState<string | null>(null)
  const noLeidas = data?.noLeidas ?? 0
  const notificationCount = data?.notificaciones.length ?? 0
  const maxContentWidth = width >= 1024 ? 900 : 720

  function openNotification(id: string, leida: boolean, href: string | null) {
    setActionError(null)
    const destination = resolveNotificationHref(href)
    if (!leida) {
      markOne.mutate(id, {
        onSuccess: () => {
          if (destination) router.push(destination)
        },
        onError: () => setActionError('No pudimos marcar la notificación como leída.'),
      })
      return
    }
    if (destination) router.push(destination)
  }

  function markAllAsRead() {
    setActionError(null)
    markAll.mutate(undefined, {
      onError: () => setActionError('No pudimos actualizar las notificaciones. Intenta de nuevo.'),
    })
  }

  return (
    <View className={backgroundClass + ' flex-1'}>
      <BackHeader
        title="Notificaciones"
        leftInset={insets.left}
        onBack={() => goBackOr(router, '/(tabs)/inicio')}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      >
        <View
          className="w-full self-center gap-5 px-4 py-5 md:px-6 md:py-7"
          style={{ maxWidth: maxContentWidth }}
        >
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-2xl font-inter-extrabold text-foreground">
                Tu actividad reciente
              </Text>
              <View className="shrink-0 rounded-full bg-primary/10 px-3 py-2">
                <Text className="text-xs font-inter-semibold text-primary">
                  {noLeidas} sin leer
                </Text>
              </View>
            </View>
            <Text className="text-sm leading-5 text-muted-foreground">
              Avisos sobre tus beneficios, membresías y actividad de cuenta.
            </Text>
            <Pressable
              onPress={() => router.push('/novedades')}
              className="min-h-11 flex-row items-center self-start gap-1 rounded-lg py-2 pr-2"
              accessibilityRole="link"
            >
              <Text className="text-sm font-inter-semibold text-primary">Explorar novedades</Text>
              <ArrowUpRight size={16} color={colors.primary.DEFAULT} />
            </Pressable>
          </View>

          {isAuthenticated && isCliente ? <PushNotificationActivation /> : null}

          {Platform.OS !== 'web' && isAuthenticated && isCliente ? (
            <Button
              variant="outline"
              onPress={openWizard}
              icon={<ShieldCheck size={17} color={colors.primary.DEFAULT} />}
            >
              Revisar permisos del dispositivo
            </Button>
          ) : null}

          {noLeidas > 0 ? (
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <Text className="text-sm text-muted-foreground">
                {notificationCount === 1
                  ? '1 notificación'
                  : notificationCount + ' notificaciones'}
              </Text>
              <Button
                variant="outline"
                size="sm"
                loading={markAll.isPending}
                onPress={markAllAsRead}
                icon={<CheckCheck size={16} color={colors.primary.DEFAULT} />}
              >
                Marcar todas leídas
              </Button>
            </View>
          ) : null}

          {actionError ? (
            <View className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
              <Text className="text-sm text-destructive">{actionError}</Text>
            </View>
          ) : null}

          {isAuthLoading ? (
            <View className="gap-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-24 w-full rounded-2xl" />
              ))}
            </View>
          ) : !isAuthenticated || !isCliente ? (
            <EmptyState
              icon={<AlertCircle size={36} color={colors.primary.DEFAULT} />}
              title="Inicia sesión como cliente"
              description="Accede a tu cuenta para consultar tus notificaciones."
              action={
                <Button onPress={() => router.push('/(auth)/login')}>
                  Iniciar sesión
                </Button>
              }
            />
          ) : isLoading ? (
            <View className="gap-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-24 w-full rounded-2xl" />
              ))}
            </View>
          ) : isError && !data ? (
            <EmptyState
              icon={<AlertCircle size={36} color={colors.state.danger} />}
              title="No pudimos cargar tus notificaciones"
              description="Revisa tu conexión e inténtalo de nuevo."
              action={
                <Button variant="outline" onPress={() => void refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : notificationCount === 0 ? (
            <EmptyState
              icon={<Bell size={36} color={colors.primary.DEFAULT} />}
              title="Todavía no tienes notificaciones"
              description="Aquí aparecerán los avisos importantes de tu cuenta."
              action={
                <Button variant="outline" onPress={() => router.push('/novedades')}>
                  Ver novedades
                </Button>
              }
            />
          ) : (
            <View className="gap-3">
              {data?.notificaciones.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onPress={() =>
                    openNotification(notification.id, notification.leida, notification.href)
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

export default function NotificacionesScreen() {
  return (
    <ResponsiveDetailSheet>
      <NotificacionesScreenContent />
    </ResponsiveDetailSheet>
  )
}
