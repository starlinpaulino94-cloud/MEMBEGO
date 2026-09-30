import React from 'react'
import { ResponsiveDetailSheet } from '../../src/components/ui/ResponsiveDetailSheet'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Check, Sparkles } from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { usePlanes } from '../../src/hooks/usePlanes'
import { formatMoney } from '../../src/lib/format'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'

function PlanDetalleScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { planId } = useLocalSearchParams<{ planId: string }>()
  const { isAuthenticated } = useAuth()
  const showAsSheet = width >= 768 && router.canGoBack()
  const { data, isLoading, isError, refetch } = usePlanes({ todos: 1 }, isAuthenticated)
  const handleBack = () => {
    goBackOr(router, '/planes')
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <EmptyState
          icon={<Sparkles size={32} color="#0284c7" />}
          title="Inicia sesión para ver el plan"
          description="Necesitas una cuenta de cliente para consultar los detalles."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </View>
    )
  }

  const plan = data?.planes.find((item) => item.id === planId)

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border bg-background">
        <DetailPageFrame
          className="flex-row items-center gap-2 px-4"
          style={{ paddingTop: 8, paddingBottom: 8 }}
        >
          <Pressable onPress={handleBack} className="rounded-lg p-2" accessibilityLabel="Volver">
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
          <Text className="text-lg font-inter-bold text-foreground">Detalle del plan</Text>
        </DetailPageFrame>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0284c7" />
        </View>
      ) : isError ? (
        <View className="flex-1 justify-center p-6">
          <EmptyState
            icon={<Sparkles size={32} color="#0284c7" />}
            title="No pudimos cargar el plan"
            description="Revisa tu conexión e intenta de nuevo."
            action={<Button variant="outline" onPress={() => refetch()}>Reintentar</Button>}
          />
        </View>
      ) : !plan ? (
        <View className="flex-1 justify-center p-6">
          <EmptyState
            icon={<Sparkles size={32} color="#0284c7" />}
            title="Plan no encontrado"
            description="Este plan ya no está disponible."
            action={<Button variant="outline" onPress={() => router.replace('/planes')}>Ver planes</Button>}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <DetailPageFrame>
          <Card className="border-primary/30 bg-primary/[0.03] p-5">
            {'company' in plan && (
              <View className="mb-3 flex-row items-center gap-2">
                {plan.company.logoUrl ? (
                  <Image
                    source={{ uri: plan.company.logoUrl }}
                    accessibilityLabel={`Logo de ${plan.company.name}`}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <View className="h-8 w-8 rounded-full bg-primary/10" />
                )}
                <Text className="text-small font-inter-semibold text-muted-foreground">
                  {plan.company.name}
                </Text>
              </View>
            )}
            <Text className="text-overline font-inter-semibold text-primary">Membresía</Text>
            <Text className="mt-2 text-h1 font-inter-extrabold text-foreground">{plan.nombre}</Text>
            <View className="mt-4 flex-row items-baseline gap-2">
              <Text className="text-h1 font-inter-extrabold text-foreground">{formatMoney(plan.precio)}</Text>
              <Text className="text-small text-muted-foreground">/mes</Text>
            </View>
            <Text className="mt-1 text-caption text-muted-foreground">Vigencia de {plan.vigenciaDias} días</Text>
            {plan.lavadosIncluidos != null && (
              <Text className="mt-4 text-small font-inter-semibold text-foreground">
                {plan.esIlimitado ? 'Usos ilimitados' : `${plan.lavadosIncluidos} usos incluidos`}
              </Text>
            )}
          </Card>

          {plan.descripcion && (
            <Card className="mt-4">
              <Text className="text-h4 font-inter-bold text-foreground">Descripción</Text>
              <Text className="mt-2 text-small leading-5 text-muted-foreground">{plan.descripcion}</Text>
            </Card>
          )}

          <Card className="mt-4">
            <Text className="text-h4 font-inter-bold text-foreground">Incluye</Text>
            <View className="mt-3 gap-3">
              {plan.beneficios.map((beneficio) => (
                <View key={beneficio} className="flex-row items-start gap-2.5">
                  <Check size={17} color="#00864d" />
                  <Text className="flex-1 text-small text-foreground">{beneficio}</Text>
                </View>
              ))}
            </View>
          </Card>

          {!showAsSheet && (
            <Button className="mt-5" onPress={() => router.replace('/planes')}>
              Ver planes de todos los negocios
            </Button>
          )}
          </DetailPageFrame>
        </ScrollView>
      )}
    </View>
  )
}

export default function PlanDetalleScreen() {
  const router = useRouter()

  return (
    <ResponsiveDetailSheet
      footer={
        <Button className="w-full" onPress={() => router.replace('/planes')}>
          Ver planes de todos los negocios
        </Button>
      }
    >
      <PlanDetalleScreenContent />
    </ResponsiveDetailSheet>
  )
}
