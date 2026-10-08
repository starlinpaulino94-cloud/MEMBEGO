import React, { useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { Clock, Flame, Heart, Sparkles, Star, ThumbsUp } from 'lucide-react-native'
import { BenefitCard } from '../marketplace/BenefitCard'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { SectionHeader } from '../ui/SectionHeader'
import { Skeleton } from '../ui/Skeleton'
import type { PromoFeed, PromotionPublic } from '../../lib/api'

const FEED_SECTIONS = [
  { key: 'misEmpresas', title: 'De tus empresas', description: 'Los negocios que sigues y donde eres cliente.', Icon: Star },
  { key: 'destacadas', title: 'Destacadas', description: 'Beneficios que merecen una mirada.', Icon: Flame },
  { key: 'nuevas', title: 'Recién llegadas', description: 'Lo nuevo de los últimos 14 días.', Icon: Sparkles },
  { key: 'expiranPronto', title: 'Por vencer', description: 'Aprovéchalas mientras están disponibles.', Icon: Clock },
  { key: 'recomendadas', title: 'Recomendadas para ti', description: 'Más opciones según tus negocios favoritos.', Icon: ThumbsUp },
] as const

interface BenefitsGridProps {
  readonly promotions?: readonly PromotionPublic[]
  readonly savedIds?: ReadonlySet<string>
}

export function BenefitsGrid({ promotions, savedIds }: BenefitsGridProps) {
  const { width } = useWindowDimensions()
  const [layoutWidth, setLayoutWidth] = useState(0)
  const columns = width >= 1280 ? 4 : width >= 768 ? 3 : 2
  const cardWidth = ((layoutWidth || Math.min(width, 1280) - 32) - (columns - 1) * 12) / columns

  return (
    <View
      className="flex-row flex-wrap gap-3"
      onLayout={(event) => setLayoutWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={promotions ? undefined : 'Cargando beneficios'}
    >
      {promotions ? promotions.map((promotion) => (
        <View key={promotion.id} style={{ width: cardWidth }}>
          <BenefitCard promotion={promotion} saved={savedIds?.has(promotion.id) ?? false} />
        </View>
      )) : Array.from({ length: columns * 2 }, (_, index) => (
        <MarketplaceCard key={index} className="w-full" style={{ width: cardWidth }}>
          <Skeleton className="h-28 w-full rounded-lg md:h-40" />
          <Skeleton className="mt-3 h-3 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-5 h-8 w-full" />
        </MarketplaceCard>
      ))}
    </View>
  )
}

export function BenefitsFeed({ feed, saved, savedIds }: {
  readonly feed: PromoFeed
  readonly saved: readonly PromotionPublic[]
  readonly savedIds: ReadonlySet<string>
}) {
  const { width } = useWindowDimensions()
  const sections = [
    { key: 'saved', title: 'Guardadas', description: 'Tus favoritas para tenerlas a mano.', Icon: Heart, promotions: saved },
    ...FEED_SECTIONS.map((section) => ({ ...section, promotions: feed[section.key] })),
  ]

  return (
    <View className="gap-8">
      {sections.filter((section) => section.promotions.length > 0).map((section) => (
        <View key={section.key} className="gap-3">
          <SectionHeader
            title={section.title}
            description={width >= 768 ? section.description : undefined}
            Icon={section.Icon}
            action={
              <View className="min-h-8 min-w-8 items-center justify-center rounded-full bg-primary/10 px-2">
                <Text className="text-label-md font-inter-bold text-primary">{section.promotions.length}</Text>
              </View>
            }
          />
          <BenefitsGrid promotions={section.promotions} savedIds={savedIds} />
        </View>
      ))}
    </View>
  )
}
