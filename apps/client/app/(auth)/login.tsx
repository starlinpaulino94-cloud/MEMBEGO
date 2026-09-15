import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '../../src/lib/auth-context'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'

export default function LoginPage() {
  const router = useRouter()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Por favor completa todos los campos.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    const { error } = await signIn(email.trim(), password)
    setLoading(false)

    if (error) {
      setErrorMsg(error.message || 'Credenciales inválidas.')
    } else {
      router.replace('/(tabs)/inicio')
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-vibe-fondo"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
        className="p-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-md">
          {/* Brand Header */}
          <LinearGradient
            colors={['#7c3aed', '#2563eb']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="mb-6 items-center rounded-2xl p-6 shadow-lg"
          >
            <Text className="text-3xl font-extrabold tracking-wider text-white">
              MembeGo
            </Text>
            <Text className="mt-1 text-sm font-medium text-white/80">
              Tu portal de membresías y beneficios
            </Text>
          </LinearGradient>

          <Card className="bg-slate-900/90 border border-slate-800 p-6">
            <Text className="text-xl font-bold text-white mb-2">
              Iniciar Sesión
            </Text>
            <Text className="text-sm text-slate-400 mb-5">
              Accede a tus pases, códigos QR y beneficios exclusivos
            </Text>

            {errorMsg && (
              <View className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                <Text className="text-sm text-red-400">{errorMsg}</Text>
              </View>
            )}

            <View className="mb-4">
              <Text className="mb-1 text-sm font-medium text-slate-300">
                Correo electrónico
              </Text>
              <TextInput
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 text-white text-base"
                placeholder="ejemplo@correo.com"
                placeholderTextColor="#64748b"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View className="mb-6">
              <Text className="mb-1 text-sm font-medium text-slate-300">
                Contraseña
              </Text>
              <TextInput
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 text-white text-base"
                placeholder="••••••••"
                placeholderTextColor="#64748b"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            <Button
              onPress={handleSubmit}
              loading={loading}
              className="mb-3"
            >
              Entrar a mi cuenta
            </Button>

            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/inicio')}
              className="h-11 items-center justify-center rounded-xl"
            >
              <Text className="text-sm font-medium text-slate-400">
                Continuar explorando como invitado
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
