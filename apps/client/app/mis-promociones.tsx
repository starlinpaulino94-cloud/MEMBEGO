import React from 'react'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Pressable,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  TicketPercent,
  Gift,
  Sparkles,
  ChevronRight,
  AlertCircle,
  Clock,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useMisPromociones } from '../src/hooks/useMisPromociones'
import { formatDate } from '../src/lib/format'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import type { CompraItem, RegaloClienteItem } from '../src/lib/api'
import { brandColor } from '../src/lib/brand-color'
import { colors } from '../src/theme/tokens'

/* ── Estado visual (paridad con web compraEstadoVisual) ──────────────── */

const PENDIENTES = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'RECHAZADA']

function estadoBadge(estado: string, usosRestantes: number, usosIncluidos: number) {
  if (estado === 'ACTIVA') {
    return { variant: 'success' as const, label: `${usosRestantes}/${usosIncluidos} usos` }
  }
  if (estado === 'CONSUMIDA') {
    return { variant: 'secondary' as const, label: 'Consumida' }
  }
  if (estado === 'VENCIDA') {
    return { variant: 'warning' as const, label: 'Vencida' }
  }
  if (PENDIENTES.includes(estado)) {
    return { variant: 'info' as const, label: 'En proceso' }
  }
  return { variant: 'secondary' as const, label: estado }
}

/* ── Fila de compra ─────────────────────────────────────────────────── */

function CompraRow({ compra }: { compra: CompraItem }) {
  const router = useRouter()
  const badge = estadoBadge(compra.estado, compra.usosRestantes, compra.usosIncluidos)
  const companyColor = brandColor(compra.company?.colorPrimario, colors.primary.DEFAULT)

  return (
    <Pressable
      onPress={() => router.push(`/mis-promociones/${compra.id}`)}
      className="flex-row items-center gap-3 px-5 py-4 active:bg-muted/50"
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de ${compra.promocion?.titulo ?? 'Promoción'}`}
    >
      {/* Icono */}
      <View className="h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${companyColor}1A` }}>
        <TicketPercent size={22} color={companyColor} />
      </View>

      {/* Texto */}
      <View className="flex-1 min-w-0">
        <Text className="font-inter-semibold text-sm text-foreground" numberOfLines={1}>
          {compra.promocion?.titulo ?? 'Promoción'}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
          {compra.company?.name ?? 'Empresa'}
          {compra.createdAt ? ` · ${formatDate(compra.createdAt)}` : ''}
        </Text>
      </View>

      {/* Badge + chevron */}
      <Badge variant={badge.variant}>{badge.label}</Badge>
      <ChevronRight size={16} color="#71717a" />
    </Pressable>
  )
}

/* ── Fila de regalo ─────────────────────────────────────────────────── */

