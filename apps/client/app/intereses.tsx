import React from 'react'
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sparkles, AlertCircle } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useIntereses } from '../src/hooks/useIntereses'
import { InteresesForm } from '../src/components/cliente/InteresesForm'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'

export default function InteresesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError, refetch } = useIntereses(isAuthenticated)

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <Sparkles size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesion para ver tus intereses
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Elige las categorias que te interesan y personaliza tus recomendaciones.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesion
        </Button>
      </View>
    )
  }

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    )
  }

  /* ── Error ─────────────────────────────────────────────────────────── */
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
          <AlertCircle size={32} color="#e7000b" />
        </View>
        <Text className="text-lg font-inter-bold text-foreground mb-2 text-center">
          No se pudieron cargar tus intereses
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Verifica tu conexion e intenta de nuevo.
        </Text>
        <Button onPress={() => refetch()}>Reintentar</Button>
      </View>
    )
  }

  const categorias = data?.categorias ?? []
  const seleccion = data?.seleccion ?? []

  return (
    <View className="flex-1 bg-background">
      {/* ── Barra con back + titulo ─────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 bg-background border-b border-border"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Button
          variant="outline"
          size="icon"
          onPress={() => goBackOr(router, '/(tabs)/cuenta')}
          className="h-9 w-9"
        >
          <Text className="text-sm font-inter-semibold text-foreground">←</Text>
        </Button>
        <Text className="text-lg font-inter-bold text-foreground">
          Tus intereses
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
          paddingTop: 24,
          paddingBottom: Math.max(insets.bottom, 32),
        }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <View className="flex-row items-center gap-2 mb-2">
          <Sparkles size={24} color="#0284c7" />
          <Text className="text-2xl font-inter-bold text-foreground">
            Tus intereses
          </Text>
        </View>
        <Text className="text-sm text-muted-foreground leading-relaxed mb-6">
          Elige las categorias que te interesan. Usaremos esto para recomendarte
          empresas y promociones que realmente te gusten.
        </Text>

        {/* ── Form card ───────────────────────────────────────────── */}
        <Card>
          <InteresesForm categories={categorias} selected={seleccion} />
        </Card>
      </ScrollView>
    </View>
  )
}
