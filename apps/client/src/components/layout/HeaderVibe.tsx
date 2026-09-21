import React from 'react'
import { View, Text, TouchableOpacity, TextInput } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Search, QrCode, User, Bell, Mic } from 'lucide-react-native'
import { PillUbicacion } from './PillUbicacion'
import { useAuth } from '../../lib/auth-context'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function HeaderVibe() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, isAuthenticated } = useAuth()

  const iniciales = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : null

  return (
    <LinearGradient
      colors={['#5b21b6', '#7c3aed', '#2563eb', '#06b6d4']}
      locations={[0, 0.35, 0.7, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className="px-4 pb-2.5 shadow-md"
      style={{ paddingTop: insets.top + 12 }}
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center h-11 min-w-0 rounded-full border border-white/25 bg-white/15 pl-4 pr-2">
          <Search size={16} color="#ffffff" />
          <TextInput
            placeholder="Buscar beneficios, membresías..."
            placeholderTextColor="rgba(255, 255, 255, 0.7)"
            className="flex-1 ml-2 text-sm text-white"
            autoCapitalize="none"
          />
          <Mic size={16} color="rgba(255, 255, 255, 0.8)" />
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(tabs)/qr')}
          activeOpacity={0.8}
          className="h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15"
        >
          <QrCode size={20} color="#ffffff" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/novedades')}
          activeOpacity={0.8}
          className="h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15"
        >
          <Bell size={20} color="#ffffff" />
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
          className="h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/20"
        >
          {iniciales ? (
            <Text className="text-[12px] font-inter-bold text-white">{iniciales}</Text>
          ) : (
            <User size={20} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>

      <View className="mt-2">
        <PillUbicacion onPress={() => router.push('/cerca')} />
      </View>
    </LinearGradient>
  )
}
