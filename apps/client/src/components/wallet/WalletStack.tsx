import React from 'react'
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { walletCard } from '../../theme/tokens'
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
  const [containerWidth, setContainerWidth] = useState(0)
  const availableWidth = Math.min(containerWidth || walletCard.geometry.width, walletCard.grid.maxWidth)
  const columns = availableWidth >= walletCard.grid.threeColumnBreakpoint
    ? 3
    : availableWidth >= walletCard.grid.twoColumnBreakpoint
      ? 2
      : 1
  const cardWidth = Math.min(
    walletCard.grid.maxCardWidth,
    (availableWidth - walletCard.grid.gap * (columns - 1)) / columns,
  )

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width)
  }

  return (
    <View
      className="w-full max-w-wallet-grid self-center flex-row flex-wrap justify-center gap-4"
      onLayout={handleLayout}
      style={{ maxWidth: walletCard.grid.maxWidth }}
    >
      {items.map((item) => (
        <View key={item.id} style={{ width: cardWidth }}>
          <WalletCard
            data={item.card}
            qrToken={item.qrToken}
            isActive={item.isActive}
            maxWidth={cardWidth}
            onPressDetails={() => onPressDetails?.(item.id)}
          />
        </View>
      ))}
    </View>
  )
}
