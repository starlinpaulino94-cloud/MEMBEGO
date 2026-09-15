import React from 'react'
import { View, Text, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, Link } from 'expo-router'

/**
 * Superficie de autenticación — BLANCA (DS 2.0 · Fase 2).
 *
 * Replica de src/app/(auth)/layout.tsx para React Native.
 * Fondo claro, bloque de marca arriba, contenido centrado con ancho máximo,
 * pie con Privacidad y Términos. El navy sobrevive solo en el pie.
 */
export default function AuthLayout() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="flex-grow items-center justify-center px-4 py-10"
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand block */}
        <View className="mb-8 items-center">
          <Text className="text-2xl font-extrabold tracking-tight text-foreground">
            Membe<Text className="text-primary">Go</Text>
          </Text>
          <Text className="mt-2.5 text-overline text-muted-foreground">
            Conecta · Disfruta · Ahorra
          </Text>
        </View>

        {/* Content slot — child routes (login, recuperar, registro) render here */}
        <View className="w-full max-w-md">
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      </ScrollView>

      {/* Footer */}
      <View className="border-t border-border bg-muted py-5 items-center">
        <Text className="text-caption text-muted-foreground text-center">
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
