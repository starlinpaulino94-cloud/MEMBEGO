import React from 'react'
import { ResponsiveDetailSheet } from '../src/components/ui/ResponsiveDetailSheet'
import { View, Text, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { AlertCircle, CreditCard } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useMembresias } from '../src/hooks/useMembresias'
import { Button } from '../src/components/ui/Button'
import { Skeleton } from '../src/components/ui/Skeleton'
import { EmptyState } from '../src/components/ui/EmptyState'
import { BackHeader } from '../src/components/ui/BackHeader'
import { WalletStack, type WalletStackItem } from '../src/components/wallet/WalletStack'

const ESTADO_LABEL: Record<string, string> = {
  ACTIVA: 'Activa',
  PENDIENTE: 'Esperando pago',
  PENDIENTE_PAGO: 'Esperando pago',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
}

interface ApiMembership {
  readonly id: string
  readonly companyName: string
  readonly companyLogoUrl?: string | null
  readonly companyColorPrimario?: string | null
  readonly planNombre: string
  readonly planEsIlimitado: boolean
  readonly planLavadosIncluidos?: number | null
  readonly estado: string
  readonly fechaVencimiento?: string | null
  readonly lavadosRestantes?: number | null
  readonly qrToken?: string | null
}

function getTone(
  estado: string,
  fechaVencimiento: string | null | undefined,
): 'active' | 'pending' | 'expired' {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    if (fechaVencimiento && new Date(fechaVencimiento) <= new Date()) return 'expired'
    return 'active'
  }
  if (upper.startsWith('PENDIENTE')) return 'pending'
  return 'expired'
}

function getExpiryText(fechaVencimiento: string | null | undefined): string | null {
  if (!fechaVencimiento) return null
  const days = Math.ceil((new Date(fechaVencimiento).getTime() - Date.now()) / 86_400_000)
  if (days > 0) return `Vence en ${days} día${days !== 1 ? 's' : ''}`
  if (days === 0) return 'Vence hoy'
  return `Venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? 's' : ''}`
}

function toWalletItem(membership: ApiMembership): WalletStackItem {
  const tone = getTone(membership.estado, membership.fechaVencimiento)
  const estadoLabel = tone === 'expired' && membership.estado.toUpperCase() === 'ACTIVA'
    ? 'Vencida'
    : ESTADO_LABEL[membership.estado] ?? membership.estado

  return {
    id: membership.id,
    card: {
      company: {
        name: membership.companyName,
        logoUrl: membership.companyLogoUrl ?? null,
        colorPrimario: membership.companyColorPrimario ?? null,
      },
      planNombre: membership.planNombre,
      estadoLabel,
      tone,
      expiryText: getExpiryText(membership.fechaVencimiento),
      esIlimitado: membership.planEsIlimitado,
      usosRestantes: membership.lavadosRestantes ?? 0,
      usosTotales: membership.planLavadosIncluidos ?? null,
    },
    qrToken: membership.qrToken ?? null,
    isActive: tone === 'active',
  }
}

function MisMembresiasScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError } = useMembresias(isAuthenticated)
  const memberships: readonly ApiMembership[] = data?.membresias ?? []
  const backHeader = (
    <BackHeader
      title="Mis membresías"
      leftInset={insets.left}
      onBack={() => goBackOr(router, '/(tabs)/cuenta')}
    />
  )

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CreditCard size={32} color="#0284c7" />
        </View>
        <Text className="mb-2 text-center text-xl font-inter-bold text-foreground">
          Inicia sesión para ver tus membresías
        </Text>
        <Text className="mb-6 max-w-xs text-center text-sm text-muted-foreground">
          Gestiona tus membresías activas y consulta tu historial de usos.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {backHeader}
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <View className="gap-4">
            <Skeleton className="h-[196px] rounded-[1.4rem]" />
            <Skeleton className="h-[196px] rounded-[1.4rem]" />
            <Skeleton className="h-[196px] rounded-[1.4rem]" />
          </View>
        </ScrollView>
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {backHeader}
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <EmptyState
            variant="card"
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="No pudimos cargar tus membresías"
            description="Hubo un problema al conectar con el servidor. Intenta de nuevo en unos momentos."
            action={
              <Button variant="outline" onPress={() => router.push('/mis-membresias')}>
                Reintentar
              </Button>
            }
          />
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-vibe-fondo">
      {backHeader}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-4 text-sm text-muted-foreground">
          Consulta tus beneficios, usos disponibles y códigos QR de cada plan.
        </Text>
        {memberships.length === 0 ? (
          <EmptyState
            variant="card"
            icon={<CreditCard size={40} color="#0284c7" />}
            title="Tu wallet está lista"
            description="Explora las empresas disponibles y activa tu primera membresía para empezar a disfrutar beneficios con tu QR."
            action={
              <View className="w-full gap-3">
                <Button onPress={() => router.push('/planes')}>Ver planes disponibles</Button>
                <Button variant="outline" onPress={() => router.push('/promociones')}>
                  Ver ofertas
                </Button>
              </View>
            }
          />
        ) : (
          <WalletStack
            items={memberships.map(toWalletItem)}
            onPressDetails={(id) => router.push(`/membresia/${id}`)}
          />
        )}
      </ScrollView>
    </View>
  )
}

export default function MisMembresiasScreen() {
  return (
    <ResponsiveDetailSheet>
      <MisMembresiasScreenContent />
    </ResponsiveDetailSheet>
  )
}
