import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Link } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Gift, Share2 } from 'lucide-react-native'
import { Card } from '../ui/Card'
import { useInicioAccent } from '../layout/InicioAccentContext'

export function VibeReferidos() {
  const { accent } = useInicioAccent()
  return (
    <View className="mt-6 mb-8 px-4">
      <Card className="relative overflow-hidden p-0 shadow-lg">
        <LinearGradient
          colors={accent.gradient}
          locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />

        <View style={{ position: 'absolute', bottom: -24, right: -24, opacity: 0.1 }}>
          <Gift size={144} color="#ffffff" />
        </View>

        <View className="relative z-10 w-[85%] p-4 gap-y-2">
          <View className="self-start flex-row items-center gap-1 rounded-full px-2.5 py-0.5" style={{ backgroundColor: accent.gradient[accent.gradient.length - 1] }}>
            <Gift size={14} color={"white"} />
            <Text className="text-overline font-inter-bold uppercase tracking-wider" style={{ color: "white" }}>
              Invita y gana
            </Text>
          </View>

          <Text className="text-price-lg text-white mt-1">
            Regala beneficios, gana premios
          </Text>

          <Text className="text-small text-white/90 mt-1 leading-normal">
            Tus amigos reciben <Text className="font-inter-bold text-white">un regalo de bienvenida</Text> y tú acumulas <Text className="font-inter-bold text-white">puntos canjeables</Text>.
          </Text>

          <View className="pt-2 mt-2">
            <Link href="/invita-y-gana" asChild>
              <TouchableOpacity
                activeOpacity={0.9}
                className="self-start flex-row items-center gap-2 rounded-full bg-card px-6 min-h-11 shadow-sm"
                accessibilityRole="button"
              >
                <Share2 size={16} color={accent.color} />
                <Text className="text-overline font-inter-bold" style={{ color: accent.color }}>
                  Compartir mi enlace
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </Card>
    </View>
  )
}
