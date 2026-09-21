import React, { useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Share,
  Alert,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { ArrowLeft, History, Car, Clock, Calendar, Share2, Download } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import QRCode from 'react-native-qrcode-svg'
import { useAuth } from '../../src/lib/auth-context'
import { useMembresias } from '../../src/hooks/useMembresias'
import { useHistorial } from '../../src/hooks/useHistorial'
import { Button } from '../../src/components/ui/Button'
import { Skeleton } from '../../src/components/ui/Skeleton'

const ESTADO_LABEL: Record<string, string> = {
  ACTIVA: 'Activa',
  PENDIENTE: 'Esperando pago',
  PENDIENTE_PAGO: 'Esperando pago',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
}

interface Membership {
  id: string
  planNombre: string
  companyName: string
  companyLogoUrl?: string | null
  companyColorPrimario?: string | null
  estado: string
  lavadosRestantes?: number | null
  planLavadosIncluidos?: number | null
  qrToken?: string | null
  fechaInicio?: string | null
  fechaVencimiento?: string | null
}

interface Visita {
  id: string
  fecha: string
  sucursal?: string | null
  servicio?: string | null
  vehiculo?: {
    marca?: string
    modelo?: string
  } | null
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date)
  } catch {
    return dateStr
  }
}

function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('es-DO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
  } catch {
    return dateStr
  }
}

function getDaysRemaining(fechaVencimiento: string | null | undefined): number | null {
  if (!fechaVencimiento) return null
  try {
    const now = new Date()
    const venc = new Date(fechaVencimiento)
    const diff = Math.ceil((venc.getTime() - now.getTime()) / 86_400_000)
    return diff > 0 ? diff : 0
  } catch {
    return null
  }
}

function getStatusChipStyle(estado: string) {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    return 'bg-success/15 border-success/30'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'bg-warning/15 border-warning/30'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'bg-destructive/10 border-destructive/30'
  }
  return 'bg-muted border-border'
}

