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
  CreditCard,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useGiftcardConfig } from '../../src/hooks/useRegalos'
import { formatMoney } from '../../src/lib/format'
import { Button } from '../../src/components/ui/Button'
import { Input } from '../../src/components/ui/Input'
import { EmptyState } from '../../src/components/ui/EmptyState'

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function GiftCardScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data: config, isLoading: configLoading, isError: configError } = useGiftcardConfig(isAuthenticated)

  // Form state
  const [monto, setMonto] = useState('')
  const [destinatario, setDestinatario] = useState('')
  const [mensaje, setMensaje] = useState('')

  if (authLoading || configLoading) {
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
          icon={<CreditCard size={32} color="#0284c7" />}
          title="Inicia sesión"
          description="Necesitas una cuenta para crear gift cards."
          action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>}
        />
      </ScrollView>
    )
  }

  if (configError || !config) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
        <EmptyState
          icon={<AlertCircle size={32} color="#e7000b" />}
          title="No se pudo cargar la configuración"
          description="Revisa tu conexión e intenta de nuevo."
          action={<Button variant="outline" onPress={() => router.back()}>Volver</Button>}
        />
      </ScrollView>
    )
  }

  if (!config.permitirGiftCards) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
        <EmptyState
          icon={<CreditCard size={28} color="#0284c7" />}
          title="Gift cards desactivadas"
          description="El negocio no tiene activadas las gift cards por ahora."
        />
      </ScrollView>
    )
  }

  const montoMin = config.giftCardMontoMin
  const montoMax = config.giftCardMontoMax

  const handleSubmit = () => {
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum < montoMin || montoNum > montoMax) {
      Alert.alert(
        'Monto inválido',
        `El monto debe estar entre ${formatMoney(montoMin)} y ${formatMoney(montoMax)}.`
      )
      return
    }
    if (!destinatario.trim()) {
      Alert.alert('Falta el destinatario', 'Ingresa el @ID o contacto de la persona.')
      return
    }

    // ponytail: el BFF aún no expone POST /regalos/giftcard — este form prepara la UI.
    // Cuando el endpoint exista, reemplazar este Alert por la mutación real.
    Alert.alert(
      'Gift card lista',
      `Monto: ${formatMoney(montoNum)}\nPara: ${destinatario}\n\nEsta funcionalidad estará disponible próximamente.`,
      [{ text: 'OK' }]
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
        Gift card
      </Text>
      <Text className="mt-1.5 text-small text-muted-foreground leading-relaxed">
        Regala un monto libre: tu persona especial lo usa en el negocio mostrando el código. No expira.
      </Text>

      {/* Form */}
      <View className="mt-6 space-y-4">
        {/* Monto */}
        <View>
          <Text className="mb-1.5 text-sm font-inter-semibold text-foreground">
            Monto
          </Text>
          <Input
            placeholder={`Entre ${formatMoney(montoMin)} y ${formatMoney(montoMax)}`}
            value={monto}
            onChangeText={setMonto}
            keyboardType="decimal-pad"
          />
          <Text className="mt-1 text-xs text-muted-foreground">
            Mínimo: {formatMoney(montoMin)} · Máximo: {formatMoney(montoMax)}
          </Text>
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
            placeholder="Escribe un mensaje..."
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
          onPress={handleSubmit}
          className="mt-2"
          icon={<CreditCard size={18} color="#ffffff" />}
        >
          Crear gift card
        </Button>
      </View>
    </ScrollView>
  )
}
