import React, { useEffect } from 'react'
import { Text, View } from 'react-native'
import type { CardnetCaptureSurfaceProps } from './capture.types'

/** Platform fallback: checkout is implemented only for Web and Android/iOS. */
export default function CardnetCaptureSurface({ onError }: CardnetCaptureSurfaceProps) {
  useEffect(() => onError('widget_unavailable'), [onError])
  return (
    <View className="min-h-[160px] items-center justify-center rounded-xl border border-border bg-muted px-4 py-6">
      <Text className="text-center text-sm text-muted-foreground">La captura segura no está disponible en esta plataforma.</Text>
    </View>
  )
}
