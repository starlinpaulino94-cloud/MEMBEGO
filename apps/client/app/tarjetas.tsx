import React from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { CreditCard, ShieldCheck, Star, Trash2 } from 'lucide-react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { api, type SavedPaymentCard } from '../src/lib/api'
import { useAuth } from '../src/lib/auth-context'
import { BackHeader } from '../src/components/ui/BackHeader'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { EmptyState } from '../src/components/ui/EmptyState'
import { colors } from '../src/theme/tokens'

function cardLabel(card: SavedPaymentCard): string {
  return [card.marca || 'Tarjeta', card.ultimos4 ? `terminada en ${card.ultimos4}` : null]
    .filter(Boolean)
    .join(' ')
}

export default function SavedCardsScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const cardsQuery = useQuery({
    queryKey: ['cliente', 'tarjetas-guardadas'],
    queryFn: api.getSavedCards,
    enabled: isAuthenticated,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cliente', 'tarjetas-guardadas'] })
  const defaultMutation = useMutation({
    mutationFn: api.setDefaultSavedCard,
    onSuccess: refresh,
  })
  const deleteMutation = useMutation({
    mutationFn: api.deleteSavedCard,
    onSuccess: async (result) => {
      await refresh()
      // Quitar una tarjeta apaga las renovaciones que la usaban: que las membresías lo reflejen.
      await queryClient.invalidateQueries({ queryKey: ['cliente', 'membresia-renovacion'] })
      if (result.estado === 'pendiente') {
        Alert.alert('Eliminación pendiente', 'La tarjeta quedó desactivada en Membego. CardNET todavía no confirma su eliminación remota.')
      }
    },
  })

  const confirmDelete = (card: SavedPaymentCard) => {
    Alert.alert(
      'Eliminar tarjeta',
      `¿Quieres quitar ${cardLabel(card)} de tu cuenta? Si esta tarjeta está asociada a una renovación automática que autorizaste antes, esa renovación también se desactivará.`,
      [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => deleteMutation.mutate(card.id) },
      ]
    )
  }

  if (authLoading || (isAuthenticated && cardsQuery.isLoading)) {
    return <View className="flex-1 items-center justify-center bg-vibe-fondo"><ActivityIndicator size="large" color={colors.vibe.deep} /></View>
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-vibe-fondo p-4">
        <BackHeader title="Tarjetas guardadas" leftInset={0} onBack={() => router.back()} />
        <EmptyState title="Inicia sesión para continuar" description="Tus métodos de pago solo están disponibles para tu cuenta." action={<Button onPress={() => router.push('/(auth)/login')}>Iniciar sesión</Button>} />
      </View>
    )
  }

  const cards = cardsQuery.data?.tarjetas ?? []
  return (
    <View className="flex-1 bg-vibe-fondo">
      <BackHeader title="Tarjetas guardadas" leftInset={0} onBack={() => router.back()} />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <View className="flex-row items-start gap-3 rounded-xl border border-success/20 bg-success/5 p-3">
          <ShieldCheck size={19} color={colors.state.success} />
          <Text className="flex-1 text-sm leading-5 text-foreground">CardNET protege los datos de tu tarjeta. Membego muestra solo la marca y los últimos cuatro dígitos. Guardar una tarjeta no activa renovaciones automáticas.</Text>
        </View>

        {cardsQuery.isError ? (
          <EmptyState
            icon={<CreditCard size={34} color={colors.vibe.deep} />}
            title="No pudimos cargar tus tarjetas"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={<Button variant="outline" onPress={() => void cardsQuery.refetch()}>Reintentar</Button>}
          />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={34} color={colors.vibe.deep} />}
            title="Todavía no tienes tarjetas guardadas"
            description="Al pagar con CardNET, marca “Guardar esta tarjeta para futuras compras”. El permiso es opcional y no inicia renovaciones automáticas."
          />
        ) : cards.map((card) => (
          <Card key={card.id} className="gap-3 p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <CreditCard size={21} color={colors.primary.DEFAULT} />
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-base font-inter-semibold text-foreground">{cardLabel(card)}</Text>
                  {card.predeterminada ? <Text className="rounded-full bg-primary/10 px-2 py-1 text-xs font-inter-semibold text-primary">Predeterminada</Text> : null}
                  {card.eliminacionPendiente ? <Text className="rounded-full bg-warning/10 px-2 py-1 text-xs font-inter-semibold text-warning">Eliminación pendiente</Text> : null}
                  {card.vencida ? <Text className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-inter-semibold text-destructive">Vencida</Text> : null}
                </View>
                <Text className="mt-1 text-small text-muted-foreground">
                  {card.vencMes && card.vencAnio ? `Vence ${String(card.vencMes).padStart(2, '0')}/${String(card.vencAnio).slice(-2)}` : 'Vencimiento no disponible'}
                </Text>
                {card.vencida ? <Text className="mt-1 text-small leading-5 text-destructive">No se usará para una renovación. Elimina esta tarjeta y guarda una nueva al hacer otro pago.</Text> : null}
              </View>
            </View>
            {!card.eliminacionPendiente ? (
              <View className="flex-row gap-2">
                {!card.predeterminada && !card.vencida ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={defaultMutation.isPending || deleteMutation.isPending}
                    loading={defaultMutation.isPending && defaultMutation.variables === card.id}
                    icon={<Star size={15} color={colors.vibe.deep} />}
                    onPress={() => defaultMutation.mutate(card.id)}
                  >Establecer predeterminada</Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleteMutation.isPending || defaultMutation.isPending}
                  loading={deleteMutation.isPending && deleteMutation.variables === card.id}
                  icon={<Trash2 size={15} color={colors.state.danger} />}
                  onPress={() => confirmDelete(card)}
                >Eliminar</Button>
              </View>
            ) : null}
          </Card>
        ))}

        {defaultMutation.isError || deleteMutation.isError ? (
          <Text className="text-sm text-destructive">No pudimos completar el cambio. Actualiza la pantalla e inténtalo de nuevo.</Text>
        ) : null}
      </ScrollView>
    </View>
  )
}
