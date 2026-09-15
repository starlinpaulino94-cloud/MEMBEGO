import React from 'react'
import { View, Text, TouchableOpacity, Image } from 'react-native'
import { Link } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Star } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'

function Estrellas({ valoracion }: { valoracion: number }) {
  const llenas = Math.round(valoracion)
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          color={n <= llenas ? '#7c3aed' : '#ddd6fe'}
          fill={n <= llenas ? '#7c3aed' : 'transparent'}
        />
      ))}
    </View>
  )
}

export function VibeRelacionado({
  planes,
  total,
}: {
  planes: any[]
  total: number
}) {
  if (!planes || planes.length === 0) {
    return (
      <View className="mt-6 px-4">
        <EmptyState
          title="Relacionado contigo"
          description="Cuando haya membresías publicadas, aparecerán aquí."
          variant="card"
        />
      </View>
    )
  }

  return (
    <View className="mt-6 px-4">
      <SectionHeader
        title="Relacionado con los artículos que viste"
        action={
          <Link href="/explorar" asChild>
            <TouchableOpacity activeOpacity={0.7}>
              <Text className="text-label-sm font-inter-bold text-vibe-violet">
                Ver más{total > 0 ? ` (${total})` : ''}
              </Text>
            </TouchableOpacity>
          </Link>
        }
      />

      <View className="mt-3 flex-row flex-wrap gap-3">
        {planes.slice(0, 4).map((p) => (
          <Link key={p.id} href={rnHref(p.href) as any} asChild>
            <TouchableOpacity
              activeOpacity={0.9}
              className="w-[48%] rounded-xl border border-vibe-borde bg-card p-3 elevation-1 shadow-card"
            >
              <View className="relative h-32 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                {p.imagen ? (
                  <Image
                    source={{ uri: p.imagen }}
                    style={{ flex: 1 }}
                    resizeMode="cover"
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-h1 text-vibe-violet">
                      {p.empresa?.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>

              <Text
                className="mt-2 text-label-md font-inter-bold text-foreground"
                numberOfLines={2}
              >
                {p.empresa} · {p.nombre}
              </Text>

              {p.valoracion != null && Number.isFinite(Number(p.valoracion)) ? (
                <View className="mt-1 flex-row items-center gap-1">
                  <Estrellas valoracion={Number(p.valoracion)} />
                  <Text className="text-label-sm font-inter-medium text-muted-foreground">
                    {Number(p.resenas ?? 0).toLocaleString('es-DO')}
                  </Text>
                </View>
              ) : null}

              <View className="mt-1 flex-row items-baseline">
                <Text className="text-h3 text-foreground">{p.precio}</Text>
                <Text className="ml-1 text-small text-muted-foreground">
                  {p.periodo}
                </Text>
              </View>

              <LinearGradient
                colors={['#7c3aed', '#2563eb', '#06b6d4']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                className="mt-3 w-full items-center rounded-full py-2"
              >
                <Text className="text-label-sm font-inter-bold text-white">
                  Aprovechar
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </Link>
        ))}
      </View>
    </View>
  )
}
