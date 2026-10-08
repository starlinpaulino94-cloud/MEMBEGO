import React from 'react'
import { View, Text, Pressable, Alert } from 'react-native'
import { Car, Star, WalletCards, Trash2 } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import type { VehiculoItem } from '../../lib/api'

/**
 * Tarjeta de un vehículo del cliente (port de web VehicleCard.tsx).
 *
 * Responde: qué coche es, si es el principal, y a qué membresías está asociado.
 * ponytail: onSetPrincipal/onDelete son no-op con Alert — el BFF no expone
 * endpoints para esto. Agregar cuando F4 los implemente.
 */
export interface VehicleCardProps {
  vehiculo: VehiculoItem
  onSetPrincipal?: (id: string) => void
  onDelete?: (id: string) => void
}

export function VehicleCard({ vehiculo, onSetPrincipal, onDelete }: VehicleCardProps) {
  const v = vehiculo
  const etiqueta = `${v.marca} ${v.modelo} (${v.anio})${v.placa ? ` · ${v.placa}` : ''}`

  const handleSetPrincipal = () => {
    // ponytail: no-op — BFF no expone endpoint. Agregar cuando F4 lo implemente.
    Alert.alert(
      'Hacer principal',
      `¿Marcar "${etiqueta}" como tu vehículo principal? Estará disponible próximamente.`
    )
    onSetPrincipal?.(v.id)
  }

  const handleDelete = () => {
    // ponytail: no-op — BFF no expone endpoint. Agregar cuando F4 lo implemente.
    Alert.alert(
      'Eliminar vehículo',
      `¿Eliminar "${etiqueta}"? Esta acción no se puede deshacer. Estará disponible próximamente.`
    )
    onDelete?.(v.id)
  }

  return (
    <View className="rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        {/* Icono Car en círculo */}
        <View className="h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Car size={24} color="#0284c7" />
        </View>

        <View className="flex-1 min-w-0">
          {/* Nombre + badge Principal */}
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="text-h3 font-inter-bold text-foreground">
              {v.marca} {v.modelo}
            </Text>
            {v.esPrincipal ? (
              <View className="flex-row items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5">
                <Star size={12} color="#111827" fill="#111827" />
                <Text className="text-label-sm font-inter-medium text-secondary-foreground">
                  Principal
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={handleSetPrincipal}
                className="flex-row items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 active:opacity-70"
              >
                <Star size={12} color="#0284c7" />
                <Text className="text-label-sm font-inter-medium text-primary">
                  Hacer principal
                </Text>
              </Pressable>
            )}
          </View>

          {/* Subtexto: categoría · año · color */}
          <Text className="mt-0.5 text-caption text-muted-foreground">
            {[v.categoria, String(v.anio), v.color].filter(Boolean).join(' · ')}
          </Text>

          {/* Empresa */}
          {v.empresaNombre && (
            <Text className="mt-1 text-caption text-muted-foreground">
              Registrado en {v.empresaNombre}
            </Text>
          )}

          {/* Placa chip dashed mono */}
          {v.placa && (
            <View className="mt-2 self-start rounded-lg border border-dashed border-border bg-muted/50 px-2.5 py-1">
              <Text className="font-mono text-small font-inter-bold tracking-wider text-foreground">
                {v.placa}
              </Text>
            </View>
          )}
        </View>

        {/* Delete button */}
        <Pressable
          onPress={handleDelete}
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-70"
          accessibilityLabel="Eliminar vehículo"
        >
          <Trash2 size={18} color="#e7000b" />
        </Pressable>
      </View>

      {/* Membresías asociadas */}
      {v.membresias.length > 0 && (
        <View className="mt-3 border-t border-border pt-3">
          <Text className="text-overline font-inter-semibold text-muted-foreground">
            Membresías asociadas
          </Text>
          <View className="mt-1.5 flex-col gap-1">
            {v.membresias.map((m) => (
              <View key={m.id} className="flex-row items-center gap-2">
                <WalletCards size={16} color="#0284c7" />
                <Text className="flex-1 text-small text-foreground" numberOfLines={1}>
                  {m.planNombre}
                  {m.empresaNombre && ` · ${m.empresaNombre}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
