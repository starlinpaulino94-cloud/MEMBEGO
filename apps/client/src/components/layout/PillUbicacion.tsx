import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { MapPin, ChevronDown } from 'lucide-react-native'

interface PillUbicacionProps {
  onPress?: () => void
}

export function PillUbicacion({ onPress }: PillUbicacionProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      className="flex-row items-center justify-between rounded-full border border-white/15 bg-white/20 px-3.5 h-9"
    >
      <View className="flex-row items-center flex-1 gap-1 mr-2">
        <MapPin size={16} color="#ffffff" />
        <Text
          numberOfLines={1}
          className="ml-1.5 text-label-sm font-inter-medium text-white flex-1"
        >
          Explorar cerca de ti · Actualizar ubicación
        </Text>
      </View>
      <View className="flex-row items-center">
        <Text className="text-label-sm font-inter-bold mr-0.5 text-white" >
          Cambiar
        </Text>
        <ChevronDown size={14} color="#ffffff" />
      </View>
    </TouchableOpacity>
  )
}
