import React from 'react'
import { View, Text, Image, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { Clock, Star } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/format'
import type { PromotionPublic } from '../../lib/api'

/**
 * PROMOTION CARD — RN port de src/components/public/PromotionCard.tsx.
 *
 * Tarjeta de promoción con imagen 1:1, badge de descuento, título, empresa,
 * precio, código (dashed), fecha de vigencia. La tarjeta entera es el enlace.
 *
 * La esquina superior derecha se deja libre para el SavePromoButton que se
 * superpone desde el padre (esquinaLibre=true en el web).
 */

interface PromotionCardProps {
  promotion: PromotionPublic
  hrefBase?: string
  className?: string
}

const TIPOS_CON_MONTO = ['monto_fijo']

function formatDescuento(descuento: string | number | null, tipo: string): string {
  if (descuento == null) return ''
  const val = typeof descuento === 'string' ? parseFloat(descuento) : descuento
  if (Number.isNaN(val)) return ''
  if (TIPOS_CON_MONTO.includes(tipo)) {
    return `RD$${val.toLocaleString('es-DO')}`
  }
  return `-${Math.round(val)}%`
}

function fechaCorta(d: string | Date): string {
  try {
    return new Intl.DateTimeFormat('es-DO', {
      timeZone: 'America/Santo_Domingo',
      day: 'numeric',
      month: 'short',
    }).format(new Date(d))
  } catch {
    const date = new Date(d)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`
  }
}

export function PromotionCard({
  promotion,
  hrefBase = '/promociones',
  className,
}: PromotionCardProps) {
  const router = useRouter()
  const targetHref = `${hrefBase}/${promotion.id}`

  const isExpired = Boolean(
    promotion.vigenciaHasta && new Date(promotion.vigenciaHasta) < new Date()
  )

  const descuentoText = formatDescuento(promotion.descuento, promotion.tipo)
  const precio = promotion.venta?.precio ?? promotion.precio
  const agotada = promotion.venta?.agotada ?? false

  // Por vencer: menos de 72h
  const ahora = new Date()
  const porVencer =
    !isExpired &&
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) > ahora &&
    new Date(promotion.vigenciaHasta).getTime() - ahora.getTime() < 72 * 60 * 60 * 1000

  return (
    <Pressable
      onPress={() => router.push(targetHref as any)}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card',
        'active:opacity-90',
        className,
      )}
      accessibilityRole="button"
      accessibilityLabel={`Ver ${promotion.titulo}`}
    >
      {/* Imagen 1:1 con badges */}
      <View className="relative w-full bg-muted" style={{ aspectRatio: 1 }}>
        {promotion.imagenUrl ? (
          <Image
            source={{ uri: promotion.imagenUrl }}
            className="size-full"
            resizeMode="cover"
          />
        ) : (
          <View className="size-full items-center justify-center bg-primary/10">
            <Text className="text-4xl font-inter-bold text-primary">
              {promotion.titulo.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Badge descuento */}
        {descuentoText && !isExpired ? (
          <View className="absolute left-2 top-2 rounded-full bg-foreground/85 px-2.5 py-1">
            <Text className="text-sm font-inter-bold text-background">
              {descuentoText}
            </Text>
          </View>
        ) : null}

        {/* Badges derecha (featured, por vencer, agotada) */}
        <View className="absolute right-2 top-12 flex-col items-end gap-1">
          {promotion.isFeatured && !isExpired ? (
            <View className="flex-row items-center gap-1 rounded-full bg-card/95 px-2 py-0.5">
              <Star size={10} color="#eab308" fill="#eab308" />
              <Text className="text-xs font-inter-semibold text-foreground">
                Destacada
              </Text>
            </View>
          ) : null}
          {porVencer ? (
            <View className="rounded-full bg-destructive px-2 py-0.5">
              <Text className="text-xs font-inter-semibold text-white">
                Por vencer
              </Text>
            </View>
          ) : null}
          {agotada && !isExpired ? (
            <View className="rounded-full bg-foreground/85 px-2 py-0.5">
              <Text className="text-xs font-inter-semibold text-background">
                Agotada
              </Text>
            </View>
          ) : null}
        </View>

        {/* Overlay expirada */}
        {isExpired ? (
          <View className="absolute inset-0 items-center justify-center bg-foreground/55">
            <View className="rounded-full border border-white/60 px-4 py-1.5">
              <Text className="text-base font-inter-bold text-white">
                Expirada
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Cuerpo */}
      <View className="p-3">
        <Text className="text-base font-inter-bold text-foreground" numberOfLines={2}>
          {promotion.titulo}
        </Text>
        <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
          {promotion.company.name}
        </Text>

        {/* Precio */}
        {precio != null && precio > 0 && !isExpired ? (
          <Text className="mt-1.5 text-xl font-inter-bold text-foreground tabular-nums">
            {formatMoney(precio)}
          </Text>
        ) : null}

        {/* Código dashed */}
        {promotion.codigo ? (
          <View className="mt-2 flex-row items-center self-start rounded-lg border border-dashed border-border px-2.5 py-1">
            <Text className="text-xs text-muted-foreground">Código </Text>
            <Text className="font-inter-bold text-foreground">
              {promotion.codigo}
            </Text>
          </View>
        ) : null}

        {/* Fecha vigencia */}
        <View className="mt-2">
          {porVencer && promotion.vigenciaHasta ? (
            <View className="flex-row items-center gap-1">
              <Clock size={14} color="#e7000b" />
              <Text className="text-xs font-inter-semibold text-destructive">
                Vence pronto
              </Text>
            </View>
          ) : promotion.vigenciaHasta ? (
            <View className="flex-row items-center gap-1.5">
              <Clock size={14} color="#71717a" />
              <Text
                className={cn(
                  'text-xs',
                  isExpired ? 'font-inter-semibold text-destructive' : 'text-muted-foreground'
                )}
              >
                {isExpired ? 'Expiró' : 'Hasta'} el {fechaCorta(promotion.vigenciaHasta)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}
