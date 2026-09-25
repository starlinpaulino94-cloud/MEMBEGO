import React, { useState, useMemo, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Search,
  Tag,
  Compass,
  AlertCircle,
  Heart,
  Star,
  Sparkles,
  Clock,
  ThumbsUp,
  Flame,
} from 'lucide-react-native'

import { useAuth } from '../src/lib/auth-context'
import { usePromociones } from '../src/hooks/usePromociones'
import { PromotionCard } from '../src/components/public/PromotionCard'
import { SavePromoButton } from '../src/components/cliente/SavePromoButton'
import { BusinessCard } from '../src/components/marketplace/BusinessCard'
import { PageHeader } from '../src/components/ui/PageHeader'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'
import type { PromotionPublic, PromocionesParams, CompanyPublic } from '../src/lib/api'
import type { BusinessCardData } from '../src/components/marketplace/BusinessCard'

/**
 * PROMOCIONES — listado de ofertas (RN port de /cliente/promociones).
 *
 * Feed con secciones curadas (Guardadas, De tus empresas, Destacadas, Nuevas,
 * Expiran pronto, Recomendadas) + búsqueda con chips de categoría.
 *
 * ponytail: el CTA "Explorar empresas" apunta a /explorar (ya existe).
 */
export default function PromocionesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState<string | undefined>(undefined)
  const buscando = Boolean(searchQuery || categoriaActiva)

  // Auth gate
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login' as any)
    }
  }, [authLoading, isAuthenticated, router])

  // Query params
  const params: PromocionesParams = useMemo(() => ({
    q: searchQuery || undefined,
    categoria: categoriaActiva,
  }), [searchQuery, categoriaActiva])

  const { data, isLoading, isError, refetch } = usePromociones(params, isAuthenticated)

  const feed = data?.feed ?? null
  const guardadas = data?.guardadas ?? []
  const categorias = data?.categorias ?? []
  const resultados = data?.resultados ?? []
  const guardadasIdsSet = useMemo(
    () => new Set(data?.guardadasIds ?? []),
    [data?.guardadasIds],
  )

  const sinPromos =
    feed != null &&
    feed.misEmpresas.length === 0 &&
    feed.destacadas.length === 0 &&
    feed.nuevas.length === 0 &&
    feed.expiranPronto.length === 0 &&
    feed.recomendadas.length === 0

  function handleSearch() {
    setSearchQuery(searchInput.trim())
  }

  // Auth loading
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <EmptyState
          icon={<Tag size={40} color="#0284c7" />}
          title="Inicia sesión para ver ofertas"
          description="Descuentos y beneficios de tus empresas favoritas."
          action={
            <Button onPress={() => router.push('/(auth)/login' as any)}>
              Iniciar sesión
            </Button>
          }
        />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-4">
          <PageHeader
            eyebrow="Beneficios"
            title="Ofertas para ti"
            description="Lo de tus empresas favoritas primero. Todo canjeable con tu QR."
            action={
              <Button variant="outline" size="sm" onPress={() => router.push('/explorar' as any)}>
                <Compass size={16} color="#0284c7" />
                <Text className="ml-1.5 text-sm font-inter-semibold text-primary">
                  Explorar empresas
                </Text>
              </Button>
            }
          />
        </View>

        {/* Search bar */}
        <View className="px-4 mt-2">
          <View className="flex-row items-center rounded-xl border border-border bg-card h-12">
            <View className="pl-4">
              <Search size={20} color="#71717a" />
            </View>
            <TextInput
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              placeholder="Buscar ofertas: lavado, pizza, corte…"
              placeholderTextColor="#71717a"
              className="flex-1 h-full px-3 text-base text-foreground font-sans"
            />
          </View>
        </View>

        {/* Category chips */}
        {categorias.length > 0 && (
          <View className="mt-4">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              <CategoryChip
                label="Todas"
                active={!categoriaActiva}
                onPress={() => setCategoriaActiva(undefined)}
              />
              {categorias.map((cat) => (
                <CategoryChip
                  key={cat.id}
                  label={cat.name}
                  active={categoriaActiva === cat.slug}
                  onPress={() =>
                    setCategoriaActiva((prev) =>
                      prev === cat.slug ? undefined : cat.slug,
                    )
                  }
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Content */}
        <View className="mt-6 px-4">
          {isError ? (
            <EmptyState
              icon={<AlertCircle size={40} color="#e7000b" />}
              title="No pudimos cargar las promociones"
              description="Intenta de nuevo en unos momentos."
              action={
                <Button variant="outline" onPress={() => refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#0284c7" size="large" />
              <Text className="mt-3 text-sm text-muted-foreground">
                Cargando ofertas…
              </Text>
            </View>
          ) : buscando ? (
            /* ── Resultados de búsqueda ──────────────────────────────── */
            <View>
              <Text className="text-sm text-muted-foreground" role="status">
                {resultados.length}{' '}
                {resultados.length === 1 ? 'oferta' : 'ofertas'}
                {categoriaActiva
                  ? ` en ${categorias.find((c) => c.slug === categoriaActiva)?.name ?? ''}`
                  : ''}
                {searchQuery ? ` para «${searchQuery}»` : ''}
              </Text>
              {resultados.length === 0 ? (
                <View className="mt-6">
                  <EmptyState
                    icon={<Tag size={40} color="#0284c7" />}
                    title={
                      searchQuery
                        ? `Sin resultados para «${searchQuery}»`
                        : 'Sin ofertas con esos filtros'
                    }
                    description="Prueba con otra palabra, cambia de categoría o mira todas las ofertas."
                    action={
                      <Button
                        variant="outline"
                        onPress={() => {
                          setSearchInput('')
                          setSearchQuery('')
                          setCategoriaActiva(undefined)
                        }}
                      >
                        Ver todas las ofertas
                      </Button>
                    }
                  />
                </View>
              ) : (
                <PromoGrid
                  promociones={resultados}
                  guardadasIds={guardadasIdsSet}
                />
              )}
            </View>
          ) : feed == null ? (
            <EmptyState
              icon={<AlertCircle size={40} color="#e7000b" />}
              title="No pudimos cargar las promociones"
              description="Intenta de nuevo en unos momentos."
              action={
                <Button variant="outline" onPress={() => refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : (
            /* ── Feed con secciones curadas ──────────────────────────── */
            <View>
              {/* Guardadas */}
              <SeccionPromos
                icon={<Heart size={16} color="#0284c7" />}
                titulo="Guardadas"
                promociones={guardadas}
                guardadasIds={guardadasIdsSet}
              />

              {/* Mis empresas */}
              <SeccionPromos
                icon={<Star size={16} color="#0284c7" />}
                titulo="De tus empresas"
                descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
                promociones={feed.misEmpresas}
                guardadasIds={guardadasIdsSet}
              />

              {/* Destacadas */}
              <SeccionPromos
                icon={<Flame size={16} color="#0284c7" />}
                titulo="Destacadas"
                promociones={feed.destacadas}
                guardadasIds={guardadasIdsSet}
              />

              {/* Nuevas */}
              <SeccionPromos
                icon={<Sparkles size={16} color="#0284c7" />}
                titulo="Nuevas"
                descripcion="Publicadas en los últimos 14 días."
                promociones={feed.nuevas}
                guardadasIds={guardadasIdsSet}
              />

              {/* Expiran pronto */}
              <SeccionPromos
                icon={<Clock size={16} color="#0284c7" />}
                titulo="Expiran pronto"
                descripcion="Aprovéchalas antes de que venzan."
                promociones={feed.expiranPronto}
                guardadasIds={guardadasIdsSet}
              />

              {/* Recomendadas */}
              <SeccionPromos
                icon={<ThumbsUp size={16} color="#0284c7" />}
                titulo="Recomendadas para ti"
                descripcion="De empresas parecidas a las que sigues."
                promociones={feed.recomendadas}
                guardadasIds={guardadasIdsSet}
              />

              {/* Sin promociones */}
              {sinPromos && guardadas.length === 0 && (
                <EmptyState
                  icon={<Tag size={40} color="#0284c7" />}
                  title="Sin promociones activas"
                  description="Sigue empresas para recibir sus promociones apenas se publiquen."
                  action={
                    <Button size="lg" onPress={() => router.push('/explorar' as any)}>
                      Explorar empresas
                    </Button>
                  }
                />
              )}

              {/* Descubrir empresas */}
              {feed.empresasRecomendadas.length > 0 && (
                <View className="mb-8">
                  <SectionHeader
                    title="Descubrir empresas"
                    description="También podrían interesarte."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={() => router.push('/explorar' as any)}
                      >
                        <Text className="text-sm font-inter-semibold text-foreground">
                          Ver todas
                        </Text>
                      </Button>
                    }
                  />
                  <View className="gap-3">
                    {feed.empresasRecomendadas.map((c) => (
                      <BusinessCard
                        key={c.id}
                        company={toBusinessCardData(c)}
                        hrefBase="/empresas"
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

/* ── Sub-componentes ─────────────────────────────────────────────────────── */

function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'h-11 items-center justify-center rounded-full px-4',
        active
          ? 'bg-retail-deep'
          : 'border border-border bg-card',
      )}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={cn(
          'text-sm font-inter-semibold',
          active ? 'text-white' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function PromoGrid({
  promociones,
  guardadasIds,
}: {
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  return (
    <View className="flex-row flex-wrap gap-3 mt-4">
      {promociones.map((p) => (
        <View key={p.id} className="w-[48%]">
          <View className="relative">
            <PromotionCard promotion={p} />
            <SavePromoButton
              promocionId={p.id}
              guardada={guardadasIds.has(p.id)}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

function SeccionPromos({
  icon,
  titulo,
  descripcion,
  promociones,
  guardadasIds,
}: {
  icon: React.ReactNode
  titulo: string
  descripcion?: string
  promociones: PromotionPublic[]
  guardadasIds: Set<string>
}) {
  if (promociones.length === 0) return null
  return (
    <View className="mb-8">
      <SectionHeader
        title={titulo}
        description={descripcion}
        action={
          <View className="flex-row items-center gap-1">
            {icon}
            <Text className="text-xs text-muted-foreground">
              {promociones.length}
            </Text>
          </View>
        }
      />
      <PromoGrid promociones={promociones} guardadasIds={guardadasIds} />
    </View>
  )
}

function toBusinessCardData(c: CompanyPublic): BusinessCardData {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    logoUrl: c.logoUrl,
    bannerUrl: c.bannerUrl,
    ciudad: c.ciudad,
    totalMembersCount: c.totalMembersCount,
    activePromotionsCount: c.activePromotionsCount,
    isFeatured: c.isFeatured,
    desdePlan: (c.desdePlan as BusinessCardData['desdePlan']) ?? null,
  }
}
