import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Eye, EyeOff } from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'
import { colors } from '../../src/theme/tokens'

export default function LoginPage() {
  const router = useRouter()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Escribe tu correo y tu contraseña.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      const { error } = await signIn(email.trim(), password)

      if (error) {
        setErrorMsg('Correo o contraseña incorrectos.')
        return
      }

      router.replace('/(tabs)/inicio')
    } catch (error) {
      if (error instanceof TypeError) {
        setErrorMsg('No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.')
        return
      }

      throw error
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="w-full"
    >
      <View className="w-full">
        <Card className="w-full border border-border bg-card p-6">
          <Text className="text-2xl font-inter-semibold text-foreground">
            Iniciar sesión
          </Text>
          <Text className="mt-1 text-small text-muted-foreground">
            Accede a tu cuenta de MembeGo.
          </Text>

          {errorMsg && (
            <View className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3">
              <Text className="text-small text-danger">{errorMsg}</Text>
            </View>
          )}

          <View className="mt-6">
            <Text className="mb-2 text-small font-inter-semibold text-foreground" style={{ lineHeight: 14 }}>
              Correo electrónico
            </Text>
            <TextInput
              className="h-14 w-full rounded-xl border border-input bg-background px-4 text-small text-foreground"
              placeholder="tu@correo.com"
              placeholderTextColor={colors.surface.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View className="mt-4">
            <Text className="mb-2 text-small font-inter-semibold text-foreground" style={{ lineHeight: 14 }}>
              Contraseña
            </Text>
            <View className="relative">
              <TextInput
                className="h-14 w-full rounded-xl border border-input bg-background px-4 pr-12 text-small text-foreground"
                placeholder="••••••••"
                placeholderTextColor={colors.surface.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onPress={() => setShowPassword((visible) => !visible)}
                className="absolute right-0 top-0 h-14 w-11 items-center justify-center"
              >
                {showPassword ? (
                  <EyeOff size={18} color={colors.surface.mutedForeground} />
                ) : (
                  <Eye size={18} color={colors.surface.mutedForeground} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <Button onPress={handleSubmit} loading={loading} className="mt-4 h-10 w-full">
            Entrar
          </Button>

          <View className="mt-4 items-center gap-2">
            <Text className="text-small text-muted-foreground">
              ¿Olvidaste tu contraseña?
            </Text>
            <Text className="text-small text-muted-foreground">
              ¿No tienes cuenta? <Text className="text-primary">Regístrate</Text>
            </Text>
          </View>
        </Card>
      </View>
    </KeyboardAvoidingView>
  )
}
