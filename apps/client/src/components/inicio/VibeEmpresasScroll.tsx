import React from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Heart, Star, ChevronRight, Store } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

interface EmpresaScrollItem {
  id: string
  nombre: string
  slug: string
  rubro: string | null
  ciudad: string | null
  logoUrl: string | null
  bannerUrl: string | null
  href: string
  valoracion: number | null
  resenas: number
  planes?: number
  esMia: boolean
  esFavorita?: boolean
  etiquetaRelacion: string | null
}

export function VibeEmpresasScroll({
  empresas,
  total,
}: {
  empresas: EmpresaScrollItem[]
  total: number
}) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  if (!empresas || empresas.length === 0) {
    return null
  }

  return (
    <View className="mt-6 mb-4 px-4">
      <SectionHeader
        title="Descubre y visita"
        action={
          <Link href="/explorar" asChild>
            <TouchableOpacity activeOpacity={0.7} className="flex-row items-center">
              <Text className="text-label-sm font-inter-bold" style={{ color: accent.color }}>
                Ver más{total > 0 ? ` (${total})` : ''}
              </Text>
              <ChevronRight size={14} color={accent.color} />
            </TouchableOpacity>
          </Link>
        }
        Icon={Store}
      />

      <HorizontalScrollWithFade contentContainerStyle={{ gap: 12 }} className="mt-3">
        {empresas.map((empresa) => (
          <MarketplaceCard
            key={empresa.id}
            onPress={() => router.push(rnHref(empresa.href) as any)}
            accessibilityLabel={`Ver ${empresa.nombre}${empresa.esFavorita ? ', marcada como favorita' : ''}`}
          >
            {/* Logo */}
            <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
              {empresa.logoUrl ? (
                <Image
                  source={{ uri: empresa.logoUrl }}
                  style={{ flex: 1 }}
                  resizeMode="cover"
                />
              ) : (
                <View className="flex-1 w-full items-center justify-center">
                  <Text className="text-h2" style={{ color: accent.color }}>
                    {empresa.nombre.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}

              {empresa.esFavorita ? (
                <View className="absolute right-2 top-2 size-8 items-center justify-center rounded-full bg-card/95">
                  <Heart size={16} color={accent.color} fill={accent.color} />
                </View>
              ) : null}

              {/* Badge "Miembro" or "Siguiendo" */}
              {empresa.etiquetaRelacion && (
                <View className="absolute left-2 bottom-2 bg-card/95 rounded-full px-2 py-0.5">
                  <Text className="text-overline font-inter-bold text-white" style={{ color: accent.color }}>
                    {empresa.etiquetaRelacion}
                  </Text>
                </View>
              )}
            </View>

            {/* Name */}
            <Text
              className="mt-2 text-label-md font-inter-bold text-foreground"
              numberOfLines={1}
            >
              {empresa.nombre}
            </Text>

            {/* Rubro */}
            {empresa.rubro && (
              <Text
                className="mt-0.5 text-caption text-muted-foreground"
                numberOfLines={1}
              >
                {empresa.rubro}
              </Text>
            )}

            {/* Rating */}
            {empresa.valoracion != null && Number.isFinite(Number(empresa.valoracion)) ? (
              <View className="mt-1.5 flex-row items-center gap-1">
                <Star size={12} color={accent.color} fill={accent.color} />
                <Text className="text-caption font-inter-semibold text-foreground">
                  {Number(empresa.valoracion).toFixed(1)}
                </Text>
                {empresa.resenas > 0 && (
                  <Text className="text-caption text-muted-foreground">
                    ({empresa.resenas})
                  </Text>
                )}
              </View>
            ) : null}

            {/* Plans count */}
            {empresa.planes && empresa.planes > 0 ? (
              <Text className="mt-1 text-caption font-inter-medium" style={{ color: accent.color }}>
                {empresa.planes} {empresa.planes === 1 ? 'plan' : 'planes'}
              </Text>
            ) : null}
          </MarketplaceCard>
        ))}
      </HorizontalScrollWithFade>
    </View>
  )
}
