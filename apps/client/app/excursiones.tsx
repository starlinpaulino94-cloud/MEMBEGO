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
  Compass,
  AlertCircle,
  Star,
  Sparkles,
  CalendarDays,
  Flame,
} from 'lucide-react-native'

import { useAuth } from '../src/lib/auth-context'
import { useExcursiones } from '../src/hooks/useExcursiones'
import { ExcursionCard } from '../src/components/public/ExcursionCard'
import { PageHeader } from '../src/components/ui/PageHeader'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'
import type { ExcursionCardData, ExcursionesParams } from '../src/lib/api'

/**
 * EXCURSIONES — feed de tours y experiencias (RN port de /cliente/excursiones).
 *
 * Feed con secciones curadas (Mis empresas, Próximas salidas, Destacadas,
 * Nuevas) + búsqueda inline con chips de categoría.
 *
 * ponytail: "Mis reservas" → placeholder /mis-excursiones (ya existe).
 * "Explorar empresas" → /explorar (ya existe).
 */
export default function ExcursionesScreen() {
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
  const params: ExcursionesParams = useMemo(() => ({
    q: searchQuery || undefined,
    categoria: categoriaActiva,
  }), [searchQuery, categoriaActiva])

  const { data, isLoading, isError, refetch } = useExcursiones(params, isAuthenticated)

  const feed = data?.feed ?? null
  const categorias = data?.categorias ?? []
  const resultados = data?.resultados ?? []

  const sinExcursiones =
    feed != null &&
    feed.misEmpresas.length === 0 &&
    feed.destacadas.length === 0 &&
    feed.nuevas.length === 0 &&
    feed.proximasSalidas.length === 0

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
          icon={<Compass size={40} color="#0284c7" />}
          title="Inicia sesión para ver excursiones"
          description="Tours, experiencias y aventuras de tus empresas favoritas."
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
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-4">
          <PageHeader
            eyebrow="Experiencias"
            title="Excursiones y Tours"
            description="Descubre aventuras y paseos de tus empresas favoritas. Reserva tu cupo fácilmente."
            action={
              <View className="flex-row gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => router.push('/mis-excursiones' as any)}
                >
                  <CalendarDays size={16} color="#0284c7" />
                  <Text className="ml-1.5 text-sm font-inter-semibold text-primary">
                    Mis reservas
                  </Text>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => router.push('/explorar' as any)}
                >
                  <Compass size={16} color="#0284c7" />
                  <Text className="ml-1.5 text-sm font-inter-semibold text-primary">
                    Explorar
                  </Text>
                </Button>
              </View>
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
              placeholder="Buscar: saona, catamarán, buggy, tirolesa…"
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
                  key={cat.slug}
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
              title="No pudimos cargar las excursiones"
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
                Cargando excursiones…
              </Text>
            </View>
          ) : buscando ? (
            /* ── Resultados de búsqueda ──────────────────────────────── */
            <View>
              <Text className="text-sm text-muted-foreground">
                {resultados.length}{' '}
                {resultados.length === 1 ? 'excursión encontrada' : 'excursiones encontradas'}
                {categoriaActiva
                  ? ` en ${categorias.find((c) => c.slug === categoriaActiva)?.name ?? ''}`
                  : ''}
                {searchQuery ? ` para «${searchQuery}»` : ''}
              </Text>
              {resultados.length === 0 ? (
                <View className="mt-6">
                  <EmptyState
                    icon={<Compass size={40} color="#0284c7" />}
                    title={
                      searchQuery
                        ? `Sin resultados para «${searchQuery}»`
                        : 'Sin excursiones con esos filtros'
                    }
                    description="Prueba con otra palabra, cambia de categoría o mira todas las excursiones."
                    action={
                      <Button
                        variant="outline"
                        onPress={() => {
                          setSearchInput('')
                          setSearchQuery('')
                          setCategoriaActiva(undefined)
                        }}
                      >
                        Ver todas las excursiones
                      </Button>
                    }
                  />
                </View>
              ) : (
                <ExcursionGrid excursiones={resultados} />
              )}
            </View>
          ) : feed == null ? (
            <EmptyState
              icon={<AlertCircle size={40} color="#e7000b" />}
              title="No pudimos cargar las excursiones"
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
              {/* De tus empresas */}
              <SeccionExcursiones
                icon={<Star size={16} color="#0284c7" />}
                titulo="De tus empresas"
                descripcion="Donde eres cliente y las que sigues. Tus favoritas primero."
                excursiones={feed.misEmpresas}
              />

              {/* Próximas salidas */}
              <SeccionExcursiones
                icon={<CalendarDays size={16} color="#0284c7" />}
                titulo="Próximas salidas"
                descripcion="Tours con salidas programadas y cupos disponibles."
                excursiones={feed.proximasSalidas}
              />

              {/* Destacadas */}
              <SeccionExcursiones
                icon={<Flame size={16} color="#0284c7" />}
                titulo="Destacadas"
                descripcion="Las experiencias más populares y reservadas."
                excursiones={feed.destacadas}
              />

              {/* Nuevas */}
              <SeccionExcursiones
                icon={<Sparkles size={16} color="#0284c7" />}
                titulo="Nuevas aventuras"
                descripcion="Publicadas recientemente por las empresas."
                excursiones={feed.nuevas}
              />

              {/* Sin excursiones */}
              {sinExcursiones && (
                <EmptyState
                  icon={<Compass size={40} color="#0284c7" />}
                  title="Sin excursiones activas por el momento"
                  description="Sigue empresas para enterarte tan pronto publiquen nuevas experiencias."
                  action={
                    <Button size="lg" onPress={() => router.push('/explorar' as any)}>
                      Explorar empresas
                    </Button>
                  }
                />
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
          ? 'bg-primary'
          : 'border border-border bg-card',
      )}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={cn(
          'text-sm font-inter-semibold',
          active ? 'text-primary-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function ExcursionGrid({ excursiones }: { excursiones: ExcursionCardData[] }) {
  return (
    <View className="flex-row flex-wrap gap-3 mt-4">
      {excursiones.map((e) => (
        <View key={e.id} className="w-[48%]">
          <ExcursionCard excursion={e} />
        </View>
      ))}
    </View>
  )
}

function SeccionExcursiones({
  icon,
  titulo,
  descripcion,
  excursiones,
}: {
  icon: React.ReactNode
  titulo: string
  descripcion?: string
  excursiones: ExcursionCardData[]
}) {
  if (excursiones.length === 0) return null
  return (
    <View className="mb-8">
      <SectionHeader
        title={titulo}
        description={descripcion}
        action={
          <View className="flex-row items-center gap-1">
            {icon}
            <Text className="text-xs text-muted-foreground">
              {excursiones.length}
            </Text>
          </View>
        }
      />
      <ExcursionGrid excursiones={excursiones} />
    </View>
  )
}
