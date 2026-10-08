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
import { Search, Store, X } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useExplorar } from '../src/hooks/useExplorar'
import { ExplorarEmpresasList } from '../src/components/cliente/ExplorarEmpresasList'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'
import type { BusinessCardData } from '../src/components/marketplace/BusinessCard'
import { colors } from '../src/theme/tokens'

/**
 * L4-27 · "Mis empresas" — listado de empresas donde el cliente es miembro
 * o sigue. Reutiliza `useExplorar` + `ExplorarEmpresasList` (mismo BFF que
 * /explorar). Search + chips de categoría + loading/error/empty.
 *
 * Fuente de verdad: `src/app/(cliente)/cliente/empresas/page.tsx` (web).
 */
export default function MisEmpresasScreen() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

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

  function handleClearFilters() {
    setSearchInput('')
    setSearchQuery('')
    setSelectedCategory('')
  }

  function handleCategoryToggle(slug: string) {
    setSelectedCategory((prev) => (prev === slug ? '' : slug))
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, alignItems: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full self-center" style={{ maxWidth: 1120 }}>
        {/* ── Page header ────────────────────────────────────────────── */}
        <View className="mb-5 overflow-hidden rounded-2xl border border-vibe-borde bg-card p-4">
          <View className="flex-row items-center gap-3">
            <View className="size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Store size={22} color={colors.primary.DEFAULT} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-inter-semibold uppercase tracking-wider text-primary">
                Tu espacio
              </Text>
              <Text className="mt-0.5 text-2xl font-inter-bold text-foreground">
                Mis empresas
              </Text>
            </View>
          </View>
          <Text className="mt-3 text-sm leading-5 text-muted-foreground">
            Encuentra tus membresías y sigue las novedades de tus negocios favoritos.
          </Text>
        </View>

        {/* ── Buscador ───────────────────────────────────────────────── */}
        <View className="mb-4 flex-row items-center gap-2 rounded-2xl border border-border bg-card p-1.5 pl-3">
          <Search size={18} color={colors.surface.mutedForeground} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            placeholder="Buscar empresas…"
            placeholderTextColor={colors.surface.mutedForeground}
            className="h-11 min-w-0 flex-1 text-base text-foreground"
            accessibilityLabel="Buscar empresas"
          />
          {searchInput.length > 0 ? (
            <Pressable
              onPress={handleClearSearch}
              className="size-9 items-center justify-center rounded-xl active:bg-muted"
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
            >
              <X size={18} color={colors.surface.mutedForeground} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSearchSubmit}
            className="h-10 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary px-3"
            accessibilityRole="button"
            accessibilityLabel="Buscar empresas"
          >
            <Search size={16} color="#ffffff" />
            <Text className="text-sm font-inter-semibold text-white">Buscar</Text>
          </Pressable>
        </View>

        {/* ── Chips de categoría ─────────────────────────────────────── */}
        {categorias.length > 0 ? (
          <View className="mb-4">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-sm font-inter-semibold text-foreground">
                Filtrar por categoría
              </Text>
              {selectedCategory ? (
                <Pressable
                  onPress={() => setSelectedCategory('')}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar filtro de categoría"
                >
                  <Text className="text-xs font-inter-semibold text-primary">Limpiar</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
            >
              <Pressable
                onPress={() => setSelectedCategory('')}
                className={cn(
                  'rounded-full border px-4 py-2.5',
                  !selectedCategory ? 'border-primary' : 'border-border bg-card',
                )}
                style={!selectedCategory ? { backgroundColor: colors.primary.DEFAULT } : undefined}
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedCategory }}
              >
                <Text className={cn('text-sm font-inter-semibold', !selectedCategory ? 'text-white' : 'text-muted-foreground')}>
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
                      'rounded-full border px-4 py-2.5',
                      activa ? 'border-primary' : 'border-border bg-card',
                    )}
                    style={activa ? { backgroundColor: colors.primary.DEFAULT } : undefined}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activa }}
                  >
                    <Text className={cn('text-sm font-inter-semibold', activa ? 'text-white' : 'text-muted-foreground')}>
                      {cat.name}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
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
          <EmptyState
            icon={<Store size={32} color="#e7000b" />}
            title="No pudimos cargar tus empresas"
            description="Hubo un problema de conexión. Vuelve a intentarlo en unos segundos."
            action={
              <Button onPress={() => refetch()} variant="outline">
                Reintentar
              </Button>
            }
          />
        ) : empresas.length === 0 ? (
          /* ── Empty state ────────────────────────────────────────────── */
          <EmptyState
            icon={<Store size={32} color={colors.primary.DEFAULT} />}
            title={
              filtrando
                ? 'Sin resultados'
                : 'Todavía no tienes negocios'
            }
            description={
              filtrando
                ? 'Prueba con otra palabra o quita los filtros para ver todos.'
                : 'Aquí aparecerán los negocios donde eres cliente y los que sigas para recibir sus promociones.'
            }
            action={
              filtrando ? (
                <Button
                  onPress={() => {
                    handleClearFilters()
                  }}
                  variant="outline"
                >
                  Ver todos
                </Button>
              ) : (
                <Button
                  onPress={() => router.push('/explorar' as any)}
                  variant="default"
                  size="lg"
                >
                  Explorar empresas
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* ── Contador de resultados ─────────────────────────────── */}
            <View className="mb-3 flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-sm text-muted-foreground" role="status">
                {empresas.length} {empresas.length === 1 ? 'negocio' : 'negocios'}
                {categoriaActiva ? ` en ${categoriaActiva.name}` : ''}
                {searchQuery ? ` para «${searchQuery}»` : ''}
              </Text>
              {filtrando ? (
                <Pressable
                  onPress={handleClearFilters}
                  className="rounded-lg px-2 py-1"
                  accessibilityRole="button"
                  accessibilityLabel="Limpiar filtros"
                >
                  <Text className="text-xs font-inter-semibold text-primary">Limpiar</Text>
                </Pressable>
              ) : null}
            </View>

            {/* ── Lista de empresas ──────────────────────────────────── */}
            <ExplorarEmpresasList
              empresas={empresas}
              seguidasIds={seguidasIds}
            />
          </>
        )}
        </View>
      </ScrollView>
    </View>
  )
}
