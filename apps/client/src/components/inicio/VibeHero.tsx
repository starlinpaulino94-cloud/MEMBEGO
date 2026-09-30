import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Text,
  View,
  useWindowDimensions,
  StyleSheet,
  Image,
  type ScrollView,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight } from 'lucide-react-native'
import { useRouter, type Href } from 'expo-router'
import { EmptyState } from '../ui/EmptyState'
import { rnHref } from '../../lib/rutas'
import { colors, radii } from '../../theme/tokens'
import { MarketplaceCard } from '../marketplace/MarketplaceCard'
import { useInicioAccent } from '../layout/InicioAccentContext'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'
import type { NovedadHero } from '../../../../../src/modules/home/vista'

const GRAD_OVERLAY = [colors.overlay.transparent, colors.overlay.heroMid, colors.overlay.heroDeep] as const
const CARD_GAP = 12
const AUTOPLAY_MS = 6_000

function modulo(value: number, length: number) {
  return ((value % length) + length) % length
}

function fechaCorta(value: string): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

function etiquetaTipo(tipo: NovedadHero['tipo']): string {
  switch (tipo) {
    case 'PROMOCION': return 'Nueva promoción'
    case 'MEMBRESIA': return 'Nueva membresía'
    case 'EMPRESA': return 'Nueva empresa'
  }
}

function ctaTipo(tipo: NovedadHero['tipo']): string {
  switch (tipo) {
    case 'PROMOCION': return 'Ver promoción'
    case 'MEMBRESIA': return 'Ver membresía'
    case 'EMPRESA': return 'Conocer empresa'
  }
}

function datoNovedad(novedad: NovedadHero): string | null {
  switch (novedad.tipo) {
    case 'PROMOCION':
      return [
        novedad.descuento,
        novedad.vigenciaHasta ? `Hasta ${fechaCorta(novedad.vigenciaHasta)}` : null,
      ].filter(Boolean).join(' · ') || null
    case 'MEMBRESIA':
      return [novedad.precio, novedad.periodo].filter(Boolean).join(' ')
    case 'EMPRESA':
      return [novedad.ciudad, novedad.valoracion != null ? `★ ${novedad.valoracion.toFixed(1)}` : null]
        .filter(Boolean).join(' · ') || null
  }
}

