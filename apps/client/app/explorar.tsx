import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Search, Store } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useExplorar } from '../src/hooks/useExplorar'
import { ExplorarEmpresasList } from '../src/components/cliente/ExplorarEmpresasList'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'
import type { BusinessCardData } from '../src/components/marketplace/BusinessCard'

/**
 * Pantalla de explorar empresas.
 *
 * Muestra: buscador, chips de categoría, contador de resultados,
 * grid de empresas (BusinessCard), empty state.
 */
export default function ExplorarScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  // Search: input state + committed query (updated on submit)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')

  const { data, isLoading, isError, refetch } = useExplorar(
    {
      q: searchQuery || undefined,
      category: selectedCategory || undefined,
    },
    isAuthenticated,
  )

  // Auth gate: redirect to login if not authenticated
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

  const empresas = (data?.empresas ?? []) as BusinessCardData[]
  const categorias = data?.categorias ?? []
  const seguidasIds = data?.seguidasIds ?? []
  const filtrando = Boolean(searchQuery || selectedCategory)
  const categoriaActiva = categorias.find((c) => c.slug === selectedCategory)

  function handleSearchSubmit() {
    Keyboard.dismiss()
    setSearchQuery(searchInput.trim())
  }

  function handleClearSearch() {
    setSearchInput('')
    setSearchQuery('')
  }

  function handleCategoryToggle(slug: string) {
    setSelectedCategory((prev) => (prev === slug ? '' : slug))
  }

  return (
    <View className="flex-1 bg-background">
      {/* ── Header con back + título ─────────────────────────────────── */}
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
          onPress={() => router.back()}
          className="rounded-lg p-2 active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">
          Explorar empresas
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Page header ────────────────────────────────────────────── */}
        <View className="mb-4">
          <Text className="text-2xl font-inter-bold text-foreground">
            Encuentra membresías
          </Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            Suscríbete a los negocios cerca de ti y ahorra en cada visita.
          </Text>
        </View>

        {/* ── Buscador ───────────────────────────────────────────────── */}
        <View className="relative mb-4">
          <View className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
            <Search size={18} color="#9ca3af" />
          </View>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            placeholder="Buscar lavados, peluquerías, gym…"
            placeholderTextColor="#9ca3af"
            className="h-11 rounded-xl border border-border bg-card pl-10 pr-10 text-base text-foreground"
            accessibilityLabel="Buscar negocios"
          />
          {searchInput.length > 0 ? (
            <Pressable
              onPress={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 active:bg-muted"
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
            >
              <Text className="text-sm text-muted-foreground">✕</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Chips de categoría ─────────────────────────────────────── */}
        {categorias.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
            className="mb-4"
          >
            {/* "Todas" chip */}
            <Pressable
              onPress={() => setSelectedCategory('')}
              className={cn(
                'rounded-full px-4 py-2.5',
                !selectedCategory
                  ? 'bg-retail-deep'
                  : 'border border-border bg-card',
              )}
              accessibilityRole="button"
              accessibilityState={{ selected: !selectedCategory }}
            >
              <Text
                className={cn(
                  'text-sm font-inter-semibold',
                  !selectedCategory ? 'text-white' : 'text-muted-foreground',
                )}
              >
                Todas
              </Text>
            </Pressable>

            {categorias.map((cat) => {
              const activa = cat.slug === selectedCategory
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => handleCategoryToggle(cat.slug)}
                  className={cn(
                    'rounded-full px-4 py-2.5',
                    activa
                      ? 'bg-retail-deep'
                      : 'border border-border bg-card',
                  )}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activa }}
                >
                  <Text
                    className={cn(
                      'text-sm font-inter-semibold',
                      activa ? 'text-white' : 'text-muted-foreground',
                    )}
                  >
                    {cat.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {/* ── Loading skeletons ──────────────────────────────────────── */}
        {isLoading && !data ? (
          <View className="gap-3">
            {[0, 1, 2].map((i) => (
              <View key={i}>
                <Skeleton className="h-44 w-full rounded-xl" />
              </View>
            ))}
          </View>
        ) : isError && !data ? (
          /* ── Error state ────────────────────────────────────────────── */
          <View className="items-center py-8">
            <Text className="mb-3 text-center text-base text-muted-foreground">
              No pudimos cargar los negocios. Intenta de nuevo.
            </Text>
            <Button onPress={() => refetch()} variant="outline">
              Reintentar
            </Button>
          </View>
        ) : empresas.length === 0 ? (
          /* ── Empty state ────────────────────────────────────────────── */
          <EmptyState
            icon={<Store size={32} color="#0284c7" />}
            title={
              searchQuery
                ? `Sin resultados para «${searchQuery}»`
                : 'Todavía no hay negocios aquí'
            }
            description={
              filtrando
                ? 'Prueba con otra palabra o quita los filtros para ver todos.'
                : 'Vuelve pronto: se van sumando negocios nuevos.'
            }
            action={
              filtrando ? (
                <Button
                  onPress={() => {
                    setSearchInput('')
                    setSearchQuery('')
                    setSelectedCategory('')
                  }}
                  variant="outline"
                >
                  Ver todos
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* ── Contador de resultados ─────────────────────────────── */}
            <Text className="mb-3 text-sm text-muted-foreground" role="status">
              {empresas.length}{' '}
              {empresas.length === 1 ? 'negocio' : 'negocios'}
              {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
              {searchQuery ? ` para «${searchQuery}»` : ''}
            </Text>

            {/* ── Lista de empresas ──────────────────────────────────── */}
            <ExplorarEmpresasList
              empresas={empresas}
              seguidasIds={seguidasIds}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}
