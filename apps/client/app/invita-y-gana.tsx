import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Gift,
  Users,
  Clock,
  Trophy,
  Send,
  Ticket,
  CheckCircle2,
  Copy,
  Share2,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useReferidos } from '../src/hooks/useReferidos'
import { formatDate } from '../src/lib/format'
import { cn } from '../src/lib/cn'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { EmptyState } from '../src/components/ui/EmptyState'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { StatCard } from '../src/components/ui/StatCard'
import { Skeleton } from '../src/components/ui/Skeleton'
import type { ReferidosResponse } from '../src/lib/api'

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** "Hoy", "Ayer", "hace 2 días", "hace 3 meses" — para el historial. */
function tiempoRelativo(fecha: string): string {
  const d = new Date(fecha)
  const dias = Math.round((d.getTime() - Date.now()) / 86400000)
  try {
    const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
    const texto =
      Math.abs(dias) < 30
        ? rtf.format(dias, 'day')
        : rtf.format(Math.round(dias / 30), 'month')
    return texto.charAt(0).toUpperCase() + texto.slice(1)
  } catch {
    // ponytail: fallback manual si Intl.RelativeTimeFormat no existe en Hermes
    if (Math.abs(dias) < 1) return 'Hoy'
    if (Math.abs(dias) === 1) return dias > 0 ? 'Mañana' : 'Ayer'
    if (Math.abs(dias) < 30) return `hace ${Math.abs(dias)} días`
    return `hace ${Math.abs(Math.round(dias / 30))} meses`
  }
}

/** Extrae la primera frase del beneficio (max 80 chars) para chips/mensajes. */
function beneficioCorto(beneficio: string | null): string {
  if (!beneficio) return 'un regalo de bienvenida'
  const texto = typeof beneficio === 'string' ? beneficio : ''
  const primeraFrase = texto.split(/[.!\n]/)[0]?.trim().slice(0, 80)
  return primeraFrase || 'un regalo de bienvenida'
}

/* ── Loading skeleton ────────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <View className="flex-1 bg-background p-4 gap-4">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-52 w-full rounded-2xl" />
      <View className="flex-row gap-3">
        <Skeleton className="h-24 flex-1 rounded-2xl" />
        <Skeleton className="h-24 flex-1 rounded-2xl" />
      </View>
      <View className="flex-row gap-3">
        <Skeleton className="h-24 flex-1 rounded-2xl" />
        <Skeleton className="h-24 flex-1 rounded-2xl" />
      </View>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </View>
  )
}

/* ── Campaign selector (cuando hay más de un negocio) ────────────────────── */

