import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { ChevronRight, Store } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'
import {
  EmpresaMarketplaceCard,
  type EmpresaMarketplaceCardData,
} from '../marketplace/EmpresaMarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

export type EmpresaScrollItem = EmpresaMarketplaceCardData

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
          <EmpresaMarketplaceCard
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
