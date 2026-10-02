import React, { useEffect, useState } from 'react'
import { ResponsiveDetailSheet, useResponsiveDetailSheetBackgroundClass } from '../../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { goBackOr } from '../../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Clock,
  Copy,
  Check,
  Tag,
  AlertCircle,
  Store,
  Share2,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { usePromocion } from '../../src/hooks/usePromociones'
import { SavePromoButton } from '../../src/components/cliente/SavePromoButton'
import { DetailPageFrame } from '../../src/components/ui/DetailPageFrame'
import { Button } from '../../src/components/ui/Button'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { cn } from '../../src/lib/cn'
import { formatMoney } from '../../src/lib/format'
import { brandColor } from '../../src/lib/brand-color'
import { colors } from '../../src/theme/tokens'
import { FlashOfferStatus, isFlashOffer } from '../../src/components/marketplace/FlashOfferStatus'
import type { PromotionPublic } from '../../src/lib/api'

/**
 * PROMOCIÓN DETALLE — RN port de /cliente/promociones/[id].
 *
 * Imagen grande, badge de descuento, título, empresa, descripción, precio,
 * código (dashed, copiable), vigencia, CTA de canje, guardar.
 *
 * ponytail: copiar código usa Alert (no expo-clipboard instalado). Agregar
 * expo-clipboard cuando se permita instalar dependencias.
 * ponytail: CTA de canje es visual (no hay endpoint BFF de canje). F4 candidate.
 */
