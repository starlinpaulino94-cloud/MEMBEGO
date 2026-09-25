import React from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, AlertCircle, Car } from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useVehiculoTipos } from '../../src/hooks/useVehiculos'
import { Button } from '../../src/components/ui/Button'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { AgregarVehiculoWizard } from '../../src/components/cliente/AgregarVehiculoWizard'

export default function NuevoVehiculoScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useVehiculoTipos(!!user)

  // Auth gate
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background" style={{ paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!user) {
    return (
      <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
        <EmptyState
          icon={<Car size={40} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para registrar un vehículo."
          action={
            <Button onPress={() => router.push('/(auth)/login')}>
              Iniciar Sesión
            </Button>
          }
        />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {/* Back bar */}
        <View className="mb-4 flex-row items-center gap-2">
          <Pressable
            onPress={() => goBackOr(router, '/vehiculos')}
            className="h-10 w-10 items-center justify-center rounded-xl border border-border bg-background active:opacity-70"
          >
            <ArrowLeft size={18} color="#111827" />
          </Pressable>
          <Text className="text-h2 font-inter-bold text-foreground">Registrar vehículo</Text>
        </View>

        {/* Loading tipos */}
        {isLoading && (
          <View className="flex-1 items-center justify-center py-12">
            <ActivityIndicator color="#0284c7" size="large" />
            <Text className="mt-3 text-small text-muted-foreground">
              Cargando categorías...
            </Text>
          </View>
        )}

        {/* Error tipos */}
        {isError && (
          <EmptyState
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="No pudimos cargar las categorías"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={
              <Button variant="outline" onPress={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        )}

        {/* No tipos disponibles */}
        {data && data.tipos.length === 0 && (
          <EmptyState
            icon={<Car size={40} color="#71717a" />}
            title="Sin categorías disponibles"
            description="El negocio aún no configuró sus categorías de vehículo. Inténtalo más tarde."
          />
        )}

        {/* Wizard */}
        {data && data.tipos.length > 0 && (
          <AgregarVehiculoWizard
            tipos={data.tipos}
          onSuccess={() => router.replace('/vehiculos')}
          />
        )}
      </ScrollView>
    </View>
  )
}
