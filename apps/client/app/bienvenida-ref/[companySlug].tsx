import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Sparkles, CalendarDays, Crown, ArrowRight } from 'lucide-react-native'
import { api, type EmpresaDetalleResponse, type ExcursionCardData } from '../../src/lib/api'
import { Card } from '../../src/components/ui/Card'
import { Button } from '../../src/components/ui/Button'
import { cn } from '../../src/lib/cn'

export default function BienvenidaRefScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { companySlug } = useLocalSearchParams<{ companySlug: string }>()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<EmpresaDetalleResponse['company'] | null>(null)
  const [excursiones, setExcursiones] = useState<ExcursionCardData[]>([])

  useEffect(() => {
    if (!companySlug) return

    async function loadData() {
      try {
        setLoading(true)
        const [empresaData, excursionesData] = await Promise.all([
          api.getEmpresa(companySlug),
          api.getExcursiones({ empresa: companySlug }).catch(() => null),
        ])

        setCompany(empresaData.company)

        // Extract excursiones from feed or resultados
        if (excursionesData) {
          const items =
            excursionesData.resultados ??
            excursionesData.feed?.misEmpresas ??
            excursionesData.feed?.destacadas ??
            []
          setExcursiones(items)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar datos')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [companySlug])

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    )
  }

  if (error || !company) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-4"
          keyboardShouldPersistTaps="handled"
        >
          <Card className="mx-auto w-full max-w-md p-6">
            <Text className="text-h2 font-inter-bold text-foreground">
              Empresa no encontrada
            </Text>
            <Text className="mt-2 text-small text-muted-foreground">
              {error || 'No pudimos encontrar la empresa.'}
            </Text>
            <Button
              onPress={() => router.replace('/(tabs)/inicio')}
              className="mt-5 w-full"
            >
              Ir al inicio
            </Button>
          </Card>
        </ScrollView>
      </View>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-8"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
    >
      <View className="mx-auto w-full max-w-2xl">
        {/* Header de bienvenida */}
        <View className="items-center">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Sparkles size={32} color="#0284c7" />
          </View>
          <Text className="mt-6 text-center text-h1 font-inter-bold tracking-tight text-foreground">
            ¡Bienvenido a {company.name}!
          </Text>
          <Text className="mt-3 text-center text-base text-muted-foreground">
            Tu cuenta está lista. Aquí tienes lo que puedes hacer ahora.
          </Text>
        </View>

        {/* Excursiones disponibles */}
        {excursiones.length > 0 && (
          <Card className="mt-8 overflow-hidden p-0">
            <View className="border-b border-border bg-muted/30 p-4">
              <View className="flex-row items-center gap-2">
                <CalendarDays size={20} color="#0284c7" />
                <Text className="text-base font-inter-semibold text-foreground">
                  Excursiones disponibles
                </Text>
              </View>
              <Text className="mt-1 text-sm text-muted-foreground">
                Reserva directamente desde aquí.
              </Text>
            </View>

            {excursiones.map((exc, idx) => (
              <View
                key={exc.id}
                className={cn(
                  'flex-row items-center gap-4 p-4',
                  idx < excursiones.length - 1 && 'border-b border-border',
                )}
              >
                {exc.portadaUrl ? (
                  <Image
                    source={{ uri: exc.portadaUrl }}
                    className="h-14 w-14 rounded-lg"
                  />
                ) : (
                  <View className="h-14 w-14 items-center justify-center rounded-lg bg-muted">
                    <CalendarDays size={24} color="#71717a" />
                  </View>
                )}

                <View className="flex-1">
                  <Text className="font-inter-medium text-foreground" numberOfLines={1}>
                    {exc.nombre}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-3">
                    {exc.categoria && (
                      <Text className="text-xs text-muted-foreground">
                        {exc.categoria}
                      </Text>
                    )}
                    {exc.duracionMin && (
                      <Text className="text-xs text-muted-foreground">
                        {exc.duracionMin} min
                      </Text>
                    )}
                  </View>
                </View>

                <View className="items-end">
                  {exc.precioDesde != null && (
                    <Text className="text-sm font-inter-semibold text-primary">
                      {exc.precioDesde > 0
                        ? `$${exc.precioDesde.toLocaleString()}`
                        : 'Gratis'}
                    </Text>
                  )}
                  <ArrowRight size={16} color="#71717a" />
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* Sin excursiones */}
        {excursiones.length === 0 && (
          <Card className="mt-8 p-6">
            <Text className="text-center text-muted-foreground">
              Explora las opciones de {company.name} desde tu perfil.
            </Text>
          </Card>
        )}

        {/* CTAs */}
        <View className="mt-8 gap-3">
          <Button
            onPress={() =>
              router.push(`/empresas/${companySlug}`)
            }
            className="w-full"
          >
            Ver perfil de {company.name}
          </Button>
          <Button
            onPress={() => router.replace('/(tabs)/inicio')}
            variant="outline"
            className="w-full"
          >
            Explorar más negocios
          </Button>
        </View>
      </View>
    </ScrollView>
  )
}
