import React, { useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { CreditCard, Trophy, WalletCards, Gauge, CalendarClock, AlertCircle } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../src/lib/auth-context'
import { useMembresias } from '../src/hooks/useMembresias'
import { Button } from '../src/components/ui/Button'
import { Skeleton } from '../src/components/ui/Skeleton'
import { PageHeader } from '../src/components/ui/PageHeader'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { StatCard } from '../src/components/ui/StatCard'
import { EmptyState } from '../src/components/ui/EmptyState'
import { WalletStack, type WalletStackItem } from '../src/components/wallet/WalletStack'
import { cn } from '../src/lib/cn'

/** Ventana "por vencer" — misma que la web. */
const DIAS_POR_VENCER = 7

/** Mapeo estado → label cliente (espejo de `membresiaEstadoUi` en web). */
const ESTADO_LABEL: Record<string, string> = {
  ACTIVA: 'Activa',
  PENDIENTE: 'Esperando pago',
  PENDIENTE_PAGO: 'Esperando pago',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
}

interface ApiMembership {
  id: string
  companyName: string
  companyLogoUrl?: string | null
  companyColorPrimario?: string | null
  planNombre: string
  planEsIlimitado: boolean
  planLavadosIncluidos?: number | null
  estado: string
  fechaVencimiento?: string | null
  lavadosRestantes?: number | null
  qrToken?: string | null
}

function getTone(estado: string, fechaVencimiento: string | null | undefined): 'active' | 'pending' | 'expired' {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    if (fechaVencimiento) {
      const v = new Date(fechaVencimiento)
      if (v <= new Date()) return 'expired'
    }
    return 'active'
  }
  if (upper.startsWith('PENDIENTE')) return 'pending'
  return 'expired'
}

