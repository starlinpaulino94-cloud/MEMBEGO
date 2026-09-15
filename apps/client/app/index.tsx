import React from 'react'
import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '../src/lib/auth-context'

export default function IndexPage() {
  const { isLoading } = useAuth()

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    )
  }

  return <Redirect href="/(tabs)/inicio" />
}
