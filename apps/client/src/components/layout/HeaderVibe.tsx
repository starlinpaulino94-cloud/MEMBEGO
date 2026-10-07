import React, { useState } from 'react'
import { View, Text, TouchableOpacity, TextInput, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Search, User, Bell, Mic } from 'lucide-react-native'
import { PillUbicacion } from './PillUbicacion'
import { useAuth } from '../../lib/auth-context'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../theme/tokens'
import { useInicioAccent } from './InicioAccentContext'

export function HeaderVibe() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { user, isAuthenticated } = useAuth()
  const { accent } = useInicioAccent()
  const [searchText, setSearchText] = useState('')
  const gutter = width >= 768 ? 24 : 16
  const topMargin = width >= 768 ? 16 : 12

  const iniciales = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : null

  return (
    <LinearGradient
      colors={accent.gradient}
      locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: '100%',
        paddingTop: insets.top + topMargin,
        paddingBottom: 10,
        shadowColor: accent.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      <View
        className="w-full self-center"
        style={{
          width: '100%',
          maxWidth: 1328,
          alignSelf: 'center',
          paddingHorizontal: gutter,
        }}
      >
        <View className="w-full">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center h-11 min-w-0 rounded-full border border-white bg-white pl-4 pr-2 shadow-sm">
            <Search size={16} color={accent.color} />
            <TextInput
              placeholder="Buscar beneficios, membresías…"
              placeholderTextColor={colors.surface.mutedForeground}
              className="flex-1 ml-2 text-sm text-foreground"
              autoCapitalize="none"
              returnKeyType="search"
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={() => {
                const q = searchText.trim()
                router.push(q ? { pathname: '/buscar', params: { q } } : '/buscar')
              }}
            />
            <Mic size={16} color={accent.color} />
          </View>

          <TouchableOpacity
            onPress={() => router.push('/novedades')}
            activeOpacity={0.8}
            className="h-11 w-11 items-center justify-center rounded-full border border-white bg-white shadow-sm"
          >
            <Bell size={20} color={accent.color} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              if (isAuthenticated) {
                router.push('/(tabs)/cuenta')
              } else {
                router.push('/(auth)/login')
              }
            }}
            activeOpacity={0.8}
            className="h-11 w-11 items-center justify-center rounded-full border border-white bg-white shadow-sm"
          >
            {iniciales ? (
              <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>{iniciales}</Text>
            ) : (
              <User size={20} color={accent.color} />
            )}
          </TouchableOpacity>
        </View>

        <View className="mt-2">
          <PillUbicacion onPress={() => router.push('/cerca')} />
        </View>
        </View>
      </View>
    </LinearGradient>
  )
}
