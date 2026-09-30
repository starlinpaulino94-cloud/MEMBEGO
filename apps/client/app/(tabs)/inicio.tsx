import React, { useState } from 'react'
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
import { colors } from '../../src/theme/tokens'
import { BannerDemo } from '../../src/components/ui/BannerDemo'
import { useInicioAccent } from '../../src/components/layout/InicioAccentContext'

export default function InicioScreen() {
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const { setAccentIndex, accent } = useInicioAccent()
  const { data, isLoading, isError, refetch, isRefetching } = useInicio(categoriaActiva)

  const comercial = data?.comercial
  const personal = data?.personal
  type BloqueInicio = 'CABECERA' | 'HERO' | 'CATEGORIAS' | 'DESTACADAS' | 'MEMBRESIAS' | 'BANNER_QR' | 'EXPERIENCIAS'
  const bloques: BloqueInicio[] = Array.isArray(comercial?.bloques)
    ? comercial.bloques
    : ['HERO', 'CATEGORIAS', 'DESTACADAS', 'MEMBRESIAS', 'EXPERIENCIAS']

  const seleccionarCategoria = (slug: string | null, gradientIndex: number | null) => {
    setCategoriaActiva(slug)
    setAccentIndex(gradientIndex)
  }

  return (
    <ScrollView
      className="flex-1 bg-vibe-fondo"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1, paddingVertical: 16, gap: 8 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={accent.color}
          colors={[accent.color]}
        />
      }
    >
      {data?.demoNombre ? <BannerDemo nombreEmpresa={data.demoNombre} /> : null}
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
            className="rounded-xl px-5 min-h-11 justify-center"
            style={{ backgroundColor: accent.color }}
            accessibilityRole="button"
          >
            <Text className="text-sm font-inter-bold text-white">Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {comercial ? (
        <>
          {bloques.map((bloque) => {
            switch (bloque) {
              case 'HERO':
                return (
                  <React.Fragment key={bloque}>
                    <VibeHero heroes={comercial.novedadesHero} />
                    {comercial.promocionesNovedades ? (
                      <VibePromocionesNovedades promociones={comercial.promocionesNovedades} />
                    ) : null}
                  </React.Fragment>
                )
              case 'CATEGORIAS':
                return (
                  <VibeCategorias
                    key={bloque}
                    categorias={comercial.categorias}
                    categoriaActiva={categoriaActiva}
                    onSeleccionar={seleccionarCategoria}
                  />
                )
              case 'DESTACADAS':
                return comercial.empresasScroll ? (
                  <VibeEmpresasScroll
                    key={bloque}
                    empresas={comercial.empresasScroll}
                    total={comercial.empresasTotal}
                  />
                ) : null
              case 'MEMBRESIAS':
                return (
                  <VibeRelacionado
                    key={bloque}
                    planes={comercial.planes}
                    total={comercial.planesTotal}
                  />
                )
              case 'EXPERIENCIAS':
                return <VibeRelampago key={bloque} relampago={comercial.relampago} />
              default:
                return null
            }
          })}
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
