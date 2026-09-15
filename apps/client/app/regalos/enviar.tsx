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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Gift,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useEnviarRegalo } from '../../src/hooks/useRegalos'
import { cn } from '../../src/lib/cn'
import { Button } from '../../src/components/ui/Button'
import { Input } from '../../src/components/ui/Input'
import { Card } from '../../src/components/ui/Card'
import { EmptyState } from '../../src/components/ui/EmptyState'

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function EnviarRegaloScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const enviarRegalo = useEnviarRegalo()

  // Form state
  const [destinatario, setDestinatario] = useState('')
  const [usos, setUsos] = useState('1')
  const [mensaje, setMensaje] = useState('')
  const [origen, setOrigen] = useState<'COMPRA' | 'MEMBRESIA'>('COMPRA')
  const [origenId, setOrigenId] = useState('')

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
          description="Necesitas una cuenta para enviar regalos."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </ScrollView>
    )
  }

  const handleSubmit = () => {
    if (!destinatario.trim()) {
      Alert.alert('Falta el destinatario', 'Ingresa el @ID o contacto de la persona a la que quieres enviar el regalo.')
      return
    }
    const usosNum = parseInt(usos, 10)
    if (!usosNum || usosNum < 1) {
      Alert.alert('Usos inválidos', 'La cantidad de usos debe ser al menos 1.')
      return
    }
    if (!origenId.trim()) {
      Alert.alert('Falta la fuente', 'Selecciona la fuente de la transferencia (compra o membresía).')
      return
    }

    enviarRegalo.mutate(
      {
        origen,
        origenId: origenId.trim(),
        destinatarioContacto: destinatario.trim(),
        usos: usosNum,
        mensaje: mensaje.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          Alert.alert('Regalo enviado', res.detalle ?? 'Tu regalo se envió correctamente.', [
            { text: 'OK', onPress: () => router.back() },
          ])
        },
        onError: (err: Error) => {
          Alert.alert('Error', err.message || 'No se pudo enviar el regalo. Intenta de nuevo.')
        },
      }
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
    >
      {/* Back link */}
      <Pressable onPress={() => router.back()} className="flex-row items-center mb-3">
        <ArrowLeft size={16} color="#0284c7" />
        <Text className="ml-1.5 text-sm font-inter-medium text-primary">Regalos</Text>
      </Pressable>

      {/* Title */}
      <Text className="text-h1 font-inter-extrabold tracking-tight text-foreground">
        Enviar un regalo
      </Text>
      <Text className="mt-1.5 text-small text-muted-foreground">
        Transfiere tus usos a un amigo.
      </Text>

      {/* Form */}
      <View className="mt-6 space-y-4">
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

        {/* Fuente (origen) */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Tipo de fuente
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => setOrigen('COMPRA')}
              className={cn(
                'flex-1 items-center rounded-xl border py-3',
                origen === 'COMPRA'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background'
              )}
            >
              <Text className={cn(
                'text-sm font-inter-medium',
                origen === 'COMPRA' ? 'text-primary font-inter-semibold' : 'text-muted-foreground'
              )}>
                Compra
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setOrigen('MEMBRESIA')}
              className={cn(
                'flex-1 items-center rounded-xl border py-3',
                origen === 'MEMBRESIA'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background'
              )}
            >
              <Text className={cn(
                'text-sm font-inter-medium',
                origen === 'MEMBRESIA' ? 'text-primary font-inter-semibold' : 'text-muted-foreground'
              )}>
                Membresía
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Origen ID */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            ID de {origen === 'COMPRA' ? 'compra' : 'membresía'}
          </Text>
          <Input
            placeholder={`ID de la ${origen === 'COMPRA' ? 'compra' : 'membresía'}`}
            value={origenId}
            onChangeText={setOrigenId}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Usos */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Cantidad de usos
          </Text>
          <Input
            placeholder="1"
            value={usos}
            onChangeText={setUsos}
            keyboardType="number-pad"
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
          loading={enviarRegalo.isPending}
          onPress={handleSubmit}
          className="mt-2"
          icon={<Gift size={18} color="#ffffff" />}
        >
          Enviar regalo
        </Button>

        {enviarRegalo.isError && (
          <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2">
            <AlertCircle size={16} color="#e7000b" />
            <Text className="flex-1 text-sm text-destructive">
              {(enviarRegalo.error as Error)?.message ?? 'Error al enviar el regalo.'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}
