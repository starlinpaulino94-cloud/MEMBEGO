import React, { useRef, useState } from 'react'
import { View, Text, Pressable, Image, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurTargetView, BlurView } from 'expo-blur'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated'
import { RotateCcw, Clock, Shield, ChevronRight } from 'lucide-react-native'
import QRCode from 'react-native-qrcode-svg'
import { cn } from '../../lib/cn'
import { brandColor, hasBrandColor } from '../../lib/brand-color'

export type WalletCardTone = 'active' | 'pending' | 'expired'

export interface WalletCardData {
  company: {
    name: string
    logoUrl: string | null
    colorPrimario?: string | null
  }
  planNombre: string
  estadoLabel: string
  tone: WalletCardTone
  expiryText?: string | null
  esIlimitado: boolean
  usosRestantes: number
  usosTotales: number | null
}

export interface WalletCardProps {
  data: WalletCardData
  /** Token del QR (null = sin QR). */
  qrToken?: string | null
  /** Si la membresía está activa (permite flip). */
  isActive?: boolean
  /** Callback al tocar "Ver detalles". */
  onPressDetails?: () => void
  /** ClassName para overrides. */
  className?: string
}

function getGradientColors(data: WalletCardData): [string, string, ...string[]] {
  const brand = hasBrandColor(data.company.colorPrimario)
    ? brandColor(data.company.colorPrimario, '#0f172a')
    : null
  if (brand) {
    return [brand, '#0b1220', brand]
  }
  if (data.tone === 'pending') return ['#475569', '#334155']
  if (data.tone === 'expired') return ['#64748b', '#475569']
  return ['#0f172a', '#1e293b', '#0f172a']
}

function getUsagePercentage(data: WalletCardData): number {
  if (!data.usosTotales || data.usosTotales <= 0) return 0
  const pct = (data.usosRestantes / data.usosTotales) * 100
  return Math.max(0, Math.min(100, pct))
}

/**
 * Tarjeta de membresía estilo Apple Wallet con flip 3D.
 * Cara frontal: gradiente de marca, logo, plan, medidor de uso, vigencia.
 * Cara trasera: QR + "Ver detalles".
 */
