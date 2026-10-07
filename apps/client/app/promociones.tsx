import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, Tag } from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { usePromociones } from '../src/hooks/usePromociones'
import { BenefitsFilters } from '../src/components/cliente/BenefitsFilters'
import { BenefitsFeed, BenefitsGrid } from '../src/components/cliente/BenefitsCatalog'
import { PageHeader } from '../src/components/ui/PageHeader'
import { SectionHeader } from '../src/components/ui/SectionHeader'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Button } from '../src/components/ui/Button'
import { colors } from '../src/theme/tokens'
import type { PromocionesParams } from '../src/lib/api'

export default function PromocionesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)
  const filtering = Boolean(query || category)
  const params: PromocionesParams = useMemo(() => ({
    q: query || undefined,
    categoria: category,
  }), [query, category])
  const { data, isLoading, isError, refetch } = usePromociones(params, isAuthenticated)
  const feed = data?.feed ?? null
  const saved = data?.guardadas ?? []
  const results = data?.resultados ?? []
  const savedIds = useMemo(() => new Set(data?.guardadasIds ?? []), [data?.guardadasIds])
  const hasOffers = saved.length > 0 || Boolean(feed && [
    feed.misEmpresas, feed.destacadas, feed.nuevas, feed.expiranPronto, feed.recomendadas,
  ].some((items) => items.length > 0))

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace('/(auth)/login')
  }, [authLoading, isAuthenticated, router])

  function clearFilters() {
    setQuery('')
    setCategory(undefined)
  }

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator color={colors.primary.DEFAULT} size="large" />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-vibe-fondo" style={{ paddingTop: insets.top }}>
        <EmptyState
          icon={<Tag size={40} color={colors.primary.DEFAULT} />}
          title="Inicia sesión para ver tus beneficios"
          description="Encuentra ofertas de tus negocios favoritos y úsalas con tu QR."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-vibe-fondo">
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <View className="w-full max-w-7xl self-center px-4 py-5">
          <PageHeader
            title="Beneficios"
            description="Ofertas para disfrutar con tu QR."
          />
          <View className="mb-5">
            <BenefitsFilters
              categories={data?.categorias ?? []}
              query={query}
              category={category}
              onSearch={setQuery}
              onCategory={setCategory}
              onClear={clearFilters}
            />
          </View>
          {isLoading ? (
            <BenefitsGrid />
          ) : isError || (!filtering && feed === null) ? (
            <EmptyState
              icon={<AlertCircle size={40} color={colors.state.danger} />}
              title="No pudimos cargar los beneficios"
              description="Revisa tu conexión y vuelve a intentarlo."
              action={<Button variant="outline" onPress={() => refetch()}>Reintentar</Button>}
            />
          ) : filtering ? (
            <View className="gap-3">
              <SectionHeader
                title="Resultados"
                description={`${results.length} ${results.length === 1 ? 'beneficio disponible' : 'beneficios disponibles'}`}
              />
              {results.length > 0 ? (
                <BenefitsGrid promotions={results} savedIds={savedIds} />
              ) : (
                <EmptyState
                  icon={<Tag size={40} color={colors.primary.DEFAULT} />}
                  title="No encontramos beneficios"
                  description="Prueba otra búsqueda o cambia la categoría para ver más opciones."
                  action={<Button variant="outline" onPress={clearFilters}>Ver todos los beneficios</Button>}
                />
              )}
            </View>
          ) : hasOffers && feed ? (
            <BenefitsFeed feed={feed} saved={saved} savedIds={savedIds} />
          ) : (
            <EmptyState
              icon={<Tag size={40} color={colors.primary.DEFAULT} />}
              title="Pronto habrá más beneficios"
              description="Sigue tus negocios favoritos para descubrir sus próximas ofertas."
              action={<Button onPress={() => router.push('/explorar')}>Explorar empresas</Button>}
            />
          )}
        </View>
      </ScrollView>
    </View>
  )
}
