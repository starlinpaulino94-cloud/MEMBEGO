import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { LucideIcon } from 'lucide-react-native'
import { colors } from '../../theme/tokens'

type CategoriaChipData = {
  label: string
  icon: LucideIcon
  gradient: readonly [string, string]
}

export function VibeCategoriaChip({
  categoria,
  seleccionada,
  atenuada = false,
  onPress,
}: {
  categoria: CategoriaChipData
  seleccionada: boolean
  atenuada?: boolean
  onPress: () => void
}) {
  const Icono = categoria.icon

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: seleccionada }}
      onPress={onPress}
      className={`min-h-11 rounded-full ${seleccionada ? '' : `${atenuada ? 'opacity-70' : ''}`}`}
    >
      <LinearGradient
        colors={categoria.gradient}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1, justifyContent: 'center', borderRadius: 999, paddingHorizontal: seleccionada ? 8 : 16 }}
      >
        <View
          className="flex-row items-center gap-2"
          style={seleccionada ? { borderWidth: 3, borderColor: colors.surface.background, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 } : undefined}
        >
          <Icono size={16} color={colors.surface.background} />
          <Text className="text-overline font-bold text-white">{categoria.label}</Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  )
}
