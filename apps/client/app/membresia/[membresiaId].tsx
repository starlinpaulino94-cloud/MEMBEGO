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
    return 'bg-[#16a34a]/15 border-[#16a34a]/30'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'bg-[#d97706]/15 border-[#d97706]/30'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'bg-[#dc2626]/10 border-[#dc2626]/30'
  }
  return 'bg-slate-500/15 border-slate-500/30'
}

function getStatusTextColor(estado: string) {
  const upper = estado.toUpperCase()
  if (upper === 'ACTIVA') {
    return 'text-[#16a34a]'
  }
  if (upper.startsWith('PENDIENTE')) {
    return 'text-[#d97706]'
  }
  if (upper === 'VENCIDA' || upper === 'CANCELADA') {
    return 'text-[#dc2626]'
  }
  return 'text-slate-600'
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
        <Text className="text-lg font-bold text-slate-900 mb-4">
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
          <ArrowLeft size={20} color="#64748b" />
          <Text className="text-sm text-slate-500">Volver</Text>
        </Pressable>
        <View className="flex-1 items-center justify-center py-16">
          <Text className="text-lg font-semibold text-slate-500">
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
  const estadoLabel = membresia.estado === 'ACTIVA' ? 'Activa'
    : membresia.estado === 'PENDIENTE' ? 'Pendiente'
    : membresia.estado === 'VENCIDA' ? 'Vencida'
    : membresia.estado === 'CANCELADA' ? 'Cancelada'
    : membresia.estado

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
          <ArrowLeft size={20} color="#64748b" />
          <Text className="text-sm text-slate-500">Mis membresías</Text>
        </Pressable>

        {/* Header */}
        <View className="flex-row items-start justify-between mb-6">
          <View className="flex-1 mr-4">
            <Text className="text-xs uppercase tracking-widest text-slate-500 mb-1 font-inter-semibold">
              {membresia.companyName}
            </Text>
            <Text className="text-[28px] font-inter-extrabold text-slate-900 leading-tight">
              {membresia.planNombre}
            </Text>
          </View>
          <View className={`rounded-full px-3 py-1 border ${statusChipStyle}`}>
            <Text className={`text-xs font-inter-semibold ${statusTextColor}`}>
              {estadoLabel}
            </Text>
          </View>
        </View>

        <View className="rounded-2xl border border-slate-200/60 bg-white py-6 px-5 items-center mb-6">
          <Text className="text-lg font-inter-bold text-slate-900 mb-1.5 text-center">
            Tu llave de acceso
          </Text>
          <Text className="text-sm text-slate-500 text-center mb-4 leading-5 px-2">
            Muéstralo en {membresia.companyName} y listo: tu membresía se valida al instante.
          </Text>

          {daysRemaining !== null && (
            <View className="flex-row items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/60 px-3.5 py-1.5 mb-5">
              <Clock size={14} color="#d97706" />
              <Text className="text-sm font-inter-semibold text-amber-700">
                Te quedan {daysRemaining} {daysRemaining === 1 ? 'día' : 'días'}
              </Text>
            </View>
          )}

          {/* QR Frame */}
          <View className="rounded-[28px] p-[3px] mb-5">
            <LinearGradient
              colors={['#10b981', '#2dd4bf', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 28, padding: 3 }}
            >
              <View className="bg-white rounded-2xl p-4 items-center justify-center">
                <QRCode
                  value={membresia.qrToken || membresia.id}
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
              className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl bg-slate-900 active:opacity-90"
            >
              <Share2 size={16} color="#ffffff" />
              <Text className="text-sm font-inter-semibold text-white">Compartir</Text>
            </Pressable>
            <Pressable
              onPress={handleDownload}
              className="flex-1 flex-row items-center justify-center gap-2 h-11 rounded-xl border border-slate-300 bg-white active:bg-slate-50"
            >
              <Download size={16} color="#334155" />
              <Text className="text-sm font-inter-semibold text-slate-700">Descargar</Text>
            </Pressable>
          </View>
        </View>

        {/* Visits Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <View className="h-7 w-7 rounded-lg bg-violet-500/10 items-center justify-center">
              <History size={14} color="#7c3aed" />
            </View>
            <Text className="text-base font-inter-bold text-slate-900">
              Visitas
            </Text>
          </View>
          {visitas.length > 0 ? (
            <View className="rounded-xl border border-slate-200 bg-white p-4">
              {visitas.slice(0, 5).map((visita, idx) => (
                <View
                  key={visita.id}
                  className={`flex-row gap-3 py-3 ${
                    idx < Math.min(visitas.length, 5) - 1
                      ? 'border-b border-slate-200/50'
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
                    <Text className="text-sm font-inter-semibold text-slate-900">
                      {visita.servicio || 'Servicio'}
                    </Text>
                    <Text className="text-xs text-slate-500">
                      {formatDate(visita.fecha)}
                    </Text>
                    {visita.sucursal && (
                      <Text className="text-xs text-slate-400 mt-0.5">
                        {visita.sucursal}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-8 px-4 items-center">
              <View className="h-10 w-10 rounded-xl bg-slate-100 items-center justify-center mb-3">
                <Clock size={20} color="#94a3b8" />
              </View>
              <Text className="text-sm text-slate-500 text-center leading-5">
                Cuando uses tu membresía, tus visitas aparecerán aquí.
              </Text>
            </View>
          )}
        </View>

        <View className="rounded-xl border border-slate-200 bg-white p-5 mb-6">
          <View className="flex-row items-center gap-2 mb-4">
            <View className="h-7 w-7 rounded-lg bg-slate-500/10 items-center justify-center">
              <Calendar size={14} color="#64748b" />
            </View>
            <Text className="text-base font-inter-bold text-slate-900">
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
          <Text className="text-sm font-inter-semibold text-red-600">
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
        !isLast ? 'border-b border-slate-200/50' : ''
      }`}
    >
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="text-sm font-medium text-slate-900">{value}</Text>
    </View>
  )
}
