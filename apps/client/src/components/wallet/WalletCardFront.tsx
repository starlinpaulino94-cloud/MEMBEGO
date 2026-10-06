import React, { type RefObject } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { Clock, QrCode, Shield } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { brandColor } from '../../lib/brand-color'
import { colors, walletCard } from '../../theme/tokens'
import type { WalletCardData } from './WalletCard'

interface WalletCardFrontProps {
  readonly data: WalletCardData
  readonly blurTarget: RefObject<View | null>
  readonly onPress?: () => void
  readonly scale: number
  readonly preview?: WalletCardFrontPreview
}

export interface WalletCardFrontPreview {
  readonly backgroundColor: string
  readonly foreground: string
  readonly accentColor: string
  readonly priceText: string
  readonly includedUses: string
  readonly validityText: string | null
}

const USAGE_SEGMENTS = [0, 1, 2, 3] as const

function getBrandColor(data: WalletCardData): string {
  return brandColor(data.company.colorPrimario, colors.membership.active)
}

function assertNever(value: never): never {
  throw new Error('Unexpected membership card tone: ' + value)
}

function getGradientColors(data: WalletCardData, backgroundColor?: string): readonly [string, string] {
  if (backgroundColor) return [backgroundColor, backgroundColor]

  switch (data.tone) {
    case 'active': {
      const brand = getBrandColor(data)
      return [brand, brand]
    }
    case 'pending':
      return walletCard.gradient.pending
    case 'expired':
      return walletCard.gradient.expired
    default:
      return assertNever(data.tone)
  }
}

function scaleTypography(
  typography: { readonly fontSize: number; readonly lineHeight: number; readonly letterSpacing?: number },
  scale: number,
) {
  return {
    fontSize: typography.fontSize * scale,
    lineHeight: typography.lineHeight * scale,
    letterSpacing: typography.letterSpacing === undefined ? undefined : typography.letterSpacing * scale,
  }
}

