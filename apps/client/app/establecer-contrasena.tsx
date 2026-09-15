import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Lock } from 'lucide-react'
import { supabase } from '../src/lib/supabase'
import { Card } from '../src/components/ui/Card'
import { Input } from '../src/components/ui/Input'
import { Button } from '../src/components/ui/Button'
import { cn } from '../src/lib/cn'

const MIN_PASSWORD = 8

export default function EstablecerContrasenaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { token } = useLocalSearchParams<{ token?: string }>()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // Sin token → enlace inválido
  if (!token) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-4"
          keyboardShouldPersistTaps="handled"
        >
          <Card className="mx-auto w-full max-w-md p-6">
            <Text className="text-h2 font-inter-bold text-foreground">
              Enlace inválido
            </Text>
            <View className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <Text className="text-sm text-destructive">
                No se encontró el token de acceso. Revisa el enlace del correo
                que recibiste.
              </Text>
            </View>
            <Button
              onPress={() => router.replace('/(auth)/login')}
              className="mt-5 w-full"
            >
              Volver a iniciar sesión
            </Button>
          </Card>
        </ScrollView>
      </View>
    )
  }

  async function handleSubmit() {
    setError(null)

    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })
    setLoading(false)

    if (updateError) {
      setError(
        updateError.message || 'No se pudo actualizar la contraseña. Intenta de nuevo.',
      )
      return
    }

    setSuccess(true)
    setTimeout(() => router.replace('/(auth)/login'), 2000)
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-4"
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="mx-auto w-full max-w-md"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Icon */}
          <View className="mx-auto mb-6 h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Lock size={32} color="#0284c7" />
          </View>

          <Card className="p-6">
            <Text className="text-h2 font-inter-bold text-foreground">
              Establece tu contraseña
            </Text>
            <Text className="mt-1.5 text-small text-muted-foreground leading-relaxed">
              Se te ha creado una cuenta en MembeGo. Establece tu contraseña
              para acceder a tu panel.
            </Text>

            {success ? (
              <View className="mt-5">
                <View className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <Text className="text-sm text-foreground">
                    Contraseña establecida. Te llevamos a iniciar sesión…
                  </Text>
                </View>
                <Button
                  onPress={() => router.replace('/(auth)/login')}
                  variant="outline"
                  className="mt-4 w-full"
                >
                  Iniciar sesión
                </Button>
              </View>
            ) : (
              <View className="mt-5 gap-4">
                {error && (
                  <View className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <Text className="text-sm text-destructive">{error}</Text>
                  </View>
                )}

                <View className="gap-1.5">
                  <Text className="text-label-sm font-inter-medium text-foreground">
                    Nueva contraseña
                  </Text>
                  <Input
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                  />
                </View>

                <View className="gap-1.5">
                  <Text className="text-label-sm font-inter-medium text-foreground">
                    Confirmar contraseña
                  </Text>
                  <Input
                    secureTextEntry
                    value={confirm}
                    onChangeText={setConfirm}
                    placeholder="••••••••"
                  />
                </View>

                <Button
                  onPress={handleSubmit}
                  loading={loading}
                  className={cn('w-full')}
                >
                  Establecer contraseña
                </Button>
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
