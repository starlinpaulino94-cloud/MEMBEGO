import { useCallback, useRef, useState } from 'react'
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { cn } from '../../lib/cn'
import { colors } from '../../theme/tokens'

export interface HorizontalScrollWithFadeProps
  extends Omit<ScrollViewProps, 'horizontal' | 'showsHorizontalScrollIndicator'> {
  readonly className?: string
  readonly fadeWidth?: number
}

export function HorizontalScrollWithFade({
  children,
  className,
  fadeWidth = 32,
  style,
  onContentSizeChange,
  onLayout,
  onScroll,
  scrollEventThrottle,
  ...scrollViewProps
}: HorizontalScrollWithFadeProps) {
  const [visibleEdges, setVisibleEdges] = useState({ left: false, right: false })
  const measurements = useRef({ contentWidth: 0, viewportWidth: 0, offsetX: 0 })

  const updateVisibleEdges = useCallback(() => {
    const maxOffset = Math.max(
      0,
      measurements.current.contentWidth - measurements.current.viewportWidth
    )
    const nextEdges = {
      left: measurements.current.offsetX > 1,
      right: maxOffset - measurements.current.offsetX > 1,
    }

    setVisibleEdges((currentEdges) =>
      currentEdges.left === nextEdges.left && currentEdges.right === nextEdges.right
        ? currentEdges
        : nextEdges
    )
  }, [])

  function handleLayout(event: LayoutChangeEvent) {
    measurements.current.viewportWidth = event.nativeEvent.layout.width
    updateVisibleEdges()
    onLayout?.(event)
  }

  function handleContentSizeChange(contentWidth: number, contentHeight: number) {
    measurements.current.contentWidth = contentWidth
    updateVisibleEdges()
    onContentSizeChange?.(contentWidth, contentHeight)
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    measurements.current.offsetX = event.nativeEvent.contentOffset.x
    updateVisibleEdges()
    onScroll?.(event)
  }

  return (
    <View className={cn('relative', className)}>
      <ScrollView
        {...scrollViewProps}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[{ flexGrow: 0 }, style]}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
      >
        {children}
      </ScrollView>
      {visibleEdges.left ? (
        <LinearGradient
          colors={[colors.overlay.whiteTransparent, colors.surface.background]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fadeWidth }}
        />
      ) : null}
      {visibleEdges.right ? (
        <LinearGradient
          colors={[colors.overlay.whiteTransparent, colors.surface.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          pointerEvents="none"
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: fadeWidth }}
        />
      ) : null}
    </View>
  )
}
