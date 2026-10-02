import React from 'react'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Ticket,
  CalendarDays,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Landmark,
} from 'lucide-react-native'
import QRCode from 'react-native-qrcode-svg'
import { useAuth } from '../../src/lib/auth-context'
import { useMisPromocion } from '../../src/hooks/useMisPromociones'
import { formatDate, formatDateTime } from '../../src/lib/format'
import { cn } from '../../src/lib/cn'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'
import { Badge } from '../../src/components/ui/Badge'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { Skeleton } from '../../src/components/ui/Skeleton'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'

/* ── Estado visual (paridad con web compraEstadoVisual) ──────────────── */

function estadoUi(estado: string, usosRestantes: number, usosIncluidos: number) {
  switch (estado) {
    case 'ACTIVA':
      return { variant: 'success' as const, label: `${usosRestantes}/${usosIncluidos} usos`, icon: CheckCircle2 }
    case 'CONSUMIDA':
      return { variant: 'secondary' as const, label: 'Consumida', icon: CheckCircle2 }
    case 'VENCIDA':
      return { variant: 'warning' as const, label: 'Vencida', icon: Clock }
    case 'SOLICITADA':
    case 'PENDIENTE_PAGO':
      return { variant: 'info' as const, label: 'Pago pendiente', icon: Landmark }
    case 'EN_VALIDACION':
      return { variant: 'info' as const, label: 'En validación', icon: Clock }
    case 'APROBADA':
      return { variant: 'success' as const, label: 'Aprobada', icon: CheckCircle2 }
    case 'RECHAZADA':
      return { variant: 'destructive' as const, label: 'Rechazada', icon: XCircle }
    default:
      return { variant: 'secondary' as const, label: estado, icon: Clock }
  }
}

/* ── Fila de detalle ────────────────────────────────────────────────── */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-inter-semibold text-foreground">{value}</Text>
    </View>
  )
}

/* ── Screen ─────────────────────────────────────────────────────────── */

function MisPromocionDetalleScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-background')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading, isError, refetch } = useMisPromocion(id, isAuthenticated)

  /* ── Auth gate ────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card p-6" : "flex-1 items-center justify-center bg-background p-6"}>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <Ticket size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tu beneficio
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"}>
      {/* ── Back bar ─────────────────────────────────────────────────── */}
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "border-b border-border bg-surface-card" : "border-b border-border bg-background"}>
        <DetailPageFrame
          className="flex-row items-center gap-2 px-4"
          style={{ paddingLeft: insets.left + 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}
        >
          <Pressable
            onPress={() => goBackOr(router, '/mis-promociones')}
            className="p-2 rounded-lg active:bg-muted"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
          <Text className="text-lg font-inter-bold text-foreground" numberOfLines={1}>
            Detalle del beneficio
          </Text>
        </DetailPageFrame>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DetailPageFrame className="gap-4">
        {/* ── Content states ─────────────────────────────────────────── */}
        {isLoading ? (
          <View className="gap-4">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <Skeleton className="h-4 w-32 rounded-lg" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </View>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar el detalle.
              </Text>
              <Button variant="outline" onPress={() => refetch()} className="mt-4">
                Reintentar
              </Button>
            </View>
          </Card>
        ) : !data ? (
          <EmptyState
            icon={<Ticket size={40} color="#9ca3af" />}
            title="Beneficio no encontrado"
            description="Es posible que ya no esté disponible o no te pertenezca."
            action={
              <Button onPress={() => router.push('/mis-promociones')}>
                Volver a mis beneficios
              </Button>
            }
          />
        ) : (
          <DetalleContent data={data} router={router} />
        )}
        </DetailPageFrame>
      </ScrollView>
    </View>
  )
}

export default function MisPromocionDetalleScreen() {
  return (
    <ResponsiveDetailSheet>
      <MisPromocionDetalleScreenContent />
    </ResponsiveDetailSheet>
  )
}

/* ── Contenido del detalle ──────────────────────────────────────────── */

