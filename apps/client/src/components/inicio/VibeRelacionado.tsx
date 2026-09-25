import React from 'react'
import { View, Text, TouchableOpacity, Image, useWindowDimensions } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Star } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'
import { colors } from '../../theme/tokens'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

function Estrellas({ valoracion, accentColor }: { valoracion: number; accentColor: string }) {
  const llenas = Math.round(valoracion)
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          color={n <= llenas ? accentColor : colors.vibe.chip}
          fill={n <= llenas ? accentColor : 'transparent'}
        />
      ))}
    </View>
  )
}

export function VibeRelacionado({
  planes,
  total,
}: {
  planes: any[]
  total: number
}) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  const { width } = useWindowDimensions()
  const isDesktop = width >= 1024

  if (!planes || planes.length === 0) {
    return (
      <View className="mt-6 px-4">
        <SectionHeader
          title="Membresías recomendadas"
          action={total > 0 ? (
            <Link href="/planes" asChild>
              <TouchableOpacity activeOpacity={0.7}>
                <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                  Ver todas ({total})
                </Text>
              </TouchableOpacity>
            </Link>
          ) : undefined}
        />
        <EmptyState
          title="No hay membresías para mostrar"
          description={
            total > 0
              ? 'Puedes consultar las membresías publicadas en el catálogo.'
              : 'Cuando haya membresías para esta selección, aparecerán aquí.'
          }
          variant="card"
          className="mt-3"
        />
      </View>
    )
  }

  return (
    <View className="mt-6 px-4">
      <SectionHeader
        title="Membresías recomendadas"
        action={
          <Link href="/planes" asChild>
            <TouchableOpacity activeOpacity={0.7}>
              <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                Ver todas{total > 0 ? ` (${total})` : ''}
              </Text>
            </TouchableOpacity>
          </Link>
        }
      />

      <HorizontalScrollWithFade
        contentContainerStyle={{ gap: 12 }}
        className="mt-3"
      >
        {planes.slice(0, 4).map((p) => (
          <MarketplaceCard
            key={p.id}
            onPress={() => router.push(rnHref(p.href) as any)}
            accessibilityLabel={`Ver membresía de ${p.empresa}`}
            variant="flush"
            footer={
              <LinearGradient
                colors={accent.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: '100%', borderRadius: 9999, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text className="text-label-sm font-inter-bold text-white">
                  Aprovechar
                </Text>
              </LinearGradient>
            }
          >
            <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
              {p.imagen ? (
                <Image
                  source={{ uri: p.imagen }}
                  style={{ flex: 1 }}
                  resizeMode="cover"
                />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Text className="text-h1" style={{ color: accent.color }}>
                    {p.empresa?.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              {p.esCliente ? (
                <View className="absolute left-2 bottom-2 rounded-full bg-card/95 px-2 py-1">
                  <Text
                    className="text-label-sm font-inter-semibold"
                    style={{ color: accent.color }}
                  >
                    De tus negocios
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="mt-2 flex-1 justify-between">
              <View>
                <Text
                  className="text-label-md font-inter-bold text-foreground"
                  numberOfLines={2}
                >
                  {p.empresa} · {p.nombre}
                </Text>

                {p.valoracion != null && Number.isFinite(Number(p.valoracion)) ? (
                  <View className="mt-1 flex-row items-center gap-1">
                    <Estrellas valoracion={Number(p.valoracion)} accentColor={accent.color} />
                    <Text className="text-label-sm font-inter-medium text-muted-foreground">
                      {Number(p.resenas ?? 0).toLocaleString('es-DO')}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View className="flex-row items-baseline">
                <Text className="text-price-lg" style={{ color: accent.color }}>{p.precio}</Text>
                <Text className="ml-1 text-small text-muted-foreground">
                  {p.periodo}
                </Text>
              </View>
            </View>
          </MarketplaceCard>
        ))}
      </HorizontalScrollWithFade>
    </View>
  )
}
