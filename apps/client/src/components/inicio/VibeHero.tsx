import React from 'react'
import { View, Text, TouchableOpacity, ScrollView, Dimensions, StyleSheet, Image } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight, Star } from 'lucide-react-native'
import { Link } from 'expo-router'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'

const { width } = Dimensions.get('window')
const CARD_WIDTH = Math.min(width * 0.86, 340)

export function VibeHero({ heroes }: { heroes: any[] }) {
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
    <View className="pt-2 mb-4">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        snapToInterval={CARD_WIDTH + 12}
        decelerationRate="fast"
      >
        {heroes.map((hero, i) => (
          <Link href={rnHref(hero.href) as any} key={`${hero.href}-${i}`} asChild>
            <TouchableOpacity 
              activeOpacity={0.9} 
              className="relative overflow-hidden rounded-[20px] bg-vibe-deep shadow-lg"
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
                  colors={['#5b21b6', '#7c3aed', '#2563eb', '#06b6d4']}
                  locations={[0, 0.35, 0.7, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <LinearGradient
                colors={['transparent', 'rgba(30, 27, 75, 0.5)', '#0b0f19']}
                locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />

              <View className="relative z-10 flex-1 justify-between p-5">
                <View>
                  <LinearGradient
                    colors={['#7c3aed', '#2563eb']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    className="self-start rounded-full px-3 py-1 mb-2"
                  >
                    <Text className="text-[12px] font-bold uppercase tracking-wider text-white">
                      Novedad destacada
                    </Text>
                  </LinearGradient>
                  
                  <Text className="text-4xl font-extrabold text-white" style={{ lineHeight: 40 }}>
                    {hero.titulo}
                  </Text>
                  
                  {hero.subtitulo ? (
                    <Text className="text-sm font-medium text-vibe-celeste mt-1">
                      {hero.subtitulo}
                    </Text>
                  ) : null}
                </View>

                <View className="gap-y-3">
                  <View className="flex-row items-center justify-between rounded-xl bg-card/95 p-3 border border-vibe-borde">
                    <View className="flex-1 pr-2">
                      <Text className="text-[12px] font-bold text-foreground" numberOfLines={1}>
                        {hero.empresa}
                      </Text>
                      {hero.planDesde ? (
                        <Text className="text-[12px] font-bold text-vibe-ink" numberOfLines={1}>
                          {hero.planDesde}
                        </Text>
                      ) : null}
                    </View>
                    
                    {hero.valoracion != null && !isNaN(Number(hero.valoracion)) ? (
                      <View className="flex-row items-center gap-1 rounded-lg bg-vibe-niebla px-2 py-1">
                        <Star size={14} color="#7c3aed" fill="#7c3aed" />
                        <Text className="text-[12px] font-bold text-foreground">
                          {Number(hero.valoracion).toFixed(1)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  
                  <LinearGradient
                    colors={['#7c3aed', '#2563eb', '#06b6d4']}
                    locations={[0, 0.6, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    className="w-full flex-row items-center justify-center gap-2 rounded-full py-3"
                  >
                    <Text className="text-[12px] font-bold text-white">
                      {hero.cta}
                    </Text>
                    <ArrowRight size={16} color="#ffffff" />
                  </LinearGradient>
                </View>
              </View>
            </TouchableOpacity>
          </Link>
        ))}
      </ScrollView>
      
      <View className="flex-row items-center justify-center gap-1.5 pt-3">
        {heroes.map((_, i) => (
          <View key={i} className="overflow-hidden rounded-full">
            {i === 0 ? (
              <LinearGradient
                colors={['#7c3aed', '#2563eb']}
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
