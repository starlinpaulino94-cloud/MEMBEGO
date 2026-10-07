import React from 'react'
import { View } from 'react-native'
import { Card, type CardProps } from '../ui/Card'
import { cn } from '../../lib/cn'

export type MarketplaceCardVariant = 'standard' | 'flush' | 'horizontal'

export interface MarketplaceCardProps extends Omit<CardProps, 'className'> {
  className?: string
  footer?: React.ReactNode
  variant?: MarketplaceCardVariant
}

const VARIANT_CLASSES: Record<MarketplaceCardVariant, string> = {
  standard: 'p-3',
  flush: 'p-0',
  horizontal: 'flex-row gap-2 p-2',
}

export function MarketplaceCard({
  children,
  footer,
  className,
  variant = 'standard',
  ...cardProps
}: MarketplaceCardProps) {
  return (
    <Card
      {...cardProps}
      className={cn('border-vibe-borde w-56', VARIANT_CLASSES[variant], className)}
    >
      {footer === undefined || footer === null ? (
        children
      ) : (
        <View className="flex-1 justify-between">
          <View className={cn('flex-1', variant === 'horizontal' && 'flex-row gap-2')}>
            {children}
          </View>
          <View className={cn(variant == "standard" ? "border-t border-border mt-3 pb-1" : '', 'pt-2')}>{footer}</View>
        </View>
      )}
    </Card>
  )
}
