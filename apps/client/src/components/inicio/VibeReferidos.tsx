import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Link } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Gift, Share2 } from 'lucide-react-native'

export function VibeReferidos() {
  return (
    <View className="mt-6 mb-8 px-4">
      <View className="relative overflow-hidden rounded-2xl elevation-2 shadow-lg">
        <LinearGradient
          colors={['#5b21b6', '#7c3aed', '#2563eb', '#06b6d4']}
          locations={[0, 0.35, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
        
        <View style={{ position: 'absolute', bottom: -24, right: -24, opacity: 0.1 }}>
          <Gift size={144} color="#ffffff" />
        </View>

        <View className="relative z-10 w-[85%] p-4 gap-y-2">
          <View className="self-start flex-row items-center gap-1 rounded-full bg-[#06b6d4] px-2.5 py-0.5">
            <Gift size={14} color="#ffffff" />
            <Text className="text-[12px] font-bold uppercase tracking-wider text-white">
              Invita y gana
            </Text>
          </View>
          
          <Text className="text-[20px] font-bold leading-tight text-white mt-1">
            Regala beneficios, gana premios
          </Text>
          
          <Text className="text-[14px] text-vibe-borde mt-1 leading-normal">
            Tus amigos reciben <Text className="font-bold text-white">un regalo de bienvenida</Text> y tú acumulas <Text className="font-bold text-vibe-aqua">puntos canjeables</Text>.
          </Text>
          
          <View className="pt-2 mt-2">
            <Link href="/invita-y-gana" asChild>
              <TouchableOpacity
                activeOpacity={0.9}
                className="self-start flex-row items-center gap-2 rounded-full bg-card px-6 py-2.5 shadow-sm"
              >
                <Share2 size={16} color="#7c3aed" />
                <Text className="text-[12px] font-bold text-vibe-deep">
                  Compartir mi enlace
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </View>
    </View>
  )
}