function getExpiryText(fechaVencimiento: string | null | undefined): string | null {
  if (!fechaVencimiento) return null
  const now = new Date()
  const v = new Date(fechaVencimiento)
  const dias = Math.ceil((v.getTime() - now.getTime()) / 86_400_000)
  if (dias > 0) return `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
  if (dias === 0) return 'Vence hoy'
  return `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`
}

function toWalletItem(m: ApiMembership): WalletStackItem {
  const tone = getTone(m.estado, m.fechaVencimiento)
  const isActive = tone === 'active'
  return {
    id: m.id,
    card: {
      company: {
        name: m.companyName,
        logoUrl: m.companyLogoUrl ?? null,
        colorPrimario: m.companyColorPrimario ?? null,
      },
      planNombre: m.planNombre,
      estadoLabel: ESTADO_LABEL[m.estado] ?? m.estado,
      tone,
      expiryText: getExpiryText(m.fechaVencimiento),
      esIlimitado: !!m.planEsIlimitado,
      usosRestantes: m.lavadosRestantes ?? 0,
      usosTotales: m.planLavadosIncluidos ?? null,
    },
    qrToken: m.qrToken ?? null,
    isActive,
  }
}

export default function MisMembresiasScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError } = useMembresias(isAuthenticated)

  // ── Derived data (hooks MUST be called unconditionally — no early returns above) ──
  const membresias: ApiMembership[] = data?.membresias ?? []
  const activas: ApiMembership[] = data?.activas ?? []
  const porVencer: ApiMembership[] = data?.porVencer ?? []
  const vencidas: ApiMembership[] = data?.vencidas ?? []
  const puntos: number | null = data?.puntos ?? null

  const totalActivas = activas.length + porVencer.length
  const usosDisponibles = useMemo(() => {
    const all = [...activas, ...porVencer]
    const tieneIlimitado = all.some((m) => m.planEsIlimitado)
    if (tieneIlimitado) return 'Ilimitados'
    return String(all.reduce((s, m) => s + (m.lavadosRestantes ?? 0), 0))
  }, [activas, porVencer])

  const proximoVencimiento = useMemo(() => {
    const all = [...activas, ...porVencer]
    const now = new Date()
    const fechas = all
      .map((m) => (m.fechaVencimiento ? new Date(m.fechaVencimiento) : null))
      .filter((d): d is Date => !!d && d > now)
      .sort((a, b) => a.getTime() - b.getTime())
    if (fechas.length === 0) return '—'
    const dias = Math.ceil((fechas[0].getTime() - now.getTime()) / 86_400_000)
    if (dias === 0) return 'Hoy'
    return `${dias} día${dias !== 1 ? 's' : ''}`
  }, [activas, porVencer])

  const diasProximo = useMemo(() => {
    const all = [...activas, ...porVencer]
    const now = new Date()
    const fechas = all
      .map((m) => (m.fechaVencimiento ? new Date(m.fechaVencimiento) : null))
      .filter((d): d is Date => !!d && d > now)
      .sort((a, b) => a.getTime() - b.getTime())
    if (fechas.length === 0) return null
    return Math.ceil((fechas[0].getTime() - now.getTime()) / 86_400_000)
  }, [activas, porVencer])

  const hasAny = membresias.length > 0

  // Points badge (action for PageHeader)
  const pointsBadge = puntos !== null ? (
    <View className="flex-row items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
      <Trophy size={16} color="#0284c7" />
      <Text className="text-sm font-inter-semibold text-foreground">
        {puntos.toLocaleString('es-DO')} pts
      </Text>
    </View>
  ) : undefined

  // ── Auth gate ──
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
          <CreditCard size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tus membresías
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Gestiona tus membresías activas y consulta tu historial de usos.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  // ── Loading ──
  if (isLoading) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8 }}
      >
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72 mb-6" />
        <View className="flex-row gap-3 mb-6">
          <Skeleton className="flex-1 h-[100px] rounded-2xl" />
          <Skeleton className="flex-1 h-[100px] rounded-2xl" />
          <Skeleton className="flex-1 h-[100px] rounded-2xl" />
        </View>
        <Skeleton className="h-[196px] rounded-[1.4rem] mb-4" />
        <Skeleton className="h-[196px] rounded-[1.4rem]" />
      </ScrollView>
    )
  }

  // ── Error ──
  if (isError) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8 }}
      >
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
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8 }}
    >
      {/* Header */}
      <PageHeader
        title="Mis membresías"
        description="Tus tarjetas y sus QR. Toca una para girarla y mostrar tu llave de acceso."
        action={pointsBadge}
      />

      {!hasAny ? (
        <EmptyState
          variant="card"
          icon={<CreditCard size={40} color="#0284c7" />}
          title="Tu wallet está lista"
          description="Explora las empresas disponibles y activa tu primera membresía para empezar a disfrutar beneficios con tu QR."
          action={
            <View className="gap-3 w-full">
              <Button onPress={() => router.push('/planes')}>
                Ver planes disponibles
              </Button>
              <Button variant="outline" onPress={() => router.push('/promociones')}>
                Ver ofertas
              </Button>
            </View>
          }
        />
      ) : (
        <View>
          {/* ── Stats ── */}
          <View className="gap-3 mb-8">
            <StatCard
              icon={<CreditCard size={20} color="#0284c7" />}
              accent="brand"
              label={`Tarjeta${membresias.length !== 1 ? 's' : ''} en total`}
              value={String(membresias.length)}
            />
            <StatCard
              icon={<WalletCards size={20} color="#0284c7" />}
              accent="success"
              label={`Membresía${totalActivas !== 1 ? 's' : ''} activa${totalActivas !== 1 ? 's' : ''}`}
              value={String(totalActivas)}
            />
            <StatCard
              icon={<Gauge size={20} color="#0284c7" />}
              accent="brand"
              label="Usos disponibles"
              value={usosDisponibles}
            />
            <StatCard
              icon={<CalendarClock size={20} color="#0284c7" />}
              accent={diasProximo !== null && diasProximo <= DIAS_POR_VENCER ? 'warning' : 'brand'}
              label="Próximo vencimiento"
              value={proximoVencimiento}
            />
          </View>

          {/* ── Por vencer ── */}
          {porVencer.length > 0 && (
            <View className="mb-8">
              <SectionHeader
                title="Por vencer"
                description={`Se ${porVencer.length === 1 ? 'agota' : 'agotan'} en los próximos ${DIAS_POR_VENCER} días. Renuévala${porVencer.length === 1 ? '' : 's'} para no quedarte sin beneficios.`}
              />
              <View className="mt-3">
                <WalletStack
                  items={porVencer.map(toWalletItem)}
                  onPressDetails={(id) => router.push(`/membresia/${id}`)}
                />
              </View>
            </View>
          )}

          {/* ── Activas ── */}
          {activas.length > 0 && (
            <View className="mb-8">
              {(porVencer.length > 0 || vencidas.length > 0) && (
                <SectionHeader title="Activas" />
              )}
              <View className={cn(porVencer.length > 0 || vencidas.length > 0 ? 'mt-3' : '')}>
                <WalletStack
                  items={activas.map(toWalletItem)}
                  onPressDetails={(id) => router.push(`/membresia/${id}`)}
                />
              </View>
            </View>
          )}

          {/* ── Vencidas ── */}
          {vencidas.length > 0 && (
            <View className="mb-8">
              <SectionHeader
                title="Vencidas"
                description="Ya no dan acceso. Puedes volver a activarlas desde su detalle."
              />
              <View className="mt-3">
                <WalletStack
                  items={vencidas.map(toWalletItem)}
                  onPressDetails={(id) => router.push(`/membresia/${id}`)}
                />
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  )
}
