import React, { type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { cn } from '../../lib/cn'

interface DetailPageFrameProps {
  readonly children: ReactNode
  readonly className?: string
  readonly style?: StyleProp<ViewStyle>
}

export function DetailPageFrame({ children, className, style }: DetailPageFrameProps) {
  return (
    <View
      className={cn('w-full self-center', className)}
      style={[{ maxWidth: 680 }, style]}
    >
      {children}
    </View>
  )
}