function getStatusTextColor(estado: string) {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    return 'text-success'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'text-warning'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

function isUnlimited(m: Membership): boolean {
  return (
    m.planLavadosIncluidos === null ||
    m.planLavadosIncluidos === undefined ||
    m.planLavadosIncluidos < 0 ||
    m.lavadosRestantes === null ||
    m.lavadosRestantes === undefined ||
    m.lavadosRestantes < 0
  )
}

export default function MembresiaDetailScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { membresiaId } = useLocalSearchParams<{ membresiaId: string }>()
  const { isAuthenticated } = useAuth()
  const { data: membresiasData, isLoading: loadingMembresias } =
    useMembresias(isAuthenticated)
  const { data: historialData } = useHistorial(1, isAuthenticated)

  const membresia = useMemo(() => {
    const memberships: Membership[] =
      membresiasData?.membresias ?? membresiasData ?? []
    return memberships.find((m) => m.id === membresiaId)
  }, [membresiasData, membresiaId])

  const visitas: Visita[] = useMemo(() => {
    return historialData?.visitas ?? []
  }, [historialData])

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <Text className="text-lg font-bold text-foreground mb-4">
          Inicia sesión para ver el detalle
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  if (loadingMembresias) {
    return (
      <ScrollView
        className="flex-1 bg-vibe-fondo"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8 }}
      >
        <Skeleton className="h-8 w-32 mb-4" />
        <Skeleton className="h-12 w-full mb-6" />
        <Skeleton className="h-[300px] rounded-2xl mb-6" />
        <Skeleton className="h-[200px] rounded-xl" />
      </ScrollView>
    )
  }

  if (!membresia) {
    return (
      <ScrollView
        className="flex-1 bg-vibe-fondo"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-1.5 mb-4"
        >
          <ArrowLeft size={20} color="#4b5563" />
          <Text className="text-sm text-muted-foreground">Volver</Text>
        </Pressable>
        <View className="flex-1 items-center justify-center py-16">
          <Text className="text-lg font-semibold text-muted-foreground">
            Membresía no encontrada
          </Text>
        </View>
      </ScrollView>
    )
  }

  const statusChipStyle = getStatusChipStyle(membresia.estado)
  const statusTextColor = getStatusTextColor(membresia.estado)
  const unlimited = isUnlimited(membresia)
  const daysRemaining = getDaysRemaining(membresia.fechaVencimiento)
  const estadoLabel = ESTADO_LABEL[membresia.estado] ?? membresia.estado
  const isActive = membresia.estado === 'ACTIVA' && (!membresia.fechaVencimiento || new Date(membresia.fechaVencimiento) > new Date())
  const showQr = isActive && !!membresia.qrToken

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Mi membresía en ${membresia.companyName} — Plan ${membresia.planNombre}`,
      })
    } catch { /* dismissed */ }
  }

  const handleDownload = () => {
    Alert.alert(
      'Descargar QR',
      'La descarga del QR como imagen estará disponible próximamente.'
    )
  }

  const handleCancel = () => {
    Alert.alert(
      'Cancelar membresía',
      'La cancelación de membresía estará disponible próximamente.',
      [{ text: 'Entendido' }]
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-vibe-fondo"
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 32 }}
    >
      <View className="max-w-xl self-center w-full">
        {/* Back Row */}
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-1.5 mb-4"
        >
          <ArrowLeft size={20} color="#4b5563" />
          <Text className="text-sm text-muted-foreground">Mis membresías</Text>
        </Pressable>

        {/* Header */}
        <View className="flex-row items-start justify-between mb-6">
          <View className="flex-1 mr-4">
            <Text className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-inter-semibold">
              {membresia.companyName}
            </Text>
            <Text className="text-[28px] font-inter-extrabold text-foreground leading-tight">
              {membresia.planNombre}
            </Text>
          </View>
          <View className={`rounded-full px-3 py-1 border ${statusChipStyle}`}>
            <Text className={`text-xs font-inter-semibold ${statusTextColor}`}>
              {estadoLabel}
            </Text>
          </View>
        </View>

        <View className="rounded-2xl border border-border/60 bg-card py-6 px-5 items-center mb-6">
          <Text className="text-lg font-inter-bold text-foreground mb-1.5 text-center">
            Tu llave de acceso
          </Text>
          <Text className="text-sm text-muted-foreground text-center mb-4 leading-5 px-2">
            Muéstralo en {membresia.companyName} y listo: tu membresía se valida al instante.
          </Text>

          {daysRemaining !== null && daysRemaining <= 7 && (
            <View className="flex-row items-center gap-1.5 rounded-full bg-warning/10 border border-warning/30 px-3.5 py-1.5 mb-5">
              <Clock size={14} color="#ab6300" />
              <Text className="text-sm font-inter-semibold text-warning">
                {daysRemaining === 0 ? 'Vence hoy' : `Te quedan ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'}`}
              </Text>
            </View>
          )}

          {showQr ? (
            <>
              {/* QR Frame */}
              <View className="rounded-[28px] p-[3px] mb-5">
                <LinearGradient
                  colors={['#10b981', '#2dd4bf', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ borderRadius: 28, padding: 3 }}
                >
                  <View className="bg-card rounded-2xl p-4 items-center justify-center">
                    <QRCode
                      value={membresia.qrToken!}
                      size={220}
                      color="#0f172a"
                      backgroundColor="#ffffff"
                    />
                  </View>
                </LinearGradient>
              </View>

              <View className="flex-row gap-3 w-full">
                <Pressable
                  onPress={handleShare}
                  className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl bg-foreground active:opacity-90"
                >
                  <Share2 size={16} color="#ffffff" />
                  <Text className="text-sm font-inter-semibold text-background">Compartir</Text>
                </Pressable>
                <Pressable
                  onPress={handleDownload}
                  className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl border border-border bg-card active:bg-muted"
                >
                  <Download size={16} color="#334155" />
                  <Text className="text-sm font-inter-semibold text-foreground">Descargar</Text>
                </Pressable>
              </View>
            </>
          ) : isActive && !unlimited && (membresia.lavadosRestantes ?? 0) <= 0 ? (
            <View className="py-6 px-4 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                Sin usos disponibles en este período. Renueva tu membresía para seguir usando tus beneficios.
              </Text>
            </View>
          ) : isActive ? (
            <View className="py-6 px-4 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                Tu código para canjear se está generando. Vuelve a cargar la página en un momento.
              </Text>
            </View>
          ) : (
            <View className="py-6 px-4 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                {membresia.estado === 'PENDIENTE' || membresia.estado === 'PENDIENTE_PAGO'
                  ? 'Esta membresía está pendiente de pago. Completa el pago para activar tu código QR.'
                  : membresia.estado === 'VENCIDA' || membresia.estado === 'CANCELADA'
                    ? 'Esta membresía no se encuentra activa. Renueva tu plan para volver a generar tu código QR.'
                    : 'El código QR no está disponible en este momento.'}
              </Text>
            </View>
          )}
        </View>

        {/* Visits Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <View className="h-7 w-7 rounded-lg bg-vibe-violet/10 items-center justify-center">
              <History size={14} color="#7c3aed" />
            </View>
            <Text className="text-base font-inter-bold text-foreground">
              Visitas
            </Text>
          </View>
          {visitas.length > 0 ? (
            <View className="rounded-xl border border-border bg-card p-4">
              {visitas.slice(0, 5).map((visita, idx) => (
                <View
                  key={visita.id}
                  className={`flex-row gap-3 py-3 ${
                    idx < Math.min(visitas.length, 5) - 1
                      ? 'border-b border-border/50'
                      : ''
                  }`}
                >
                  <View className="h-9 w-9 rounded-xl bg-primary/10 items-center justify-center">
                    {visita.vehiculo ? (
                      <Car size={18} color="#0284c7" />
                    ) : (
                      <Clock size={18} color="#0284c7" />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-inter-semibold text-foreground">
                      {visita.servicio || 'Servicio'}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {formatDate(visita.fecha)}
                    </Text>
                    {visita.sucursal && (
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {visita.sucursal}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="rounded-xl border border-dashed border-border bg-muted/20 py-8 px-4 items-center">
              <View className="h-10 w-10 rounded-xl bg-muted items-center justify-center mb-3">
                <Clock size={20} color="#94a3b8" />
              </View>
              <Text className="text-sm text-muted-foreground text-center leading-5">
                Cuando uses tu membresía, tus visitas aparecerán aquí.
              </Text>
            </View>
          )}
        </View>

        <View className="rounded-xl border border-border bg-card p-5 mb-6">
          <View className="flex-row items-center gap-2 mb-4">
            <View className="h-7 w-7 rounded-lg bg-muted items-center justify-center">
              <Calendar size={14} color="#64748b" />
            </View>
            <Text className="text-base font-inter-bold text-foreground">
              Detalles de la membresía
            </Text>
          </View>
          <View>
            <DetailRow
              label="Fecha de inicio"
              value={formatDateLong(membresia.fechaInicio)}
              isLast={false}
            />
            <DetailRow
              label="Fecha de vencimiento"
              value={formatDateLong(membresia.fechaVencimiento)}
              isLast={false}
            />
            <DetailRow
              label="Usos restantes"
              value={unlimited ? 'Ilimitado' : `${membresia.lavadosRestantes ?? 0}`}
              isLast={true}
            />
          </View>
        </View>

        <Pressable
          onPress={handleCancel}
          className="items-center py-3"
        >
          <Text className="text-sm font-inter-semibold text-destructive">
            Cancelar membresía
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

function DetailRow({
  label,
  value,
  isLast,
}: {
  label: string
  value: string
  isLast: boolean
}) {
  return (
    <View
      className={`flex-row justify-between py-3 ${
        !isLast ? 'border-b border-border/50' : ''
      }`}
    >
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  )
}
