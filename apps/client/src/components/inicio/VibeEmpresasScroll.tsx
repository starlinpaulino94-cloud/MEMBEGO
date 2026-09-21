import React from 'react'
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native'
import { Link } from 'expo-router'
import { Star, ChevronRight } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { rnHref } from '../../lib/rutas'

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
  etiquetaRelacion: string | null
}

export function VibeEmpresasScroll({
  empresas,
  total,
}: {
  empresas: EmpresaScrollItem[]
  total: number
}) {
  if (!empresas || empresas.length === 0) {
    return null
  }

  return (
    <View className="mt-6 mb-4">
      <SectionHeader
        title="Empresas destacadas"
        action={
          <Link href="/explorar" asChild>
            <TouchableOpacity activeOpacity={0.7} className="flex-row items-center">
              <Text className="text-label-sm font-inter-bold text-vibe-violet">
                Ver más{total > 0 ? ` (${total})` : ''}
              </Text>
              <ChevronRight size={14} color="#7c3aed" />
            </TouchableOpacity>
          </Link>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        className="mt-3"
      >
        {empresas.map((empresa) => (
          <Link key={empresa.id} href={rnHref(empresa.href) as any} asChild>
            <TouchableOpacity
              activeOpacity={0.9}
              className="w-40 rounded-xl border border-vibe-borde bg-card p-3 elevation-1 shadow-card"
            >
              {/* Logo */}
              <View className="relative h-20 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                {empresa.logoUrl ? (
                  <Image
                    source={{ uri: empresa.logoUrl }}
                    style={{ flex: 1 }}
                    resizeMode="cover"
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-h2 text-vibe-violet">
                      {empresa.nombre.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}

                {/* Badge "Miembro" or "Siguiendo" */}
                {empresa.etiquetaRelacion && (
                  <View className="absolute left-1.5 top-1.5 rounded-full bg-vibe-violet px-2 py-0.5">
                    <Text className="text-[10px] font-bold text-white">
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
                  <Star size={12} color="#7c3aed" fill="#7c3aed" />
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
                <Text className="mt-1 text-caption font-inter-medium text-vibe-violet">
                  {empresa.planes} {empresa.planes === 1 ? 'plan' : 'planes'}
                </Text>
              ) : null}
            </TouchableOpacity>
          </Link>
        ))}
      </ScrollView>
    </View>
  )
}
