import React, { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native'
import { Link } from 'expo-router'
import { Sparkles, Tag, Flame, Clock } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'

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
  { key: 'exclusivas', label: 'Exclusivas', icon: Tag },
  { key: 'descuentos', label: 'Descuentos', icon: Flame },
  { key: 'porVencer', label: 'Por vencer', icon: Clock },
]

export function VibePromocionesNovedades({
  promociones,
}: {
  promociones: PromocionesNovedadesVista
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('paraTi')

  if (promociones.total === 0) return null

  const items: readonly PromoNovedadItem[] = promociones[activeTab] ?? []

  if (items.length === 0) return null

  return (
    <View className="mt-6 mb-4">
      <SectionHeader
        title="Novedades y promociones"
        action={
          <Link href="/promociones" asChild>
            <TouchableOpacity activeOpacity={0.7}>
              <Text className="text-label-sm font-inter-bold text-vibe-violet">
                Ver todas ({promociones.total})
              </Text>
            </TouchableOpacity>
          </Link>
        }
      />

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        className="mt-3"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          const count = promociones[tab.key].length

          if (count === 0) return null

          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className={`flex-row items-center gap-1.5 rounded-full px-4 py-2 ${
                isActive ? 'bg-vibe-violet' : 'border border-vibe-borde bg-card'
              }`}
              activeOpacity={0.8}
            >
              <Icon size={14} color={isActive ? '#ffffff' : '#7c3aed'} />
              <Text
                className={`text-label-sm font-inter-bold ${
                  isActive ? 'text-white' : 'text-foreground'
                }`}
              >
                {tab.label}
              </Text>
              <Text
                className={`text-caption font-inter-semibold ${
                  isActive ? 'text-white/80' : 'text-muted-foreground'
                }`}
              >
                {count}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Items grid */}
      <View className="mt-3 flex-row flex-wrap gap-3 px-4">
        {items.slice(0, 6).map((item) => (
          <Link key={item.id} href={rnHref(item.href) as any} asChild>
            <TouchableOpacity
              activeOpacity={0.9}
              className="w-[48%] rounded-xl border border-vibe-borde bg-card p-3 elevation-1 shadow-card"
            >
              {/* Image */}
              <View className="relative h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                {item.imagenUrl ? (
                  <Image
                    source={{ uri: item.imagenUrl }}
                    style={{ flex: 1 }}
                    resizeMode="cover"
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-h1 text-vibe-violet">
                      {item.titulo.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}

                {/* Discount badge */}
                {item.descuentoTexto && (
                  <View className="absolute left-1.5 top-1.5 rounded-full bg-foreground/85 px-2 py-0.5">
                    <Text className="text-caption font-inter-bold text-background">
                      {item.descuentoTexto}
                    </Text>
                  </View>
                )}

                {/* Exclusive badge */}
                {item.esPrivadaMiembros && (
                  <View className="absolute right-1.5 top-1.5 rounded-full bg-vibe-violet px-2 py-0.5">
                    <Text className="text-[10px] font-bold text-white">
                      Exclusiva
                    </Text>
                  </View>
                )}
              </View>

              {/* Title */}
              <Text
                className="mt-2 text-label-md font-inter-bold text-foreground"
                numberOfLines={2}
              >
                {item.titulo}
              </Text>

              {/* Company */}
              <Text
                className="mt-0.5 text-caption text-muted-foreground"
                numberOfLines={1}
              >
                {item.empresa.nombre}
              </Text>

              {/* Price */}
              {item.precioTexto && (
                <View className="mt-1.5 flex-row items-baseline gap-1">
                  <Text className="text-h4 font-inter-bold text-foreground">
                    {item.precioTexto}
                  </Text>
                </View>
              )}

              {/* Days remaining */}
              {item.diasRestantes != null && item.diasRestantes <= 7 && (
                <View className="mt-1.5 flex-row items-center gap-1">
                  <Clock size={10} color="#e7000b" />
                  <Text className="text-caption font-inter-semibold text-destructive">
                    {item.diasRestantes === 0
                      ? 'Hoy'
                      : item.diasRestantes === 1
                        ? '1 día'
                        : `${item.diasRestantes} días`}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Link>
        ))}
      </View>
    </View>
  )
}
