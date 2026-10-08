import React from 'react'
import { View, Text, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { MapPin, Gift, Users, Star } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/format'
import { brandColor, hasBrandColor } from '../../lib/brand-color'
import { MarketplaceCard } from './MarketplaceCard'

/**
 * BUSINESS CARD — RN port de src/components/marketplace/BusinessCard.tsx.
 *
 * API compartida con la web: `BusinessCardData` + `{ company, hrefBase?, action?, className? }`.
 * L3-22 (perfil de empresa) importará esta misma tarjeta.
 */

export interface BusinessCardData {
  id: string
  name: string
  slug: string
  type: string
  logoUrl: string | null
  bannerUrl: string | null
  ciudad: string | null
  colorPrimario?: string | null
  descripcion?: string | null
  totalMembersCount?: number
  activePromotionsCount?: number
  averageRating?: number | null
  isFeatured?: boolean
  desdePlan?: { nombre: string; precio: number } | null
}

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
  excursiones: 'Excursiones'
}

interface BusinessCardProps {
  company: BusinessCardData
  hrefBase?: string
  action?: React.ReactNode
  className?: string
}

function Logo({ company, size }: { company: BusinessCardData; size: 'sm' | 'md' }) {
  const clases = size === 'sm' ? 'h-10 w-10' : 'h-12 w-12'
  const textClase = size === 'sm' ? 'text-xs' : 'text-sm'
  const companyColor = hasBrandColor(company.colorPrimario)
    ? brandColor(company.colorPrimario, '#7c3aed')
    : null

  if (company.logoUrl) {
    return (
      <View className={cn('shrink-0 overflow-hidden rounded-lg bg-muted', clases)}>
        <Image
          source={{ uri: company.logoUrl }}
          className="size-full"
          resizeMode="cover"
        />
      </View>
    )
  }
  return (
    <View
      className={cn(
        'shrink-0 items-center justify-center rounded-lg bg-primary/10',
        clases,
      )}
      style={companyColor ? { backgroundColor: `${companyColor}1A` } : undefined}
    >
      <Text
        className={cn('font-inter-bold text-primary', textClase)}
        style={companyColor ? { color: companyColor } : undefined}
      >
        {company.name.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  )
}

function Meta({ company }: { company: BusinessCardData }) {
  const tipo = TIPO_LABEL[company.type] ?? company.type
  return (
    <View className="mt-0.5 flex-row flex-wrap items-center gap-x-1.5">
      <Text className="text-xs text-muted-foreground">{tipo}</Text>
      {company.ciudad ? (
        <>
          <Text className="text-xs text-muted-foreground" aria-hidden> · </Text>
          <View className="flex-row items-center gap-0.5">
            <MapPin size={12} color="#9ca3af" />
            <Text className="text-xs text-muted-foreground">{company.ciudad}</Text>
          </View>
        </>
      ) : null}
    </View>
  )
}

function Stats({ company }: { company: BusinessCardData }) {
  const promos = company.activePromotionsCount ?? 0
  const miembros = company.totalMembersCount ?? 0
  if (promos === 0 && miembros === 0 && company.averageRating == null) return null

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 mt-1">
      {promos > 0 ? (
        <View className="flex-row items-center gap-1">
          <Gift size={14} color="#0284c7" />
          <Text className="text-xs text-muted-foreground">
            {promos} {promos === 1 ? 'promoción' : 'promociones'}
          </Text>
        </View>
      ) : null}
      {miembros > 0 ? (
        <View className="flex-row items-center gap-1">
          <Users size={14} color="#0284c7" />
          <Text className="text-xs text-muted-foreground">
            {miembros} {miembros === 1 ? 'miembro' : 'miembros'}
          </Text>
        </View>
      ) : null}
      {company.averageRating != null ? (
        <View className="flex-row items-center gap-1">
          <Star size={14} color="#eab308" fill="#eab308" />
          <Text className="text-xs text-muted-foreground tabular-nums">
            {Number(company.averageRating).toFixed(1)}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export function BusinessCard({
  company,
  hrefBase = '/empresas',
  action,
  className,
}: BusinessCardProps) {
  const router = useRouter()
  const href = `${hrefBase}/${company.slug}`
  const precio = company.desdePlan
  const companyColor = hasBrandColor(company.colorPrimario)
    ? brandColor(company.colorPrimario, '#7c3aed')
    : null

  return (
    <View className={cn('relative overflow-hidden rounded-xl', className)}>
      <MarketplaceCard
        variant="flush"
        onPress={() => router.push(href as any)}
        accessibilityLabel={`Ver ${company.name}`}
        className="w-full overflow-hidden"
      >
        {hasBrandColor(company.colorPrimario) ? (
          <View className="h-1 w-full" style={{ backgroundColor: brandColor(company.colorPrimario, '#7c3aed') }} />
        ) : null}
        <View className="relative w-full bg-muted" style={{ aspectRatio: 16 / 10 }}>
          {company.bannerUrl ? (
            <Image
              source={{ uri: company.bannerUrl }}
              className="size-full"
              resizeMode="cover"
            />
          ) : (
            <View className="size-full items-center justify-center bg-primary/10" style={companyColor ? { backgroundColor: `${companyColor}1A` } : undefined}>
              <Text className="text-3xl font-inter-bold text-primary" style={companyColor ? { color: companyColor } : undefined}>
                {company.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          {company.ciudad ? (
            <View className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5">
              <Text className="text-xs font-inter-semibold text-foreground">
                {company.ciudad}
              </Text>
            </View>
          ) : null}
          {company.isFeatured ? (
            <View className="absolute right-2 top-2 flex-row items-center gap-1 rounded-full bg-card/95 px-2 py-0.5">
              <Star size={10} color="#eab308" fill="#eab308" />
              <Text className="text-xs font-inter-semibold text-foreground">
                Destacada
              </Text>
            </View>
          ) : null}
        </View>

        <View className={cn('gap-1 p-3', action ? 'pr-16' : undefined)}>
          <View className="flex-row items-center gap-2.5">
            <Logo company={company} size="sm" />
            <View className="min-w-0 flex-1">
              <Text
                className="text-base font-inter-bold text-foreground"
                numberOfLines={1}
              >
                {company.name}
              </Text>
              <Meta company={company} />
            </View>
          </View>

          {company.descripcion ? (
            <Text
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
              numberOfLines={2}
            >
              {company.descripcion}
            </Text>
          ) : null}

          <Stats company={company} />

          {precio ? (
            <View className="mt-1.5 flex-row items-center self-start rounded-full border border-border px-3 py-1">
              <Text className="text-xs text-primary" style={companyColor ? { color: companyColor } : undefined}>{precio.nombre} </Text>
              <Text className="text-xs font-inter-bold text-primary tabular-nums" style={companyColor ? { color: companyColor } : undefined}>
                {formatMoney(precio.precio)}
              </Text>
            </View>
          ) : null}
        </View>
      </MarketplaceCard>

      {action ? <View className="absolute bottom-3 right-3">{action}</View> : null}
    </View>
  )
}
