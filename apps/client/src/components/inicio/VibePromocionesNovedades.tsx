import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Image, Pressable } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Link, useRouter } from 'expo-router'
import { Sparkles, Tag, Flame, Clock, ChevronRight, ArrowRight } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent, type InicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'

interface PromoNovedadItem {
  id: string
  titulo: string
  slug: string | null
  descripcion: string
  imagenUrl: string | null
  tipo: string
  tipoEtiqueta: string
  descuentoTexto: string | null
  precioTexto: string | null
  vigenciaHasta: string | null
  diasRestantes: number | null
  href: string
  empresa: {
    id: string
    nombre: string
    slug: string
    logoUrl: string | null
    colorPrimario?: string | null
  }
  esPrivadaMiembros: boolean
  esDeMiEmpresa: boolean
  motivo: 'afinidad' | 'exclusiva' | 'descuento' | 'vencimiento'
}

interface PromocionesNovedadesVista {
  paraTi: readonly PromoNovedadItem[]
  exclusivas: readonly PromoNovedadItem[]
  descuentos: readonly PromoNovedadItem[]
  porVencer: readonly PromoNovedadItem[]
  total: number
}

type TabKey = 'paraTi' | 'exclusivas' | 'descuentos' | 'porVencer'

const TABS: { key: TabKey; label: string; icon: typeof Sparkles }[] = [
  { key: 'paraTi', label: 'Para ti', icon: Sparkles },
  { key: 'exclusivas', label: 'Exclusivas miembros', icon: Tag },
  { key: 'descuentos', label: '2x1 / Descuentos', icon: Flame },
  { key: 'porVencer', label: 'Por vencer', icon: Clock },
]

export interface PromoCardItemProps {
  item: PromoNovedadItem
  accent: InicioAccent
  onPress: () => void
}

export function PromoCardItem({
  item,
  accent,
  onPress,
}: PromoCardItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const companyColor = brandColor(item.empresa.colorPrimario, accent.color)

  return (
    <MarketplaceCard
      onPress={onPress}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      accessibilityLabel={`Ver ${item.titulo}`}
      className="group hover:scale-[1.01] transition-all"
      footer={
        <View className="flex-row justify-between items-center">
          <Text className="text-muted-foreground text-caption">Ver beneficio</Text>
          <View className="flex-row items-center">
            <Text style={{ color: companyColor }} className="text-caption">Aprovecha </Text>
            <ArrowRight size={14} color={companyColor} />
          </View>
        </View>
      }
    >
      {/* Image */}
      <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
        {item.imagenUrl ? (
          <Image
            source={{ uri: item.imagenUrl }}
            style={{ flex: 1 }}
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-h1" style={{ color: companyColor }}>
              {item.titulo.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Discount badge */}
        {item.descuentoTexto && (
          <View className="absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 bg-white shadow-sm">
            <Text className="text-caption font-inter-bold" style={{ color: companyColor }}>
              {item.descuentoTexto}
            </Text>
          </View>
        )}

        {/* Exclusive badge */}
        {item.esPrivadaMiembros && (
          <View className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 bg-white">
            <Text className="text-overline font-bold" style={{ color: companyColor }}>
              Exclusiva
            </Text>
          </View>
        )
        }

        {/* Expiration badge */}
        {
          item.diasRestantes != null && item.diasRestantes <= 7 && (
            <View className="absolute right-1.5 bottom-1.5 rounded-full flex-row items-center gap-1 px-2 py-0.5 bg-destructive">
              <Clock size={10} color="white" />
              <Text className="text-overline font-bold text-white">
                {item.diasRestantes === 0
                  ? 'Hoy'
                  : item.diasRestantes === 1
                    ? '1 día'
                    : `${item.diasRestantes} días`}
              </Text>
            </View>
          )
        }
      </View >

      {/* Company */}
      < Text
        className="mt-2 text-md text-muted-foreground"
        numberOfLines={1}
      >
        {item.empresa.nombre}
      </Text >

      {/* Title */}
      < Text
        className="mt-0.5 text-label-md text-foreground"
        style={isHovered ? { color: companyColor } : undefined}
        numberOfLines={2}
      >
        {item.titulo}
      </Text >

      {/* Price */}
      {
        item.precioTexto && (
          <View className="mt-1.5 flex-row items-baseline gap-1">
            <Text className="text-h4 font-inter-bold text-foreground">
              {item.precioTexto}
            </Text>
          </View>
        )
      }
    </MarketplaceCard >
  )
}

export function VibePromocionesNovedades({
  promociones,
}: {
  promociones: PromocionesNovedadesVista
}) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  const [activeTab, setActiveTab] = useState<TabKey>('paraTi')
  const [hoveredTab, setHoveredTab] = useState<TabKey | null>(null)

  if (promociones.total === 0) return null

  const items: readonly PromoNovedadItem[] = promociones[activeTab] ?? []

  if (items.length === 0) return null

  return (
    <View className="mt-6 mb-4 px-4">
      <SectionHeader
        title="Promociones"
        action={
          <Link href="/promociones" asChild>
            <TouchableOpacity activeOpacity={0.7} className="flex-row items-center">
              <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                Ver todas ({promociones.total})
              </Text>
              <ChevronRight size={14} color={accent.color} />
            </TouchableOpacity>
          </Link>
        }
        Icon={Sparkles}
      />

      {/* Tabs */}
      <HorizontalScrollWithFade className="mt-3" contentContainerStyle={{ gap: 8 }}>
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          const isTabHovered = hoveredTab === tab.key && !isActive
          const count = promociones[tab.key].length

          if (count === 0) return null

          const content = (
            <>
              <Icon size={14} color={isActive ? 'white' : isTabHovered ? accent.color : 'rgb(17 24 39 / 0.6)'} />
              <Text
                className={`text-label-sm font-inter-bold ${isActive ? 'text-white' : 'text-foreground/60'}`}
                style={isTabHovered ? { color: accent.color } : undefined}
              >
                {tab.label}
              </Text>
              <View
                className={`rounded-full px-1.5 ${isActive ? 'bg-white/20' : 'bg-vibe-niebla'}`}
                style={{ backgroundColor: isActive ? 'rgba(255, 255, 255, 0.2)' : isTabHovered ? accent.color + '22' : accent.color + '33' }}
              >
                <Text
                  className={`text-caption font-inter-semibold ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}
                  style={isTabHovered ? { color: accent.color } : undefined}
                >
                  {count}
                </Text>
              </View>
            </>
          )

          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              onHoverIn={() => setHoveredTab(tab.key)}
              onHoverOut={() => setHoveredTab(null)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              className="rounded-full"
            >
              {isActive ? (
                <LinearGradient
                  colors={accent.gradient}
                  locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    shadowColor: accent.shadow,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.2,
                    shadowRadius: 4,
                    elevation: 2,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 4,
                  }}
                >
                  {content}
                </LinearGradient>
              ) : (
                <View
                  className="flex-row items-center gap-1.5 rounded-full px-4 py-1 border transition border-vibe-borde bg-card"
                  style={isTabHovered ? { borderColor: accent.color } : undefined}
                >
                  {content}
                </View>
              )}
            </Pressable>
          )
        })}
      </HorizontalScrollWithFade>

      {/* Items grid */}
      <HorizontalScrollWithFade className="mt-3" contentContainerStyle={{ gap: 12 }}>
        {items.slice(0, 6).map((item) => (
          <PromoCardItem
            key={item.id}
            item={item}
            accent={accent}
            onPress={() => router.push(rnHref(item.href) as any)}
          />
        ))}
      </HorizontalScrollWithFade>
    </View>
  )
}
