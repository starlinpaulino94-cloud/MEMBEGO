import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import QRCode from 'react-native-qrcode-svg'
import { ChevronRight, QrCode as QrIcon, Frown } from 'lucide-react-native'
import { useQr } from '../../src/hooks/useQr'
import { useAuth } from '../../src/lib/auth-context'
import { Card } from '../../src/components/ui/Card'
import { Button } from '../../src/components/ui/Button'
import { cn } from '../../src/lib/cn'

/** grad-vibe-cta: #7c3aed → #2563eb (60%) → #06b6d4 */
const CTA_GRADIENT: [string, string, string] = ['#7c3aed', '#2563eb', '#06b6d4']

/** QR frame gradient: emerald-500 → teal-400 → emerald-600 */
const QR_FRAME_GRADIENT: [string, string, string] = ['#10b981', '#2dd4bf', '#059669']

const ESTADO_MEMBRESIA_LABEL: Record<string, string> = {
  ACTIVA: 'Activa',
  PENDIENTE: 'Esperando pago',
  PENDIENTE_PAGO: 'Esperando pago',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
}

function getEstadoMembresiaLabel(estado: string): string {
  const label = ESTADO_MEMBRESIA_LABEL[estado]
  if (label) return label

  return estado
    .replaceAll('_', ' ')
    .toLocaleLowerCase('es')
    .split(' ')
    .map((palabra) => palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1))
    .join(' ')
}

