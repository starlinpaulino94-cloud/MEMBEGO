import React, { useState } from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react-native'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'

/**
 * FILTERS SIDEBAR — RN port de src/app/(cliente)/cliente/buscar/FiltersSidebar.tsx.
 *
 * Panel de filtros avanzados del buscador: categorías, empresas, fechas,
 * solo con stock. En móvil se abre como Sheet (bottom sheet).
 */

export interface FiltersSidebarProps {
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl?: string | null }[]
  filtros: {
    cat?: string
    emp?: string
    fd?: string
    fh?: string
    stock?: boolean
  }
  onApply: (filtros: {
    cat?: string
    emp?: string
    fd?: string
    fh?: string
    stock?: boolean
  }) => void
  onClear: () => void
}

export function FiltersSidebar({
  categorias,
  empresas,
  filtros,
  onApply,
  onClear,
}: FiltersSidebarProps) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(filtros)

  const activeCount = [
    local.cat,
    local.emp,
    local.fd,
    local.fh,
    local.stock ? 'stock' : '',
  ].filter(Boolean).length

  function handleApply() {
    onApply(local)
    setOpen(false)
  }

  function handleClear() {
    const cleared = { cat: undefined, emp: undefined, fd: undefined, fh: undefined, stock: undefined }
    setLocal(cleared)
    onClear()
    setOpen(false)
  }

  function update<K extends keyof typeof local>(key: K, value: (typeof local)[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      {/* Trigger button */}
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl border border-border bg-card p-4 active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel="Abrir filtros avanzados"
      >
        <View className="flex-row items-center gap-2">
          <Filter size={16} color="#0284c7" />
          <Text className="text-base font-inter-medium text-foreground">
            Filtros avanzados
          </Text>
          {activeCount > 0 ? (
            <View className="rounded-full bg-primary px-2 py-0.5">
              <Text className="text-xs font-inter-bold text-primary-foreground tabular-nums">
                {activeCount}
              </Text>
            </View>
          ) : null}
        </View>
        <ChevronDown size={16} color="#71717a" />
      </Pressable>

      {/* Sheet con los filtros */}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Filtros">
        <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
          {/* Header con limpiar */}
          <View className="flex-row items-center justify-between pb-4">
            <View className="flex-row items-center gap-2">
              <Filter size={16} color="#0284c7" />
              <Text className="text-base font-inter-bold text-foreground">
                Filtros
              </Text>
            </View>
            {activeCount > 0 ? (
              <Pressable onPress={handleClear} className="flex-row items-center gap-1">
                <X size={14} color="#e7000b" />
                <Text className="text-sm font-inter-semibold text-destructive">
                  Limpiar todo
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Categorías */}
          {categorias.length > 0 ? (
            <View className="border-t border-border pt-4">
              <Text className="mb-2.5 text-xs font-inter-semibold uppercase tracking-widest text-muted-foreground">
                Categoría
              </Text>
              <View className="gap-1.5">
                {/* Todas */}
                <Pressable
                  onPress={() => update('cat', undefined)}
                  className={cn(
                    'flex-row items-center gap-2.5 rounded-lg p-1.5',
                    !local.cat && 'bg-primary/10',
                  )}
                >
                  <View
                    className={cn(
                      'h-4 w-4 rounded-full border-2',
                      !local.cat ? 'border-primary bg-primary' : 'border-border',
                    )}
                  >
                    {!local.cat ? (
                      <View className="m-auto h-1.5 w-1.5 rounded-full bg-white" />
                    ) : null}
                  </View>
                  <Text className="text-sm font-inter-medium">Todas</Text>
                </Pressable>
                {categorias.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => update('cat', local.cat === cat ? undefined : cat)}
                    className={cn(
                      'flex-row items-center gap-2.5 rounded-lg p-1.5',
                      local.cat === cat && 'bg-primary/10',
                    )}
                  >
                    <View
                      className={cn(
                        'h-4 w-4 rounded-full border-2',
                        local.cat === cat ? 'border-primary bg-primary' : 'border-border',
                      )}
                    >
                      {local.cat === cat ? (
                        <View className="m-auto h-1.5 w-1.5 rounded-full bg-white" />
                      ) : null}
                    </View>
                    <Text className="text-sm font-inter-medium">{cat}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Empresas */}
          {empresas.length > 0 ? (
            <View className="border-t border-border pt-4 mt-4">
              <Text className="mb-2.5 text-xs font-inter-semibold uppercase tracking-widest text-muted-foreground">
                Empresa
              </Text>
              <View className="gap-1.5">
                <Pressable
                  onPress={() => update('emp', undefined)}
                  className={cn(
                    'flex-row items-center gap-2.5 rounded-lg p-1.5',
                    !local.emp && 'bg-primary/10',
                  )}
                >
                  <View
                    className={cn(
                      'h-4 w-4 rounded-full border-2',
                      !local.emp ? 'border-primary bg-primary' : 'border-border',
                    )}
                  >
                    {!local.emp ? (
                      <View className="m-auto h-1.5 w-1.5 rounded-full bg-white" />
                    ) : null}
                  </View>
                  <Text className="text-sm font-inter-medium">Todas</Text>
                </Pressable>
                {empresas.map((emp) => (
                  <Pressable
                    key={emp.id}
                    onPress={() => update('emp', local.emp === emp.id ? undefined : emp.id)}
                    className={cn(
                      'flex-row items-center gap-2.5 rounded-lg p-1.5',
                      local.emp === emp.id && 'bg-primary/10',
                    )}
                  >
                    <View
                      className={cn(
                        'h-4 w-4 rounded-full border-2',
                        local.emp === emp.id ? 'border-primary bg-primary' : 'border-border',
                      )}
                    >
                      {local.emp === emp.id ? (
                        <View className="m-auto h-1.5 w-1.5 rounded-full bg-white" />
                      ) : null}
                    </View>
                    <Text className="text-sm font-inter-medium" numberOfLines={1}>
                      {emp.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Fechas */}
          <View className="border-t border-border pt-4 mt-4">
            <Text className="mb-2.5 text-xs font-inter-semibold uppercase tracking-widest text-muted-foreground">
              Fechas
            </Text>
            <View className="gap-3">
              <View>
                <Text className="mb-1 text-xs text-muted-foreground">Desde</Text>
                <Pressable
                  onPress={() => {
                    // ponytail: date picker nativo requiere @react-native-community/datetimepicker.
                    // Por ahora, input manual simplificado. Agregar DatePicker cuando se permita instalar deps.
                  }}
                  className="h-11 flex-row items-center rounded-lg border border-border bg-background px-3"
                >
                  <Text className={local.fd ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
                    {local.fd || 'Seleccionar fecha'}
                  </Text>
                </Pressable>
              </View>
              <View>
                <Text className="mb-1 text-xs text-muted-foreground">Hasta</Text>
                <Pressable
                  onPress={() => {}}
                  className="h-11 flex-row items-center rounded-lg border border-border bg-background px-3"
                >
                  <Text className={local.fh ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
                    {local.fh || 'Seleccionar fecha'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Solo con stock */}
          <View className="border-t border-border pt-4 mt-4">
            <Text className="mb-2.5 text-xs font-inter-semibold uppercase tracking-widest text-muted-foreground">
              Disponibilidad
            </Text>
            <Pressable
              onPress={() => update('stock', !local.stock)}
              className="flex-row items-center gap-2.5 rounded-lg p-1.5"
            >
              <View
                className={cn(
                  'h-5 w-5 rounded border-2',
                  local.stock ? 'border-primary bg-primary' : 'border-border',
                )}
              >
                {local.stock ? (
                  <Text className="text-center text-xs font-inter-bold text-white">✓</Text>
                ) : null}
              </View>
              <Text className="text-sm font-inter-medium">Solo con cupos disponibles</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Botón aplicar */}
        <View className="pt-4">
          <Button onPress={handleApply} variant="default" size="lg">
            Aplicar filtros
          </Button>
        </View>
      </Sheet>
    </>
  )
}
