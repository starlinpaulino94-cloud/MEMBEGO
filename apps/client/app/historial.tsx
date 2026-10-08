import React, { useState, useEffect } from 'react'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../src/components/ui/ResponsiveDetailSheet'
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
  History,
  CalendarDays,
  MapPin,
  User as UserIcon,
  Car,
  Hash,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { useHistorial } from '../src/hooks/useHistorial'
import { formatDateTime } from '../src/lib/format'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { Skeleton } from '../src/components/ui/Skeleton'
import { BackHeader } from '../src/components/ui/BackHeader'

interface Visita {
  id: string
  servicio: string
  fechaVisita: string
  descontado: boolean
  notas?: string | null
  sucursal?: string | null
  empleado?: string | null
  planNombre?: string | null
  vehiculo?: {
    marca: string
    modelo: string
    placa?: string | null
  } | null
  transaccion?: {
    codigo: string
    ticketNumero: string
    estado: string
  } | null
}

interface HistorialData {
  total: number
  esteMes: number
  pages: number
  visitas: Visita[]
}

/* ── Badge helpers ─────────────────────────────────────────────────────── */

const estadoLabel = (estado: string) =>
  estado === 'REVERTED'
    ? 'Revertida'
    : estado === 'CANCELLED'
      ? 'Cancelada'
      : estado

/* ── VisitRow ──────────────────────────────────────────────────────────── */

function VisitRow({ visita }: { visita: Visita }) {
  const [expanded, setExpanded] = useState(false)
  const hasNotas = !!visita.notas
  const showEstado =
    !!visita.transaccion && visita.transaccion.estado !== 'APPLIED'

  return (
    <View className="px-5 py-4 border-b border-border/60">
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          {/* Servicio */}
          <Text className="font-inter-semibold text-sm text-foreground">
            {visita.servicio}
          </Text>

          {/* Fecha */}
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatDateTime(visita.fechaVisita)}
          </Text>

          {/* Sucursal / Empleado / Vehículo / Plan */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-2">
            {visita.sucursal && (
              <View className="flex-row items-center gap-1">
                <MapPin size={12} color="#4b5563" />
                <Text className="text-[11px] text-muted-foreground">
                  {visita.sucursal}
                </Text>
              </View>
            )}
            {visita.empleado && (
              <View className="flex-row items-center gap-1">
                <UserIcon size={12} color="#4b5563" />
                <Text className="text-[11px] text-muted-foreground">
                  {visita.empleado}
                </Text>
              </View>
            )}
            {visita.vehiculo && (
              <View className="flex-row items-center gap-1">
                <Car size={12} color="#4b5563" />
                <Text className="text-[11px] text-muted-foreground">
                  {visita.vehiculo.marca} {visita.vehiculo.modelo}
                  {visita.vehiculo.placa ? ` · ${visita.vehiculo.placa}` : ''}
                </Text>
              </View>
            )}
            {visita.planNombre && (
              <Text className="text-[11px] text-muted-foreground">
                Plan: {visita.planNombre}
              </Text>
            )}
          </View>

          {/* Transacción (código + ticket) */}
          {visita.transaccion && (
            <View className="flex-row items-center gap-1 mt-1">
              <Hash size={12} color="#4b5563" />
              <Text className="text-[11px] text-muted-foreground font-mono">
                {visita.transaccion.codigo} · {visita.transaccion.ticketNumero}
              </Text>
            </View>
          )}

          {/* Notas (expandibles) */}
          {hasNotas && (
            <Pressable
              onPress={() => setExpanded(!expanded)}
              className="mt-2 flex-row items-center gap-1"
            >
              <Text className="text-[11px] text-primary font-inter-medium">
                {expanded ? 'Ocultar nota' : 'Ver nota'}
              </Text>
              <ChevronRight
                size={12}
                color="#0284c7"
                style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
              />
            </Pressable>
          )}
          {expanded && visita.notas && (
            <Text className="text-xs italic text-muted-foreground mt-1">
              &ldquo;{visita.notas}&rdquo;
            </Text>
          )}
        </View>

        {/* Badges (columna derecha) */}
        <View className="flex-col items-end gap-1.5">
          {visita.descontado ? (
            <Badge variant="destructive">−1 uso</Badge>
          ) : (
            <Badge variant="success">Sin descuento</Badge>
          )}
          {showEstado && (
            <Badge variant="warning">{estadoLabel(visita.transaccion!.estado)}</Badge>
          )}
        </View>
      </View>
    </View>
  )
}

/* ── Screen ────────────────────────────────────────────────────────────── */

function HistorialScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-vibe-fondo')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useHistorial(page, isAuthenticated)

  useEffect(() => {
    if (isAuthenticated) {
      refetch()
    }
  }, [page, isAuthenticated, refetch])

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card p-6" : "flex-1 items-center justify-center bg-vibe-fondo p-6"}>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <History size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tu historial
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Consulta cada uso registrado de tu membresía.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  const historial = (data as HistorialData | undefined) ?? {
    total: 0,
    esteMes: 0,
    pages: 0,
    visitas: [],
  }

  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-vibe-fondo"}>
      <BackHeader
        title="Historial"
        leftInset={insets.left}
        onBack={() => goBackOr(router, '/(tabs)/cuenta')}
      />

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <View className="mb-6">
          <Text className="text-2xl font-inter-bold text-foreground">
            Historial de visitas
          </Text>
          <Text className="text-sm text-muted-foreground mt-1">
            Cada uso registrado de tu membresía.
          </Text>
        </View>

        {/* ── Stat cards ─────────────────────────────────────────────── */}
        <View className="flex-row gap-4 mb-6">
          {/* Visitas totales */}
          <Card className="flex-1 p-0">
            <View className="flex-row items-center gap-3 p-4 py-5">
              <View className="rounded-lg bg-info/10 p-2">
                <History size={20} color="#0284c7" />
              </View>
              <View>
                <Text className="text-2xl font-inter-bold text-foreground">
                  {isLoading ? '—' : historial.total}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Visitas totales
                </Text>
              </View>
            </View>
          </Card>

          {/* Este mes */}
          <Card className="flex-1 p-0">
            <View className="flex-row items-center gap-3 p-4 py-5">
              <View className="rounded-lg bg-primary/10 p-2">
                <CalendarDays size={20} color="#0284c7" />
              </View>
              <View>
                <Text className="text-2xl font-inter-bold text-foreground">
                  {isLoading ? '—' : historial.esteMes}
                </Text>
                <Text className="text-sm text-muted-foreground">Este mes</Text>
              </View>
            </View>
          </Card>
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
                No pudimos cargar tu historial.
              </Text>
              <Button
                variant="outline"
                onPress={() => refetch()}
                className="mt-4"
              >
                Reintentar
              </Button>
            </View>
          </Card>
        ) : historial.visitas.length === 0 ? (
          <Card>
            <View className="py-16 items-center">
              <History size={40} color="#9ca3af" />
              <Text className="font-inter-semibold text-foreground mt-3">
                Sin visitas registradas
              </Text>
              <Text className="text-sm text-muted-foreground mt-1 text-center px-4">
                Tus visitas aparecerán aquí cuando el empleado las confirme.
              </Text>
            </View>
          </Card>
        ) : (
          <Card className="p-0">
            {historial.visitas.map((visita, index) => (
              <View
                key={visita.id}
                className={
                  index === historial.visitas.length - 1
                    ? ''
                    : 'border-b border-border/60'
                }
              >
                <VisitRow visita={visita} />
              </View>
            ))}
          </Card>
        )}

        {/* ── Paginación ─────────────────────────────────────────────── */}
        {!isLoading && !isError && historial.pages > 1 && (
          <View className="flex-row items-center justify-center gap-3 mt-6">
            <Pressable
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex-row items-center gap-1 px-3 py-2 rounded-lg border border-border bg-card active:bg-muted"
              accessibilityRole="button"
              accessibilityLabel="Página anterior"
            >
              <ChevronLeft
                size={16}
                color={page === 1 ? '#d4d4d8' : '#111827'}
              />
              <Text
                className={`text-xs font-inter-medium ${page === 1 ? 'text-zinc-300' : 'text-foreground'}`}
              >
                Anterior
              </Text>
            </Pressable>

            <Text className="text-xs text-muted-foreground">
              Página {page} de {historial.pages}
            </Text>

            <Pressable
              onPress={() => setPage((p) => Math.min(historial.pages, p + 1))}
              disabled={page === historial.pages}
              className="flex-row items-center gap-1 px-3 py-2 rounded-lg border border-border bg-card active:bg-muted"
              accessibilityRole="button"
              accessibilityLabel="Página siguiente"
            >
              <Text
                className={`text-xs font-inter-medium ${page === historial.pages ? 'text-zinc-300' : 'text-foreground'}`}
              >
                Siguiente
              </Text>
              <ChevronRight
                size={16}
                color={page === historial.pages ? '#d4d4d8' : '#111827'}
              />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export default function HistorialScreen() {
  return (
    <ResponsiveDetailSheet>
      <HistorialScreenContent />
    </ResponsiveDetailSheet>
  )
}
