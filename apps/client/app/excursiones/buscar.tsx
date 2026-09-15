import React, { useState, useMemo, useEffect, useCallback } from 'react'
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
  Filter,
  X,
  Compass,
  AlertCircle,
  ChevronDown,
} from 'lucide-react-native'

import { useAuth } from '../../src/lib/auth-context'
import { useBuscarExcursiones } from '../../src/hooks/useExcursiones'
import { ExcursionCard } from '../../src/components/public/ExcursionCard'
import { PageHeader } from '../../src/components/ui/PageHeader'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { Button } from '../../src/components/ui/Button'
import { cn } from '../../src/lib/cn'
import type { BuscarParams, ExcursionCardData } from '../../src/lib/api'

/**
 * BUSCAR EXCURSIONES — búsqueda avanzada con filtros (RN port de
 * /cliente/excursiones/buscar).
 *
 * Filtros: texto, categoría, empresa, fecha desde/hasta, solo con stock.
 * Paginación con botones Anterior/Siguiente.
 *
 * ponytail: los date pickers usan TextInput con type="text" porque RN no
 * tiene date picker nativo sin dependencia. El BFF acepta strings ISO.
 * Agregar date picker nativo cuando se permita instalar dependencias.
 */
export default function BuscarExcursionesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  // Filter state
  const [query, setQuery] = useState('')
  const [categoria, setCategoria] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [soloConStock, setSoloConStock] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Auth gate
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login' as any)
    }
  }, [authLoading, isAuthenticated, router])

  // Build search params
  const params: BuscarParams = useMemo(() => {
    const p: BuscarParams = { p: pagina }
    if (query) p.q = query
    if (categoria) p.cat = categoria
    if (empresa) p.emp = empresa
    if (fechaDesde) p.fd = fechaDesde
    if (fechaHasta) p.fh = fechaHasta
    if (soloConStock) p.stock = '1'
    return p
  }, [query, categoria, empresa, fechaDesde, fechaHasta, soloConStock, pagina])

  const enabled = isAuthenticated && submitted
  const { data, isLoading, isError, refetch } = useBuscarExcursiones(
    enabled ? params : undefined,
    enabled,
  )

  // Cast BFF response — excursiones is ExcursionPublica[] (JsonObject) but
  // the BFF returns ExcursionCardData-compatible shapes.
  const excursiones = (data?.excursiones ?? []) as unknown as ExcursionCardData[]
  const total = data?.total ?? 0
  const totalPaginas = data?.totalPaginas ?? 0
  const categoriasBff = data?.categorias ?? []
  const empresasBff = data?.empresas ?? []

  const hayFiltros = Boolean(query || categoria || empresa || fechaDesde || fechaHasta || soloConStock)

  const handleSearch = useCallback(() => {
    setPagina(1)
    setSubmitted(true)
  }, [])

  const limpiarFiltros = useCallback(() => {
    setQuery('')
    setCategoria('')
    setEmpresa('')
    setFechaDesde('')
    setFechaHasta('')
    setSoloConStock(false)
    setPagina(1)
  }, [])

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
          icon={<Search size={40} color="#0284c7" />}
          title="Inicia sesión para buscar excursiones"
          description="Encuentra tu próxima aventura."
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
            title="Buscar excursiones"
            description="Encuentra tu próxima aventura filtrando por destino, fecha, categoría y disponibilidad."
            action={
              hayFiltros ? (
                <Button variant="outline" size="sm" onPress={limpiarFiltros}>
                  <X size={16} color="#0284c7" />
                  <Text className="ml-1 text-sm font-inter-semibold text-primary">
                    Limpiar
                  </Text>
                </Button>
              ) : undefined
            }
          />
        </View>

        {/* Search bar + filter toggle */}
        <View className="px-4 mt-2">
          <View className="flex-row gap-2">
            <View className="flex-1 flex-row items-center rounded-xl border border-border bg-card h-12">
              <View className="pl-3">
                <Search size={18} color="#71717a" />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                placeholder="Buscar por nombre, destino, categoría…"
                placeholderTextColor="#71717a"
                className="flex-1 h-full px-2 text-sm text-foreground font-sans"
              />
            </View>
            <Pressable
              onPress={() => setFiltrosAbiertos((v) => !v)}
              className={cn(
                'h-12 flex-row items-center justify-center gap-1.5 rounded-xl border px-3',
                filtrosAbiertos
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card',
              )}
              accessibilityRole="button"
              accessibilityLabel="Abrir filtros"
            >
              <Filter size={16} color={filtrosAbiertos ? '#0284c7' : '#71717a'} />
              <Text
                className={cn(
                  'text-sm font-inter-semibold',
                  filtrosAbiertos ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                Filtros
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Advanced filters */}
        {filtrosAbiertos && (
          <View className="px-4 mt-3">
            <View className="rounded-xl border border-border bg-card p-4">
              {/* Categoría */}
              <FilterDropdown
                label="Categoría"
                options={categoriasBff.map((c) => ({ value: c, label: c }))}
                value={categoria}
                onChange={setCategoria}
                placeholder="Todas las categorías"
              />

              {/* Empresa */}
              <View className="mt-3">
                <FilterDropdown
                  label="Empresa"
                  options={empresasBff.map((e) => ({ value: e.id, label: e.name }))}
                  value={empresa}
                  onChange={setEmpresa}
                  placeholder="Todas las empresas"
                />
              </View>

              {/* Fechas */}
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1">
                  <Text className="mb-1 text-xs font-inter-medium text-muted-foreground">
                    Fecha desde
                  </Text>
                  <View className="rounded-lg border border-border bg-background px-3 h-10 items-center justify-center">
                    <TextInput
                      value={fechaDesde}
                      onChangeText={setFechaDesde}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#71717a"
                      className="text-sm text-foreground font-sans"
                    />
                  </View>
                </View>
                <View className="flex-1">
                  <Text className="mb-1 text-xs font-inter-medium text-muted-foreground">
                    Fecha hasta
                  </Text>
                  <View className="rounded-lg border border-border bg-background px-3 h-10 items-center justify-center">
                    <TextInput
                      value={fechaHasta}
                      onChangeText={setFechaHasta}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#71717a"
                      className="text-sm text-foreground font-sans"
                    />
                  </View>
                </View>
              </View>

              {/* Solo con stock */}
              <Pressable
                onPress={() => setSoloConStock((v) => !v)}
                className="mt-3 flex-row items-center gap-2"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: soloConStock }}
              >
                <View
                  className={cn(
                    'h-5 w-5 items-center justify-center rounded border',
                    soloConStock
                      ? 'border-primary bg-primary'
                      : 'border-border bg-background',
                  )}
                >
                  {soloConStock && <Text className="text-xs font-inter-bold text-primary-foreground">✓</Text>}
                </View>
                <Text className="text-sm text-foreground">
                  Solo con cupos disponibles
                </Text>
              </Pressable>

              {/* Apply button */}
              <View className="mt-4">
                <Button onPress={handleSearch}>
                  Buscar excursiones
                </Button>
              </View>
            </View>
          </View>
        )}

        {/* Results */}
        <View className="mt-6 px-4">
          {!submitted ? (
            <EmptyState
              icon={<Search size={40} color="#0284c7" />}
              title="Busca tu próxima aventura"
              description="Usa los filtros para encontrar excursiones por destino, fecha, categoría y disponibilidad."
            />
          ) : isError ? (
            <EmptyState
              icon={<AlertCircle size={40} color="#e7000b" />}
              title="Error al buscar"
              description="No se pudieron cargar los resultados. Intenta de nuevo."
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
                Buscando excursiones…
              </Text>
            </View>
          ) : excursiones.length === 0 ? (
            <EmptyState
              icon={<Compass size={40} color="#0284c7" />}
              title={query ? `Sin resultados para «${query}»` : 'Sin excursiones disponibles'}
              description={
                query
                  ? `No encontramos excursiones para "${query}". Intenta con otros términos.`
                  : 'Actualmente no hay excursiones publicadas con tus filtros.'
              }
              action={
                hayFiltros ? (
                  <Button variant="outline" onPress={limpiarFiltros}>
                    Limpiar filtros
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <View>
              <Text className="text-sm text-muted-foreground">
                {total} {total === 1 ? 'excursión encontrada' : 'excursiones encontradas'}
              </Text>
              <View className="flex-row flex-wrap gap-3 mt-4">
                {excursiones.map((e) => (
                  <View key={e.id} className="w-[48%]">
                    <ExcursionCard excursion={e} />
                  </View>
                ))}
              </View>

              {/* Pagination */}
              {totalPaginas > 1 && (
                <View className="mt-6 flex-row items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => setPagina((p) => Math.max(1, p - 1))}
                  >
                    <Text className="text-sm font-inter-semibold text-foreground">
                      Anterior
                    </Text>
                  </Button>
                  <Text className="text-sm text-muted-foreground">
                    Página {data?.pagina ?? pagina} de {totalPaginas}
                  </Text>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  >
                    <Text className="text-sm font-inter-semibold text-foreground">
                      Siguiente
                    </Text>
                  </Button>
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

/**
 * ponytail: dropdown simple con Pressable + lista expandida. No usa
 * @react-native-picker/picker (dependencia no instalada). Suficiente para
 * listas cortas de categorías/empresas. Reemplazar con picker nativo cuando
 * se permita instalar dependencias.
 */
function FilterDropdown({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  return (
    <View>
      <Text className="mb-1 text-xs font-inter-medium text-muted-foreground">
        {label}
      </Text>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between rounded-lg border border-border bg-background px-3 h-10"
        accessibilityRole="button"
      >
        <Text
          className={cn(
            'text-sm font-sans',
            selectedLabel ? 'text-foreground' : 'text-muted-foreground',
          )}
          numberOfLines={1}
        >
          {selectedLabel || placeholder}
        </Text>
        <ChevronDown
          size={16}
          color="#71717a"
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open && options.length > 0 && (
        <View className="mt-1 rounded-lg border border-border bg-card max-h-48">
          {/* "Todas" option */}
          <Pressable
            onPress={() => { onChange(''); setOpen(false) }}
            className={cn(
              'px-3 py-2.5 border-b border-border/50',
              !value && 'bg-primary/10',
            )}
          >
            <Text
              className={cn(
                'text-sm',
                !value ? 'font-inter-semibold text-primary' : 'text-foreground',
              )}
            >
              {placeholder}
            </Text>
          </Pressable>
          {options.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => { onChange(opt.value); setOpen(false) }}
              className={cn(
                'px-3 py-2.5 border-b border-border/50',
                value === opt.value && 'bg-primary/10',
              )}
            >
              <Text
                className={cn(
                  'text-sm',
                  value === opt.value ? 'font-inter-semibold text-primary' : 'text-foreground',
                )}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}
