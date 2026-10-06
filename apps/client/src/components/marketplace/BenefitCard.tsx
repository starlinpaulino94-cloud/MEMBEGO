import React from 'react'
import { Image, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowRight, Clock, Star, Zap } from 'lucide-react-native'
import { MarketplaceCard } from './MarketplaceCard'
import { isFlashOffer } from './FlashOfferStatus'
import { SavePromoButton } from '../cliente/SavePromoButton'
import { formatMoney } from '../../lib/format'
import { colors } from '../../theme/tokens'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'
import type { PromotionPublic } from '../../lib/api'

export function BenefitCard({ promotion, saved }: {
  readonly promotion: PromotionPublic
  readonly saved: boolean
}) {
  const router = useRouter()
  const companyColor = brandColor(promotion.company.colorPrimario, colors.primary.DEFAULT)
  const price = promotion.venta?.precio ?? promotion.precio
  const expiresAt = promotion.vigenciaHasta ? new Date(promotion.vigenciaHasta) : null
  const expired = expiresAt !== null && expiresAt.getTime() < Date.now()
  const endingSoon = expiresAt !== null && !expired && expiresAt.getTime() - Date.now() < 3 * 86400000
  const discount = promotion.descuento === null ? null : Number(promotion.descuento)
  const discountLabel = promotion.tipo === '2x1'
    ? '2×1'
    : discount !== null && Number.isFinite(discount) && discount > 0
      ? promotion.tipo === 'monto_fijo' ? formatMoney(discount) : `−${Math.round(discount)}%`
      : null
  const status = expired ? 'Expirada' : promotion.venta?.agotada ? 'Agotada' : null

  return (
    <View className="relative flex-1">
      <MarketplaceCard
        className="w-full flex-1"
        style={{ borderColor: `${companyColor}66`, borderTopWidth: 3, borderTopColor: companyColor }}
        onPress={() => router.push({ pathname: '/promociones/[id]', params: { id: promotion.id } })}
        accessibilityLabel={`Ver ${promotion.titulo}, ${promotion.company.name}`}
        footer={
          <View className="min-h-9 flex-row items-center justify-between gap-2">
            <Text className="text-label-md font-inter-bold" style={{ color: companyColor }}>Ver beneficio</Text>
            <ArrowRight size={16} color={companyColor} />
          </View>
        }
      >
        <View className="relative h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla md:h-40" style={{ backgroundColor: `${companyColor}0D` }}>
          {promotion.imagenUrl ? (
            <Image source={{ uri: promotion.imagenUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-h1 font-inter-extrabold" style={{ color: companyColor }}>{promotion.titulo.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          {discountLabel && !expired ? (
            <View className="absolute left-2 top-2 rounded-full px-2 py-1" style={{ backgroundColor: companyColor }}>
              <Text className="text-label-sm font-inter-bold" style={{ color: brandDisplayForeground(companyColor, colors.primary.DEFAULT) }}>{discountLabel}</Text>
            </View>
          ) : null}
          {status ? (
            <View className="absolute bottom-2 left-2 rounded-full bg-card px-2 py-1">
              <Text className="text-label-sm font-inter-semibold text-destructive">{status}</Text>
            </View>
          ) : isFlashOffer(promotion) ? (
            <View className="absolute bottom-2 left-2 flex-row items-center gap-1 rounded-full bg-card px-2 py-1">
              <Zap size={12} color={colors.primary.DEFAULT} />
              <Text className="text-label-sm font-inter-semibold text-primary">Relámpago</Text>
            </View>
          ) : promotion.isFeatured ? (
            <View className="absolute bottom-2 left-2 flex-row items-center gap-1 rounded-full bg-card px-2 py-1">
              <Star size={12} color={colors.retail.star} />
              <Text className="text-label-sm font-inter-semibold text-foreground">Destacada</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-3 flex-row items-center gap-1.5">
          {promotion.company.logoUrl ? (
            <Image source={{ uri: promotion.company.logoUrl }} className="h-5 w-5 rounded-full" resizeMode="cover" />
          ) : null}
          <Text className="min-w-0 flex-1 text-caption text-muted-foreground" numberOfLines={1}>{promotion.company.name}</Text>
        </View>
        <Text className="mt-1 min-h-11 text-small font-inter-bold text-foreground" numberOfLines={2}>{promotion.titulo}</Text>
        <View className="mt-2 gap-1">
          {price !== null && price > 0 && !expired ? (
            <Text className="text-price-lg font-inter-bold text-foreground" numberOfLines={1}>{formatMoney(price)}</Text>
          ) : null}
          {expiresAt ? (
            <View className="flex-row items-center gap-1">
              <Clock size={12} color={endingSoon || expired ? colors.state.danger : colors.surface.mutedForeground} />
              <Text className={endingSoon || expired ? 'text-label-sm text-destructive' : 'text-label-sm text-muted-foreground'} numberOfLines={1}>
                {expired ? 'Expiró' : endingSoon ? 'Vence' : 'Hasta'} {expiresAt.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', timeZone: 'America/Santo_Domingo' })}
              </Text>
            </View>
          ) : null}
        </View>
      </MarketplaceCard>
      <SavePromoButton promocionId={promotion.id} guardada={saved} className="right-5 top-5" />
    </View>
  )
}
