import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { MapPin, ChevronDown } from 'lucide-react-native'

interface PillUbicacionProps {
  zonaLabel?: string | null
  onPress?: () => void
}

export function PillUbicacion({ zonaLabel, onPress }: PillUbicacionProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      className="flex-row items-center justify-between rounded-full border border-white/15 bg-black/20 px-3.5 h-9"
    >
      <View className="flex-row items-center flex-1 mr-2">
        <MapPin size={16} color="#38bdf8" />
        <Text
          numberOfLines={1}
          className="ml-1.5 text-label-sm font-inter-bold text-white flex-1"
        >
          {zonaLabel ? `Explorar cerca de ${zonaLabel}` : 'Explorar cerca de ti'} · Actualizar ubicación
        </Text>
      </View>
      <View className="flex-row items-center">
        <Text className="text-label-sm font-inter-bold text-vibe-aqua mr-0.5">
          Cambiar
        </Text>
        <ChevronDown size={14} color="#67e8f9" />
      </View>
    </TouchableOpacity>
  )
}
