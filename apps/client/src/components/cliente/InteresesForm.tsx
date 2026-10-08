import React, { useState, useEffect } from 'react'
import { View, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Save } from 'lucide-react-native'
import { useGuardarIntereses } from '../../hooks/useIntereses'
import { CategoryMultiSelect } from './CategoryMultiSelect'
import { Button } from '../ui/Button'
import type { CategoryOption } from '../../lib/api'

interface InteresesFormProps {
  categories: CategoryOption[]
  selected: string[]
}

export function InteresesForm({ categories, selected }: InteresesFormProps) {
  const router = useRouter()
  const [selection, setSelection] = useState<string[]>(selected)
  const mutation = useGuardarIntereses()

  function toggle(id: string) {
    setSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleSave() {
    mutation.mutate(selection, {
      onSuccess: () => {
        Alert.alert('Intereses guardados', 'Tus recomendaciones mejoraran.')
        router.push('/mis-membresias')
      },
      onError: (err: Error) => {
        Alert.alert('Error', err.message || 'No se pudieron guardar tus intereses.')
      },
    })
  }

  return (
    <View className="gap-6">
      <CategoryMultiSelect
        categories={categories}
        selected={selection}
        onToggle={toggle}
      />
      <Button
        onPress={handleSave}
        loading={mutation.isPending}
        icon={<Save size={16} color="#ffffff" />}
      >
        Guardar intereses
      </Button>
    </View>
  )
}
