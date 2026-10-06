import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Heart, Star, ChevronRight, Store } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { InicioAccent, useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'

export interface EmpresaScrollItem {
  id: string
  nombre: string
  slug: string
  rubro: string | null
  ciudad: string | null
  logoUrl: string | null
  colorPrimario?: string | null
  bannerUrl: string | null
  href: string
  valoracion: number | null
  resenas: number
  planes?: number
  esMia: boolean
  esFavorita?: boolean
  etiquetaRelacion: string | null
  esNueva?: boolean
  creadoEn?: string | null
  createdAt?: string | null
}

const UN_MES_MS = 30 * 24 * 60 * 60 * 1000

function calcularEsNueva(empresa: EmpresaScrollItem): boolean {
  if (typeof empresa.esNueva === 'boolean') {
    return empresa.esNueva
  }
  const fecha = empresa.creadoEn || empresa.createdAt
  if (!fecha) return false
  const diffMs = Date.now() - new Date(fecha).getTime()
  return diffMs >= 0 && diffMs < UN_MES_MS
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

  const empresasOrdenadas = React.useMemo(() => {
    return [...empresas].sort((a, b) => {
      const valA = a.valoracion != null ? Number(a.valoracion) : 0
      const valB = b.valoracion != null ? Number(b.valoracion) : 0
      if (valB !== valA) return valB - valA
      if ((b.resenas ?? 0) !== (a.resenas ?? 0)) return (b.resenas ?? 0) - (a.resenas ?? 0)
      const afinidadA = (a.esFavorita ? 2 : 0) + (a.esMia ? 1 : 0)
      const afinidadB = (b.esFavorita ? 2 : 0) + (b.esMia ? 1 : 0)
      if (afinidadB !== afinidadA) return afinidadB - afinidadA
      return (b.planes ?? 0) - (a.planes ?? 0)
    })
  }, [empresas])

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
        {empresasOrdenadas.map((empresa) => (
          <EmpresaCardItem
            key={empresa.id}
            empresa={empresa}
            accent={accent}
            onPress={() => router.push(rnHref(empresa.href) as any)}
          />
        ))}
      </HorizontalScrollWithFade>
    </View>
  )
}

export interface EmpresaCardItemProps {
  empresa?: EmpresaScrollItem
  item?: EmpresaScrollItem
  accent: InicioAccent
  onPress: () => void
}

export function EmpresaCardItem({
  empresa: empresaProp,
  item,
  accent,
  onPress,
}: EmpresaCardItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const empresa = empresaProp ?? item
  if (!empresa) return null

  const esNueva = calcularEsNueva(empresa)
  const companyColor = brandColor(empresa.colorPrimario, accent.color)

  return (
    <MarketplaceCard
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      onPress={onPress}
      className="group hover:scale-[1.01] transition-all"
      accessibilityLabel={`Ver ${empresa.nombre}${empresa.esFavorita ? ', marcada como favorita' : ''}${esNueva ? ', empresa nueva' : ''}`}
    >
      {/* Logo */}
      <View className="relative aspect-video h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla" style={{ backgroundColor: `${companyColor}0D` }}>
        {empresa.logoUrl ? (
          <Image
            source={{ uri: empresa.logoUrl }}
            style={{ flex: 1 }}
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 w-full items-center justify-center">
            <Text className="text-h2" style={{ color: companyColor }}>
              {empresa.nombre.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Badge Nuevo */}
        {esNueva ? (
          <View
            className="rounded-full px-2 py-0.5 absolute left-2 top-2 shadow-sm"
            style={{ backgroundColor: companyColor, zIndex: 10 }}
          >
            <Text className="text-overline font-inter-bold" style={{ color: brandDisplayForeground(companyColor, accent.color) }}>
              Nuevo
            </Text>
          </View>
        ) : null}

        {/* Corazón de Favorito */}
        {Boolean(empresa.esFavorita) ? (
          <View
            className="absolute right-2 top-2 size-8 items-center justify-center rounded-full bg-card/95 shadow-sm"
            style={{ zIndex: 10 }}
          >
            <Heart size={16} color={companyColor} fill={companyColor} />
          </View>
        ) : null}

        {/* Badge "Miembro" or "Siguiendo" */}
        {Boolean(empresa.etiquetaRelacion) ? (
          <View
            className="absolute left-2 bottom-2 bg-card/95 rounded-full px-2 py-0.5 shadow-sm"
            style={{ zIndex: 10 }}
          >
            <Text className="text-overline font-inter-bold" style={{ color: companyColor }}>
              {empresa.etiquetaRelacion}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Name */}
      <Text
        className="mt-2 text-label-md font-inter-bold text-foreground"
        style={isHovered ? { color: companyColor } : undefined}
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
          <Star size={12} color={companyColor} fill={companyColor} />
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
        <Text className="mt-1 text-caption font-inter-medium" style={{ color: companyColor }}>
          {empresa.planes} {empresa.planes === 1 ? 'plan' : 'planes'}
        </Text>
      ) : null}
    </MarketplaceCard>
  )
}
