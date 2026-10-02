import React, { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Search, X } from 'lucide-react-native'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'
import { cn } from '../../lib/cn'
import { colors } from '../../theme/tokens'
import type { CategoryPublic } from '../../lib/api'

interface BenefitsFiltersProps {
  readonly categories: readonly CategoryPublic[]
  readonly query: string
  readonly category: string | undefined
  readonly onSearch: (query: string) => void
  readonly onCategory: (category: string | undefined) => void
  readonly onClear: () => void
}

export function BenefitsFilters({ categories, query, category, onSearch, onCategory, onClear }: BenefitsFiltersProps) {
  const [input, setInput] = useState(query)
  const filtering = Boolean(query || category)
  const categoryName = categories.find((item) => item.slug === category)?.name ?? category

  useEffect(() => setInput(query), [query])

  return (
    <View className="rounded-xl border border-vibe-borde bg-card p-3">
      <View className="h-14 flex-row items-center rounded-xl border border-vibe-borde bg-vibe-fondo pl-3 pr-1.5">
        <Search size={18} color={colors.primary.DEFAULT} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => onSearch(input.trim())}
          returnKeyType="search"
          placeholder="Buscar beneficios…"
          placeholderTextColor={colors.surface.mutedForeground}
          accessibilityLabel="Buscar ofertas"
          className="h-full min-w-0 flex-1 px-2 text-small font-sans text-foreground"
        />
        {input ? (
          <Pressable
            onPress={() => { setInput(''); onSearch('') }}
            className="h-11 w-11 items-center justify-center rounded-full"
            accessibilityRole="button"
            accessibilityLabel="Borrar búsqueda"
          >
            <X size={16} color={colors.surface.mutedForeground} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onSearch(input.trim())}
          className="min-h-11 items-center justify-center rounded-lg bg-primary px-3 active:opacity-90"
          accessibilityRole="button"
          accessibilityLabel="Buscar ofertas"
        >
          <Text className="text-label-lg font-inter-semibold text-primary-foreground">Buscar</Text>
        </Pressable>
      </View>
      {categories.length > 0 ? (
        <HorizontalScrollWithFade className="mt-3" contentContainerStyle={{ gap: 8 }}>
          {[{ id: 'all', name: 'Todas', slug: undefined }, ...categories].map((item) => {
            const selected = category === item.slug
            return (
              <Pressable
                key={item.id}
                onPress={() => onCategory(selected ? undefined : item.slug)}
                className={cn('min-h-11 items-center justify-center rounded-full border px-4', selected ? 'border-primary bg-primary/10' : 'border-vibe-borde bg-card')}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text className={cn('text-label-lg font-inter-semibold', selected ? 'text-primary' : 'text-muted-foreground')}>{item.name}</Text>
              </Pressable>
            )
          })}
        </HorizontalScrollWithFade>
      ) : null}
      {filtering ? (
        <View className="mt-2 flex-row items-center justify-between gap-2">
          <Text className="min-w-0 flex-1 text-caption text-muted-foreground" role="status">
            {[categoryName, query ? `«${query}»` : null].filter(Boolean).join(' · ')}
          </Text>
          <Pressable
            onPress={() => { setInput(''); onClear() }}
            className="min-h-11 justify-center px-2"
            accessibilityRole="button"
            accessibilityLabel="Limpiar filtros"
          >
            <Text className="text-label-lg font-inter-semibold text-primary">Limpiar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