function SelectorNegocio({
  campanas,
  selectedId,
  onSelect,
}: {
  campanas: ReferidosResponse['campanas']
  selectedId: string
  onSelect: (slug: string) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 px-1"
      className="-mx-1 pb-1"
    >
      {campanas.map((o) => {
        const activa = o.company.id === selectedId
        return (
          <Pressable
            key={o.company.id}
            onPress={() => onSelect(o.company.slug)}
            className={cn(
              'min-h-[44px] shrink-0 items-center justify-center rounded-full px-4',
              activa
                ? 'bg-primary'
                : 'border border-border bg-card',
            )}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
          >
            <Text
              className={cn(
                'text-small font-inter-semibold',
                activa ? 'text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {o.company.name}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/* ── Guest row ───────────────────────────────────────────────────────────── */

function GuestRow({
  invitado,
}: {
  invitado: ReferidosResponse['elegida'] extends infer E
    ? E extends null
      ? never
      : E extends { invitados: (infer I)[] }
        ? I
        : never
    : never
}) {
  const inicial = (invitado.nombre || '?').charAt(0).toUpperCase()
  const esCompletado = invitado.estado === 'COMPLETADO'

  return (
    <View className="flex-row items-center gap-3 py-3 border-b border-border/60">
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Text className="text-sm font-inter-bold text-primary">{inicial}</Text>
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-inter-medium text-foreground" numberOfLines={1}>
          {invitado.nombre}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {tiempoRelativo(invitado.createdAt)}
        </Text>
      </View>
      <View className="shrink-0 items-end gap-1">
        <Badge variant={esCompletado ? 'default' : 'secondary'}>
          {esCompletado ? 'Cliente activo' : 'Registrado'}
        </Badge>
        {invitado.recompensaAplicada && (
          <View className="flex-row items-center gap-1">
            <CheckCircle2 size={12} color="#00864d" />
            <Text className="text-xs font-inter-medium text-success">
              Recompensa obtenida
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export default function InvitaYGanaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const [empresaSlug, setEmpresaSlug] = useState<string | undefined>(undefined)

  const { data, isLoading, isError, refetch } = useReferidos(
    empresaSlug,
    isAuthenticated,
  )

  const campanas = data?.campanas ?? []
  const elegida = data?.elegida ?? null

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <Gift size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para invitar
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Regala beneficios y gana premios por cada amigo que se una.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
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
          <Text className="text-lg font-inter-bold text-foreground">
            Invita y Gana
          </Text>
        </View>
        <LoadingSkeleton />
      </View>
    )
  }

  /* ── Error ─────────────────────────────────────────────────────────── */
  if (isError) {
    return (
      <View className="flex-1 bg-background p-6">
        <View
          className="flex-row items-center gap-2 border-b border-border mb-6"
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
          <Text className="text-lg font-inter-bold text-foreground">
            Invita y Gana
          </Text>
        </View>
        <EmptyState
          icon={<AlertIcon />}
          title="No se pudo cargar"
          description="Revisa tu conexión e inténtalo de nuevo."
          action={
            <Button variant="outline" onPress={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      </View>
    )
  }

  /* ── Empty (sin campañas) ──────────────────────────────────────────── */
  if (!elegida) {
    return (
      <View className="flex-1 bg-background">
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
          <Text className="text-lg font-inter-bold text-foreground">
            Invita y Gana
          </Text>
        </View>
        <View className="flex-1 p-4">
          <EmptyState
            icon={<Gift size={40} color="#0284c7" />}
            title="Sin campañas activas"
            description="Las campañas de «Invita y gana» las publica cada negocio. Únete a uno para participar."
          />
        </View>
      </View>
    )
  }

  /* ── Data ──────────────────────────────────────────────────────────── */
  const { company, campana, codigo, inviteUrl, mensajeCompartir, stats, invitados } =
    elegida

  const regalo = beneficioCorto(
    typeof campana.beneficioInvitado === 'string'
      ? campana.beneficioInvitado
      : null,
  )

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${mensajeCompartir}\n\n${inviteUrl}`,
      })
    } catch {
      // usuario canceló — no-op
    }
  }

  // ponytail: no expo-clipboard instalado. Mostrar Alert con el enlace.
  // Agregar expo-clipboard cuando se permita instalar dependencias.
  const handleCopy = () => {
    Alert.alert(
      'Enlace de invitación',
      inviteUrl,
      [{ text: 'Cerrar', style: 'cancel' }],
    )
  }

  const statCards = [
    { label: 'Invitaciones', value: stats.invitacionesEnviadas, icon: <Send size={20} color="#00864d" />, accent: 'brand' as const },
    { label: 'Registradas', value: stats.personasRegistradas, icon: <Users size={20} color="#00864d" />, accent: 'success' as const },
    { label: 'Recompensas', value: stats.recompensasObtenidas, icon: <Trophy size={20} color="#00864d" />, accent: 'success' as const },
    { label: 'Beneficios', value: stats.beneficiosActivos, icon: <Ticket size={20} color="#00864d" />, accent: 'brand' as const },
  ]

  return (
    <View className="flex-1 bg-background">
      {/* ── Barra con back + título ──────────────────────────────────── */}
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
        <Text className="text-lg font-inter-bold text-foreground">
          Invita y Gana
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* ── Selector de negocio (solo si hay más de uno) ─────────── */}
        {campanas.length > 1 && (
          <View className="mb-4">
            <SelectorNegocio
              campanas={campanas}
              selectedId={company.id}
              onSelect={(slug) => setEmpresaSlug(slug)}
            />
          </View>
        )}

        {/* ── Campaña activa ───────────────────────────────────────── */}
        <Card className="overflow-hidden mb-6 p-0">
          {/* Banner */}
          {(campana.bannerUrl || campana.imagenUrl) && (
            <View className="relative w-full bg-muted" style={{ height: 176 }}>
              <Image
                source={{ uri: (campana.bannerUrl || campana.imagenUrl)! }}
                className="size-full"
                resizeMode="cover"
              />
              <View className="absolute inset-0 bg-black/20" />
            </View>
          )}

          <View className="px-4 pb-5 pt-0">
            {/* Gift icon flotante */}
            <View className="items-center -mt-9 mb-3">
              <View
                className="h-[72px] w-[72px] items-center justify-center rounded-2xl bg-success"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 12,
                  elevation: 8,
                }}
              >
                <Gift size={36} color="#ffffff" />
              </View>
            </View>

            {/* Título + subtítulo */}
            <View className="items-center mb-4">
              <Text className="text-2xl font-inter-extrabold text-foreground text-center tracking-tight">
                {campana.titulo}
              </Text>
              <Text className="text-sm font-inter-medium text-success mt-1 text-center">
                Regala beneficios, gana premios
              </Text>
            </View>

            {/* Beneficio */}
            <View className="flex-row items-center gap-3 rounded-2xl border border-success/80 bg-card p-4 mb-3">
              <View className="h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success">
                <Gift size={22} color="#ffffff" />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-xs font-inter-bold uppercase tracking-wider text-success mb-0.5">
                  Beneficio para tu amigo
                </Text>
                <Text className="text-sm font-inter-semibold text-foreground leading-snug" numberOfLines={2}>
                  {regalo}
                </Text>
              </View>
            </View>

            <Text className="text-xs text-muted-foreground text-center mb-4">
              Sin límite de invitados. Cada amigo que se registra cuenta.
            </Text>

            {/* Botones compartir / copiar */}
            <View className="flex-row gap-3">
              <Button
                variant="success"
                className="flex-1"
                icon={<Share2 size={16} color="#ffffff" />}
                onPress={handleShare}
              >
                Compartir ahora
              </Button>
              <Button
                variant="outline"
                icon={<Copy size={16} color="#111827" />}
                onPress={handleCopy}
              >
                Copiar
              </Button>
            </View>
          </View>
        </Card>

        {/* ── Mi progreso ──────────────────────────────────────────── */}
        <View className="mb-6">
          <SectionHeader
            title="Mi progreso"
            className="mb-3"
          />
          <View className="flex-row flex-wrap gap-3">
            {statCards.map((s) => (
              <View key={s.label} className="w-[48%] flex-1">
                <StatCard
                  label={s.label}
                  value={s.value}
                  icon={s.icon}
                  accent={s.accent}
                />
              </View>
            ))}
          </View>
        </View>

        {/* ── Historial ────────────────────────────────────────────── */}
        <Card className="mb-6">
          <View className="flex-row items-center gap-2 mb-4">
            <Users size={20} color="#71717a" />
            <Text className="text-base font-inter-semibold text-foreground flex-1">
              Historial de invitados
            </Text>
            {invitados.length > 0 && (
              <View className="rounded-full bg-muted px-2 py-0.5">
                <Text className="text-xs font-inter-semibold text-muted-foreground">
                  {invitados.length}
                </Text>
              </View>
            )}
          </View>

          {invitados.length === 0 ? (
            <View className="py-4 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                Aún no has invitado a nadie. ¡Comparte tu enlace!
              </Text>
            </View>
          ) : (
            <View>
              {invitados.map((inv, idx) => (
                <View
                  key={inv.id}
                  className={cn(
                    idx < invitados.length - 1 && 'border-b border-border/60',
                  )}
                >
                  <GuestRow invitado={inv} />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* ── Vigencia ─────────────────────────────────────────────── */}
        {campana.fechaFin && (
          <View className="flex-row items-center justify-center gap-1 pb-4">
            <Clock size={14} color="#71717a" />
            <Text className="text-xs text-muted-foreground">
              Vigente hasta{' '}
              {formatDate(campana.fechaFin, null, { dateStyle: 'long' })}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

/* ── Small helper for error icon ─────────────────────────────────────────── */

function AlertIcon() {
  return (
    <View className="h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10">
      <View
        className="h-12 w-12 items-center justify-center rounded-full bg-destructive/20"
      >
        <Text className="text-2xl font-inter-bold text-destructive">!</Text>
      </View>
    </View>
  )
}
