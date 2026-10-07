import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Gift,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useRegalar } from '../../src/hooks/useRegalos'
import { cn } from '../../src/lib/cn'
import { Button } from '../../src/components/ui/Button'
import { Input } from '../../src/components/ui/Input'
import { EmptyState } from '../../src/components/ui/EmptyState'

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function RegalarScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const regalar = useRegalar()

  // Form state
  const [tipo, setTipo] = useState<'PROMOCION' | 'PLAN'>('PROMOCION')
  const [itemId, setItemId] = useState('')
  const [destinatario, setDestinatario] = useState('')
  const [mensaje, setMensaje] = useState('')

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background" style={{ paddingTop: insets.top }}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
        <EmptyState
          icon={<Gift size={32} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para regalar."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </ScrollView>
    )
  }

  const handleSubmit = () => {
    if (!destinatario.trim()) {
      Alert.alert('Falta el destinatario', 'Ingresa el @ID o contacto de la persona.')
      return
    }
    if (!itemId.trim()) {
      Alert.alert(
        'Falta el ítem',
        `Ingresa el ID de la ${tipo === 'PROMOCION' ? 'promoción' : 'membresía/plan'}.`
      )
      return
    }

    const body = tipo === 'PROMOCION'
      ? { tipo: 'PROMOCION' as const, promocionId: itemId.trim(), destinatarioId: destinatario.trim(), mensaje: mensaje.trim() || undefined }
      : { tipo: 'PLAN' as const, planId: itemId.trim(), destinatarioId: destinatario.trim(), mensaje: mensaje.trim() || undefined }

    regalar.mutate(body, {
      onSuccess: (res) => {
        Alert.alert('Regalo enviado', res.detalle ?? 'Tu regalo se procesó correctamente.', [
          { text: 'OK', onPress: () => router.replace('/regalos') },
        ])
      },
      onError: (err: Error) => {
        Alert.alert('Error', err.message || 'No se pudo procesar el regalo. Intenta de nuevo.')
      },
    })
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
    >
      {/* Back link */}
      <Pressable onPress={() => goBackOr(router, '/regalos')} className="flex-row items-center mb-3">
        <ArrowLeft size={16} color="#0284c7" />
        <Text className="ml-1.5 text-sm font-inter-medium text-primary">Regalos</Text>
      </Pressable>

      {/* Title */}
      <Text className="text-h1 font-inter-extrabold tracking-tight text-foreground">
        Regalar a un amigo
      </Text>
      <Text className="mt-1.5 text-small text-muted-foreground leading-relaxed">
        Tú lo pagas, tu amigo lo disfruta. Se entrega al confirmarse el pago.
      </Text>

      {/* Form */}
      <View className="mt-6 space-y-4">
        {/* Tipo */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Qué quieres regalar
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => { setTipo('PROMOCION'); setItemId('') }}
              className={cn(
                'flex-1 items-center rounded-xl border py-3',
                tipo === 'PROMOCION'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background'
              )}
            >
              <Text className={cn(
                'text-sm font-inter-medium',
                tipo === 'PROMOCION' ? 'text-primary font-inter-semibold' : 'text-muted-foreground'
              )}>
                Promoción
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setTipo('PLAN'); setItemId('') }}
              className={cn(
                'flex-1 items-center rounded-xl border py-3',
                tipo === 'PLAN'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background'
              )}
            >
              <Text className={cn(
                'text-sm font-inter-medium',
                tipo === 'PLAN' ? 'text-primary font-inter-semibold' : 'text-muted-foreground'
              )}>
                Membresía
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Item ID */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            ID de {tipo === 'PROMOCION' ? 'promoción' : 'plan/membresía'}
          </Text>
          <Input
            placeholder={`ID de la ${tipo === 'PROMOCION' ? 'promoción' : 'membresía'}`}
            value={itemId}
            onChangeText={setItemId}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Destinatario */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Destinatario
          </Text>
          <Input
            placeholder="@usuario o contacto"
            value={destinatario}
            onChangeText={setDestinatario}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Mensaje */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Mensaje (opcional)
          </Text>
          <Input
            placeholder="Escribe una dedicatoria..."
            value={mensaje}
            onChangeText={setMensaje}
            multiline
            numberOfLines={3}
            style={{ height: 80, textAlignVertical: 'top' }}
          />
        </View>

        {/* Submit */}
        <Button
          variant="gradient"
          size="lg"
          loading={regalar.isPending}
          onPress={handleSubmit}
          className="mt-2"
          icon={<Gift size={18} color="#ffffff" />}
        >
          Regalar
        </Button>

        {regalar.isError && (
          <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2">
            <AlertCircle size={16} color="#e7000b" />
            <Text className="flex-1 text-sm text-destructive">
              {(regalar.error as Error)?.message ?? 'Error al procesar el regalo.'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}
