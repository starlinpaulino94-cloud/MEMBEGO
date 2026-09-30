import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Image, useWindowDimensions } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { ChevronRight, Sparkles, Star } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'
import { colors } from '../../theme/tokens'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent, type InicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

function Estrellas({ valoracion, accentColor }: { valoracion: number; accentColor: string }) {
  const llenas = Math.round(valoracion)
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          color={n <= llenas ? accentColor : colors.vibe.chip}
          fill={n <= llenas ? accentColor : 'transparent'}
        />
      ))}
    </View>
  )
}

export interface PlanRelacionadoItem {
  id: string
  nombre: string
  empresa: string
  href: string
  imagen?: string | null
  esCliente?: boolean
  valoracion?: number | null
  resenas?: number
  precio: string
  periodo: string
}

export interface PlanCardItemProps {
  plan: PlanRelacionadoItem
  accent: InicioAccent
  onPress: () => void
}

export function PlanCardItem({ plan, accent, onPress }: PlanCardItemProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <MarketplaceCard
      onPress={onPress}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      accessibilityLabel={`Ver membresía de ${plan.empresa}`}
      variant="flush"
      className="group hover:scale-[1.01] transition-all"
      footer={
        <LinearGradient
          colors={accent.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: '100%', borderRadius: 9999, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text className="text-label-sm font-inter-bold text-white">
            Aprovechar
          </Text>
        </LinearGradient>
      }
    >
      <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
        {plan.imagen ? (
          <Image
            source={{ uri: plan.imagen }}
            style={{ flex: 1 }}
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-h1" style={{ color: accent.color }}>
              {plan.empresa?.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {plan.esCliente ? (
          <View className="absolute left-2 bottom-2 rounded-full bg-card/95 px-2 py-1">
            <Text
              className="text-label-sm font-inter-semibold"
              style={{ color: accent.color }}
            >
              De tus negocios
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-2 flex-1 justify-between">
        <View>
          <Text
            className="text-label-md text-foreground"
            style={isHovered ? { color: accent.color } : undefined}
            numberOfLines={2}
          >
            {plan.empresa} · {plan.nombre}
          </Text>

          {plan.valoracion != null && Number.isFinite(Number(plan.valoracion)) ? (
            <View className="mt-1 flex-row items-center gap-1">
              <Estrellas valoracion={Number(plan.valoracion)} accentColor={accent.color} />
              <Text className="text-label-sm font-inter-medium text-muted-foreground">
                {Number(plan.resenas ?? 0).toLocaleString('es-DO')}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row items-baseline">
          <Text className="text-price-lg" style={{ color: accent.color }}>{plan.precio}</Text>
          <Text className="ml-1 text-small text-muted-foreground">
            {plan.periodo}
          </Text>
        </View>
      </View>
    </MarketplaceCard>
  )
}

export function VibeRelacionado({
  planes,
  total,
}: {
  planes: any[]
  total: number
}) {
  const router = useRouter()
  const { accent } = useInicioAccent()

  if (!planes || planes.length === 0) {
    return (
      <View className="mt-6 px-4">
        <SectionHeader
          title="Membresías recomendadas para ti"
          action={total > 0 ? (
            <Link href="/planes" asChild>
              <TouchableOpacity className='flex-row items-center' activeOpacity={0.7}>
                <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                  Ver todas ({total})
                </Text>
                <ChevronRight size={14} color={accent.color} />
              </TouchableOpacity>
            </Link>
          ) : undefined}
          Icon={Sparkles}
        />
        <EmptyState
          title="No hay membresías para mostrar"
          description={
            total > 0
              ? 'Puedes consultar las membresías publicadas en el catálogo.'
              : 'Cuando haya membresías para esta selección, aparecerán aquí.'
          }
          variant="card"
          className="mt-3"
        />
      </View>
    )
  }

  return (
    <View className="mt-6 px-4">
      <SectionHeader
        title="Membresías recomendadas para ti"
        action={
          <Link href="/planes" asChild>
            <TouchableOpacity className='flex-row items-center' activeOpacity={0.7}>
              <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                Ver todas{total > 0 ? ` (${total})` : ''}
              </Text>
              <ChevronRight size={14} color={accent.color} />
            </TouchableOpacity>
          </Link>
        }
        Icon={Sparkles}
      />

      <HorizontalScrollWithFade
        contentContainerStyle={{ gap: 12 }}
        className="mt-3"
      >
        {planes.slice(0, 4).map((p) => (
          <PlanCardItem
            key={p.id}
            plan={p}
            accent={accent}
            onPress={() => router.push(rnHref(p.href) as any)}
          />
        ))}
      </HorizontalScrollWithFade>
    </View>
  )
}