function PromocionDetalleScreenContent() {
  const sheetBackgroundClass = useResponsiveDetailSheetBackgroundClass('bg-background')
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = usePromocion(id, isAuthenticated)

  const [copied, setCopied] = useState(false)

  // Auth gate
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login' as any)
    }
  }, [authLoading, isAuthenticated, router])

  // Auth loading
  if (authLoading) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card" : "flex-1 items-center justify-center bg-background"}>
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"} style={{ paddingTop: insets.top }}>
        <EmptyState
          icon={<Tag size={40} color="#0284c7" />}
          title="Inicia sesión para ver esta oferta"
          description="Necesitas una cuenta para acceder a los detalles."
          action={
            <Button onPress={() => router.push('/(auth)/login' as any)}>
              Iniciar sesión
            </Button>
          }
        />
      </View>
    )
  }

  // Loading
  if (isLoading) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 items-center justify-center bg-surface-card" : "flex-1 items-center justify-center bg-background"}>
        <ActivityIndicator color="#0284c7" size="large" />
        <Text className="mt-3 text-sm text-muted-foreground">
          Cargando oferta…
        </Text>
      </View>
    )
  }

  // Error
  if (isError || !data?.promotion) {
    return (
      <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"} style={{ paddingTop: insets.top }}>
        <EmptyState
          icon={<AlertCircle size={40} color="#e7000b" />}
          title="No pudimos cargar la oferta"
          description="Intenta de nuevo en unos momentos."
          action={
            <Button variant="outline" onPress={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      </View>
    )
  }

  const promotion = data.promotion
  const codigo = promotion.codigo
  const guardada = (data as any).guardada ?? false

  return (
    <View className={sheetBackgroundClass === 'bg-surface-card' ? "flex-1 bg-surface-card" : "flex-1 bg-background"} style={{ paddingTop: insets.top }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DetailPageFrame>
          <PromoHero
            promotion={promotion}
            onBack={() => goBackOr(router, '/(tabs)/beneficios')}
          />

          <View className="mt-4 px-4">
            {/* Title + company */}
            <Text className="text-h1 font-inter-bold text-foreground">
              {promotion.titulo}
            </Text>
            <View className="flex-row items-center mt-2 gap-2">
              <Store size={14} color="#71717a" />
              <Text className="text-sm text-muted-foreground">
                {promotion.company.name}
              </Text>
            </View>

            {/* Description */}
            {promotion.descripcion ? (
              <Text className="mt-4 text-base text-foreground leading-relaxed">
                {promotion.descripcion}
              </Text>
            ) : null}

            {/* Price + discount */}
            <PrecioYDescuento promotion={promotion} />

            {/* Tags */}
            {promotion.tags.length > 0 ? (
              <View className="mt-5 flex-row flex-wrap gap-2">
                {promotion.tags.map((tag) => (
                  <View
                    key={tag}
                    className="rounded-full bg-info/10 px-3 py-1"
                  >
                    <Text className="text-xs font-inter-medium text-info">
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

          </View>
        </DetailPageFrame>
      </ScrollView>

      <View className={sheetBackgroundClass === 'bg-surface-card' ? "border-t border-border bg-surface-card px-4 pt-3" : "border-t border-border bg-background px-4 pt-3"} style={{ paddingBottom: insets.bottom + 12 }}>
        <DetailPageFrame className="gap-2 px-4">
          {codigo ? (
            <View>
              <Text className="mb-1.5 text-sm font-inter-semibold text-muted-foreground">
                Código de canje
              </Text>
              <Pressable
                onPress={() => handleCopyCode(codigo)}
                className="w-full flex-row items-center justify-between rounded-2xl border border-dashed border-border bg-muted/50 px-4 py-3 active:opacity-80"
                accessibilityRole="button"
                accessibilityLabel="Copiar código"
              >
                {copied ? (
                  <Check size={16} color="#00864d" />
                ) : (
                  <Copy size={16} color="#71717a" />
                )}
                <Text className="ml-2 flex-1 text-base font-inter-bold text-foreground">
                  {codigo}
                </Text>
                <Text className="ml-2 text-xs text-muted-foreground">
                  {copied ? 'Copiado' : 'Toca para copiar'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Vigencia promotion={promotion} />
          <Button
            size="xl"
            className="rounded-2xl"
            onPress={() =>
              Alert.alert(
                'Canjear oferta',
                'Muestra este código en el establecimiento para canjear tu oferta.',
              )
            }
          >
            <Tag size={18} color="#ffffff" />
            <Text className="ml-2 text-base font-inter-bold text-primary-foreground">
              Canjear oferta
            </Text>
          </Button>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1 rounded-2xl"
              onPress={() => Alert.alert('Compartir', 'Función próximamente disponible.')}
            >
              <Share2 size={16} color="#5b21b6" />
              <Text className="ml-2 text-sm font-inter-semibold text-primary">Compartir</Text>
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-2xl"
              onPress={() => Alert.alert('Guardar', 'Función próximamente disponible.')}
            >
              <Text className="text-sm font-inter-semibold text-foreground">Guardar</Text>
            </Button>
          </View>
        </DetailPageFrame>
      </View>
    </View>
  )

  function handleCopyCode(code: string) {
    // ponytail: no expo-clipboard instalado. Mostrar Alert con el código.
    // Agregar expo-clipboard cuando se permita instalar dependencias.
    Alert.alert('Código copiado', code, [{ text: 'OK' }])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
}

export default function PromocionDetalleScreen() {
  return (
    <ResponsiveDetailSheet>
      <PromocionDetalleScreenContent />
    </ResponsiveDetailSheet>
  )
}

/* ── Sub-componentes ─────────────────────────────────────────────────────── */

function PromoHero({ promotion, onBack }: { promotion: PromotionPublic; onBack: () => void }) {
  const companyColor = brandColor(promotion.company.colorPrimario, colors.primary.DEFAULT)
  const isExpired =
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) < new Date()

  const descuentoText = formatDescuento(promotion.descuento, promotion.tipo)

  return (
    <View className="relative w-full bg-muted" style={{ aspectRatio: 16 / 10 }}>
      {promotion.imagenUrl ? (
        <Image
          source={{ uri: promotion.imagenUrl }}
          className="size-full"
          resizeMode="cover"
        />
      ) : (
        <View className="size-full items-center justify-center bg-primary/10" style={{ backgroundColor: `${companyColor}1A` }}>
          <Text className="text-6xl font-inter-bold" style={{ color: companyColor }}>
            {promotion.titulo.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}

      {/* Badge descuento */}
      {descuentoText && !isExpired ? (
        <View className="absolute left-4 top-4 rounded-full bg-foreground/85 px-3 py-1.5">
          <Text className="text-base font-inter-bold text-background">
            {descuentoText}
          </Text>
        </View>
      ) : null}

      <View className="absolute left-4 right-4 top-4 flex-row items-center justify-between">
        <Pressable
          onPress={onBack}
          className="size-11 items-center justify-center rounded-full bg-card"
          accessibilityRole="button"
          accessibilityLabel="Volver a ofertas"
        >
          <ArrowLeft size={21} color="#71717a" />
        </Pressable>
        <SavePromoButton promocionId={promotion.id} />
      </View>

      {/* Overlay expirada */}
      {isExpired ? (
        <View className="absolute inset-0 items-center justify-center bg-foreground/55">
          <View className="rounded-full border border-white/60 px-6 py-2">
            <Text className="text-lg font-inter-bold text-white">
              Expirada
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

function PrecioYDescuento({ promotion }: { promotion: PromotionPublic }) {
  const precio = promotion.venta?.precio ?? promotion.precio
  const isExpired =
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) < new Date()

  if (precio == null || precio <= 0 || isExpired) return null

  return (
    <View className="mt-4 flex-row items-baseline gap-3">
      <Text className="text-3xl font-inter-bold tabular-nums" style={{ color: brandColor(promotion.company.colorPrimario, colors.primary.DEFAULT) }}>
        {formatMoney(precio)}
      </Text>
      {promotion.venta?.agotada ? (
        <View className="rounded-full bg-destructive/10 px-3 py-1">
          <Text className="text-xs font-inter-semibold text-destructive">
            Agotada
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function Vigencia({ promotion }: { promotion: PromotionPublic }) {
  const ahora = new Date()
  const isExpired =
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) < ahora

  const porVencer =
    !isExpired &&
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) > ahora &&
    new Date(promotion.vigenciaHasta).getTime() - ahora.getTime() <
    72 * 60 * 60 * 1000

  if (!promotion.vigenciaHasta) return null

  const fechaTexto = fechaLarga(promotion.vigenciaHasta)

  const esRelampago = isFlashOffer(promotion)
  const companyColor = brandColor(promotion.company.colorPrimario, colors.primary.DEFAULT)

  return (
    <View className="mt-4 gap-2">
      {esRelampago ? (
        <FlashOfferStatus hasta={promotion.vigenciaHasta!} color={companyColor} />
      ) : null}
      <View className="flex-row items-center gap-2">
        <Clock size={16} color={porVencer ? '#e7000b' : '#71717a'} />
        <Text
          className={cn(
            'text-sm',
            porVencer
              ? 'font-inter-semibold text-destructive'
              : isExpired
                ? 'font-inter-semibold text-destructive'
                : 'text-muted-foreground',
          )}
        >
          {isExpired
            ? `Expiró el ${fechaTexto}`
            : porVencer
              ? `Vence pronto — ${fechaTexto}`
              : `Válida hasta el ${fechaTexto}`}
        </Text>
      </View>
    </View>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const TIPOS_CON_MONTO = ['monto_fijo']

function formatDescuento(
  descuento: string | number | null,
  tipo: string,
): string {
  if (descuento == null) return ''
  const val = typeof descuento === 'string' ? parseFloat(descuento) : descuento
  if (Number.isNaN(val)) return ''
  if (TIPOS_CON_MONTO.includes(tipo)) {
    return `RD$${val.toLocaleString('es-DO')}`
  }
  return `-${Math.round(val)}%`
}

function fechaLarga(d: string): string {
  try {
    return new Intl.DateTimeFormat('es-DO', {
      timeZone: 'America/Santo_Domingo',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(d))
  } catch {
    const date = new Date(d)
    const months = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ]
    return `${date.getUTCDate()} de ${months[date.getUTCMonth()]} de ${date.getUTCFullYear()}`
  }
}
