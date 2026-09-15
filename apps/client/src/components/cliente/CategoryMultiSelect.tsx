import React from 'react'
import { View, Text, Pressable } from 'react-native'
import { Check } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import type { CategoryOption } from '../../lib/api'

interface CategoryMultiSelectProps {
  categories: CategoryOption[]
  selected: string[]
  onToggle: (id: string) => void
}

export function CategoryMultiSelect({
  categories,
  selected,
  onToggle,
}: CategoryMultiSelectProps) {
  const selectedSet = new Set(selected)

  if (categories.length === 0) {
    return (
      <Text className="text-xs text-muted-foreground">
        No hay categorias disponibles.
      </Text>
    )
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {categories.map((c) => {
        const active = selectedSet.has(c.id)
        return (
          <Pressable
            key={c.id}
            onPress={() => onToggle(c.id)}
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background',
            )}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
          >
            {active && <Check size={14} color="#0284c7" />}
            <Text
              className={cn(
                'text-sm font-inter-medium',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {c.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