function DetalleContent({
  data,
  router,
}: {
  data: NonNullable<ReturnType<typeof useMisPromocion>['data']>
  router: ReturnType<typeof useRouter>
}) {
  const ui = estadoUi(data.estado, data.usosRestantes, data.usosIncluidos)
  const EstadoIcon = ui.icon
  const promo = data.promocion
  const qr = data.qr as { token: string } | null
  const precio = Number(data.precioCongelado ?? 0)

  return (
    <View className="gap-5">
      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 min-w-0">
          <Text className="text-2xl font-inter-bold text-foreground">
            {promo?.titulo ?? 'Promoción'}
          </Text>
          <Text className="text-sm text-muted-foreground mt-0.5">
            {data.company?.name ?? 'Empresa'}
          </Text>
        </View>
        <Badge variant={ui.variant}>
          <EstadoIcon size={14} color="#111827" />
          <Text className="ml-1 text-xs font-inter-medium">{ui.label}</Text>
        </Badge>
      </View>

      {/* ── Resumen ──────────────────────────────────────────────────── */}
      <Card>
        <View className="p-5 gap-1">
          <DetailRow
            label="Precio"
            value={precio > 0 ? `RD$${precio.toLocaleString('es-DO')}` : 'Gratis'}
          />
          <DetailRow
            label="Usos"
            value={
              data.estado === 'ACTIVA' || data.estado === 'CONSUMIDA'
                ? `${data.usosRestantes} de ${data.usosIncluidos} restantes`
                : `${data.usosIncluidos} incluido${data.usosIncluidos !== 1 ? 's' : ''}`
            }
          />
          {data.fechaActivacion && (
            <DetailRow label="Activada" value={formatDateTime(data.fechaActivacion)} />
          )}
          <DetailRow
            label="Vence"
            value={data.fechaVencimiento ? formatDateTime(data.fechaVencimiento) : 'Sin vencimiento'}
          />
        </View>
      </Card>

      {/* ── Campaña en cadena ────────────────────────────────────────── */}
      {data.campanaPaso && (
        <Card className="border-primary/30 bg-primary/5">
          <View className="p-4 gap-1.5">
            <Text className="text-xs font-inter-bold uppercase tracking-wide text-primary">
              {data.campanaPaso.campana.nombre} · paso {data.campanaPaso.orden}
            </Text>
            <Text className="text-sm text-muted-foreground">
              Al usar este beneficio se desbloquea el siguiente paso de la campaña.
            </Text>
          </View>
        </Card>
      )}

      {/* ── QR para canjear ──────────────────────────────────────────── */}
      {data.estado === 'ACTIVA' && qr && (
        <Card className="border-success/25">
          <View className="p-5 items-center gap-3">
            <View className="flex-row items-center gap-2">
              <Ticket size={16} color="#00864d" />
              <Text className="font-inter-semibold text-foreground">Tu QR para canjear</Text>
            </View>
            <View className="rounded-2xl bg-card p-4">
              <QRCode
                value={qr.token}
                size={180}
                color="#111827"
                backgroundColor="transparent"
              />
            </View>
            <Text className="text-xs text-muted-foreground text-center max-w-xs">
              Muestra este código en el local. Es de un solo uso.
            </Text>
          </View>
        </Card>
      )}

      {/* ── Agendar cita (opcional) ──────────────────────────────────── */}
      {data.estado === 'ACTIVA' && qr && (
        <Card className="border-primary/30">
          <View className="p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <CalendarDays size={18} color="#0284c7" />
              <Text className="font-inter-bold text-foreground">¿Quieres agendar tu cita?</Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              Es <Text className="font-inter-semibold text-foreground">opcional</Text>. Si agendas,
              el local te reserva el turno y evitas la espera.
            </Text>
            <Button
              onPress={() => router.push(`/mis-promociones/${data.id}/agendar`)}
              className="gap-2"
            >
              <CalendarDays size={16} color="#ffffff" />
              <Text className="text-primary-foreground font-inter-semibold ml-1">
                Agendar mi cita
              </Text>
            </Button>
          </View>
        </Card>
      )}

      {/* ── Pago pendiente ───────────────────────────────────────────── */}
      {(data.estado === 'SOLICITADA' || data.estado === 'PENDIENTE_PAGO') && (
        <Card>
          <View className="p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <Landmark size={18} color="#0284c7" />
              <Text className="font-inter-bold text-foreground">Pago pendiente</Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              Tu compra está reservada. Comunícate con el negocio para completar el pago.
            </Text>
          </View>
        </Card>
      )}

      {/* ── En validación ────────────────────────────────────────────── */}
      {data.estado === 'EN_VALIDACION' && (
        <Card className="border-info/25">
          <View className="p-5 flex-row items-start gap-3">
            <Clock size={20} color="#0284c7" />
            <View className="flex-1">
              <Text className="font-inter-semibold text-foreground">Comprobante en revisión</Text>
              <Text className="text-sm text-muted-foreground mt-0.5">
                La empresa está validando tu pago. Te notificaremos al aprobarse.
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* ── Consumida ────────────────────────────────────────────────── */}
      {data.estado === 'CONSUMIDA' && (
        <Card className="border-success/25">
          <View className="p-5 flex-row items-start gap-3">
            <CheckCircle2 size={20} color="#00864d" />
            <View className="flex-1">
              <Text className="font-inter-semibold text-foreground">
                Promoción consumida por completo
              </Text>
              <Text className="text-sm text-muted-foreground mt-0.5">
                Usaste los {data.usosIncluidos} uso{data.usosIncluidos !== 1 ? 's' : ''} incluidos.
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* ── Historial de transiciones ────────────────────────────────── */}
      {data.transiciones && data.transiciones.length > 0 && (
        <Card>
          <View className="p-5">
            <Text className="font-inter-bold text-foreground mb-3">Historial de la compra</Text>
            <View className="gap-3">
              {(data.transiciones as Array<{ id: string; hacia: string; createdAt: string; motivo?: string | null }>).map((t) => (
                <View key={t.id} className="flex-row items-start gap-3">
                  <View className="mt-1.5 h-2 w-2 rounded-full bg-primary/60" />
                  <View className="flex-1">
                    <Text className="text-sm font-inter-medium text-foreground">
                      {estadoUi(t.hacia, 0, 0).label}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                      {t.motivo ? ` · ${t.motivo}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </Card>
      )}
    </View>
  )
}
