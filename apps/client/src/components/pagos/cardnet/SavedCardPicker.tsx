import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check, CreditCard } from 'lucide-react-native'
import type { SavedPaymentCard } from '../../../lib/api'

export function SavedCardPicker({
  cards,
  selectedId,
  onSelect,
  disabled = false,
}: {
  cards: readonly SavedPaymentCard[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  disabled?: boolean
}) {
  const available = cards.filter((card) => card.vencida === false && !card.eliminacionPendiente)
  if (available.length === 0) return null

  return (
    <View className="gap-2">
      <Text className="text-sm font-inter-semibold text-foreground">Método de pago</Text>
      {available.map((card) => {
        const selected = selectedId === card.id
        return (
          <Pressable
            key={card.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(selected ? null : card.id)}
            className={`min-h-14 flex-row items-center gap-3 rounded-xl border px-3 py-3 ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'} ${disabled ? 'opacity-60' : 'active:opacity-80'}`}
          >
            <CreditCard size={19} color={selected ? '#0284c7' : '#64748b'} />
            <View className="flex-1">
              <Text className="text-sm font-inter-semibold text-foreground">
                {card.marca || 'Tarjeta'}{card.ultimos4 ? ` ···· ${card.ultimos4}` : ''}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {card.vencMes && card.vencAnio ? `Vence ${String(card.vencMes).padStart(2, '0')}/${card.vencAnio}` : 'Guardada en CardNET'}
                {card.predeterminada ? ' · Predeterminada' : ''}
              </Text>
            </View>
            {selected ? <Check size={18} color="#0284c7" /> : null}
          </Pressable>
        )
      })}
      {selectedId ? (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSelect(null)} className="self-start px-1 py-1">
          <Text className="text-xs font-inter-semibold text-primary">Usar una tarjeta nueva</Text>
        </Pressable>
      ) : (
        <Text className="text-xs leading-5 text-muted-foreground">El cobro de esta compra se hará con la tarjeta elegida. No activa renovaciones automáticas.</Text>
      )}
    </View>
  )
}