export function WalletCard({
  data,
  qrToken,
  isActive,
  onPressDetails,
  className,
}: WalletCardProps) {
  const [flipped, setFlipped] = useState(false)
  const rotation = useSharedValue(0)
  const blurTarget = useRef<View>(null)

  const canFlip = !!qrToken && !!isActive

  const handlePress = () => {
    if (!canFlip) {
      onPressDetails?.()
      return
    }
    const newFlipped = !flipped
    setFlipped(newFlipped)
    rotation.value = withTiming(newFlipped ? 180 : 0, { duration: 350 })
  }

  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180], Extrapolation.CLAMP)
    return {
      transform: [{ perspective: 1400 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
    }
  })

  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360], Extrapolation.CLAMP)
    return {
      transform: [{ perspective: 1400 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
    }
  })

  const usagePct = getUsagePercentage(data)
  const unlimited = data.esIlimitado
  const companyAccent = hasBrandColor(data.company.colorPrimario)
    ? brandColor(data.company.colorPrimario, '#0f172a')
    : null
  const gradientColors = getGradientColors(data)
  const isInactive = data.tone !== 'active'
  const logoInitial = data.company.name
    ? data.company.name.slice(0, 2).toUpperCase()
    : '?'

  return (
    <View style={[styles.container, className ? { overflow: 'hidden' } : undefined]}>
      {/* ── Front Face ── */}
      <Animated.View style={[styles.card, frontAnimatedStyle]}>
        <Pressable onPress={handlePress} style={styles.cardInner}>
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.gradient}
          >
            <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
              {/* Textura sutil */}
              <View style={styles.textureOverlay} />
              <View style={styles.glowOrb} />

              <View style={styles.cardContent}>
                {/* Top: company + logo */}
                <View style={styles.topRow}>
                  <View style={styles.companyBlock}>
                    <Text className="text-[15px] font-inter-semibold leading-tight text-white" numberOfLines={1}>
                      {data.company.name}
                    </Text>
                    <View className="mt-0.5 flex-row items-center gap-1">
                      <Shield size={12} color="rgba(255,255,255,0.7)" />
                      <Text className="text-[12px] text-white/70">Membresía digital</Text>
                    </View>
                  </View>
                  {data.company.logoUrl ? (
                    <View style={styles.logoContainer}>
                      <Image
                        source={{ uri: data.company.logoUrl }}
                        style={styles.logoImage}
                        resizeMode="cover"
                      />
                    </View>
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Text className="text-xs font-inter-bold text-white/80">
                        {logoInitial}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Plan */}
                <View>
                  <Text className="text-[12px] font-inter-medium uppercase tracking-[3px] text-white/60">
                    Plan
                  </Text>
                  <Text
                    className="mt-0.5 text-xl font-inter-bold uppercase tracking-widest text-white"
                    numberOfLines={1}
                  >
                    {data.planNombre}
                  </Text>
                </View>

                {/* Bottom: usage + expiry + status */}
                <View>
                  {/* Usage meter */}
                  <View style={styles.meterTrack}>
                    {unlimited ? (
                      <LinearGradient
                        colors={companyAccent ? [companyAccent, companyAccent] : ['#7c3aed', '#06b6d4']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.meterFill, { width: '100%' }]}
                      />
                    ) : (
                      <View style={[styles.meterFill, { width: `${usagePct}%` }]}>
                        <LinearGradient
                          colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.7)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.meterFillInner}
                        />
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-white/70 mb-2">
                    {unlimited
                      ? 'Ilimitado'
                      : `${data.usosRestantes} / ${data.usosTotales} usos restantes`}
                  </Text>

                  {/* Expiry + status chip */}
                  <View style={styles.bottomRow}>
                    {data.expiryText ? (
                      <View className="flex-row items-center gap-1.5 flex-1 mr-2">
                        <Clock size={12} color="rgba(255,255,255,0.75)" />
                        <Text className="text-[12px] text-white/75 flex-1" numberOfLines={1}>
                          {data.expiryText}
                        </Text>
                      </View>
                    ) : (
                      <View className="flex-1" />
                    )}
                    <View
                      className={cn(
                        'rounded-full px-2.5 py-0.5',
                        data.tone === 'active'
                          ? 'bg-white/15 border border-white/25'
                          : data.tone === 'pending'
                            ? 'bg-warning/25 border border-warning/30'
                            : 'bg-destructive/25 border border-destructive/30'
                      )}
                    >
                      <Text
                        className={cn(
                          'text-[12px] font-inter-semibold',
                          data.tone === 'active'
                            ? 'text-white'
                            : data.tone === 'pending'
                              ? 'text-warning'
                              : 'text-destructive'
                        )}
                      >
                        {data.estadoLabel}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </BlurTargetView>
            {isInactive && (
              <>
                <BlurView
                  blurTarget={blurTarget}
                  intensity={44}
                  tint="dark"
                  blurMethod="dimezisBlurView"
                  style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
                />
                <View style={styles.inactiveScrim} />
                <View style={styles.statusBadgeWrap}>
                  <View
                    style={[
                      styles.statusBadge,
                      data.tone === 'pending'
                        ? styles.pendingBadge
                        : styles.expiredBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        data.tone === 'pending'
                          ? styles.pendingBadgeText
                          : styles.expiredBadgeText,
                      ]}
                    >
                      {data.estadoLabel}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* ── Back Face (QR) ── */}
      <Animated.View style={[styles.card, styles.backCard, backAnimatedStyle]}>
        <View style={styles.backContent}>
          {/* Flip-back button */}
          <Pressable
            onPress={handlePress}
            className="absolute top-3 right-3 rounded-full bg-muted p-2 active:bg-muted/80"
          >
            <RotateCcw size={16} color="#475569" />
          </Pressable>

          {/* QR */}
          <View className="items-center justify-center flex-1">
            <QRCode
              value={qrToken || data.company.name}
              size={180}
              color="#0f172a"
              backgroundColor="#ffffff"
            />
          </View>

          {/* Company name */}
          <Text className="text-xs font-inter-medium text-muted-foreground text-center mt-2">
            {data.company.name}
          </Text>

          {/* Ver detalles */}
          {onPressDetails && (
            <Pressable
              onPress={onPressDetails}
              className="mt-2 flex-row items-center justify-center gap-1 rounded-full bg-retail-deep px-4 py-2 active:opacity-90"
            >
              <Text className="text-xs font-inter-semibold text-white">Ver detalles</Text>
              <ChevronRight size={14} color="#ffffff" />
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1.586,
    minHeight: 196,
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 22,
    overflow: 'hidden',
  },
  backCard: {
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.6)',
    backgroundColor: '#ffffff',
  },
  backContent: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInner: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
  },
  cardContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  companyBlock: {
    flex: 1,
    minWidth: 0,
  },
  logoContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  meterTrack: {
    height: 8,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  meterFill: {
    height: '100%',
    borderRadius: 9999,
  },
  meterFillInner: {
    height: '100%',
    borderRadius: 9999,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  textureOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.04,
    backgroundColor: 'transparent',
  },
  glowOrb: {
    position: 'absolute',
    right: -64,
    top: -80,
    width: 192,
    height: 192,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  inactiveScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
  },
  statusBadgeWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  statusBadge: {
    minHeight: 58,
    maxWidth: '100%',
    paddingHorizontal: 24,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    borderWidth: 1,
  },
  pendingBadge: {
    backgroundColor: 'rgba(255, 247, 237, 0.96)',
    borderColor: '#f59e0b',
  },
  expiredBadge: {
    backgroundColor: 'rgba(254, 242, 242, 0.96)',
    borderColor: '#ba1a1a',
  },
  statusBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'center',
  },
  pendingBadgeText: {
    color: '#7c2d12',
  },
  expiredBadgeText: {
    color: '#991b1b',
  },
})
