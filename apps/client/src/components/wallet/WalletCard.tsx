import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { cn } from '../../lib/cn'
import { walletCard } from '../../theme/tokens'
import { WalletCardBack } from './WalletCardBack'
import { WalletCardFront } from './WalletCardFront'

export type WalletCardTone = 'active' | 'pending' | 'expired'

export interface WalletCardData {
  readonly company: {
    readonly name: string
    readonly logoUrl: string | null
    readonly colorPrimario?: string | null
  }
  readonly planNombre: string
  readonly estadoLabel: string
  readonly tone: WalletCardTone
  readonly expiryText?: string | null
  readonly esIlimitado: boolean
  readonly usosRestantes: number
  readonly usosTotales: number | null
}

export interface WalletCardProps {
  readonly data: WalletCardData
  /** Token del QR (null = sin QR). */
  readonly qrToken?: string | null
  /** Si la membresía está activa (permite flip). */
  readonly isActive?: boolean
  /** Callback al tocar "Ver detalles". */
  readonly onPressDetails?: () => void
  /** ClassName para overrides. */
  readonly className?: string
  readonly maxWidth?: number
}

export function WalletCard({
  data,
  qrToken,
  isActive,
  onPressDetails,
  className,
  maxWidth = walletCard.geometry.width,
}: WalletCardProps) {
  const [flipped, setFlipped] = useState(false)
  const rotation = useSharedValue(0)
  const blurTarget = useRef<View>(null)
  const canFlip = Boolean(qrToken && isActive)
  const scale = maxWidth / walletCard.geometry.width

  const handlePress = () => {
    if (!canFlip) {
      onPressDetails?.()
      return
    }

    const nextFlipped = !flipped
    setFlipped(nextFlipped)
    rotation.value = withTiming(nextFlipped ? 180 : 0, { duration: walletCard.flipDuration })
  }

  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180], Extrapolation.CLAMP)
    return {
      transform: [{ perspective: walletCard.perspective }, { rotateY: rotateY + 'deg' }],
      backfaceVisibility: 'hidden' as const,
    }
  })

  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360], Extrapolation.CLAMP)
    return {
      transform: [{ perspective: walletCard.perspective }, { rotateY: rotateY + 'deg' }],
      backfaceVisibility: 'hidden' as const,
    }
  })

  return (
    <View className={cn('relative aspect-wallet-card rounded-2xl w-full self-center shadow-premium', className)}
      style={{ aspectRatio: walletCard.geometry.aspectRatio, maxWidth }}>
      <View
        className="absolute inset-0 overflow-hidden rounded-wallet-card"
        style={{ borderRadius: walletCard.geometry.radius }}
        pointerEvents={flipped ? 'none' : 'auto'}
      >
        <Animated.View style={[{ flex: 1 }, frontAnimatedStyle]}>
          <WalletCardFront data={data} blurTarget={blurTarget} onPress={handlePress} scale={scale} />
        </Animated.View>
      </View>

      <View
        className="absolute inset-0 overflow-hidden rounded-wallet-card"
        style={{ borderRadius: walletCard.geometry.radius }}
        pointerEvents={flipped ? 'auto' : 'none'}
      >
        <Animated.View style={[{ flex: 1 }, backAnimatedStyle]}>
          <WalletCardBack
            data={data}
            qrToken={qrToken}
            onFlip={handlePress}
            onPressDetails={onPressDetails}
            scale={scale}
          />
        </Animated.View>
      </View>
    </View>
  )
}
