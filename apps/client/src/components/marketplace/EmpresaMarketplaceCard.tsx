import React, { useState } from 'react'
import { Image, Text, View } from 'react-native'
import { Heart, Star } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'
import type { InicioAccent } from '../layout/InicioAccentContext'
import { MarketplaceCard } from './MarketplaceCard'

export interface EmpresaMarketplaceCardData {
  readonly id: string
  readonly nombre: string
  readonly slug: string
  readonly rubro: string | null
  readonly ciudad: string | null
  readonly logoUrl: string | null
  readonly colorPrimario?: string | null
  readonly bannerUrl: string | null
  readonly href: string
  readonly valoracion: number | null
  readonly resenas: number
  readonly planes?: number
  readonly esMia: boolean
  readonly esFavorita?: boolean
  readonly etiquetaRelacion: string | null
  readonly esNueva?: boolean
  readonly creadoEn?: string | null
  readonly createdAt?: string | null
}

const UN_MES_MS = 30 * 24 * 60 * 60 * 1000

function calcularEsNueva(empresa: EmpresaMarketplaceCardData): boolean {
  if (typeof empresa.esNueva === 'boolean') return empresa.esNueva
  const fecha = empresa.creadoEn || empresa.createdAt
  if (!fecha) return false
  const diferencia = Date.now() - new Date(fecha).getTime()
  return diferencia >= 0 && diferencia < UN_MES_MS
}

interface EmpresaMarketplaceCardProps {
  readonly empresa: EmpresaMarketplaceCardData
  readonly accent: InicioAccent
  readonly onPress: () => void
  readonly className?: string
}

export function EmpresaMarketplaceCard({
  empresa,
  accent,
  onPress,
  className,
}: EmpresaMarketplaceCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const esNueva = calcularEsNueva(empresa)
  const companyColor = brandColor(empresa.colorPrimario, accent.color)

  return (
    <MarketplaceCard
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      onPress={onPress}
      className={cn('group hover:scale-[1.01] transition-all', className)}
      accessibilityLabel={`Ver ${empresa.nombre}${empresa.esFavorita ? ', marcada como favorita' : ''}${esNueva ? ', empresa nueva' : ''}`}
    >
      <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla" style={{ backgroundColor: `${companyColor}0D` }}>
        {empresa.logoUrl ? (
          <Image source={{ uri: empresa.logoUrl }} style={{ flex: 1 }} resizeMode="cover" />
        ) : (
          <View className="flex-1 w-full items-center justify-center">
            <Text className="text-h2" style={{ color: companyColor }}>
              {empresa.nombre.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}

        {esNueva ? (
          <View className="absolute left-2 top-2 rounded-full px-2 py-0.5 shadow-sm" style={{ backgroundColor: companyColor, zIndex: 10 }}>
            <Text className="text-overline font-inter-bold" style={{ color: brandDisplayForeground(companyColor, accent.color) }}>
              Nuevo
            </Text>
          </View>
        ) : null}

        {empresa.esFavorita ? (
          <View className="absolute right-2 top-2 size-8 items-center justify-center rounded-full bg-card/95 shadow-sm" style={{ zIndex: 10 }}>
            <Heart size={16} color={companyColor} fill={companyColor} />
          </View>
        ) : null}

        {empresa.etiquetaRelacion ? (
          <View className="absolute bottom-2 left-2 rounded-full bg-card/95 px-2 py-0.5 shadow-sm" style={{ zIndex: 10 }}>
            <Text className="text-overline font-inter-bold" style={{ color: companyColor }}>
              {empresa.etiquetaRelacion}
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        className="mt-2 text-label-md font-inter-bold text-foreground"
        style={isHovered ? { color: companyColor } : undefined}
        numberOfLines={1}
      >
        {empresa.nombre}
      </Text>

      {empresa.rubro ? (
        <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={1}>
          {empresa.rubro}
        </Text>
      ) : null}

      {empresa.valoracion != null && Number.isFinite(Number(empresa.valoracion)) ? (
        <View className="mt-1.5 flex-row items-center gap-1">
          <Star size={12} color={companyColor} fill={companyColor} />
          <Text className="text-caption font-inter-semibold text-foreground">
            {Number(empresa.valoracion).toFixed(1)}
          </Text>
          {empresa.resenas > 0 ? (
            <Text className="text-caption text-muted-foreground">({empresa.resenas})</Text>
          ) : null}
        </View>
      ) : null}

      {empresa.planes && empresa.planes > 0 ? (
        <Text className="mt-1 text-caption font-inter-medium" style={{ color: companyColor }}>
          {empresa.planes} {empresa.planes === 1 ? 'plan' : 'planes'}
        </Text>
      ) : null}
    </MarketplaceCard>
  )
}
