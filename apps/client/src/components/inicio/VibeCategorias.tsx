import React from 'react'
import { View, Text, TouchableOpacity, ScrollView } from 'react-native'
import { Link } from 'expo-router'
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
} from 'lucide-react-native'

const ICONOS: Record<string, any> = {
  lavado: Car, lavados: Car, carwash: Car, automotriz: Car, vehiculos: Car,
  gastronomia: UtensilsCrossed, restaurante: UtensilsCrossed, restaurantes: UtensilsCrossed, comida: UtensilsCrossed,
  tours: Compass, turismo: Compass, excursiones: Compass,
  bienestar: HeartPulse, salud: HeartPulse,
  spa: Sparkles, belleza: Scissors, barberia: Scissors, salon: Scissors,
  gimnasio: Dumbbell, fitness: Dumbbell,
  servicios: Wrench,
  tienda: ShoppingBag, tiendas: ShoppingBag, comercio: ShoppingBag,
}

const ACENTOS = ['#7c3aed', '#2563eb', '#06b6d4'] as const

export function VibeCategorias({ categorias }: { categorias: any[] }) {
  if (!categorias || categorias.length === 0) {
    return (
      <View className="px-4 py-8 items-center justify-center">
        <Text className="text-xl font-bold text-foreground">Categorías</Text>
        <Text className="text-sm text-slate-500 mt-2 text-center">
          No hay categorías disponibles para explorar ahora.
        </Text>
      </View>
    )
  }

  return (
    <View className="mt-4 mb-4">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        <Link href="/explorar" asChild>
          <TouchableOpacity
            activeOpacity={0.8}
            className="flex-row items-center gap-2 rounded-full bg-vibe-violet px-4 py-2"
          >
            <LayoutGrid size={16} color="#ffffff" />
            <Text className="text-[12px] font-bold text-white">
              Todos
            </Text>
          </TouchableOpacity>
        </Link>
        
        {categorias.map((c, i) => {
          const Icono = ICONOS[c.slug?.toLowerCase()] ?? LayoutGrid
          const color = ACENTOS[i % ACENTOS.length]
          
          return (
            <Link key={c.id} href={`/explorar?category=${encodeURIComponent(c.slug)}`} asChild>
              <TouchableOpacity
                activeOpacity={0.8}
                className="flex-row items-center gap-2 rounded-full border border-vibe-chip bg-card px-4 py-2 elevation-1 shadow-sm"
              >
                <Icono size={16} color={color} />
                <Text className="text-[12px] font-bold text-foreground">
                  {c.name}
                </Text>
              </TouchableOpacity>
            </Link>
          )
        })}
      </ScrollView>
    </View>
  )
}