export function WalletCardFront({ data, blurTarget, onPress, scale, preview }: WalletCardFrontProps) {
  const isInactive = data.tone !== 'active'
  const total = data.usosTotales ?? 0
  const available = Math.max(0, data.usosRestantes)
  const consumed = total > 0 ? Math.max(0, total - available) : 0
  const progressColor = getBrandColor(data)
  const filledSegments = data.esIlimitado
    ? USAGE_SEGMENTS.length
    : total > 0
      ? Math.round((Math.min(available, total) / total) * USAGE_SEGMENTS.length)
      : 0
  const usageText = data.esIlimitado
    ? 'Usos ilimitados'
    : total > 0
      ? available + ' de ' + total + ' disponibles · ' + consumed + ' consumido' + (consumed === 1 ? '' : 's')
      : available + ' disponibles'
  const foreground = preview?.foreground ?? colors.surface.background

  const cardContent = (
    <LinearGradient
      colors={getGradientColors(data, preview?.backgroundColor)}
      end={walletCard.gradient.end}
      start={walletCard.gradient.start}
      style={{ flex: 1 }}
    >
      <LinearGradient
        colors={walletCard.gradient.sheen}
        end={walletCard.gradient.end}
        locations={walletCard.gradient.sheenLocations}
        start={walletCard.gradient.start}
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
      />

      <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
        <View className="flex-1 justify-between px-wallet-inset py-wallet-content-y"
          style={{ paddingHorizontal: walletCard.geometry.inset * scale, paddingVertical: walletCard.geometry.contentPaddingY * scale }}>
          <View className="flex-row items-start justify-between gap-2.5">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={2} className="font-inter-bold text-wallet-company text-white"
                style={[scaleTypography(walletCard.typography.company, scale), preview ? { color: foreground } : undefined]}>
                {data.company.name}
              </Text>
              <View className="mt-0.5 flex-row items-center gap-1">
                <Shield color={preview ? foreground : walletCard.iconColor.muted} size={walletCard.iconSize.shield * scale} />
                <Text className="font-inter-regular text-wallet-meta text-white/75"
                  style={[scaleTypography(walletCard.typography.meta, scale), preview ? { color: foreground } : undefined]}>
                  Membresía digital
                </Text>
              </View>
            </View>

            {data.company.logoUrl ? (
              <View className="h-wallet-logo w-wallet-logo items-center justify-center overflow-hidden rounded-lg border border-white/20 bg-white/15"
                style={{ width: walletCard.geometry.logoSize * scale, height: walletCard.geometry.logoSize * scale }}>
                <Image
                  source={{ uri: data.company.logoUrl }}
                  className="h-full w-full"
                  resizeMode="cover"
                />
              </View>
            ) : (
              <View className="h-wallet-logo w-wallet-logo items-center justify-center rounded-lg border border-white/35 bg-white/15"
                style={{ width: walletCard.geometry.logoSize * scale, height: walletCard.geometry.logoSize * scale }}>
                <Text className="font-inter-bold text-wallet-mark text-white"
                  style={[scaleTypography(walletCard.typography.mark, scale), preview ? { color: foreground } : undefined]}>
                  {data.company.name.slice(0, 2).toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1">
              <Text className="font-inter-semibold text-wallet-overline uppercase text-white/70"
                style={[scaleTypography(walletCard.typography.overline, scale), preview ? { color: foreground } : undefined]}>
                Plan
              </Text>
              <Text numberOfLines={2} className={cn(
                'mt-0.5 font-inter-bold uppercase text-white',
                data.planNombre.length > 20
                  ? 'text-wallet-plan-long'
                  : 'text-wallet-plan',
              )}
              style={[scaleTypography(data.planNombre.length > 20 ? walletCard.typography.planLong : walletCard.typography.plan, scale), preview ? { color: foreground } : undefined]}>
                {data.planNombre}
              </Text>
            </View>
            <View className="ml-3 size-9 items-center justify-center rounded-full border border-white/20 bg-white/20" style={{ marginLeft: 12 * scale, width: 36 * scale, height: 36 * scale }}>
              <QrCode color={preview ? foreground : colors.surface.background} size={walletCard.iconSize.qr * scale} strokeWidth={walletCard.iconStrokeWidth} />
            </View>
          </View>

          {preview ? (
            <View
              className="flex-row items-center justify-between gap-3 rounded-xl border px-3 py-2"
              style={{
                backgroundColor: 'rgba(255,255,255,0.16)',
                borderColor: 'rgba(255,255,255,0.28)',
                borderLeftColor: preview.accentColor,
                borderLeftWidth: 3 * scale,
                borderRadius: 12 * scale,
                paddingHorizontal: 12 * scale,
                paddingVertical: 8 * scale,
              }}
            >
              <View className="min-w-0 flex-1">
                <Text
                  numberOfLines={1}
                  className="font-inter-bold"
                  style={[scaleTypography(walletCard.typography.planLong, scale), { color: foreground }]}
                >
                  {preview.priceText}
                </Text>
                <Text
                  numberOfLines={1}
                  className="font-inter-regular"
                  style={[scaleTypography(walletCard.typography.meta, scale), { color: foreground, opacity: 0.76 }]}
                >
                  por membresía
                </Text>
              </View>
              <View className="items-end">
                <Text
                  numberOfLines={1}
                  className="font-inter-semibold"
                  style={[scaleTypography(walletCard.typography.usage, scale), { color: foreground }]}
                >
                  {preview.includedUses}
                </Text>
                {preview.validityText ? (
                  <Text
                    numberOfLines={1}
                    className="font-inter-regular"
                    style={[scaleTypography(walletCard.typography.expiry, scale), { color: foreground, opacity: 0.76 }]}
                  >
                    {preview.validityText}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <View className="gap-1">
              <View
                accessibilityLabel="Usos disponibles de la membresía"
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: USAGE_SEGMENTS.length, now: filledSegments }}
                className="mb-0.5 flex-row gap-1"
              >
                {USAGE_SEGMENTS.map((segment) => (
                  <View
                    key={segment}
                    className={cn(
                      'h-wallet-progress flex-1 rounded-full',
                      segment < filledSegments ? '' : 'bg-white',
                    )}
                    style={[
                      { height: walletCard.geometry.progressHeight * scale },
                      segment < filledSegments ? { backgroundColor: progressColor } : undefined,
                    ]}
                  />
                ))}
              </View>
              <Text numberOfLines={2} className="font-inter-medium text-wallet-usage text-white/90"
                style={scaleTypography(walletCard.typography.usage, scale)}>
                {usageText}
              </Text>
              {data.expiryText ? (
              <View className="flex-row items-center gap-1.5">
                <Clock color={walletCard.iconColor.subtle} size={walletCard.iconSize.clock * scale} />
                <Text numberOfLines={2} className="flex-1 font-inter-regular text-wallet-expiry text-white/75"
                  style={scaleTypography(walletCard.typography.expiry, scale)}>
                  {data.expiryText}
                </Text>
              </View>
            ) : null}
            </View>
          )}
        </View>
      </BlurTargetView>

      {isInactive ? (
        <>
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurView"
            intensity={walletCard.blurIntensity}
            style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
            tint="dark"
          />
          <View className="pointer-events-none absolute inset-0 bg-slate-900/25" />
          <View className="pointer-events-none absolute inset-0 items-center justify-center px-5">
            <View
              className={cn(
                'min-h-12 max-w-full justify-center rounded-full border px-5 py-3',
                data.tone === 'pending'
                  ? 'border-warning/30 bg-warning/25'
                  : 'border-membership-expired-status/30 bg-membership-expired-status/25',
              )}
              style={[
                { minHeight: 48 * scale, paddingHorizontal: 20 * scale, paddingVertical: 12 * scale },
                data.tone === 'expired' ? {
                  borderColor: colors.membership.expiredStatusBorder,
                  backgroundColor: colors.membership.expiredStatusSurface,
                } : undefined,
              ]}
            >
              <Text
                className={cn(
                  'text-center font-inter-bold text-wallet-state',
                  data.tone === 'pending' ? 'text-warning' : 'text-membership-expired-status',
                )}
                style={[
                  scaleTypography(walletCard.typography.state, scale),
                  data.tone === 'expired' ? { color: colors.membership.expiredStatus } : undefined,
                ]}
              >
                {data.estadoLabel}
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </LinearGradient>
  )

  return preview ? (
    <View
      accessibilityLabel="Vista previa de la tarjeta de membresía"
      accessible
      className="flex-1 overflow-hidden rounded-wallet-card"
      style={{ borderRadius: walletCard.geometry.radius }}
    >
      {cardContent}
    </View>
  ) : (
    <Pressable
      accessibilityLabel={'Tarjeta de membresía de ' + data.company.name}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-1 overflow-hidden rounded-wallet-card"
      style={{ borderRadius: walletCard.geometry.radius }}
    >
      {cardContent}
    </Pressable>
  )
}
