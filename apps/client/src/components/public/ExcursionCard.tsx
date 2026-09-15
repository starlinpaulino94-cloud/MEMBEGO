import React from 'react'
import { View, Text, Image, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight, Clock, MapPin, Compass, Users } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/format'
import { rnHref } from '../../lib/rutas'
import type { ExcursionCardData } from '../../lib/api'

/**
 * EXCURSION CARD — RN port de src/components/public/ExcursionCard.tsx.
 *
 * Tarjeta de excursión con imagen h-44 + gradiente, badge de categoría,
 * chip de empresa, título, descripción, meta (MapPin/Clock), precio, CTA.
 */

interface ExcursionCardProps {
  excursion: ExcursionCardData
  hrefBase?: string
  className?: string
}

export function ExcursionCard({
  excursion,
  hrefBase,
  className,
}: ExcursionCardProps) {
  const router = useRouter()

  // Construir href
  let targetHref: string
  if (hrefBase) {
    targetHref = `${hrefBase}/${excursion.slug}`
  } else if (excursion.empresa?.slug) {
    targetHref = `/empresas/${excursion.empresa.slug}/excursiones/${excursion.slug}`
  } else {
    targetHref = `/excursiones/${excursion.slug}`
  }
  targetHref = rnHref(targetHref)

  const isAgotada = excursion.agotadaGlobal ?? false
  const isPasada = excursion.todasFechasPasadas ?? false
  const disabled = isAgotada || isPasada
  const cupos = excursion.cupoDisponible

  return (
    <Pressable
      onPress={() => !disabled && router.push(targetHref as any)}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card',
        'active:opacity-90',
        disabled && 'opacity-70',
        className,
      )}
      accessibilityRole="button"
      accessibilityLabel={`Ver ${excursion.nombre}`}
      accessibilityState={{ disabled }}
    >
      {/* Imagen protagonista h-44 con gradiente */}
      <View className="relative w-full overflow-hidden" style={{ height: 176 }}>
        <LinearGradient
          colors={['#006bed', '#06b6d4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className="absolute inset-0"
        />
        {excursion.portadaUrl ? (
          <Image
            source={{ uri: excursion.portadaUrl }}
            className="size-full"
            resizeMode="cover"
          />
        ) : (
          <View className="size-full items-center justify-center">
            <Compass size={40} color="rgba(255,255,255,0.6)" />
          </View>
        )}

        {/* Gradiente para legibilidad del chip de empresa */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.4)']}
          start={{ x: 0, y: 0.6 }}
          end={{ x: 0, y: 1 }}
          className="absolute inset-x-0 bottom-0 h-16"
        />

        {/* Categoría: badge arriba izquierda */}
        {excursion.categoria && !disabled ? (
          <View className="absolute left-3 top-3 rounded-lg bg-card/95 px-2.5 py-1">
            <Text className="text-xs font-inter-bold tracking-tight text-primary">
              {excursion.categoria}
            </Text>
          </View>
        ) : null}

        {/* Badges de estado (derecha) */}
        <View className="absolute right-3 top-3 flex-col items-end gap-1.5">
          {isPasada ? (
            <View className="rounded-full bg-destructive px-2.5 py-1">
              <Text className="text-xs font-inter-bold uppercase tracking-wide text-white">
                Finalizada
              </Text>
            </View>
          ) : null}
          {isAgotada && !isPasada ? (
            <View className="rounded-full bg-foreground/85 px-2.5 py-1">
              <Text className="text-xs font-inter-bold uppercase tracking-wide text-background">
                Agotada
              </Text>
            </View>
          ) : null}
          {!disabled && cupos != null && cupos > 0 && cupos <= 5 ? (
            <View className="flex-row items-center gap-1 rounded-full bg-warning px-2.5 py-1">
              <Users size={12} color="#92400e" />
              <Text className="text-xs font-inter-bold uppercase tracking-wide text-warning-foreground">
                Últimos {cupos} cupos
              </Text>
            </View>
          ) : null}
        </View>

        {/* Empresa: chip glass sobre la imagen */}
        {excursion.empresa?.name ? (
          <View className="absolute bottom-3 left-3 flex-row items-center gap-1.5 rounded-full bg-card/90 py-1 pl-1 pr-3">
            {excursion.empresa.logoUrl ? (
              <View className="h-5 w-5 overflow-hidden rounded-full">
                <Image
                  source={{ uri: excursion.empresa.logoUrl }}
                  className="size-full"
                  resizeMode="cover"
                />
              </View>
            ) : (
              <View className="h-5 w-5 items-center justify-center rounded-full bg-primary">
                <Text className="text-xs font-inter-bold text-primary-foreground">
                  {excursion.empresa.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <Text className="max-w-36 text-xs font-inter-medium text-foreground" numberOfLines={1}>
              {excursion.empresa.name}
            </Text>
          </View>
        ) : null}

        {/* Estado deshabilitado overlay */}
        {disabled ? (
          <View className="absolute inset-0 items-center justify-center bg-foreground/50">
            <View className="rounded-full border border-white/40 px-4 py-1.5">
              <Text className="text-sm font-inter-semibold text-white">
                {isPasada ? 'Excursión finalizada' : 'Cupos agotados'}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Contenido */}
      <View className="p-4">
        <Text className="text-lg font-inter-bold text-foreground" numberOfLines={2}>
          {excursion.nombre}
        </Text>

        {excursion.descripcion ? (
          <Text className="mt-1.5 text-sm text-muted-foreground" numberOfLines={2}>
            {excursion.descripcion}
          </Text>
        ) : null}

        {/* Meta: Duración y Ubicación */}
        <View className="mt-3 flex-row flex-wrap items-center gap-3">
          {excursion.ubicacion ? (
            <View className="flex-row items-center gap-1">
              <MapPin size={14} color="#0284c7" />
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {excursion.ubicacion}
              </Text>
            </View>
          ) : null}
          {excursion.duracionMin ? (
            <View className="flex-row items-center gap-1">
              <Clock size={14} color="#0284c7" />
              <Text className="text-xs text-muted-foreground">
                {excursion.duracionMin} min
              </Text>
            </View>
          ) : null}
        </View>

        {/* Precio Desde */}
        {excursion.precioDesde != null && !disabled ? (
          <View className="mt-3">
            <Text className="text-xs text-muted-foreground">Desde</Text>
            <Text className="text-2xl font-inter-bold text-foreground tabular-nums">
              {formatMoney(excursion.precioDesde, { moneda: excursion.moneda || 'DOP' })}
            </Text>
          </View>
        ) : null}

        {/* CTA */}
        <View className="mt-4">
          <View
            className={cn(
              'flex-row items-center justify-center gap-1.5 rounded-lg py-3',
              disabled ? 'bg-muted' : 'bg-primary',
            )}
          >
            <Text
              className={cn(
                'text-sm font-inter-bold',
                disabled ? 'text-muted-foreground' : 'text-primary-foreground',
              )}
            >
              {disabled ? 'Ver detalles' : 'Reservar ahora'}
            </Text>
            <ArrowRight
              size={16}
              color={disabled ? '#71717a' : '#ffffff'}
            />
          </View>
        </View>
      </View>
    </Pressable>
  )
}
