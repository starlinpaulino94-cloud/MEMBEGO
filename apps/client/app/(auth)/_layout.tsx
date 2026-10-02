import React, { useEffect, useState } from 'react'
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Slot, Link } from 'expo-router'
import { colors } from '../../src/theme/tokens'

/**
 * Superficie de autenticación — BLANCA (DS 2.0 · Fase 2).
 *
 * Replica de src/app/(auth)/layout.tsx para React Native.
 * Fondo claro, marca y formulario centrados cuando el teclado está cerrado,
 * contenido desplazable al escribir y pie con Privacidad y Términos.
 */
export default function AuthLayout() {
  const { width } = useWindowDimensions()
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const brandMarginBottom = width >= 768 ? 32 : 24

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            className="w-full items-center px-4 pt-4"
            style={{ flexGrow: 1, justifyContent: keyboardVisible ? 'flex-start' : 'center' }}
          >
            <View className="w-full items-center" style={{ maxWidth: 448 }}>
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

              <View className="w-full">
                <Slot />
              </View>
            </View>
          </View>

          <View className="w-full items-center border-t border-border bg-muted py-5">
            <Text className="text-caption text-center text-muted-foreground">
              © 2026 MembeGo ·{' '}
              <Link href="https://membego.com/privacy" style={{ color: colors.retail.blue, textDecorationLine: 'underline' }}>
                Privacidad
              </Link>
              {' · '}
              <Link href="https://membego.com/terms" style={{ color: colors.retail.blue, textDecorationLine: 'underline' }}>
                Términos
              </Link>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
