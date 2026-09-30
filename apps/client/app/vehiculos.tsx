import React from 'react'
import { ResponsiveDetailSheet } from '../src/components/ui/ResponsiveDetailSheet'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Car, Plus, AlertCircle } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useVehiculos } from '../src/hooks/useVehiculos'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { EmptyState } from '../src/components/ui/EmptyState'
import { PageHeader } from '../src/components/ui/PageHeader'
import { Skeleton } from '../src/components/ui/Skeleton'
import { VehicleCard } from '../src/components/cliente/VehicleCard'

const DESCRIPCION =
  'Los que usas en tus visitas. El principal viene preseleccionado al comprar; ' +
  'el precio siempre sigue al vehículo que elijas.'

function VehiculosScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useVehiculos(!!user)

  // Auth gate
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo" style={{ paddingBottom: insets.bottom }}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!user) {
    return (
      <View className="flex-1 bg-vibe-fondo" style={{ paddingBottom: insets.bottom }}>
        <EmptyState
          icon={<Car size={40} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para ver tus vehículos."
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
    <View className="flex-1 bg-vibe-fondo">
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
            onPress={() => goBackOr(router, '/(tabs)/cuenta')}
            className="h-10 w-10 items-center justify-center rounded-xl border border-border bg-background active:opacity-70"
          >
            <ArrowLeft size={18} color="#111827" />
          </Pressable>
          <Text className="text-h2 font-inter-bold text-foreground">Mis vehículos</Text>
        </View>

        {/* Page header */}
        <PageHeader
          title="Mis vehículos"
          description={DESCRIPCION}
          action={
            data && data.vehiculos.length > 0 ? (
              <Button
                size="sm"
                onPress={() => router.push('/vehiculos/nuevo')}
                icon={<Plus size={16} color="#ffffff" />}
              >
                Añadir
              </Button>
            ) : undefined
          }
        />

        {/* Loading */}
        {isLoading && (
          <View className="gap-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <View className="flex-row items-start gap-3">
                  <Skeleton className="h-12 w-12 rounded-xl" />
                  <View className="flex-1 gap-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-24" />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Error */}
        {isError && (
          <EmptyState
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="No pudimos cargar tus vehículos"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={
              <Button variant="outline" onPress={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        )}

        {/* Empty */}
        {data && data.vehiculos.length === 0 && (
          <EmptyState
            icon={<Car size={40} color="#0284c7" />}
            title="Todavía no tienes vehículos"
            description="Añade el tuyo para que el mostrador lo reconozca al llegar y para asociarlo a tus membresías."
            action={
              <Button onPress={() => router.push('/vehiculos/nuevo')}>
                Añadir vehículo
              </Button>
            }
          />
        )}

        {/* List */}
        {data && data.vehiculos.length > 0 && (
          <View className="gap-3">
            {data.vehiculos.map((v) => (
              <VehicleCard key={v.id} vehiculo={v} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export default function VehiculosScreen() {
  return (
    <ResponsiveDetailSheet>
      <VehiculosScreenContent />
    </ResponsiveDetailSheet>
  )
}
