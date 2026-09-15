import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Gift,
  CreditCard,
  Send,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useRegalos } from '../src/hooks/useRegalos'
import { formatMoney } from '../src/lib/format'
import { cn } from '../src/lib/cn'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { EmptyState } from '../src/components/ui/EmptyState'
import { PageHeader } from '../src/components/ui/PageHeader'
import type { RegaloItem, GiftCardItem } from '../src/lib/api'

/* ── Estado label helpers ─────────────────────────────────────────────── */

const ESTADO_GIFTCARD_LABEL: Record<string, string> = {
  PENDIENTE_PAGO: 'Pendiente de pago',
  ACTIVA: 'Activa',
  AGOTADA: 'Agotada',
  CANCELADA: 'Cancelada',
}

const ESTADO_REGALO_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
}

function badgeVariantRegalo(estado: string): 'warning' | 'success' | 'destructive' | 'secondary' {
  switch (estado) {
    case 'ACEPTADO': return 'success'
    case 'RECHAZADO':
    case 'CANCELADO':
    case 'EXPIRADO': return 'destructive'
    case 'PENDIENTE': return 'warning'
    default: return 'secondary'
  }
}

function badgeVariantGiftcard(estado: string): 'warning' | 'success' | 'destructive' | 'secondary' {
  switch (estado) {
    case 'ACTIVA': return 'success'
    case 'AGOTADA':
    case 'CANCELADA': return 'destructive'
    case 'PENDIENTE_PAGO': return 'warning'
    default: return 'secondary'
  }
}

/* ── Sub-components ───────────────────────────────────────────────────── */

function RegaloRow({ regalo, tipo }: { regalo: RegaloItem; tipo: 'recibido' | 'enviado' }) {
  const esRecibido = tipo === 'recibido'
  const contraparte = regalo.contraparte ?? 'Usuario'
  const titulo = esRecibido ? `De ${contraparte}` : `Para ${contraparte}`

  return (
    <Card className="mb-3">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Gift size={20} color="#0284c7" />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-sm font-inter-semibold text-foreground" numberOfLines={1}>
            {titulo}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
            {regalo.beneficio ?? `Transferencia · ${regalo.usos} uso(s)`}
            {regalo.mensaje ? ` · "${regalo.mensaje}"` : ''}
          </Text>
          <View className="mt-2 flex-row items-center gap-2">
            <Badge variant={badgeVariantRegalo(regalo.estado)}>
              {ESTADO_REGALO_LABEL[regalo.estado] ?? regalo.estado}
            </Badge>
            {regalo.expiraAt && regalo.estado === 'PENDIENTE' && (
              <Text className="text-xs text-muted-foreground">
                Expira pronto
              </Text>
            )}
          </View>
        </View>
      </View>
    </Card>
  )
}

