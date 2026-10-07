import { Pressable, Text, View } from 'react-native'
import { ArrowLeft } from 'lucide-react-native'
import React from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cn } from '../../lib/cn'
import { useIsResponsiveDetailSheet } from './ResponsiveDetailSheet'

interface BackHeaderProps {
  readonly className?: string
  readonly title: React.ReactNode
  readonly leftInset: number
  readonly onBack?: () => void
  readonly border?: boolean
  readonly safeAreaTop?: boolean
}

export function BackHeader({
  className,
  title,
  leftInset,
  onBack,
  border = true,
  safeAreaTop = true,
}: BackHeaderProps) {
  const insets = useSafeAreaInsets()
  const isResponsiveDetailSheet = useIsResponsiveDetailSheet()

  return (
    <View
      className={cn("flex-row items-center gap-2", border ? "border-b border-border" : "", className)}
      style={{
        paddingLeft: leftInset + 16,
        paddingRight: 16,
        paddingTop: (safeAreaTop && !isResponsiveDetailSheet ? insets.top : 0) + 12,
        paddingBottom: 12,
      }}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          className="rounded-lg p-2 active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
      ) : null}
      {typeof title === 'string' ? (
        <Text className="text-lg font-inter-bold text-foreground">{title}</Text>
      ) : (
        <View className="flex-1">
          {title}
        </View>
      )}
    </View>
  )
}
