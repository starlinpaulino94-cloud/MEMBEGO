import React, { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { WalletCard, type WalletCardData } from './WalletCard'

export interface WalletStackItem {
  id: string
  card: WalletCardData
  qrToken: string | null
  isActive: boolean
}

interface WalletStackProps {
  items: WalletStackItem[]
  onPressDetails?: (id: string) => void
}

/**
 * Pila de tarjetas estilo Apple Wallet:
 * - La tarjeta del frente se muestra completa y es interactiva (flip/QR).
 * - Las demás asoman como franjas apiladas detrás (offset negativo).
 * - Tocar una franja la trae al frente.
 */
export function WalletStack({ items, onPressDetails }: WalletStackProps) {
  const [frontId, setFrontId] = useState(items[0]?.id ?? '')

  const front = items.find((i) => i.id === frontId) ?? items[0]
  if (!front) return null
  const resto = items.filter((i) => i.id !== front.id)

  return (
    <View style={styles.container}>
      {/* Background cards (strips) */}
      {resto.map((item, idx) => (
        <Pressable
          key={item.id}
          onPress={() => setFrontId(item.id)}
          style={[
            styles.strip,
            {
              top: (idx + 1) * 12,
              zIndex: idx + 1,
              marginHorizontal: (idx + 1) * 6,
            },
          ]}
        >
          <StripCard data={item.card} />
        </Pressable>
      ))}

      {/* Front card */}
      <View
        style={[
          styles.frontWrapper,
          resto.length > 0 && { marginTop: resto.length * 12 + 8 },
          { zIndex: resto.length + 1 },
        ]}
      >
        <WalletCard
          data={front.card}
          qrToken={front.qrToken}
          isActive={front.isActive}
          onPressDetails={() => onPressDetails?.(front.id)}
        />
      </View>

      {/* Hint text */}
      <Text style={styles.hint}>
        {front.qrToken && front.isActive
          ? 'Toca la tarjeta para ver su código QR'
          : 'Toca la tarjeta para ver los detalles'}
      </Text>
    </View>
  )
}

/** Mini card render for background strips — just the gradient, no interaction. */
function StripCard({ data }: { data: WalletCardData }) {
  const brand =
    data.tone === 'active' && data.company.colorPrimario
      ? data.company.colorPrimario
      : null

  const colors: [string, string] = brand
    ? [brand, '#0b1220']
    : data.tone === 'pending'
      ? ['#475569', '#334155']
      : data.tone === 'expired'
        ? ['#64748b', '#475569']
        : ['#0f172a', '#1e293b']

  return (
    <LinearGradient colors={colors} style={styles.stripGradient}>
      <View style={styles.stripContent}>
        <Text className="text-[13px] font-inter-semibold text-white" numberOfLines={1}>
          {data.company.name}
        </Text>
      </View>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 72,
    borderRadius: 22,
    overflow: 'hidden',
  },
  stripGradient: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  frontWrapper: {
    position: 'relative',
  },
  hint: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 12,
    color: '#71717a',
  },
})
