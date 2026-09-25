import React from 'react'
import { View, Text, ScrollView, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Slot, Link } from 'expo-router'

/**
 * Superficie de autenticación — BLANCA (DS 2.0 · Fase 2).
 *
 * Replica de src/app/(auth)/layout.tsx para React Native.
 * Fondo claro, bloque de marca arriba, contenido centrado con ancho máximo,
 * pie con Privacidad y Términos. El navy sobrevive solo en el pie.
 */
export default function AuthLayout() {
  const { width } = useWindowDimensions()
  const topPadding = width >= 768 ? 64 : 40
  const brandMarginBottom = width >= 768 ? 41 : 39

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ paddingTop: topPadding }}>
      <View className="w-full items-center px-4" style={{ flexGrow: 1 }}>
        <View className="flex-1 items-center justify-center w-full">
          <View className="items-center" style={{ marginBottom: brandMarginBottom }}>
            <Text className="text-2xl font-extrabold tracking-tight text-foreground">
              Membe<Text className="text-primary">Go</Text>
            </Text>
            <Text className="mt-2.5 text-overline text-muted-foreground">
              Conecta · Disfruta · Ahorra
            </Text>
          </View>

          <View className="w-full" style={{ maxWidth: 448 }}>
            <Slot />
          </View>
        </View>
      </View>

      <View className="w-full items-center border-t border-border bg-muted py-5">
        <Text className="text-caption text-center text-muted-foreground">
          © 2026 MembeGo ·{' '}
          <Link href="/privacy" className="text-primary underline">
            Privacidad
          </Link>
          {' · '}
          <Link href="/terms" className="text-primary underline">
            Términos
          </Link>
        </Text>
      </View>
    </SafeAreaView>
  )
}
