import React, { useState } from 'react'
import { Alert, Pressable, Text, ActivityIndicator } from 'react-native'
import { XCircle } from 'lucide-react-native'
import { useCancelarCita } from '../../hooks/useCitas'

export function CancelarCitaButton({ citaId }: { citaId: string }) {
  const mutation = useCancelarCita()
  const [confirming, setConfirming] = useState(false)

  const handlePress = () => {
    Alert.alert(
      'Cancelar esta cita?',
      'El turno quedara libre para otra persona. Podras reservar otro cuando quieras.',
      [
        { text: 'Mantener', style: 'cancel' },
        {
          text: 'Cancelar cita',
          style: 'destructive',
          onPress: () => {
            setConfirming(true)
            mutation.mutate(citaId, {
              onSettled: () => setConfirming(false),
            })
          },
        },
      ],
    )
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={mutation.isPending || confirming}
      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg active:bg-muted"
      accessibilityRole="button"
      accessibilityLabel="Cancelar cita"
    >
      {mutation.isPending || confirming ? (
        <ActivityIndicator size="small" color="#e7000b" />
      ) : (
        <XCircle size={16} color="#71717a" />
      )}
      <Text className="text-sm font-inter-medium text-muted-foreground">Cancelar</Text>
    </Pressable>
  )
}
