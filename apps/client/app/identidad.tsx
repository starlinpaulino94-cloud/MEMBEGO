import React from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { ShieldCheck } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../src/lib/auth-context'
import { useIdentidadPanel } from '../src/hooks/useIdentidad'
import { BackHeader } from '../src/components/ui/BackHeader'
import { Button } from '../src/components/ui/Button'
import { EmptyState } from '../src/components/ui/EmptyState'
import { PanelIdentidadView } from '../src/components/identidad/PanelIdentidad'
import { goBackOr } from '../src/lib/navigation'
import { colors } from '../src/theme/tokens'

/**
 * VERIFICACIÓN DE IDENTIDAD (app). El servidor manda todo lo que se ve (estado, botón, textos, permisos);
 * esta pantalla solo lo pinta y abre la verificación hospedada en el navegador del sistema. Ver `PanelIdentidad`.
 */
export default function IdentidadScreen() {
  const router = useRouter()
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const panelQuery = useIdentidadPanel(isAuthenticated)

  if (authLoading || (isAuthenticated && panelQuery.isLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator size="large" color={colors.vibe.deep} />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-vibe-fondo p-4">
        <BackHeader title="Verificación de identidad" leftInset={0} onBack={() => goBackOr(router, '/ajustes')} />
        <EmptyState
          title="Inicia sesión para continuar"
          description="La verificación de identidad solo está disponible para tu cuenta."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </View>
    )
  }

  const panel = panelQuery.data
  return (
    <View className="flex-1 bg-vibe-fondo">
      <BackHeader title="Verificación de identidad" leftInset={0} onBack={() => goBackOr(router, '/ajustes')} />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        {panelQuery.isError && !panel ? (
          <EmptyState
            icon={<ShieldCheck size={34} color={colors.vibe.deep} />}
            title="No pudimos cargar tu verificación"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={<Button variant="outline" onPress={() => void panelQuery.refetch()}>Reintentar</Button>}
          />
        ) : !panel?.visible ? (
          <EmptyState
            icon={<ShieldCheck size={34} color={colors.vibe.deep} />}
            title="No disponible por ahora"
            description="La verificación de identidad todavía no está disponible. Te avisaremos cuando lo esté."
          />
        ) : (
          <PanelIdentidadView panel={panel} />
        )}
      </ScrollView>
    </View>
  )
}
