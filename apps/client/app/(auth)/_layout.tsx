import React from 'react'
import { View, Text, Image, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Slot, Link } from 'expo-router'
import { colors } from '../../src/theme/tokens'

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
            <View className="flex-row items-center gap-2">
              <Image
                source={require('../../../../public/icon-512.png')}
                accessibilityLabel="Logo de MembeGo"
                resizeMode="contain"
                style={{ width: 36, height: 36 }}
              />
              <Text className="text-2xl font-extrabold tracking-tight text-foreground">
                Membe<Text style={{ color: colors.retail.blue }}>Go</Text>
              </Text>
            </View>
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
          <Link href="/privacy" style={{ color: colors.retail.blue, textDecorationLine: 'underline' }}>
            Privacidad
          </Link>
          {' · '}
          <Link href="/terms" style={{ color: colors.retail.blue, textDecorationLine: 'underline' }}>
            Términos
          </Link>
        </Text>
      </View>
    </SafeAreaView>
  )
}
