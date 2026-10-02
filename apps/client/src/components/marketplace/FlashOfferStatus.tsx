import React, { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { Zap } from 'lucide-react-native'

export function isFlashOffer(offer: {
  venta?: { agotada: boolean } | null
  vigenciaHasta?: string | Date | null
}): boolean {
  return Boolean(
    offer.venta &&
      !offer.venta.agotada &&
      offer.vigenciaHasta &&
      new Date(offer.vigenciaHasta).getTime() > Date.now(),
  )
}

export function FlashOfferStatus({
  hasta,
  color,
  compact = false,
}: {
  hasta: string | Date
  color: string
  compact?: boolean
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((new Date(hasta).getTime() - now) / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const countdown = days > 0
    ? `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`

  return (
    <View className={`flex-row items-center self-start rounded-full bg-card px-2.5 py-1 ${compact ? 'gap-1' : 'gap-1.5'}`}>
      <Zap size={compact ? 12 : 14} color={color} fill={color} />
      <Text className={compact ? 'text-[10px] font-inter-bold' : 'text-xs font-inter-bold'} style={{ color }}>
        Relámpago · {countdown}
      </Text>
    </View>
  )
}
