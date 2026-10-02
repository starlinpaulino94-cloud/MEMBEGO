import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Clock, Timer, ChevronRight } from 'lucide-react-native'
import { rnHref } from '../../lib/rutas'
import { Card } from '../ui/Card'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent, type InicioAccent } from '../layout/InicioAccentContext'
import { brandColor, brandForeground } from '../../lib/brand-color'

function fechaCorta(d: string) {
  try {
    const date = new Date(d)
    const day = date.getDate()
    const month = date.toLocaleString('es-DO', { month: 'short' })
    return `${day} ${month}`
  } catch (e) {
    return d
  }
}

function VibeCountdown({ hasta, accentColor }: { hasta: string; accentColor: string }) {
  const calculateTimeLeft = () => {
    const now = new Date().getTime()
    const end = new Date(hasta).getTime()
    const distance = end - now

    if (distance < 0) {
      return 'Expirado'
    }

    const hours = Math.floor(distance / (1000 * 60 * 60))
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((distance % (1000 * 60)) / 1000)

    const dH = hours < 10 ? '0' + hours : hours
    const dM = minutes < 10 ? '0' + minutes : minutes
    const dS = seconds < 10 ? '0' + seconds : seconds

    return `${dH}:${dM}:${dS}`
  }

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft)

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [hasta])

  return <Text className="text-overline font-inter-bold tracking-tight" style={{ color: accentColor }}>{timeLeft}</Text>
}

interface RelampagoPromo {
  readonly id: string
  readonly titulo: string
  readonly empresa: string
  readonly colorPrimario?: string | null
  readonly imagen: string | null
  readonly href: string
  readonly precio: string | null
  readonly descuento: string | null
  readonly hasta: string
}

interface RelampagoData {
  readonly hasta: string
  readonly promos: readonly RelampagoPromo[]
}

export function RelampagoCardItem({ promo, accent, onPress }: {
  promo: RelampagoPromo
  accent: InicioAccent
  onPress: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const companyColor = brandColor(promo.colorPrimario, accent.color)

  return (
    <MarketplaceCard
      variant="horizontal"
      onPress={onPress}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      accessibilityLabel={`Ver ${promo.titulo}`}
      className="w-full min-w-0 group hover:scale-[1.01] transition-all"
      style={{ borderColor: `${companyColor}40` }}
    >
      <View className="relative h-28 w-28 overflow-hidden rounded-lg bg-vibe-niebla" style={{ backgroundColor: `${companyColor}0D` }}>
        {promo.imagen ? (
          <Image source={{ uri: promo.imagen }} style={{ flex: 1 }} resizeMode="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-4xl font-inter-bold" style={{ color: companyColor }}>
              {promo.titulo.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {promo.descuento ? (
          <View
            className="absolute bottom-1 left-1 rounded px-1.5 py-0.5"
            style={{ backgroundColor: companyColor }}
          >
            <Text className="text-overline font-inter-bold" style={{ color: brandForeground(companyColor, accent.color) }}>{promo.descuento}</Text>
          </View>
        ) : null}
      </View>

      <View className="min-w-0 flex-1 justify-between py-1 pr-1">
        <View>
          <View className="flex-row items-center gap-1">
            <Clock size={14} color={companyColor} />
            <Text className="text-overline font-inter-medium text-muted-foreground">
              Hasta el {fechaCorta(promo.hasta)}
            </Text>
          </View>
          <Text
            className="text-h4 text-foreground mt-1"
            style={isHovered ? { color: companyColor } : undefined}
            numberOfLines={2}
          >
            {promo.titulo}
          </Text>
          <Text className="text-small text-muted-foreground mt-0.5" numberOfLines={1}>
            {promo.empresa}
          </Text>
        </View>

        <View className="mt-2 flex-row items-end justify-between gap-2">
          {promo.precio ? (
            <Text className="text-price-sm font-inter-bold" style={{ color: companyColor }} numberOfLines={1}>
              {promo.precio}
            </Text>
          ) : (
            <View />
          )}
          <View
            className="shrink-0 rounded-full px-3 min-h-11 justify-center"
            style={{ backgroundColor: companyColor }}
          >
            <Text className="text-overline font-inter-bold" style={{ color: brandForeground(companyColor, accent.color) }}>Canjear</Text>
          </View>
        </View>
      </View>
    </MarketplaceCard>
  )
}

export function VibeRelampago({ relampago }: { relampago: RelampagoData | null | undefined }) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  const promos = relampago?.promos ?? []
  const sectionColor = accent.color

  return (
    <View className="mt-6 px-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-price-lg text-foreground">Experiencias y excursiones</Text>
        <Link href="/explorar" asChild>
          <TouchableOpacity activeOpacity={0.7} className="rounded-full p-1">
            <ChevronRight size={20} color={sectionColor} />
          </TouchableOpacity>
        </Link>
      </View>

      <Card className="p-4 shadow-none">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Timer size={20} color={sectionColor} />
            <Text className="text-h3 text-foreground">Ofertas Relámpago</Text>
          </View>
          {relampago && promos.length > 0 ? (
            <View className="rounded-full border border-vibe-chip bg-card px-2.5 py-1">
              <VibeCountdown hasta={relampago.hasta} accentColor={sectionColor} />
            </View>
          ) : null}
        </View>

        {promos.length > 0 ? (
          <View className="gap-3">
            {promos.map((promo) => (
              <RelampagoCardItem
                key={promo.id}
                promo={promo}
                accent={accent}
                onPress={() => router.push(rnHref(promo.href) as any)}
              />
            ))}
          </View>
        ) : (
          <View className="min-h-24 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6">
            <Text className="text-sm text-muted-foreground text-center leading-5">
              No hay ofertas relámpago disponibles por ahora
            </Text>
          </View>
        )}
      </Card>
    </View>
  )
}
