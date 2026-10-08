import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronRight, RotateCcw } from 'lucide-react-native'
import QRCode from 'react-native-qrcode-svg'
import { colors, walletCard } from '../../theme/tokens'
import type { WalletCardData } from './WalletCard'

interface WalletCardBackProps {
  readonly data: WalletCardData
  readonly qrToken?: string | null
  readonly onFlip: () => void
  readonly onPressDetails?: () => void
  readonly scale: number
}

export function WalletCardBack({ data, qrToken, onFlip, onPressDetails, scale }: WalletCardBackProps) {
  return (
    <View className="flex-1 items-center justify-between overflow-hidden rounded-wallet-card border border-border/60 bg-white px-3.5 py-3"
      style={{ borderRadius: walletCard.geometry.radius, paddingHorizontal: 14 * scale, paddingVertical: 12 * scale }}>
      <Pressable
        accessibilityLabel="Volver a la tarjeta"
        accessibilityRole="button"
        onPress={onFlip}
        className="absolute right-2 top-2 z-10 h-wallet-control w-wallet-control items-center justify-center rounded-full"
        style={{ width: walletCard.geometry.controlSize * scale, height: walletCard.geometry.controlSize * scale }}
      >
        <RotateCcw color={colors.surface.mutedForeground} size={walletCard.iconSize.flip * scale} />
      </Pressable>

      <View className="w-full flex-1 items-center justify-center">
        <QRCode
          backgroundColor={colors.surface.background}
          color={walletCard.qr.foreground}
          size={walletCard.qr.size * scale}
          value={qrToken || data.company.name}
        />
      </View>

      <Text numberOfLines={2} className="mb-1 max-w-full text-center font-inter-medium text-wallet-caption text-muted-foreground"
        style={{ fontSize: walletCard.typography.caption.fontSize * scale, lineHeight: walletCard.typography.caption.lineHeight * scale }}>
        {data.company.name}
      </Text>

      {onPressDetails ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPressDetails}
          className="min-h-7 flex-row items-center justify-center gap-1 rounded-full bg-retail-deep px-3"
          style={{ minHeight: 28 * scale, paddingHorizontal: 12 * scale }}
        >
          <Text className="font-inter-semibold text-wallet-caption text-white"
          style={{ fontSize: walletCard.typography.caption.fontSize * scale, lineHeight: walletCard.typography.caption.lineHeight * scale }}>Ver detalles</Text>
          <ChevronRight color={colors.surface.background} size={walletCard.iconSize.details * scale} />
        </Pressable>
      ) : null}
    </View>
  )
}