export function VibeHero({ heroes }: { heroes: readonly NovedadHero[] }) {
  const router = useRouter()
  const { accent } = useInicioAccent()
  const { width: windowWidth } = useWindowDimensions()
  const cardWidth = Math.min(windowWidth * 0.86, 340)
  const step = cardWidth + CARD_GAP
  const isCircular = heroes.length > 5
  const repeatedHeroes = useMemo(
    () => isCircular ? [...heroes, ...heroes, ...heroes, ...heroes, ...heroes] : [...heroes],
    [heroes, isCircular],
  )
  const scrollRef = useRef<ScrollView>(null)
  const physicalIndex = useRef(0)
  const interactionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needsInitialPosition = useRef(true)
  const previousLayout = useRef({ count: heroes.length, step })
  const [activeIndex, setActiveIndex] = useState(0)
  const [accessibleCopy, setAccessibleCopy] = useState(2)
  const [autoplayCycle, setAutoplayCycle] = useState(0)
  const [isInteracting, setIsInteracting] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (previousLayout.current.count !== heroes.length || previousLayout.current.step !== step) {
      needsInitialPosition.current = true
      previousLayout.current = { count: heroes.length, step }
    }
  }, [heroes.length, step])

  const posicionarCarrusel = useCallback(() => {
    if (!needsInitialPosition.current || heroes.length === 0) return
    needsInitialPosition.current = false
    const middleIndex = isCircular ? heroes.length * 2 : 0
    physicalIndex.current = middleIndex
    setActiveIndex(0)
    setAccessibleCopy(isCircular ? 2 : 0)
    scrollRef.current?.scrollTo({ x: middleIndex * step, y: 0, animated: false })
  }, [heroes.length, isCircular, step])

  const actualizarPosicion = useCallback((offset: number) => {
    if (heroes.length === 0) return
    const index = Math.max(0, Math.round(offset / step))
    const count = heroes.length
    const needsRecentering = isCircular && (index < count * 2 || index >= count * 3)
    const nextPhysicalIndex = needsRecentering ? count * 2 + modulo(index, count) : index
    physicalIndex.current = nextPhysicalIndex
    setAccessibleCopy(needsRecentering ? 2 : isCircular ? Math.floor(index / count) : 0)
    setActiveIndex((current) => {
      const next = modulo(index, heroes.length)
      return current === next ? current : next
    })
    if (needsRecentering) {
      scrollRef.current?.scrollTo({ x: nextPhysicalIndex * step, y: 0, animated: false })
    }
  }, [heroes.length, isCircular, step])

  const comenzarInteraccion = useCallback(() => {
    if (interactionTimeout.current) clearTimeout(interactionTimeout.current)
    setIsInteracting(true)
  }, [])

  const terminarInteraccion = useCallback(() => {
    if (interactionTimeout.current) clearTimeout(interactionTimeout.current)
    interactionTimeout.current = setTimeout(() => setIsInteracting(false), 700)
  }, [])

  useEffect(() => () => {
    if (interactionTimeout.current) clearTimeout(interactionTimeout.current)
  }, [])

  const avanzar = useCallback(() => {
    if (heroes.length <= 5) return
    const nextIndex = physicalIndex.current + 1
    physicalIndex.current = nextIndex
    setAutoplayCycle((cycle) => cycle + 1)
    scrollRef.current?.scrollTo({ x: nextIndex * step, y: 0, animated: true })
  }, [heroes.length, step])

  useEffect(() => {
    if (heroes.length <= 5 || isInteracting || reduceMotion) return
    const timer = setTimeout(avanzar, AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [activeIndex, avanzar, autoplayCycle, heroes.length, isInteracting, reduceMotion])

  if (heroes.length === 0) {
    return (
      <EmptyState
        title="Novedades"
        description="Cuando haya promociones, membresías o empresas nuevas, aparecerán aquí."
        variant="card"
      />
    )
  }

  return (
    <React.Fragment>
      <HorizontalScrollWithFade
        fadeScrollRef={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 16, gap: CARD_GAP }}
        snapToInterval={step}
        decelerationRate="fast"
        scrollEventThrottle={16}
        fadeWidth={0}
        onContentSizeChange={posicionarCarrusel}
        onScroll={(event) => actualizarPosicion(event.nativeEvent.contentOffset.x)}
        onScrollBeginDrag={comenzarInteraccion}
        onScrollEndDrag={terminarInteraccion}
        onMomentumScrollBegin={comenzarInteraccion}
        onMomentumScrollEnd={(event) => {
          actualizarPosicion(event.nativeEvent.contentOffset.x)
          terminarInteraccion()
        }}
      >
        {repeatedHeroes.map((hero, i) => {
          const detalle = datoNovedad(hero)
          return (
            <MarketplaceCard
              variant="flush"
              key={`${hero.tipo}-${hero.id}-${i}`}
              onPress={() => router.push(rnHref(hero.href) as Href)}
              accessibilityLabel={`${etiquetaTipo(hero.tipo)}: ${hero.titulo}, ${hero.empresa}. ${ctaTipo(hero.tipo)}`}
              accessibilityElementsHidden={Math.floor(i / heroes.length) !== accessibleCopy}
              importantForAccessibility={Math.floor(i / heroes.length) === accessibleCopy ? 'auto' : 'no-hide-descendants'}
              aria-hidden={Math.floor(i / heroes.length) !== accessibleCopy}
              tabIndex={Math.floor(i / heroes.length) === accessibleCopy ? 0 : -1}
              className="relative max-w-[340px] overflow-hidden bg-vibe-deep"
              style={{ width: cardWidth, height: 380 }}
            >
              {hero.imagen ? (
                <Image source={{ uri: hero.imagen }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <LinearGradient
                  colors={accent.gradient}
                  locations={accent.gradient.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <LinearGradient
                colors={[...GRAD_OVERLAY]}
                locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View className="relative z-10 flex-1 justify-between p-4 pt-14">
                <Text
                  className="absolute left-4 top-3 overflow-hidden rounded-full px-3 py-1 text-overline font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: accent.gradient[1] }}
                >
                  {etiquetaTipo(hero.tipo)}
                </Text>
                <View>
                  <Text className="text-4xl font-extrabold text-white" style={{ lineHeight: 40 }} numberOfLines={3}>
                    {hero.titulo}
                  </Text>
                  {hero.descripcion ? (
                    <Text className="mt-2 text-sm font-medium text-white" numberOfLines={3}>
                      {hero.descripcion}
                    </Text>
                  ) : null}
                </View>
                <View className="gap-y-3">
                  <View>
                    <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                      {hero.tipo === 'EMPRESA' ? 'Descubre el negocio' : hero.empresa}
                    </Text>
                    {detalle ? (
                      <Text className="mt-1 text-base font-bold text-white" numberOfLines={1}>
                        {detalle}
                      </Text>
                    ) : null}
                  </View>
                  <LinearGradient
                    colors={accent.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <Text className="text-label-sm font-bold text-white">{ctaTipo(hero.tipo)}</Text>
                    <ArrowRight size={16} color={colors.surface.background} />
                  </LinearGradient>
                </View>
              </View>
            </MarketplaceCard>
          )
        })}
      </HorizontalScrollWithFade>

      <Text className="sr-only" accessibilityLiveRegion="polite">
        Novedad {activeIndex + 1} de {heroes.length}
      </Text>
      <React.Fragment>
        <View className="flex-row items-center justify-center gap-1.5 pt-3">
          {heroes.map((hero, i) => (
            <View key={`${hero.tipo}-${hero.id}`} className="overflow-hidden rounded-full">
              {i === activeIndex ? (
                <LinearGradient colors={accent.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 6, width: 24 }} />
              ) : (
                <View className="h-1.5 w-2 rounded-full bg-vibe-lavanda" />
              )}
            </View>
          ))}
        </View>
      </React.Fragment>
    </React.Fragment>
  )
}
