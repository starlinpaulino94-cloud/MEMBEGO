import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { goBackOr } from '../../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../../../src/lib/auth-context'
import { useMisPromocion, useAgendarPromocion } from '../../../src/hooks/useMisPromociones'
import { Button } from '../../../src/components/ui/Button'
import { Card } from '../../../src/components/ui/Card'

/**
 * Agendar cita para canjear un beneficio.
 *
 * ponytail: DatePicker no disponible (requiere @react-native-community/datetimepicker).
 * El usuario ingresa fecha (YYYY-MM-DD) y hora (HH:MM) manualmente.
 * Upgrade path: instalar datetimepicker y reemplazar los TextInput.
 */
export default function AgendarCitaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: compra } = useMisPromocion(id, isAuthenticated)
  const agendar = useAgendarPromocion()

  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')

  /* ── Auth gate ────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <CalendarDays size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para agendar
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  const titulo = compra?.promocion?.titulo ?? 'Tu beneficio'
  const empresa = compra?.company?.name ?? ''

  function handleAgendar() {
    if (!fecha || !hora) {
      Alert.alert('Completa los campos', 'Ingresa la fecha y hora para tu cita.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      Alert.alert('Fecha inválida', 'Usa el formato YYYY-MM-DD (ej: 2026-09-25).')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(hora)) {
      Alert.alert('Hora inválida', 'Usa el formato HH:MM (ej: 10:30).')
      return
    }
    if (!id) return

    agendar.mutate(
      { id, body: { fecha, hora } },
      {
        onSuccess: (res) => {
          Alert.alert('Cita agendada', res.mensaje ?? 'Tu cita fue agendada correctamente.', [
            { text: 'OK', onPress: () => router.replace('/mis-promociones') },
          ])
        },
        onError: (err: Error) => {
          Alert.alert('No se pudo agendar', err.message || 'Intenta de nuevo más tarde.')
        },
      }
    )
  }

  return (
    <View className="flex-1 bg-background">
      {/* ── Back bar ─────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 bg-background border-b border-border"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => goBackOr(router, '/mis-promociones')}
          className="p-2 rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">Agendar cita</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      >
        <View className="items-center gap-5 py-4">
          {/* ── Icono de éxito ─────────────────────────────────────────── */}
          <View className="h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 size={36} color="#00864d" />
          </View>

          <View className="items-center gap-2">
            <Text className="text-2xl font-inter-bold text-foreground text-center">
              ¡Listo, ya es tuyo!
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              <Text className="font-inter-semibold text-foreground">{titulo}</Text> quedó guardado
              en tus beneficios{empresa ? ` de ${empresa}` : ''}. Tu código QR ya está disponible.
            </Text>
          </View>

          {/* ── Card de agendamiento ───────────────────────────────────── */}
          <Card className="w-full border-primary/30 bg-primary/5">
            <View className="p-5 gap-4">
              <View className="flex-row items-center gap-2">
                <CalendarDays size={20} color="#0284c7" />
                <Text className="font-inter-bold text-foreground">
                  ¿Quieres agendar tu cita ahora?
                </Text>
              </View>

              <Text className="text-sm text-muted-foreground">
                Es <Text className="font-inter-semibold text-foreground">opcional</Text>. Si
                agendas, el local te reserva el turno y no haces fila.
              </Text>

              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Clock size={16} color="#0284c7" />
                  <Text className="text-sm text-muted-foreground">
                    Eliges el día y la hora que te convenga.
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <MapPin size={16} color="#0284c7" />
                  <Text className="text-sm text-muted-foreground">
                    El negocio te espera preparado.
                  </Text>
                </View>
              </View>

              {/* ── Inputs de fecha y hora ─────────────────────────────── */}
              <View className="gap-3 mt-2">
                <View>
                  <Text className="text-sm font-inter-medium text-foreground mb-1">
                    Fecha (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    value={fecha}
                    onChangeText={setFecha}
                    placeholder="2026-09-25"
                    placeholderTextColor="#9ca3af"
                    className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
                <View>
                  <Text className="text-sm font-inter-medium text-foreground mb-1">
                    Hora (HH:MM)
                  </Text>
                  <TextInput
                    value={hora}
                    onChangeText={setHora}
                    placeholder="10:30"
                    placeholderTextColor="#9ca3af"
                    className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    keyboardType="numeric"
                    maxLength={5}
                  />
                </View>
              </View>

              {/* ── Botones ────────────────────────────────────────────── */}
              <View className="gap-2.5 mt-1">
                <Button
                  onPress={handleAgendar}
                  disabled={agendar.isPending}
                  className="gap-2"
                >
                  {agendar.isPending ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <CalendarDays size={18} color="#ffffff" />
                      <Text className="text-primary-foreground font-inter-bold ml-1">
                        Agendar mi cita
                      </Text>
                    </>
                  )}
                </Button>
                <Button variant="outline" onPress={() => goBackOr(router, '/mis-promociones')}>
                  <Text className="font-inter-semibold text-foreground">Omitir por ahora</Text>
                </Button>
              </View>
            </View>
          </Card>

          <Text className="text-xs text-muted-foreground text-center px-4">
            Omitir no afecta tu beneficio: sigue siendo tuyo y puedes usarlo cuando quieras.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
