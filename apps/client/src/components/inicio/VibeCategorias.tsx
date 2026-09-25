import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import {
  Car,
  Compass,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Scissors,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { colors } from '../../theme/tokens'
import { VibeCategoriaChip } from './VibeCategoriaChip'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

type Categoria = { id: string; slug: string; name: string }

const ICONOS: Record<string, LucideIcon> = {
  lavado: Car, lavados: Car, carwash: Car, automotriz: Car, vehiculos: Car,
  gastronomia: UtensilsCrossed, restaurante: UtensilsCrossed, restaurantes: UtensilsCrossed, comida: UtensilsCrossed,
  tours: Compass, turismo: Compass, excursiones: Compass,
  bienestar: HeartPulse, salud: HeartPulse,
  spa: Sparkles, belleza: Scissors, barberia: Scissors, salon: Scissors,
  gimnasio: Dumbbell, fitness: Dumbbell,
  servicios: Wrench,
  tienda: ShoppingBag, tiendas: ShoppingBag, comercio: ShoppingBag,
}

export function VibeCategorias({
  categorias,
  categoriaActiva,
  onSeleccionar,
}: {
  categorias: Categoria[]
  categoriaActiva: string | null
  onSeleccionar: (slug: string | null, gradientIndex: number | null) => void
}) {
  const { accent } = useInicioAccent()
  if (!categorias || categorias.length === 0) {
    return (
      <View className="px-4 py-8 items-center justify-center">
        <Text className="text-xl font-bold text-foreground">Categorías</Text>
        <Text className="text-sm text-muted-foreground mt-2 text-center">
          No hay categorías disponibles para explorar ahora.
        </Text>
      </View>
    )
  }

  return (
    <View className="mt-4 mb-4">
      <HorizontalScrollWithFade contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          <VibeCategoriaChip
            categoria={{ label: 'Todos', icon: LayoutGrid, gradient: colors.gradient.categories[0] }}
            seleccionada={categoriaActiva === null}
            atenuada={Boolean(categoriaActiva)}
            onPress={() => onSeleccionar(null, null)}
          />

          {categorias.map((c, i) => {
            const Icono = ICONOS[c.slug?.toLowerCase()] ?? LayoutGrid
            const activa = categoriaActiva === c.slug
            const gradiente = colors.gradient.categories[(i + 1) % colors.gradient.categories.length]

            return (
              <VibeCategoriaChip
                key={c.id}
                categoria={{ label: c.name, icon: Icono, gradient: gradiente }}
                seleccionada={activa}
                atenuada={Boolean(categoriaActiva && !activa)}
                onPress={() => onSeleccionar(activa ? null : c.slug, activa ? null : (i + 1) % colors.gradient.categories.length)}
              />
            )
          })}
      </HorizontalScrollWithFade>
      {categoriaActiva ? (
        <View className="mt-2.5 flex-row items-center justify-between px-4">
          <Text className="flex-1 text-small text-muted-foreground" numberOfLines={1}>
            Filtrando por: <Text className="font-bold text-foreground">{categorias.find((item) => item.slug === categoriaActiva)?.name ?? categoriaActiva}</Text>
          </Text>
          <TouchableOpacity
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Mostrar todas las categorías"
            onPress={() => onSeleccionar(null, null)}
            className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          >
            <X size={14} color={accent.color} />
            <Text className="text-label-sm font-bold" style={{ color: accent.color }}>Mostrar todas</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}