function GiftCardRow({ gc }: { gc: GiftCardItem }) {
  const contraparte = gc.contraparte ?? '—'
  const titulo = gc.rol === 'RECIBIDA' ? `De ${contraparte}` : `Para ${contraparte}`

  return (
    <Card className="mb-3">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <CreditCard size={20} color="#0284c7" />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-sm font-inter-semibold text-foreground" numberOfLines={1}>
            {titulo} · {formatMoney(gc.monto)}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
            {gc.estado === 'ACTIVA'
              ? `Saldo ${formatMoney(gc.saldo)} · muestra el código al pagar`
              : gc.estado === 'PENDIENTE_PAGO' && gc.rol === 'COMPRADA'
                ? 'Paga citando el código para activarla'
                : (ESTADO_GIFTCARD_LABEL[gc.estado] ?? gc.estado)}
            {gc.mensaje ? ` · "${gc.mensaje}"` : ''}
          </Text>
        </View>
        {(gc.estado === 'ACTIVA' || (gc.estado === 'PENDIENTE_PAGO' && gc.rol === 'COMPRADA')) && (
          <View className="rounded-xl bg-muted px-3 py-1.5">
            <Text className="font-mono text-sm font-inter-bold tracking-widest text-foreground">
              {gc.codigo}
            </Text>
          </View>
        )}
        <Badge variant={badgeVariantGiftcard(gc.estado)}>
          {ESTADO_GIFTCARD_LABEL[gc.estado] ?? gc.estado}
        </Badge>
      </View>
    </Card>
  )
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

type TabKey = 'recibidos' | 'enviados' | 'giftcards'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recibidos', label: 'Recibidos' },
  { key: 'enviados', label: 'Enviados' },
  { key: 'giftcards', label: 'Gift cards' },
]

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function RegalosScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useRegalos(isAuthenticated)
  const [tab, setTab] = useState<TabKey>('recibidos')

  if (authLoading || isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background" style={{ paddingTop: insets.top }}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
        <EmptyState
          icon={<Gift size={32} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para ver tus regalos."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </ScrollView>
    )
  }

  if (isError) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
        <EmptyState
          icon={<AlertCircle size={32} color="#e7000b" />}
          title="No se pudieron cargar los regalos"
          description="Revisa tu conexión e intenta de nuevo."
          action={<Button variant="outline" onPress={() => refetch()}>Reintentar</Button>}
        />
      </ScrollView>
    )
  }

  const recibidos = data?.recibidos ?? []
  const enviados = data?.enviados ?? []
  const giftCards = data?.giftCards ?? []
  const isEmpty = recibidos.length === 0 && enviados.length === 0 && giftCards.length === 0

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
      <View className="px-4">
        {/* Header */}
        <PageHeader
          title="Regalos"
          description="Envía tus usos a tus amigos o acepta los que te enviaron."
        />

        {/* Action buttons */}
        <View className="flex-row flex-wrap gap-2 mb-6">
          <Button
            variant="outline"
            size="sm"
            icon={<CreditCard size={16} color="#0284c7" />}
            onPress={() => router.push('/regalos/giftcard')}
          >
            Gift card
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Gift size={16} color="#0284c7" />}
            onPress={() => router.push('/regalos/regalar')}
          >
            Regalar promo o membresía
          </Button>
          <Button
            variant="gradient"
            size="sm"
            icon={<Send size={16} color="#ffffff" />}
            onPress={() => router.push('/regalos/enviar')}
          >
            Transferir mis usos
          </Button>
        </View>

        {/* Empty state */}
        {isEmpty ? (
          <EmptyState
            icon={<Gift size={28} color="#0284c7" />}
            title="Aún no tienes regalos"
            description="Comparte tu @ID MembeGo (está en tu perfil) para recibir, o envía tus usos a un amigo."
          />
        ) : (
          <>
            {/* Tabs */}
            <View className="flex-row border-b border-border mb-4">
              {TABS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  className={cn(
                    'flex-1 items-center py-3 border-b-2',
                    tab === t.key ? 'border-primary' : 'border-transparent'
                  )}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.key }}
                >
                  <Text
                    className={cn(
                      'text-sm font-inter-medium',
                      tab === t.key ? 'text-primary font-inter-semibold' : 'text-muted-foreground'
                    )}
                  >
                    {t.label}
                    {t.key === 'recibidos' && recibidos.length > 0 && ` (${recibidos.length})`}
                    {t.key === 'enviados' && enviados.length > 0 && ` (${enviados.length})`}
                    {t.key === 'giftcards' && giftCards.length > 0 && ` (${giftCards.length})`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Tab content */}
            {tab === 'recibidos' && (
              recibidos.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={<Gift size={24} color="#71717a" />}
                  title="Sin regalos recibidos"
                  description="Cuando alguien te envíe un regalo, aparecerá aquí."
                />
              ) : (
                recibidos.map((r) => <RegaloRow key={r.id} regalo={r} tipo="recibido" />)
              )
            )}

            {tab === 'enviados' && (
              enviados.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={<Send size={24} color="#71717a" />}
                  title="Sin regalos enviados"
                  description="Cuando envíes un regalo a un amigo, aparecerá aquí."
                />
              ) : (
                enviados.map((r) => <RegaloRow key={r.id} regalo={r} tipo="enviado" />)
              )
            )}

            {tab === 'giftcards' && (
              giftCards.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={<CreditCard size={24} color="#71717a" />}
                  title="Sin gift cards"
                  description="Crea una gift card para regalar un monto libre."
                />
              ) : (
                giftCards.map((gc) => <GiftCardRow key={gc.id} gc={gc} />)
              )
            )}
          </>
        )}
      </View>
    </ScrollView>
  )
}
