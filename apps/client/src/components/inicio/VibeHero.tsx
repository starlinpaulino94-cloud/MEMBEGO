import React from 'react'
import { View, Text, useWindowDimensions, StyleSheet, Image } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'
import { colors, radii } from '../../theme/tokens'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

// Gradient stop arrays sourced from tokens.ts (LinearGradient cannot take NativeWind classes).
// Overlay gradient: composited alpha stops for image darkening — not representable as design tokens.
const GRAD_OVERLAY = [colors.overlay.transparent, colors.overlay.heroMid, colors.overlay.heroDeep] as const

export function VibeHero({ heroes }: { heroes: any[] }) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  const { width: windowWidth } = useWindowDimensions()
  const CARD_WIDTH = Math.min(windowWidth * 0.86, 340)

  if (!heroes || heroes.length === 0) {
    return (
      <View className="px-4 py-4">
        <EmptyState
          title="Novedades"
          description="Cuando haya beneficios destacados, aparecerán aquí."
          variant="card"
        />
      </View>
    )
  }

  return (
    <View
      className="pt-2 mb-4"
    >
      <HorizontalScrollWithFade
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        snapToInterval={CARD_WIDTH + 12}
        decelerationRate="fast"
      >
        {heroes.map((hero, i) => (
          <MarketplaceCard
            variant="flush"
            key={`${hero.href}-${i}`}
            onPress={() => router.push(rnHref(hero.href) as any)}
            accessibilityLabel={`${hero.titulo} — ${hero.cta}`}
            className="relative max-w-[340px] overflow-hidden bg-vibe-deep"
            style={{ width: CARD_WIDTH, height: 380 }}
          >
            {hero.imagen ? (
              <Image
                source={{ uri: hero.imagen }}
                style={[StyleSheet.absoluteFill]}
                resizeMode="cover"
              />
            ) : (
              <LinearGradient
                colors={accent.gradient}
                locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            <LinearGradient
              colors={[...GRAD_OVERLAY]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View className="relative z-10 flex-1 justify-between p-2">
              <View>
                <LinearGradient
                  colors={accent.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ alignSelf: 'flex-start', borderRadius: radii.pill, paddingVertical: 4, paddingHorizontal: 12 }}
                >
                  <Text className="text-overline font-bold uppercase tracking-wider text-white">
                    Novedad destacada
                  </Text>
                </LinearGradient>

                <Text className="text-4xl font-extrabold text-white" style={{ lineHeight: 40 }}>
                  {hero.titulo}
                </Text>

                {hero.subtitulo ? (
                  <Text className="text-sm font-medium mt-1" style={{ color: accent.gradient[accent.gradient.length - 1] }}>
                    {hero.subtitulo}
                  </Text>
                ) : null}
              </View>

              <View className="gap-y-3">
                <LinearGradient
                  colors={accent.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ minHeight: 44, paddingVertical: 14, paddingHorizontal: 10, borderRadius: radii.pill, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                >
                  <Text className="text-label-sm font-bold text-white">
                    {hero.cta}
                  </Text>
                  <ArrowRight size={16} color={colors.surface.background} />
                </LinearGradient>
              </View>
            </View>
          </MarketplaceCard>
        ))}
      </HorizontalScrollWithFade>

      <View className="flex-row items-center justify-center gap-1.5 pt-3">
        {heroes.map((_, i) => (
          <View key={i} className="overflow-hidden rounded-full">
            {i === 0 ? (
              <LinearGradient
                colors={accent.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ height: 6, width: 24 }}
              />
            ) : (
              <View className="h-1.5 w-2 rounded-full bg-vibe-lavanda" />
            )}
          </View>
        ))}
      </View>
    </View>
  )
}