export default function QrScreen() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const { data, isLoading, isError, refetch } = useQr(selectedId, isAuthenticated)

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-vibe-niebla">
          <QrIcon size={32} color="#7c3aed" />
        </View>
        <Text className="mb-2 text-center text-h3 font-inter-bold text-foreground">
          Inicia sesión para ver tu QR
        </Text>
        <Text className="mb-6 max-w-xs text-center text-small text-muted-foreground">
          Tu código QR te permite canjear servicios y acceder a todos tus beneficios al instante.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator size="large" color="#0284c7" />
        <Text className="mt-3 text-small text-muted-foreground">Cargando tu carnet...</Text>
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <Text className="mb-4 text-center text-small text-destructive">
          No se pudo cargar tu QR. Intenta de nuevo.
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          Reintentar
        </Button>
      </View>
    )
  }

  const usable = data?.usable
  const memberships = data?.memberships ?? []
  const sinBeneficio = data?.sinBeneficio

  // Reconstruct elegida for intermediate state (pending/expired)
  const elegida = !usable && memberships.length > 0
    ? (selectedId ? memberships.find((m: any) => m.id === selectedId) : null) ?? memberships[0]
    : null

  return (
    <ScrollView
      className="flex-1 bg-vibe-fondo"
      contentContainerStyle={{ padding: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {usable ? (
        <View className="gap-4">
          {/* ── Main QR Card ─────────────────────────────────────────── */}
          <Card className="items-center overflow-hidden rounded-xl border border-border bg-card p-5">
            {/* Company name */}
            <Text className="text-label-md text-muted-foreground">
              {usable.companyName}
            </Text>
            {/* Plan title */}
            <Text className="mt-0.5 text-center text-h2 font-inter-bold text-foreground" numberOfLines={2}>
              {usable.planNombre}
            </Text>

            {/* ── QR with gradient frame ─────────────────────────────── */}
            <View className="mt-4">
              <LinearGradient
                colors={QR_FRAME_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 28, padding: 3 }}
              >
                <View className="items-center justify-center rounded-2xl bg-card p-4">
                  <QRCode
                    value={usable.token || 'https://membego.com'}
                    size={220}
                    color="#0f172a"
                    backgroundColor="transparent"
                  />
                </View>
              </LinearGradient>
            </View>

            {/* Usage count */}
            <Text className="mt-3 text-label-lg text-foreground">
              {usable.usos}
            </Text>
            {/* Expiration */}
            {usable.vencimiento ? (
              <Text className="text-caption text-muted-foreground">
                {usable.vencimiento}
              </Text>
            ) : null}

            {/* ── CTA: grad-vibe-cta ─────────────────────────────────── */}
            <TouchableOpacity
              onPress={() => router.push(`/membresia/${usable.id}`)}
              activeOpacity={0.85}
              className="mt-4 w-full"
            >
              <LinearGradient
                colors={CTA_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ borderRadius: 9999, minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
              >
                <Text className="text-label-lg font-inter-bold text-white">
                  Ver detalle y movimientos
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </Card>

          {/* ── Multi-pase list ──────────────────────────────────────── */}
          {memberships.length > 1 ? (
            <View>
              <Text className="px-1 text-h4 font-inter-semibold text-foreground">
                Tus pases
              </Text>
              <View className="mt-2 gap-2">
                {memberships.map((m: any) => {
                  const isCurrent = m.id === usable.id
                  return (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => setSelectedId(m.id)}
                      activeOpacity={0.7}
                      className={cn(
                        'flex-row items-center justify-between rounded-xl border bg-card p-4',
                        isCurrent ? 'border-vibe-violet' : 'border-border',
                      )}
                    >
                      <View className="flex-1 mr-2">
                        <Text className="text-label-md text-muted-foreground">
                          {m.companyName}
                        </Text>
                        <Text className="text-label-lg text-foreground">
                          {m.planNombre}
                        </Text>
                        <Text className="text-label-md text-muted-foreground">
                          {getEstadoMembresiaLabel(m.estado)}
                        </Text>
                      </View>
                      <ChevronRight size={16} color="#4b5563" />
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : elegida ? (
        /* ── Intermediate state: membership exists but not usable ──── */
        <View className="gap-4">
          <Card className="items-center overflow-hidden rounded-xl border border-border bg-card p-5">
            <Text className="text-label-md text-muted-foreground">{elegida.companyName}</Text>
            <Text className="mt-0.5 text-center text-h2 font-inter-bold text-foreground" numberOfLines={2}>
              {elegida.planNombre}
            </Text>
            <View className="my-5 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6">
              <View className="rounded-full bg-vibe-lavanda px-3 py-1">
                <Text className="text-xs font-inter-semibold text-vibe-violet">
                  {getEstadoMembresiaLabel(elegida.estado)}
                </Text>
              </View>
              <Text className="mt-3 text-center text-small text-muted-foreground px-2">
                {elegida.estado === 'PENDIENTE' || elegida.estado === 'PENDIENTE_PAGO'
                  ? 'Esta membresía está pendiente de pago. Completa el pago para activar tu código QR de acceso.'
                  : elegida.estado === 'VENCIDA'
                    ? 'Esta membresía se encuentra vencida. Renueva tu plan para volver a generar tu código QR.'
                    : 'El código QR no está disponible en este momento.'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push(`/membresia/${elegida.id}`)}
              activeOpacity={0.85}
              className="w-full"
            >
              <LinearGradient
                colors={CTA_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ borderRadius: 9999, minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
              >
                <Text className="text-label-lg font-inter-bold text-white">
                  {elegida.estado === 'PENDIENTE' || elegida.estado === 'PENDIENTE_PAGO'
                    ? 'Completar pago y activar pase'
                    : 'Ver detalle y gestionar'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </Card>

          {memberships.length > 1 ? (
            <View>
              <Text className="px-1 text-h4 font-inter-semibold text-foreground">Tus pases</Text>
              <View className="mt-2 gap-2">
                {memberships.map((m: any) => {
                  const isCurrent = m.id === elegida.id
                  return (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => setSelectedId(m.id)}
                      activeOpacity={0.7}
                      className={cn(
                        'flex-row items-center justify-between rounded-xl border bg-card p-4',
                        isCurrent ? 'border-vibe-violet' : 'border-border',
                      )}
                    >
                      <View className="flex-1 mr-2">
                        <Text className="text-label-md text-muted-foreground">
                          {m.companyName}
                        </Text>
                        <Text className="text-label-lg text-foreground">
                          {m.planNombre}
                        </Text>
                        <Text className="text-label-md text-muted-foreground">
                          {getEstadoMembresiaLabel(m.estado)}
                        </Text>
                      </View>
                      <ChevronRight size={16} color="#4b5563" />
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        /* ── Empty state: sin beneficio activo ──────────────────────── */
        <View className="gap-5">
          <View className="items-center px-4 pt-6 text-center">
            <View className="h-28 w-28 items-center justify-center rounded-xl bg-vibe-niebla">
              <QrIcon size={56} color="#7c3aed" />
              <View className="absolute -right-2 -top-2 h-8 w-8 items-center justify-center rounded-full border border-vibe-chip bg-card">
                <Frown size={20} color="#7c3aed" />
              </View>
            </View>
            <Text className="mt-4 text-h1 font-inter-extrabold text-foreground text-center">
              No tienes beneficios activos
            </Text>
            <Text className="mt-1 max-w-xs text-center text-small text-muted-foreground">
              {sinBeneficio?.bienvenida ||
                'Nada aquí todavía. Solo posibilidades para ahorrar y disfrutar cada día.'}
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/inicio')}
              className="mt-3 flex-row items-center gap-1 rounded-lg px-2 py-2"
            >
              <Text className="text-label-lg font-inter-semibold text-vibe-violet">
                Continuar explorando negocios locales
              </Text>
              <ChevronRight size={16} color="#7c3aed" />
            </TouchableOpacity>
          </View>

          {/* Welcome benefit (if available) */}
          {sinBeneficio?.bienvenida ? (
            <Card className="overflow-hidden rounded-xl border border-border bg-card">
              <View className="border-l-4 border-retail-cyan p-4">
                <View className="self-start rounded-full bg-vibe-niebla px-2.5 py-1">
                  <Text className="text-label-sm font-inter-bold uppercase tracking-wide text-vibe-ink">
                    Beneficio exclusivo
                  </Text>
                </View>
                <Text className="mt-2 text-h4 font-inter-semibold text-foreground">
                  {sinBeneficio.bienvenida}
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/inicio')}
                  activeOpacity={0.85}
                  className="mt-3"
                >
                  <LinearGradient
                    colors={CTA_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ borderRadius: 9999, minHeight: 44 }}
                    className="items-center justify-center px-4"
                  >
                    <Text className="text-label-lg font-inter-bold text-white">
                      Ver membresías disponibles
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </Card>
          ) : null}

          {/* How it works */}
          <View className="flex-row items-start gap-3 rounded-xl bg-vibe-lavanda p-4">
            <View className="mt-0.5">
              <QrIcon size={20} color="#7c3aed" />
            </View>
            <View className="flex-1">
              <Text className="text-label-lg font-inter-semibold text-foreground">
                ¿Cómo funciona Mi QR?
              </Text>
              <Text className="mt-0.5 text-caption text-muted-foreground">
                Al suscribirte a cualquier negocio afiliado, tu código personal se activará aquí al
                instante para canjear en caja.
              </Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  )
}
