import React from 'react'
import { View } from 'react-native'
import { WalletCard, type WalletCardData } from './WalletCard'

export interface WalletStackItem {
  readonly id: string
  readonly card: WalletCardData
  readonly qrToken: string | null
  readonly isActive: boolean
}

interface WalletStackProps {
  readonly items: readonly WalletStackItem[]
  readonly onPressDetails?: (id: string) => void
}

export function WalletStack({ items, onPressDetails }: WalletStackProps) {
  return (
    <View className="w-full self-center gap-4" style={{ maxWidth: 520 }}>
      {items.map((item) => (
        <WalletCard
          key={item.id}
          data={item.card}
          qrToken={item.qrToken}
          isActive={item.isActive}
          onPressDetails={() => onPressDetails?.(item.id)}
        />
      ))}
    </View>
  )
}
