import React, { useEffect, useState } from 'react'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  ArrowRight,
  Users,
  Gift,
  Star,
  BadgeCheck,
  Check,
  Heart,
  MapPin,
  Clock,
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
import { BackHeader } from '../../src/components/ui/BackHeader'
import { colors } from '../../src/theme/tokens'
import { CompanyProfileExtraSections } from '../../src/components/marketplace/CompanyProfileExtraSections'
import { brandColor, brandForeground } from '../../src/lib/brand-color'
import { FlashOfferStatus, isFlashOffer } from '../../src/components/marketplace/FlashOfferStatus'

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
const HEADER_BACKGROUND_COLORS = [
  colors.overlay.whiteTransparent,
  colors.surface.card,
]

function EmpresaDetalleScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-background')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isSmallScreen = width < 768
  const queryClient = useQueryClient()
  const { companySlug } = useLocalSearchParams<{ companySlug: string }>()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [headerHasSurface, setHeaderHasSurface] = useState(false)
  const headerSurfaceProgress = useSharedValue(0)

  useEffect(() => {
    headerSurfaceProgress.set(withTiming(headerHasSurface ? 1 : 0, {
      duration: 200,
    }))
  }, [headerHasSurface, headerSurfaceProgress])

  const animatedHeaderStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      headerSurfaceProgress.value,
      [0, 1],
      HEADER_BACKGROUND_COLORS,
    ),
  }))

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
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card" : "flex-1 items-center justify-center bg-background"}>
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
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"}>
        <View
          className={sheetBackgroundClass === 'bg-surface-card' ? "flex-row items-center gap-2 border-b border-border bg-surface-card" : "flex-row items-center gap-2 border-b border-border bg-background"}
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
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"}>
        <View
          className={sheetBackgroundClass === 'bg-surface-card' ? "flex-row items-center gap-2 border-b border-border bg-surface-card" : "flex-row items-center gap-2 border-b border-border bg-background"}
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
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"}>
        <View
          className={sheetBackgroundClass === 'bg-surface-card' ? "flex-row items-center gap-2 border-b border-border bg-surface-card" : "flex-row items-center gap-2 border-b border-border bg-background"}
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
  const companyColor = brandColor(company.colorPrimario, colors.primary.DEFAULT)
  const promos = promotions ?? []
  const ubicacion = [company.ciudad, company.provincia, company.pais]
    .filter((parte): parte is string => Boolean(parte))
    .join(', ')
  const horario = typeof company.horario === 'string' ? company.horario.trim() : ''

  return (
    <View className={cn('relative flex-1', sheetBackgroundClass === 'bg-surface-card' ? 'bg-surface-card' : 'bg-background')}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        onScroll={(event) => setHeaderHasSurface(event.nativeEvent.contentOffset.y > 0)}
        scrollEventThrottle={16}
      >
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
              <View className="size-full items-center justify-center bg-primary/10" style={{ backgroundColor: `${companyColor}1A` }}>
                <Text className="text-4xl font-inter-bold" style={{ color: companyColor }}>
                  {company.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* ── Logo overlapping banner ────────────────────────────────── */}
          <View
            className={cn(
              'pl-4 pt-3 bg-white',
              isSmallScreen ? 'w-full pr-4' : 'max-w-full self-start pr-16',
            )}
            style={{
              width: isSmallScreen ? '100%' : undefined,
              marginTop: -28,
              borderTopRightRadius: isSmallScreen ? 0 : 40,
            }}
          >
            <View
              className="flex-row items-end gap-3"
            >
              {company.logoUrl ? (
                <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 border-card bg-card">
                  <Image
                    source={{ uri: company.logoUrl }}
                    className="size-full"
                    resizeMode="cover"
                  />
                </View>
              ) : (
                <View className="h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-card bg-primary/10" style={{ backgroundColor: `${companyColor}1A` }}>
                  <Text className="text-lg font-inter-bold" style={{ color: companyColor }}>
                    {company.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View className={cn('min-w-0 pb-1', isSmallScreen && 'flex-1')}>
                <Text
                  className="text-xl font-inter-bold text-foreground"
                  numberOfLines={2}
                >
                  {company.name}
                </Text>
                <View className="mt-0.5 flex-row items-center gap-1.5">
                  <Badge variant="secondary">{tipo}</Badge>
                  {company.isFeatured ? (
                    <View className="flex-row items-center gap-0.5">
                      <Star size={12} color="#eab308" fill="#eab308" />
                      <Text className="text-xs text-muted-foreground">Destacada</Text>
                    </View>
                  ) : null}
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
                <View className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1" style={{ backgroundColor: `${companyColor}1A` }}>
                  <Check size={14} color={companyColor} />
                  <Text className="text-xs font-inter-medium" style={{ color: companyColor }}>
                    Sigues este negocio
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {ubicacion || horario ? (
            <View className="mt-3 gap-1 px-4">
              {ubicacion ? (
                <View className="flex-row items-start gap-1.5">
                  <MapPin size={15} color="#6b7280" />
                  <Text className="flex-1 text-sm text-muted-foreground">{ubicacion}</Text>
                </View>
              ) : null}
              {horario ? (
                <View className="flex-row items-start gap-1.5">
                  <Clock size={15} color="#6b7280" />
                  <Text className="flex-1 text-sm text-muted-foreground">{horario}</Text>
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
                  <Users size={16} color={companyColor} />
                  <Text className="text-sm font-inter-semibold text-foreground tabular-nums">
                    {stats.totalMembers}
                  </Text>
                  <Text className="text-xs text-muted-foreground">miembros</Text>
                </View>
              ) : null}
              {stats.activePromotions > 0 ? (
                <View className="flex-row items-center gap-1.5">
                  <Gift size={16} color={companyColor} />
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
              <SectionHeader title="Planes de membresía" />
              <Text className="mt-1 text-sm text-muted-foreground">
                Elige el plan que mejor se adapte a ti y recibe tu membresía digital con QR.
              </Text>
              <View className="mt-3 gap-3">
                {planes.map((plan, index) => (
                  <Card key={plan.id}>
                    <View className="gap-2">
                      <View className="flex-row items-start justify-between gap-2">
                        <Text
                          className="flex-1 text-base font-inter-bold text-foreground"
                        >
                          {plan.nombre}
                        </Text>
                        <View className="flex-row items-baseline gap-0.5">
                          <Text className="text-lg font-inter-bold tabular-nums" style={{ color: companyColor }}>
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
                        >
                          {plan.descripcion}
                        </Text>
                      ) : null}
                      <View className="rounded-lg bg-muted p-3">
                        <Text className="text-sm font-inter-semibold text-foreground">
                          {plan.esIlimitado ? 'Usos ilimitados' : `${plan.lavadosIncluidos ?? 0} usos incluidos`}
                        </Text>
                        <Text className="mt-0.5 text-xs text-muted-foreground">Vigencia: {plan.vigenciaDias} días</Text>
                      </View>
                      {plan.beneficios.length > 0 ? (
                        <View className="mt-1 gap-1.5">
                          {plan.beneficios.map((b, i) => (
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
                      <Link href={{ pathname: '/planes/[planId]', params: { planId: plan.id } }} asChild>
                        <Pressable className={cn(
                          'mt-2 flex-row items-center justify-center gap-2 rounded-full border px-4 py-2.5',
                          planes.length > 1 && index === Math.floor(planes.length / 2)
                            ? 'border-primary bg-primary'
                            : 'border-border bg-card',
                        )} accessibilityRole="link">
                          <Text className={cn(
                            'text-sm font-inter-semibold',
                            planes.length > 1 && index === Math.floor(planes.length / 2)
                              ? 'text-white'
                              : 'text-primary',
                          )}>Ver y compartir plan</Text>
                          <ArrowRight size={16} color={planes.length > 1 && index === Math.floor(planes.length / 2) ? brandForeground(companyColor, colors.primary.DEFAULT) : companyColor} />
                        </Pressable>
                      </Link>
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
                title="Promociones vigentes"
                action={
                  promos.length > 3 ? (
                    <Text className="text-sm font-inter-semibold text-primary">
                      Ver todas ({promos.length})
                    </Text>
                  ) : undefined
                }
              />
              <Text className="mt-1 text-sm text-muted-foreground">
                Beneficios exclusivos disponibles ahora mismo.
              </Text>
              <View className="mt-3 gap-3">
                {promos.map((promo) => (
                  <Pressable
                    key={promo.id}
                    onPress={() => router.push(`/promociones/${promo.id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver oferta ${promo.titulo}`}
                  >
                    <Card>
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
                          <View className="h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary/10" style={{ backgroundColor: `${companyColor}1A` }}>
                            <Gift size={24} color={companyColor} />
                          </View>
                        )}
                        <View className="flex-1 min-w-0 gap-1">
                          <Text
                            className="text-sm font-inter-semibold text-foreground"
                            numberOfLines={1}
                          >
                            {promo.titulo}
                          </Text>
                          {isFlashOffer(promo) && promo.vigenciaHasta ? (
                            <FlashOfferStatus hasta={promo.vigenciaHasta} color={companyColor} compact />
                          ) : null}
                          {promo.descripcion ? (
                            <Text
                              className="text-xs text-muted-foreground"
                              numberOfLines={2}
                            >
                              {promo.descripcion}
                            </Text>
                          ) : null}
                          {(promo.venta?.precio ?? promo.precio) != null ? (
                            <Text className="text-sm font-inter-bold tabular-nums" style={{ color: companyColor }}>
                              {formatMoney(promo.venta?.precio ?? promo.precio ?? 0)}
                            </Text>
                          ) : null}
                          {promo.descuento ? (
                            <Text className="text-xs font-inter-semibold" style={{ color: companyColor }}>
                              Descuento: {promo.tipo === 'monto_fijo' ? formatMoney(Number(promo.descuento)) : `-${Math.round(Number(promo.descuento))}%`}
                            </Text>
                          ) : null}
                          {promo.codigo ? (
                            <Text className="mt-1 self-start rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                              Código <Text className="font-inter-bold text-foreground">{promo.codigo}</Text>
                            </Text>
                          ) : null}
                          {promo.vigenciaHasta ? (
                            <Text className="text-xs text-muted-foreground">
                              Válida hasta {new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(promo.vigenciaHasta))}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </Card>
                  </Pressable>
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
                      <MapPin size={16} color={companyColor} />
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
                        {s.telefono ? (
                          <Text className="mt-1 text-xs text-muted-foreground">Tel. {s.telefono}</Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          <CompanyProfileExtraSections
            company={company}
            posts={data.posts}
            resenas={data.resenas}
            puedeOpinar={data.puedeOpinar}
            miResena={data.miResena}
            excursiones={data.excursiones}
          />

          {/* ── Bottom spacer ──────────────────────────────────────────── */}
          <View style={{ height: insets.bottom + 32 }} />
        </DetailPageFrame>
      </ScrollView>

      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            borderBottomWidth: headerHasSurface ? 1 : 0,
            borderBottomColor: colors.surface.border,
          },
          animatedHeaderStyle,
        ]}
      >
        <DetailPageFrame
          className="flex-row items-center justify-between px-4"
          style={{ paddingLeft: insets.left + 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}
        >
          <BackHeader
            className="flex-1"
            title={
              <View className="flex-row justify-end items-center gap-2">
                <Pressable
                  onPress={toggleFavorita}
                  className={cn(
                    'size-9 items-center justify-center rounded-full border transition-colors',
                    esFavoritaLocal
                      ? 'border-red-500 bg-red-500/15'
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
                      ? 'border-success bg-success/15'
                      : 'border-border bg-card',
                  )}
                  accessibilityRole="button"
                  accessibilityLabel={sigoLocal ? 'Dejar de seguir' : 'Seguir'}
                >
                  {sigoLocal ? (
                    <>
                      <Check size={16} color={colors.state.success} />
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
            }
            leftInset={insets.left}
            onBack={() => goBackOr(router, '/empresas')}
            border={false}
          />
        </DetailPageFrame>
      </Animated.View>
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
