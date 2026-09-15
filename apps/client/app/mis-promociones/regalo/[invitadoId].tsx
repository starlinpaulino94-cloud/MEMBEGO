import React from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Gift,
  Ticket,
  CalendarDays,
  AlertCircle,
} from 'lucide-react-native'
import QRCode from 'react-native-qrcode-svg'
import { useAuth } from '../../../src/lib/auth-context'
import {
  useRegaloInvitado,
  useReclamarRegaloInvitado,
} from '../../../src/hooks/useMisPromociones'
import { formatDate } from '../../../src/lib/format'
import { Button } from '../../../src/components/ui/Button'
import { Card } from '../../../src/components/ui/Card'
import { Badge } from '../../../src/components/ui/Badge'
import { EmptyState } from '../../../src/components/ui/EmptyState'
import { Skeleton } from '../../../src/components/ui/Skeleton'

/**
 * Detalle de un regalo VIP recibido.
 *
 * El BFF aprovisiona el QR perezosamente al hacer GET (igual que la web).
 * Si el regalo no estaba reclamado, abrirlo lo completa.
 */
export default function RegaloInvitadoScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { invitadoId } = useLocalSearchParams<{ invitadoId: string }>()
  const { data, isLoading, isError, refetch } = useRegaloInvitado(invitadoId, isAuthenticated)
  const reclamar = useReclamarRegaloInvitado()

  /* ── Auth gate ────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <Gift size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tu regalo
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      {/* ── Back bar ─────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 bg-background border-b border-border"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          className="p-2 rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">Mi regalo</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      >
        {/* ── Content states ─────────────────────────────────────────── */}
        {isLoading ? (
          <View className="gap-4">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <Skeleton className="h-4 w-32 rounded-lg" />
            <Skeleton className="h-40 rounded-2xl" />
          </View>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar el regalo.
              </Text>
              <Button variant="outline" onPress={() => refetch()} className="mt-4">
                Reintentar
              </Button>
            </View>
          </Card>
        ) : !data ? (
          <EmptyState
            icon={<Gift size={40} color="#9ca3af" />}
            title="Regalo no encontrado"
            description="Es posible que ya no esté disponible o no te pertenezca."
            action={
              <Button onPress={() => router.push('/mis-promociones')}>
                Volver a mis beneficios
              </Button>
            }
          />
        ) : (
          <RegaloContent data={data} reclamar={reclamar} invitadoId={invitadoId ?? ''} />
        )}
      </ScrollView>
    </View>
  )
}

/* ── Contenido del regalo ───────────────────────────────────────────── */

function RegaloContent({
  data,
  reclamar,
  invitadoId,
}: {
  data: NonNullable<ReturnType<typeof useRegaloInvitado>['data']>
  reclamar: ReturnType<typeof useReclamarRegaloInvitado>
  invitadoId: string
}) {
  const router = useRouter()

  // Si no está reclamada, ofrecer reclamar
  if (!data.reclamadaAt && data.vigente) {
    return (
      <View className="items-center gap-5 py-6">
        <View className="h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
          <Gift size={40} color="#0284c7" />
        </View>
        <View className="items-center gap-2">
          <Text className="text-h2 font-inter-bold text-foreground text-center">
            {data.titulo}
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            Regalo de {data.empresa}
          </Text>
        </View>
        {data.descripcion && (
          <Text className="text-sm text-muted-foreground text-center">{data.descripcion}</Text>
        )}
        <Button
          onPress={() => reclamar.mutate(invitadoId)}
          disabled={reclamar.isPending}
          className="gap-2"
        >
          {reclamar.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-primary-foreground font-inter-bold">Reclamar regalo</Text>
          )}
        </Button>
      </View>
    )
  }

  return (
    <View className="gap-5">
      {/* ── Header del regalo ──────────────────────────────────────────── */}
      <Card className="border-primary/20 overflow-hidden">
        <View className="bg-primary/5 p-5 gap-2">
          <View className="flex-row items-center gap-1.5">
            <Gift size={14} color="#0284c7" />
            <Text className="text-xs font-inter-semibold uppercase tracking-wide text-primary">
              Regalo de {data.empresa}
            </Text>
          </View>
          <Text className="text-h2 font-inter-bold text-foreground">{data.titulo}</Text>
          {data.descripcion && (
            <Text className="text-sm text-muted-foreground">{data.descripcion}</Text>
          )}
        </View>

        <View className="p-5 gap-4">
          {/* ── Estado + usos ──────────────────────────────────────────── */}
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge variant={data.vigente ? 'success' : 'secondary'}>
              {data.vigente ? 'Activo' : 'No disponible'}
            </Badge>
            <Text className="text-sm text-muted-foreground">
              {data.restantes} de {data.usosPorPeriodo} usos {data.periodoLabel} disponibles
            </Text>
          </View>

          {/* ── Vigencia ───────────────────────────────────────────────── */}
          {data.vigenciaHasta && (
            <View className="flex-row items-center gap-1.5">
              <CalendarDays size={16} color="#71717a" />
              <Text className="text-sm text-muted-foreground">
                Válido hasta el {formatDate(data.vigenciaHasta)}
              </Text>
            </View>
          )}

          {/* ── QR para canjear ────────────────────────────────────────── */}
          {data.vigente && data.qrToken && data.restantes > 0 ? (
            <View className="rounded-2xl border border-success/25 bg-success/5 p-4 items-center gap-3">
              <View className="flex-row items-center gap-1.5">
                <Ticket size={16} color="#00864d" />
                <Text className="font-inter-semibold text-foreground text-sm">
                  Tu QR para canjear
                </Text>
              </View>
              <View className="rounded-2xl bg-card p-4">
                <QRCode
                  value={data.qrToken}
                  size={180}
                  color="#111827"
                  backgroundColor="transparent"
                />
              </View>
              <Text className="text-xs text-muted-foreground text-center max-w-xs">
                Preséntalo en el local: el personal lo escanea y el uso se descuenta. El QR se
                renueva solo después de cada canje.
              </Text>
            </View>
          ) : data.vigente && data.restantes === 0 ? (
            <View className="rounded-xl bg-muted p-3 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                Agotaste los usos de este período. Se renuevan {data.periodoLabel}.
              </Text>
            </View>
          ) : !data.vigente ? (
            <View className="rounded-xl bg-muted p-3 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                Este regalo ya no está disponible.
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  )
}
