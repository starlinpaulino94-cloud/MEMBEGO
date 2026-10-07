import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, Car, Check } from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useVehiculoTipos } from '../../src/hooks/useVehiculos'
import { Button } from '../../src/components/ui/Button'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { AgregarVehiculoWizard } from '../../src/components/cliente/AgregarVehiculoWizard'
import { BackHeader } from '../../src/components/ui/BackHeader'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'

function NuevoVehiculoScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-background')
  const { user, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useVehiculoTipos(!!user)
  const [empresaSeleccionadaId, setEmpresaSeleccionadaId] = useState<string | null>(null)
  const backHeader = (
    <BackHeader
      title="Registrar vehículo"
      leftInset={insets.left}
      safeAreaTop
      onBack={() => goBackOr(router, '/vehiculos')}
    />
  )
  const backgroundClass = sheetBackgroundClass === 'bg-surface-card' ? 'bg-surface-card' : 'bg-background'

  useEffect(() => {
    if (!data?.empresas.length) return
    setEmpresaSeleccionadaId((actual) => {
      if (actual && data.empresas.some((empresa) => empresa.id === actual)) return actual
      return data.empresas.find((empresa) => empresa.id === data.empresaActualId)?.id
        ?? data.empresas[0].id
    })
  }, [data])

  const empresaSeleccionada = data?.empresas.find((empresa) => empresa.id === empresaSeleccionadaId)

  // Auth gate
  if (authLoading) {
    return (
      <View className={`flex-1 ${backgroundClass}`}>
        {backHeader}
        <View className="flex-1 items-center justify-center" style={{ paddingBottom: insets.bottom }}>
          <ActivityIndicator color="#0284c7" size="large" />
        </View>
      </View>
    )
  }

  if (!user) {
    return (
      <View className={`flex-1 ${backgroundClass}`} style={{ paddingBottom: insets.bottom }}>
        {backHeader}
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
    <View className={`flex-1 ${backgroundClass}`}>
      {backHeader}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
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
        {data && data.empresas.length === 0 && (
          <EmptyState
            icon={<Car size={40} color="#71717a" />}
            title="Sin categorías disponibles"
            description="Los negocios asociados a tu cuenta todavía no tienen categorías de vehículo configuradas."
          />
        )}

        {data && data.empresas.length > 1 && (
          <View className="mb-4 gap-2">
            <Text className="text-sm font-inter-semibold text-foreground">
              ¿En qué negocio registrarás el vehículo?
            </Text>
            {data.empresas.map((empresa) => {
              const seleccionada = empresa.id === empresaSeleccionadaId
              return (
                <Pressable
                  key={empresa.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: seleccionada }}
                  onPress={() => setEmpresaSeleccionadaId(empresa.id)}
                  className={`flex-row items-center justify-between rounded-xl border px-4 py-3 ${
                    seleccionada ? 'border-primary bg-primary/5' : 'border-border bg-card'
                  }`}
                >
                  <View className="flex-1 gap-0.5">
                    <Text className="font-inter-semibold text-foreground">{empresa.nombre}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {empresa.tipos.length} {empresa.tipos.length === 1 ? 'categoría' : 'categorías'} disponibles
                    </Text>
                  </View>
                  {seleccionada ? <Check size={18} color="#7c3aed" /> : null}
                </Pressable>
              )
            })}
          </View>
        )}

        {data && data.empresas.length === 1 && empresaSeleccionada && (
          <View className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
            <Text className="text-xs text-muted-foreground">Negocio de registro</Text>
            <Text className="mt-1 font-inter-semibold text-foreground">
              {empresaSeleccionada.nombre}
            </Text>
          </View>
        )}

        {/* Wizard */}
        {empresaSeleccionada && (
          <AgregarVehiculoWizard
            key={empresaSeleccionada.id}
            companyId={empresaSeleccionada.id}
            tipos={empresaSeleccionada.tipos}
            onSuccess={() => router.replace('/vehiculos')}
          />
        )}
      </ScrollView>
    </View>
  )
}

export default function NuevoVehiculoScreen() {
  return (
    <ResponsiveDetailSheet>
      <NuevoVehiculoScreenContent />
    </ResponsiveDetailSheet>
  )
}
