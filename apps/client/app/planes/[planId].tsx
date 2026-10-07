import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Check, Sparkles } from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { usePlanes } from '../../src/hooks/usePlanes'
import { api } from '../../src/lib/api'
import { formatMoney } from '../../src/lib/format'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'
import { brandColor, brandDisplayForeground } from '../../src/lib/brand-color'
import { WalletCardPreview } from '../../src/components/wallet/WalletCardPreview'
import { colors } from '../../src/theme/tokens'

export default function PlanDetalleScreen() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-background')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const routeParams = useLocalSearchParams<{ planId: string | string[]; membershipId?: string | string[] }>()
  const planId = Array.isArray(routeParams.planId) ? routeParams.planId[0] : routeParams.planId
  const membershipId = Array.isArray(routeParams.membershipId)
    ? routeParams.membershipId[0]
    : routeParams.membershipId
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const showAsSheet = width >= 768 && router.canGoBack()
  const { data, isLoading, isError, refetch } = usePlanes(
    membershipId ? { membershipId } : { todos: 1 },
    isAuthenticated,
  )
  const [submitting, setSubmitting] = useState(false)
  const [solicitudEnviada, setSolicitudEnviada] = useState(false)
  const plan = data?.planes.find((item) => item.id === planId)
  const company = data?.modo === 'empresa'
    ? data.empresa
    : plan && 'company' in plan
      ? plan.company
      : undefined
  const currentMembership = data?.modo === 'empresa' ? data.cliente?.membership : null
  const accentColor = brandColor(company?.colorPrimario, colors.primary.DEFAULT)
  const accentForeground = brandDisplayForeground(accentColor, colors.primary.DEFAULT)
  const planColor = brandColor(plan?.color, accentColor)
  const priceForChange = plan && 'precioBase' in plan ? plan.precioBase ?? plan.precio : plan?.precio ?? 0
  const puedeCambiar = !!membershipId && !!currentMembership && plan?.id !== currentMembership.planId &&
    priceForChange > currentMembership.plan.precio
  const esCompra = !membershipId

  const handleBack = () => {
    goBackOr(router, membershipId ? `/planes?membershipId=${encodeURIComponent(membershipId)}` : '/planes')
  }

  const handleSolicitar = async () => {
    if (!plan) return
    setSubmitting(true)
    try {
      const result = membershipId
        ? await api.solicitarCambioPlan(membershipId, plan.id)
        : await api.solicitarMembresia({ planId: plan.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cliente', 'membresias'] }),
        queryClient.invalidateQueries({ queryKey: ['cliente', 'membresia-pago', result.membershipId] }),
      ])
      setSolicitudEnviada(true)
      router.push(`/membresia/${result.membershipId}`)
    } catch (error) {
      Alert.alert(
        membershipId ? 'No se pudo cambiar el plan' : 'No se pudo solicitar la membresía',
        error instanceof Error ? error.message : 'Intenta de nuevo en unos minutos.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const planesAction = plan && (esCompra || puedeCambiar) ? (
    <View className="gap-3">
      <Text className="text-small text-center leading-5 text-muted-foreground">
        Si la solicitud genera un pago pendiente, podrás completarlo con CardNET o las opciones disponibles desde el detalle de tu membresía.
      </Text>
      <Button className="w-full" style={{ backgroundColor: accentColor }} onPress={handleSolicitar} disabled={submitting || solicitudEnviada}>
        {submitting ? <ActivityIndicator size="small" color={accentForeground} /> : (
          <Text className="text-sm font-inter-semibold" style={{ color: accentForeground }}>
            {solicitudEnviada ? 'Solicitud enviada' : membershipId ? 'Cambiar a este plan' : 'Obtener membresía'}
          </Text>
        )}
      </Button>
    </View>
  ) : membershipId && currentMembership && plan ? (
    <View className="rounded-xl border border-border bg-card px-4 py-3">
      <Text className="text-small text-muted-foreground text-center">
        Para bajar de plan, contacta directamente a {company?.name ?? 'este negocio'}.
      </Text>
    </View>
  ) : null

  return (
    <ResponsiveDetailSheet
      footer={planesAction}
    >
      <View className={sheetBackgroundClass === 'bg-surface-card' ? 'flex-1 bg-surface-card' : 'flex-1 bg-background'}>
        <View className={sheetBackgroundClass === 'bg-surface-card' ? 'border-b border-border bg-surface-card' : 'border-b border-border bg-background'}>
          <DetailPageFrame
            className="flex-row items-center gap-2 px-4"
            style={{ paddingTop: (showAsSheet ? 0 : insets.top) + 8, paddingBottom: 8 }}
          >
            <Pressable onPress={handleBack} className="rounded-lg p-2" accessibilityLabel="Volver">
              <ArrowLeft size={20} color={colors.surface.foreground} />
            </Pressable>
            <Text className="text-lg font-inter-bold text-foreground">Detalle del plan</Text>
          </DetailPageFrame>
        </View>

        {!isAuthenticated ? (
          <View className="flex-1 items-center justify-center p-6">
            <EmptyState
              icon={<Sparkles size={32} color={colors.primary.DEFAULT} />}
              title="Inicia sesión para ver el plan"
              description="Necesitas una cuenta de cliente para consultar los detalles."
              action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
            />
          </View>
        ) : isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
          </View>
        ) : isError ? (
          <View className="flex-1 justify-center p-6">
            <EmptyState
              icon={<Sparkles size={32} color={colors.primary.DEFAULT} />}
              title="No pudimos cargar el plan"
              description="Revisa tu conexión e intenta de nuevo."
              action={<Button variant="outline" onPress={() => refetch()}>Reintentar</Button>}
            />
          </View>
        ) : !plan ? (
          <View className="flex-1 justify-center p-6">
            <EmptyState
              icon={<Sparkles size={32} color={colors.primary.DEFAULT} />}
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
              <WalletCardPreview
                data={{
                  company: {
                    name: company?.name ?? 'Membego',
                    logoUrl: company?.logoUrl ?? null,
                    color: accentColor,
                  },
                  plan: {
                    name: plan.nombre,
                    color: planColor,
                    price: formatMoney(plan.precio),
                    validityDays: plan.vigenciaDias,
                    includedUses: plan.esIlimitado ? 'Usos ilimitados' : `${plan.lavadosIncluidos ?? 0} usos`,
                  },
                }}
              />

              {plan.descripcion && (
                <Card className="mt-4 p-5">
                  <View className="flex-row items-center gap-2">
                    <View className="h-7 w-1 rounded-full" style={{ backgroundColor: accentColor }} />
                    <Text className="text-h4 font-inter-bold text-foreground">Descripción</Text>
                  </View>
                  <Text className="mt-3 text-small leading-5 text-muted-foreground">{plan.descripcion}</Text>
                </Card>
              )}

              <Card className="mt-4 p-5">
                <View className="flex-row items-center gap-2">
                  <View className="h-7 w-1 rounded-full" style={{ backgroundColor: accentColor }} />
                  <Text className="text-h4 font-inter-bold text-foreground">Incluye</Text>
                  <View className="ml-auto rounded-full px-2.5 py-1" style={{ backgroundColor: `${accentColor}16` }}>
                    <Text className="text-caption font-inter-semibold" style={{ color: accentColor }}>
                      {plan.beneficios.length}
                    </Text>
                  </View>
                </View>
                {plan.beneficios.length ? (
                  <View className="mt-4 gap-3">
                    {plan.beneficios.map((beneficio) => (
                      <View key={beneficio} className="flex-row items-start gap-2.5">
                        <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: `${accentColor}16` }}>
                          <Check size={13} color={accentColor} />
                        </View>
                        <Text className="flex-1 text-small text-foreground">{beneficio}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text className="mt-3 text-small text-muted-foreground">Este plan no tiene beneficios adicionales.</Text>
                )}
              </Card>

              {!showAsSheet && <View className="mt-5">{planesAction}</View>}
              <Pressable onPress={() => router.replace('/planes')} className="mt-4 items-center py-2">
                <Text className="text-small font-inter-semibold" style={{ color: accentColor }}>
                  Ver planes de todos los negocios
                </Text>
              </Pressable>
            </DetailPageFrame>
          </ScrollView>
        )}
      </View>
    </ResponsiveDetailSheet>
  )
}
