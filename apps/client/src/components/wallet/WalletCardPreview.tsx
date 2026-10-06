import React, { useRef } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'
import { colors, walletCard } from '../../theme/tokens'
import { WalletCardFront, type WalletCardFrontPreview as WalletCardFrontPreviewData } from './WalletCardFront'
import type { WalletCardData } from './WalletCard'

export interface WalletCardPreviewData {
  readonly company: {
    readonly name: string
    readonly logoUrl: string | null
    readonly color: string
  }
  readonly plan: {
    readonly name: string
    readonly color: string
    readonly price: string
    readonly validityDays: number
    readonly includedUses: string
  }
}

export function WalletCardPreview({ data }: { readonly data: WalletCardPreviewData }) {
  const { width } = useWindowDimensions()
  const blurTarget = useRef<View>(null)
  const companyColor = brandColor(data.company.color, colors.primary.DEFAULT)
  const planColor = brandColor(data.plan.color, companyColor)
  const foreground = brandDisplayForeground(planColor, colors.primary.DEFAULT)
  const cardWidth = Math.min(Math.max(width - 32, 240), walletCard.grid.maxCardWidth)
  const scale = cardWidth / walletCard.geometry.width

  const cardData: WalletCardData = {
    company: {
      name: data.company.name,
      logoUrl: data.company.logoUrl,
      colorPrimario: companyColor,
    },
    planNombre: data.plan.name,
    estadoLabel: '',
    tone: 'active',
    expiryText: null,
    esIlimitado: false,
    usosRestantes: 0,
    usosTotales: null,
  }
  const preview: WalletCardFrontPreviewData = {
    backgroundColor: planColor,
    foreground,
    accentColor: companyColor,
    priceText: data.plan.price,
    includedUses: data.plan.includedUses === 'Usos ilimitados'
      ? data.plan.includedUses
      : `${data.plan.includedUses} incluidos`,
    validityText: data.plan.validityDays > 0 ? `Vigencia ${data.plan.validityDays} días` : null,
  }

  return (
    <View
      className="relative mt-2 w-full self-center shadow-premium"
      style={{ width: cardWidth, maxWidth: walletCard.grid.maxCardWidth, aspectRatio: walletCard.geometry.aspectRatio }}
    >
      <WalletCardFront data={cardData} blurTarget={blurTarget} preview={preview} scale={scale} />
    </View>
  )
}