function RegaloRow({ regalo }: { regalo: RegaloClienteItem }) {
  const router = useRouter()
  const restantes = Math.max(0, regalo.usosPorPeriodo - regalo.usosPeriodo)
  const companyColor = brandColor(regalo.empresaColorPrimario, colors.primary.DEFAULT)

  return (
    <Pressable
      onPress={() => router.push(`/mis-promociones/regalo/${regalo.invitadoId}`)}
      className="flex-row items-center gap-3 px-5 py-4 active:bg-muted/50"
      accessibilityRole="button"
      accessibilityLabel={`Ver regalo ${regalo.titulo}`}
    >
      <View className="h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${companyColor}1A` }}>
        <Gift size={22} color={companyColor} />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="font-inter-semibold text-sm text-foreground" numberOfLines={1}>
          {regalo.titulo}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
          {restantes} de {regalo.usosPorPeriodo} usos
          {regalo.vigenciaHasta ? ` · hasta ${formatDate(regalo.vigenciaHasta)}` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color="#71717a" />
    </Pressable>
  )
}

/* ── Sección agrupada ───────────────────────────────────────────────── */

function Seccion({
  titulo,
  icon,
  items,
  children,
}: {
  titulo: string
  icon: React.ReactNode
  items: unknown[]
  children: React.ReactNode
}) {
  if (items.length === 0) return null
  return (
    <View className="mb-6">
      <View className="flex-row items-center gap-2 mb-2 px-1">
        {icon}
        <Text className="text-xs font-inter-semibold uppercase tracking-widest text-muted-foreground">
          {titulo}
        </Text>
      </View>
      <Card className="p-0">{children}</Card>
    </View>
  )
}

/* ── Screen ─────────────────────────────────────────────────────────── */

function MisPromocionesScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-vibe-fondo')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError, refetch } = useMisPromociones(isAuthenticated)

  /* ── Auth gate ────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card p-6" : "flex-1 items-center justify-center bg-vibe-fondo p-6"}>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <Sparkles size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tus beneficios
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Cuando adquieras una promoción o recibas un regalo, aparecerán aquí.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  const compras = data?.compras ?? []
  const regalos = data?.regalos ?? []
  const historial = data?.historial ?? []
  const activas = compras.filter((c) => c.estado === 'ACTIVA')
  const pendientes = compras.filter((c) => PENDIENTES.includes(c.estado))

  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
      {/* ── Back bar ─────────────────────────────────────────────────── */}
      <View
        className={sheetBackgroundClass === 'bg-surface-card' ? "flex-row items-center gap-2 bg-surface-card border-b border-border" : "flex-row items-center gap-2 bg-vibe-fondo border-b border-border"}
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => goBackOr(router, '/(tabs)/beneficios')}
          className="p-2 rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">Mis beneficios</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View className="mb-6">
          <Text className="text-2xl font-inter-bold text-foreground">Mis beneficios</Text>
          <Text className="text-sm text-muted-foreground mt-1">
            Tu centro de recompensas: lo que puedes usar hoy, lo que está en camino y lo que ya
            disfrutaste.
          </Text>
        </View>

        {/* ── Content states ─────────────────────────────────────────── */}
        {isLoading ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </View>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar tus beneficios.
              </Text>
              <Button variant="outline" onPress={() => refetch()} className="mt-4">
                Reintentar
              </Button>
            </View>
          </Card>
        ) : compras.length === 0 && regalos.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={40} color="#9ca3af" />}
            title="Sin beneficios activos por ahora."
            description="Cuando adquieras una promoción o recibas un regalo, aparecerán aquí listos para usar."
            action={
              <Button onPress={() => router.push('/(tabs)/inicio')}>Explorar beneficios</Button>
            }
          />
        ) : (
          <>
            {/* Regalos VIP */}
            {regalos.length > 0 && (
              <Seccion
                titulo="Mis regalos"
                icon={<Gift size={16} color="#0284c7" />}
                items={regalos}
              >
                {regalos.map((r, i) => (
                  <View key={r.invitadoId} className={i < regalos.length - 1 ? 'border-b border-border/60' : ''}>
                    <RegaloRow regalo={r} />
                  </View>
                ))}
              </Seccion>
            )}

            {/* Activas */}
            <Seccion
              titulo="Listos para usar"
              icon={<TicketPercent size={16} color="#0284c7" />}
              items={activas}
            >
              {activas.map((c, i) => (
                <View key={c.id} className={i < activas.length - 1 ? 'border-b border-border/60' : ''}>
                  <CompraRow compra={c} />
                </View>
              ))}
            </Seccion>

            {/* Pendientes */}
            <Seccion
              titulo="En proceso"
              icon={<Clock size={16} color="#0284c7" />}
              items={pendientes}
            >
              {pendientes.map((c, i) => (
                <View key={c.id} className={i < pendientes.length - 1 ? 'border-b border-border/60' : ''}>
                  <CompraRow compra={c} />
                </View>
              ))}
            </Seccion>

            {/* Historial */}
            <Seccion
              titulo="Ya utilizados y vencidos"
              icon={<TicketPercent size={16} color="#71717a" />}
              items={historial}
            >
              {historial.map((c, i) => (
                <View key={c.id} className={i < historial.length - 1 ? 'border-b border-border/60' : ''}>
                  <CompraRow compra={c} />
                </View>
              ))}
            </Seccion>
          </>
        )}
      </ScrollView>
    </View>
  )
}

export default function MisPromocionesScreen() {
  return (
    <ResponsiveDetailSheet>
      <MisPromocionesScreenContent />
    </ResponsiveDetailSheet>
  )
}
