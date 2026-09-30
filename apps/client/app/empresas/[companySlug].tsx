import React, { useEffect, useState } from 'react'
import { ResponsiveDetailSheet } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Users,
  Gift,
  Star,
  BadgeCheck,
  Check,
  Heart,
  MapPin,
  Phone,
  Globe,
  Clock,
  ChevronRight,
  ExternalLink,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useEmpresa } from '../../src/hooks/useEmpresa'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../src/lib/api'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { SectionHeader } from '../../src/components/ui/SectionHeader'
import { Card } from '../../src/components/ui/Card'
import { Badge } from '../../src/components/ui/Badge'
import { Button } from '../../src/components/ui/Button'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'
import { Skeleton } from '../../src/components/ui/Skeleton'
import { cn } from '../../src/lib/cn'
import { formatMoney } from '../../src/lib/format'

/**
 * L4-27 · Detalle de empresa — RN port de `CompanyProfile` (web).
 *
 * Datos: `useEmpresa(slug)` → `{ company, stats, planes, promotions, sucursales, esCliente, sigo }`.
 * Fuente de verdad: `src/app/(cliente)/cliente/empresas/[companySlug]/page.tsx`.
 */

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
  excursiones: 'Excursiones',
}

function EmpresaDetalleScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const { companySlug } = useLocalSearchParams<{ companySlug: string }>()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  const { data, isLoading, isError, refetch } = useEmpresa(
    companySlug,
    isAuthenticated,
  )

  const [sigoLocal, setSigoLocal] = useState(false)
  const [sigoInitialized, setSigoInitialized] = useState(false)
  const [esFavoritaLocal, setEsFavoritaLocal] = useState(false)
  const [favoritaInitialized, setFavoritaInitialized] = useState(false)

  // Sync from server data (state adjustment during render, no extra commit)
  if (data?.sigo !== undefined && !sigoInitialized) {
    setSigoLocal(data.sigo)
    setSigoInitialized(true)
  }
  if (data?.esFavorita !== undefined && !favoritaInitialized) {
    setEsFavoritaLocal(data.esFavorita)
    setFavoritaInitialized(true)
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login' as any)
    }
  }, [authLoading, isAuthenticated, router])

  if (authLoading || !isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    )
  }

  async function toggleSeguir() {
    if (!companySlug) return
    const nuevo = !sigoLocal
    setSigoLocal(nuevo)
    if (!nuevo) setEsFavoritaLocal(false)
    try {
      const res = await api.toggleSeguirEmpresa(companySlug)
      if (res.following !== undefined) setSigoLocal(res.following)
      queryClient.invalidateQueries({ queryKey: ['cliente'] })
      refetch()
    } catch {
      setSigoLocal(!nuevo)
    }
  }

  async function toggleFavorita() {
    if (!companySlug) return
    const nuevo = !esFavoritaLocal
    setEsFavoritaLocal(nuevo)
    if (nuevo) setSigoLocal(true)
    try {
      const res = await api.toggleFavoritaEmpresa(companySlug)
      if (res.following !== undefined) setSigoLocal(res.following)
      if (res.esFavorita !== undefined) setEsFavoritaLocal(res.esFavorita)
      queryClient.invalidateQueries({ queryKey: ['cliente'] })
      refetch()
    } catch {
      setEsFavoritaLocal(!nuevo)
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <View className="flex-1 bg-background">
        <View
          className="flex-row items-center gap-2 border-b border-border bg-background"
          style={{
            paddingLeft: insets.left + 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          <Pressable
            onPress={() => goBackOr(router, '/empresas')}
            className="rounded-lg p-2"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          <Skeleton className="h-48 w-full rounded-2xl" />
          <View className="mt-4 gap-3">
            <Skeleton className="h-8 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </View>
        </ScrollView>
      </View>
    )
  }

  // ── Error state ─────────────────────────────────────────────────────────
  if (isError && !data) {
    return (
      <View className="flex-1 bg-background">
        <View
          className="flex-row items-center gap-2 border-b border-border bg-background"
          style={{
            paddingLeft: insets.left + 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          <Pressable
            onPress={() => goBackOr(router, '/empresas')}
            className="rounded-lg p-2"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <EmptyState
            title="No pudimos cargar la empresa"
            description="Hubo un problema de conexión. Vuelve a intentarlo."
            action={
              <Button onPress={() => refetch()} variant="outline">
                Reintentar
              </Button>
            }
          />
        </View>
      </View>
    )
  }

  if (!data?.company) {
    return (
      <View className="flex-1 bg-background">
        <View
          className="flex-row items-center gap-2 border-b border-border bg-background"
          style={{
            paddingLeft: insets.left + 16,
            paddingRight: 16,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          <Pressable
            onPress={() => goBackOr(router, '/empresas')}
            className="rounded-lg p-2"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={20} color="#111827" />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <EmptyState title="Empresa no encontrada" />
        </View>
      </View>
    )
  }

  const { company, stats, planes, promotions, sucursales, esCliente } = data
  const tipo = TIPO_LABEL[company.type] ?? company.type
  const promos = promotions ?? []
  const sucursal = sucursales?.[0] ?? null

  return (
    <View className="flex-1 bg-background">
      {/* ── Header con back ──────────────────────────────────────────── */}
      <View className="border-b border-border bg-background">
        <DetailPageFrame
          className="flex-row items-center justify-between px-4"
          style={{ paddingLeft: insets.left + 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}
        >
        <Pressable
          onPress={() => goBackOr(router, '/empresas')}
          className="rounded-lg p-2 active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={toggleFavorita}
            className={cn(
              'size-9 items-center justify-center rounded-full border',
              esFavoritaLocal
                ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                : 'border-border bg-card'
            )}
            accessibilityRole="button"
            accessibilityLabel={esFavoritaLocal ? 'Quitar de favoritos' : 'Marcar como favorito'}
          >
            <Heart
              size={18}
              color={esFavoritaLocal ? '#ef4444' : '#9ca3af'}
              fill={esFavoritaLocal ? '#ef4444' : 'transparent'}
            />
          </Pressable>

          <Pressable
            onPress={toggleSeguir}
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              sigoLocal
                ? 'border-success bg-success/10'
                : 'border-border bg-card',
            )}
            accessibilityRole="button"
            accessibilityLabel={sigoLocal ? 'Dejar de seguir' : 'Seguir'}
          >
            {sigoLocal ? (
              <>
                <Check size={16} color="#22c55e" />
                <Text className="text-sm font-inter-semibold text-success">
                  Siguiendo
                </Text>
              </>
            ) : (
              <Text className="text-sm font-inter-semibold text-muted-foreground">
                Seguir
              </Text>
            )}
          </Pressable>
        </View>
        </DetailPageFrame>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <DetailPageFrame>
        {/* ── Banner ─────────────────────────────────────────────────── */}
        <View className="relative w-full bg-muted" style={{ height: 200 }}>
          {company.bannerUrl ? (
            <Image
              source={{ uri: company.bannerUrl }}
              className="size-full"
              resizeMode="cover"
            />
          ) : (
            <View className="size-full items-center justify-center bg-primary/10">
              <Text className="text-4xl font-inter-bold text-primary">
                {company.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* ── Logo overlapping banner ────────────────────────────────── */}
        <View className="px-4" style={{ marginTop: -28 }}>
          <View className="flex-row items-end gap-3">
            {company.logoUrl ? (
              <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 border-card bg-card">
                <Image
                  source={{ uri: company.logoUrl }}
                  className="size-full"
                  resizeMode="cover"
                />
              </View>
            ) : (
              <View className="h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-card bg-primary/10">
                <Text className="text-lg font-inter-bold text-primary">
                  {company.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
            <View className="flex-1 min-w-0 pb-1">
              <Text
                className="text-xl font-inter-bold text-foreground"
                numberOfLines={1}
              >
                {company.name}
              </Text>
              <View className="mt-0.5 flex-row items-center gap-1.5">
                <Badge variant="secondary">{tipo}</Badge>
                {company.ciudad ? (
                  <View className="flex-row items-center gap-0.5">
                    <MapPin size={12} color="#9ca3af" />
                    <Text className="text-xs text-muted-foreground">
                      {company.ciudad}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        {/* ── Relación badges ────────────────────────────────────────── */}
        {esCliente || sigoLocal ? (
          <View className="mt-3 flex-row flex-wrap items-center gap-2 px-4">
            {esCliente ? (
              <View className="flex-row items-center gap-1.5 rounded-full bg-success/15 px-3 py-1">
                <BadgeCheck size={14} color="#22c55e" />
                <Text className="text-xs font-inter-medium text-success">
                  Eres cliente aquí
                </Text>
              </View>
            ) : null}
            {sigoLocal ? (
              <View className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
                <Check size={14} color="#0284c7" />
                <Text className="text-xs font-inter-medium text-primary">
                  Sigues este negocio
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Descripción ────────────────────────────────────────────── */}
        {company.description ? (
          <View className="mt-4 px-4">
            <Text className="text-sm text-muted-foreground leading-relaxed">
              {company.description}
            </Text>
          </View>
        ) : null}

        {/* ── Stats ──────────────────────────────────────────────────── */}
        {stats ? (
          <View className="mt-4 flex-row items-center gap-4 px-4">
            {stats.totalMembers > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Users size={16} color="#0284c7" />
                <Text className="text-sm font-inter-semibold text-foreground tabular-nums">
                  {stats.totalMembers}
                </Text>
                <Text className="text-xs text-muted-foreground">miembros</Text>
              </View>
            ) : null}
            {stats.activePromotions > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Gift size={16} color="#0284c7" />
                <Text className="text-sm font-inter-semibold text-foreground tabular-nums">
                  {stats.activePromotions}
                </Text>
                <Text className="text-xs text-muted-foreground">promos</Text>
              </View>
            ) : null}
            {stats.averageRating != null ? (
              <View className="flex-row items-center gap-1.5">
                <Star size={16} color="#eab308" fill="#eab308" />
                <Text className="text-sm font-inter-semibold text-foreground tabular-nums">
                  {Number(stats.averageRating).toFixed(1)}
                </Text>
                {stats.totalRatings > 0 ? (
                  <Text className="text-xs text-muted-foreground">
                    ({stats.totalRatings})
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Planes disponibles ─────────────────────────────────────── */}
        {planes.length > 0 ? (
          <View className="mt-6 px-4">
            <SectionHeader title="Planes disponibles" />
            <View className="mt-3 gap-3">
              {planes.map((plan) => (
                <Card key={plan.id}>
                  <View className="gap-2">
                    <View className="flex-row items-start justify-between gap-2">
                      <Text
                        className="flex-1 text-base font-inter-bold text-foreground"
                        numberOfLines={1}
                      >
                        {plan.nombre}
                      </Text>
                      <View className="flex-row items-baseline gap-0.5">
                        <Text className="text-lg font-inter-bold text-primary tabular-nums">
                          {formatMoney(plan.precio)}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          /mes
                        </Text>
                      </View>
                    </View>
                    {plan.descripcion ? (
                      <Text
                        className="text-sm text-muted-foreground"
                        numberOfLines={2}
                      >
                        {plan.descripcion}
                      </Text>
                    ) : null}
                    {plan.beneficios.length > 0 ? (
                      <View className="mt-1 gap-1.5">
                        {plan.beneficios.slice(0, 4).map((b, i) => (
                          <View
                            key={i}
                            className="flex-row items-start gap-2"
                          >
                            <Check size={14} color="#22c55e" />
                            <Text className="flex-1 text-xs text-muted-foreground">
                              {b}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Promociones ────────────────────────────────────────────── */}
        {promos.length > 0 ? (
          <View className="mt-6 px-4">
            <SectionHeader
              title="Promociones"
              action={
                promos.length > 3 ? (
                  <Text className="text-sm font-inter-semibold text-primary">
                    Ver todas ({promos.length})
                  </Text>
                ) : undefined
              }
            />
            <View className="mt-3 gap-3">
              {promos.slice(0, 6).map((promo) => (
                <Card key={promo.id}>
                  <View className="flex-row gap-3">
                    {promo.imagenUrl ? (
                      <View className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                        <Image
                          source={{ uri: promo.imagenUrl }}
                          className="size-full"
                          resizeMode="cover"
                        />
                      </View>
                    ) : (
                      <View className="h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Gift size={24} color="#0284c7" />
                      </View>
                    )}
                    <View className="flex-1 min-w-0 gap-1">
                      <Text
                        className="text-sm font-inter-semibold text-foreground"
                        numberOfLines={1}
                      >
                        {promo.titulo}
                      </Text>
                      {promo.descripcion ? (
                        <Text
                          className="text-xs text-muted-foreground"
                          numberOfLines={2}
                        >
                          {promo.descripcion}
                        </Text>
                      ) : null}
                      {promo.precio != null ? (
                        <Text className="text-sm font-inter-bold text-primary tabular-nums">
                          {formatMoney(promo.precio)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Sucursales ─────────────────────────────────────────────── */}
        {sucursales && sucursales.length > 0 ? (
          <View className="mt-6 px-4">
            <SectionHeader title="Sucursales" />
            <View className="mt-3 gap-2">
              {sucursales.map((s) => (
                <Card key={s.id}>
                  <View className="flex-row items-start gap-2">
                    <MapPin size={16} color="#0284c7" />
                    <View className="flex-1 min-w-0">
                      <Text
                        className="text-sm font-inter-semibold text-foreground"
                        numberOfLines={1}
                      >
                        {s.nombre}
                      </Text>
                      <Text
                        className="mt-0.5 text-xs text-muted-foreground"
                        numberOfLines={2}
                      >
                        {s.direccion}
                      </Text>
                      {s.ciudadTexto ? (
                        <Text className="mt-0.5 text-xs text-muted-foreground">
                          {s.ciudadTexto}
                          {s.sectorTexto ? ` · ${s.sectorTexto}` : ''}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── CTA de visita ──────────────────────────────────────────── */}
        {company.website || company.whatsapp || company.telefono ? (
          <View className="mt-6 px-4">
            <SectionHeader title="Visitar" />
            <View className="mt-3 gap-2">
              {company.website ? (
                <Pressable
                  onPress={() => Linking.openURL(company.website!)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-muted"
                  accessibilityRole="link"
                  accessibilityLabel="Sitio web"
                >
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Globe size={18} color="#0284c7" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-inter-semibold text-foreground">
                      Sitio web
                    </Text>
                    <Text
                      className="text-xs text-muted-foreground"
                      numberOfLines={1}
                    >
                      {company.website}
                    </Text>
                  </View>
                  <ExternalLink size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
              {company.whatsapp ? (
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      `https://wa.me/${company.whatsapp!.replace(/\D/g, '')}`,
                    )
                  }
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-muted"
                  accessibilityRole="link"
                  accessibilityLabel="WhatsApp"
                >
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-success/10">
                    <Phone size={18} color="#22c55e" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-inter-semibold text-foreground">
                      WhatsApp
                    </Text>
                    <Text
                      className="text-xs text-muted-foreground"
                      numberOfLines={1}
                    >
                      {company.whatsapp}
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
              {company.telefono && !company.whatsapp ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${company.telefono}`)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-muted"
                  accessibilityRole="link"
                  accessibilityLabel="Teléfono"
                >
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Phone size={18} color="#0284c7" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-inter-semibold text-foreground">
                      Teléfono
                    </Text>
                    <Text
                      className="text-xs text-muted-foreground"
                      numberOfLines={1}
                    >
                      {company.telefono}
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
              {company.googleMapsUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(company.googleMapsUrl!)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-muted"
                  accessibilityRole="link"
                  accessibilityLabel="Ver en mapa"
                >
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-info/10">
                    <MapPin size={18} color="#0284c7" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-inter-semibold text-foreground">
                      Ver en mapa
                    </Text>
                    {sucursal ? (
                      <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                      >
                        {sucursal.direccion}
                      </Text>
                    ) : null}
                  </View>
                  <ExternalLink size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Bottom spacer ──────────────────────────────────────────── */}
        <View style={{ height: insets.bottom + 32 }} />
        </DetailPageFrame>
      </ScrollView>
    </View>
  )
}

export default function EmpresaDetalleScreen() {
  return (
    <ResponsiveDetailSheet>
      <EmpresaDetalleScreenContent />
    </ResponsiveDetailSheet>
  )
}
