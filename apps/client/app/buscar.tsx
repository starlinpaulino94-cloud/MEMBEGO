import React, { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Search, Tag, Compass, ChevronRight, Store, AlertCircle } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useBuscar } from '../src/hooks/useBuscar'
import { BusinessCard } from '../src/components/marketplace/BusinessCard'
import { PromotionCard } from '../src/components/public/PromotionCard'
import { ExcursionCard } from '../src/components/public/ExcursionCard'
import { SavePromoButton } from '../src/components/cliente/SavePromoButton'
import { FiltersSidebar } from '../src/components/cliente/FiltersSidebar'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'
import type { BusinessCardData } from '../src/components/marketplace/BusinessCard'
import type { BuscarParams } from '../src/lib/api'

/**
 * BUSCAR — pantalla de búsqueda unificada (RN port de /cliente/buscar).
 *
 * Muestra: barra de búsqueda, chips de filtro rápido, 3 secciones de resultados
 * (Empresas, Promociones, Excursiones), empty state, loading skeletons, error
 * con retry.
 *
 * Nota: el BFF /api/v1/cliente/buscar devuelve arrays vacíos con Bearer
 * (limitación documentada L2-15). La pantalla renderiza las 3 secciones con
 * sus empty states correctamente.
 */
export default function BuscarScreen() {
  const router = useRouter()
  const { q: initialQuery } = useLocalSearchParams<{ q?: string | string[] }>()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filtros, setFiltros] = useState<BuscarParams>({})

  useEffect(() => {
    const query = Array.isArray(initialQuery) ? initialQuery[0] ?? '' : initialQuery ?? ''
    setSearchInput(query)
    setSearchQuery(query.trim())
  }, [initialQuery])

  // Auth gate
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login' as any)
    }
  }, [authLoading, isAuthenticated, router])

  // Query
  const params: BuscarParams = useMemo(() => ({
    q: searchQuery || undefined,
    ...filtros,
  }), [searchQuery, filtros])

  const { data, isLoading, isError, refetch } = useBuscar(params, isAuthenticated)

  // Derived data — transformar EmpresaResumen a BusinessCardData
  const empresas: BusinessCardData[] = useMemo(() =>
    (data?.empresas ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      type: e.type,
      logoUrl: e.logoUrl,
      bannerUrl: e.bannerUrl,
      ciudad: e.ciudad,
      colorPrimario: e.colorPrimario,
      descripcion: e.descripcion,
      totalMembersCount: e.totalMembersCount,
      activePromotionsCount: e.activePromotionsCount,
      isFeatured: e.isFeatured,
      desdePlan: (e.desdePlan as BusinessCardData['desdePlan']) ?? null,
    })),
    [data?.empresas]
  )
  const promociones = data?.promociones ?? []
  const excursiones = data?.excursiones ?? []

  // Categorías y empresas para filtros
  const categorias = useMemo(() => {
    const set = new Set<string>()
    for (const emp of empresas) {
      if (emp.type) set.add(emp.type)
    }
    for (const e of excursiones) {
      if (e.categoria) set.add(e.categoria)
    }
    return Array.from(set).sort()
  }, [empresas, excursiones])

  const empresasFiltro = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string; logoUrl: string | null }>()
    for (const emp of empresas) {
      map.set(emp.id, { id: emp.id, slug: emp.slug, name: emp.name, logoUrl: emp.logoUrl })
    }
    for (const e of excursiones) {
      if (e.empresa?.id) {
        map.set(e.empresa.id, { id: e.empresa.id, slug: e.empresa.slug, name: e.empresa.name, logoUrl: e.empresa.logoUrl })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [empresas, excursiones])

  const total = empresas.length + promociones.length + excursiones.length

  // Loading gate
  if (authLoading || !isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    )
  }

  function handleSearch() {
    Keyboard.dismiss()
    setSearchQuery(searchInput.trim())
  }

  function handleApplyFilters(newFiltros: {
    cat?: string
    emp?: string
    fd?: string
    fh?: string
    stock?: boolean
  }) {
    setFiltros({
      cat: newFiltros.cat,
      emp: newFiltros.emp,
      fd: newFiltros.fd,
      fh: newFiltros.fh,
      stock: newFiltros.stock ? '1' : undefined,
    })
  }

  function handleClearFilters() {
    setFiltros({})
  }

  function handleChipCat(cat: string | undefined) {
    setFiltros((prev) => ({ ...prev, cat }))
  }

  function handleChipStock() {
    setFiltros((prev) => ({
      ...prev,
      stock: prev.stock === '1' ? undefined : '1',
    }))
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="pt-4 pb-5">
          <Text className="text-2xl font-inter-bold text-foreground">
            {searchQuery ? `Resultados para "${searchQuery}"` : 'Buscar en MembeGo'}
          </Text>
          <Text className="mt-0.5 text-sm text-muted-foreground">
            {searchQuery
              ? `Encontramos ${total} resultado${total !== 1 ? 's' : ''}.`
              : 'Empresas afiliadas, ofertas exclusivas y tours para ti.'}
          </Text>
        </View>

        {/* Search bar */}
        <View className="flex-row items-center gap-2 mb-4">
          <View className="flex-1 flex-row items-center rounded-lg border border-border bg-background px-3">
            <Search size={16} color="#71717a" />
            <TextInput
              className="flex-1 ml-2 h-11 text-sm text-foreground"
              placeholder="Buscar beneficios, empresas..."
              placeholderTextColor="#71717a"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Button onPress={handleSearch} variant="default" size="default">
            Buscar
          </Button>
        </View>

        {/* Filter chips (horizontal scroll) */}
        {(categorias.length > 0 || excursiones.length > 0) ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="flex-row gap-2 pb-2"
            className="mb-4"
          >
            {/* Todas */}
            <Pressable
              onPress={() => handleChipCat(undefined)}
              className={cn(
                'h-10 shrink-0 items-center justify-center rounded-full px-4',
                !filtros.cat
                  ? 'bg-retail-deep'
                  : 'border border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-inter-medium',
                  !filtros.cat ? 'text-white' : 'text-muted-foreground',
                )}
              >
                Todas
              </Text>
            </Pressable>
            {/* Categorías */}
            {categorias.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => handleChipCat(filtros.cat === cat ? undefined : cat)}
                className={cn(
                  'h-10 shrink-0 items-center justify-center rounded-full px-4',
                  filtros.cat === cat
                    ? 'bg-retail-deep'
                    : 'border border-border bg-card',
                )}
              >
                <Text
                  className={cn(
                    'text-sm font-inter-medium',
                    filtros.cat === cat ? 'text-white' : 'text-muted-foreground',
                  )}
                >
                  {cat}
                </Text>
              </Pressable>
            ))}
            {/* Solo con cupos */}
            <Pressable
              onPress={handleChipStock}
              className={cn(
                'h-10 shrink-0 items-center justify-center rounded-full px-4',
                filtros.stock === '1'
                  ? 'bg-retail-deep'
                  : 'border border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-inter-medium',
                  filtros.stock === '1' ? 'text-white' : 'text-muted-foreground',
                )}
              >
                Solo con cupos
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {/* Filters sidebar trigger */}
        {(categorias.length > 0 || empresasFiltro.length > 0) ? (
          <View className="mb-5">
            <FiltersSidebar
              categorias={categorias}
              empresas={empresasFiltro}
              filtros={{
                cat: filtros.cat,
                emp: filtros.emp,
                fd: filtros.fd,
                fh: filtros.fh,
                stock: filtros.stock === '1',
              }}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
            />
          </View>
        ) : null}

        {/* Error state */}
        {isError ? (
          <EmptyState
            icon={<AlertCircle size={40} color="#e7000b" />}
            title="Error al cargar resultados"
            description="No pudimos obtener los resultados. Intenta de nuevo."
            action={
              <Button onPress={() => refetch()} variant="outline" size="default">
                Reintentar
              </Button>
            }
          />
        ) : null}

        {/* Loading state */}
        {isLoading && !isError ? (
          <View className="gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <View key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                <Skeleton className="aspect-video w-full" />
                <View className="gap-2 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Results */}
        {!isLoading && !isError ? (
          <>
            {/* Empty state */}
            {total === 0 ? (
              <EmptyState
                icon={<Search size={40} color="#0284c7" />}
                title={searchQuery ? `Sin resultados para "${searchQuery}"` : '¿Qué estás buscando?'}
                description={
                  searchQuery
                    ? `No encontramos resultados para "${searchQuery}". Intenta con otros términos o explora todas las empresas.`
                    : 'Escribe en el buscador para encontrar empresas, ofertas y excursiones.'
                }
                action={
                  <View className="flex-row flex-wrap items-center justify-center gap-3 pt-2">
                    <Button
                      onPress={() => router.push('/explorar' as any)}
                      variant="default"
                      size="lg"
                    >
                      Explorar empresas
                    </Button>
                    <Button
                      onPress={() => router.push('/(tabs)/inicio' as any)}
                      variant="outline"
                      size="lg"
                    >
                      Ver ofertas
                    </Button>
                  </View>
                }
              />
            ) : (
              <View className="gap-8">
                {/* Empresas */}
                {empresas.length > 0 ? (
                  <View>
                    <SectionHeader
                      title={`Empresas y negocios (${empresas.length})`}
                      action={
                        <Pressable
                          onPress={() => router.push('/explorar' as any)}
                          className="flex-row items-center gap-0.5"
                        >
                          <Text className="text-sm font-inter-semibold text-primary">
                            Ver todas
                          </Text>
                          <ChevronRight size={16} color="#0284c7" />
                        </Pressable>
                      }
                    />
                    <View className="mt-3 gap-3">
                      {empresas.map((emp) => (
                        <BusinessCard
                          key={emp.id}
                          company={emp}
                          hrefBase="/empresas"
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* Promociones */}
                {promociones.length > 0 ? (
                  <View>
                    <SectionHeader
                      title={`Promociones y ofertas (${promociones.length})`}
                      action={
                        <Pressable
                          onPress={() => router.push('/promociones' as any)}
                          className="flex-row items-center gap-0.5"
                        >
                          <Text className="text-sm font-inter-semibold text-primary">
                            Ver todas
                          </Text>
                          <ChevronRight size={16} color="#0284c7" />
                        </Pressable>
                      }
                    />
                    <View className="mt-3 flex-row flex-wrap gap-3">
                      {promociones.map((p) => (
                        <View key={p.id} className="relative w-[48%]">
                          <PromotionCard promotion={p} hrefBase="/promociones" />
                          <SavePromoButton promocionId={p.id} />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* Excursiones */}
                {excursiones.length > 0 ? (
                  <View>
                    <SectionHeader
                      title={`Excursiones y tours (${excursiones.length})`}
                      action={
                        <Pressable
                          onPress={() => router.push('/excursiones' as any)}
                          className="flex-row items-center gap-0.5"
                        >
                          <Text className="text-sm font-inter-semibold text-primary">
                            Ver todas
                          </Text>
                          <ChevronRight size={16} color="#0284c7" />
                        </Pressable>
                      }
                    />
                    <View className="mt-3 gap-3">
                      {excursiones.map((e) => (
                        <ExcursionCard key={e.id} excursion={e} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}
