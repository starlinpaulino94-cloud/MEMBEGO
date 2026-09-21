import React from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native'
import { useInicio } from '../../src/hooks/useInicio'
import { VibeHero } from '../../src/components/inicio/VibeHero'
import { VibePromocionesNovedades } from '../../src/components/inicio/VibePromocionesNovedades'
import { VibeCategorias } from '../../src/components/inicio/VibeCategorias'
import { VibeEmpresasScroll } from '../../src/components/inicio/VibeEmpresasScroll'
import { VibeRelacionado } from '../../src/components/inicio/VibeRelacionado'
import { VibeRelampago } from '../../src/components/inicio/VibeRelampago'
import { VibeReferidos } from '../../src/components/inicio/VibeReferidos'
import { VibeOnboarding } from '../../src/components/inicio/VibeOnboarding'
import { Skeleton } from '../../src/components/ui/Skeleton'

export default function InicioScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useInicio()

  const comercial = data?.comercial
  const personal = data?.personal

  return (
    <ScrollView
      className="flex-1 bg-vibe-fondo"
      contentContainerStyle={{ paddingVertical: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor="#0284c7"
          colors={['#0284c7']}
        />
      }
    >
      {isLoading && !data ? (
        <View className="px-4 gap-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <View className="flex-row gap-2">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </View>
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </View>
      ) : isError && !data ? (
        <View className="p-6 items-center">
          <Text className="text-base text-muted-foreground mb-3 text-center">
            No pudimos conectar con el servidor. Puedes seguir navegando los beneficios guardados.
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            className="rounded-xl bg-primary px-5 py-2.5"
          >
            <Text className="text-sm font-inter-bold text-white">Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {comercial ? (
        <>
          {/* 1. Novedades (hero carousel or empty state) */}
          <VibeHero heroes={comercial.heroes} />

          {/* 2. Novedades y promociones con tabs (Para ti, Exclusivas, Descuentos, Por vencer) */}
          {comercial.promocionesNovedades && (
            <VibePromocionesNovedades promociones={comercial.promocionesNovedades} />
          )}

          {/* 3. Category chips */}
          <VibeCategorias categorias={comercial.categorias} />

          {/* 4. Empresas destacadas (scroll horizontal) */}
          {comercial.empresasScroll && (
            <VibeEmpresasScroll
              empresas={comercial.empresasScroll}
              total={comercial.empresasTotal}
            />
          )}

          {/* 5. Relacionado con los artículos que viste (2-col grid) */}
          <VibeRelacionado
            planes={comercial.planes}
            total={comercial.planesTotal}
          />

          {/* 6. Ofertas Relámpago (only if data exists) */}
          <VibeRelampago relampago={comercial.relampago} />
        </>
      ) : null}

      {/* 5. Invita y Gana banner */}
      <VibeReferidos />

      {/* 6. Saca el máximo a MembeGo (onboarding checklist) */}
      {personal?.onboarding ? (
        <VibeOnboarding
          items={personal.onboarding.items}
          completados={personal.onboarding.completados}
          total={personal.onboarding.total}
        />
      ) : null}
    </ScrollView>
  )
}
