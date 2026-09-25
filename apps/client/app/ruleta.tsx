import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import Svg, { Path, Text as SvgText, G, Circle, Line } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { goBackOr } from '../src/lib/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Sparkles,
  Trophy,
  History,
  RotateCw,
  Gift,
  PartyPopper,
  AlertCircle,
  Lock,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useRuleta, useGirarRuleta } from '../src/hooks/useRuleta'
import { formatDate } from '../src/lib/format'
import { cn } from '../src/lib/cn'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Badge } from '../src/components/ui/Badge'

/* ── Constants ─────────────────────────────────────────────────────────── */

const PALETA = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6',
]

const WHEEL_SIZE = Dimensions.get('window').width < 380 ? 280 : 310
const SPIN_DURATION = 3500

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtFecha(iso: string) {
  return formatDate(new Date(iso), undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** SVG arc path for a pie sector from center. */
function sectorPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = {
    x: cx + r * Math.cos(startAngle),
    y: cy + r * Math.sin(startAngle),
  }
  const end = {
    x: cx + r * Math.cos(endAngle),
    y: cy + r * Math.sin(endAngle),
  }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return [
    `M ${cx},${cy}`,
    `L ${start.x},${start.y}`,
    `A ${r},${r} 0 ${largeArc} 1 ${end.x},${end.y}`,
    'Z',
  ].join(' ')
}

/* ── RuletaWheel ───────────────────────────────────────────────────────── */

interface Premio {
  id: string
  nombre: string
  tipo: 'PROMOCION' | 'NADA'
  color: string
}

interface GiroResult {
  gano: boolean
  premioNombre: string
  premioId?: string
  saldoRestante?: number
}

function RuletaWheel({
  premios,
  costo,
  saldo,
  onGirar,
  spinning,
  resultado,
}: {
  premios: Premio[]
  costo: number
  saldo: number
  onGirar: () => void
  spinning: boolean
  resultado: GiroResult | null
}) {
  const rotation = useSharedValue(0)
  const [localResultado, setLocalResultado] = useState<GiroResult | null>(null)
  const n = premios.length
  const seg = n > 0 ? (2 * Math.PI) / n : 2 * Math.PI
  const cx = WHEEL_SIZE / 2
  const cy = WHEEL_SIZE / 2
  const r = WHEEL_SIZE / 2 - 8

  const puedeGirar = saldo >= costo && n > 0 && !spinning

  // When result arrives from parent, animate wheel to the winning sector
  useEffect(() => {
    if (!resultado || n === 0) return
    const k = premios.findIndex((p) => p.id === resultado.premioId)
    const idx = k >= 0 ? k : 0
    // Target: bring sector center to top (pointer at -PI/2)
    const targetAngle = -(idx * seg + seg / 2) - Math.PI / 2
    const currentMod = ((rotation.value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const delta = ((targetAngle - currentMod) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    const vueltas = 5 * 2 * Math.PI
    rotation.value = withTiming(rotation.value + vueltas + delta, {
      duration: SPIN_DURATION,
      easing: Easing.out(Easing.cubic),
    })
    // Show result modal after animation
    const t = setTimeout(() => setLocalResultado(resultado), SPIN_DURATION + 100)
    return () => clearTimeout(t)
  }, [resultado]) // eslint-disable-line react-hooks/exhaustive-deps

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}rad` }],
  }))

  const sectors = useMemo(() => {
    if (n === 0) return null
    return premios.map((p, k) => {
      const startAngle = k * seg - Math.PI / 2
      const endAngle = startAngle + seg
      const midAngle = startAngle + seg / 2
      const textR = r * 0.62
      const tx = cx + textR * Math.cos(midAngle)
      const ty = cy + textR * Math.sin(midAngle)
      const textRotation = (midAngle * 180) / Math.PI + 90
      const displayName = p.nombre.length > 14 ? p.nombre.slice(0, 12) + '…' : p.nombre
      return (
        <G key={p.id}>
          <Path
            d={sectorPath(cx, cy, r, startAngle, endAngle)}
            fill={premios[k]?.color || PALETA[k % PALETA.length]}
            stroke="#ffffff"
            strokeWidth={2}
          />
          <SvgText
            x={tx}
            y={ty}
            fill="#ffffff"
            fontSize={11}
            fontWeight="bold"
            textAnchor="middle"
            alignmentBaseline="middle"
            rotate={textRotation}
          >
            {displayName}
          </SvgText>
        </G>
      )
    })
  }, [premios, n, seg, cx, cy, r]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View className="items-center gap-5">
      {/* Wheel container */}
      <View style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
        {/* Pointer */}
        <View className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 12,
              borderRightWidth: 12,
              borderTopWidth: 22,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: '#1e293b',
            }}
          />
        </View>

        {/* Spinning wheel */}
        <Animated.View style={[{ width: WHEEL_SIZE, height: WHEEL_SIZE }, animatedStyle]}>
          <Svg width={WHEEL_SIZE} height={WHEEL_SIZE}>
            {n === 0 ? (
              <Circle cx={cx} cy={cy} r={r} fill="#e2e8f0" />
            ) : (
              sectors
            )}
            {/* Outer ring */}
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeWidth={6}
            />
          </Svg>
        </Animated.View>

        {/* Center hub */}
        <View
          className="absolute left-1/2 top-1/2 z-10 items-center justify-center rounded-full bg-slate-800"
          style={{
            width: 52,
            height: 52,
            marginLeft: -26,
            marginTop: -26,
            borderWidth: 4,
            borderColor: '#ffffff',
          }}
        >
          <Sparkles size={22} color="#ffffff" />
        </View>
      </View>

      {/* Saldo + botón */}
      <View className="items-center gap-2">
        <Text className="text-sm text-muted-foreground">
          Saldo:{' '}
          <Text className="font-inter-bold text-foreground">
            {saldo.toLocaleString('es-DO')}
          </Text>{' '}
          pts · Costo por giro:{' '}
          <Text className="font-inter-bold text-foreground">{costo}</Text>{' '}
          pts
        </Text>
        <Button
          onPress={onGirar}
          disabled={!puedeGirar}
          size="xl"
          loading={spinning}
          className="min-w-[200px]"
          icon={!spinning ? <RotateCw size={18} color="#ffffff" /> : undefined}
        >
          {spinning
            ? 'Girando…'
            : saldo >= costo
              ? 'Girar la ruleta'
              : `Te faltan ${costo - saldo} pts`}
        </Button>
      </View>

      {/* Result modal */}
      <Modal
        visible={localResultado !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLocalResultado(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/60 p-6"
          onPress={() => setLocalResultado(null)}
        >
          <Pressable
            className="w-full max-w-sm rounded-2xl bg-card p-6 items-center"
            onPress={(e) => e.stopPropagation?.()}
          >
            <View
              className={cn(
                'mb-4 h-20 w-20 items-center justify-center rounded-full',
                localResultado?.gano ? 'bg-success/15' : 'bg-muted',
              )}
            >
              {localResultado?.gano ? (
                <PartyPopper size={36} color="#00864d" />
              ) : (
                <Gift size={36} color="#71717a" />
              )}
            </View>
            <Text className="text-h2 font-inter-bold text-foreground">
              {localResultado?.gano ? '¡Ganaste!' : '¡Casi!'}
            </Text>
            <Text className="mt-1.5 text-lg font-inter-bold text-foreground">
              {localResultado?.premioNombre}
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              {localResultado?.gano
                ? 'Tu premio ya está en tu wallet con su código QR. Preséntalo en el negocio.'
                : 'No te desanimes, sigue participando para ganar tu premio.'}
            </Text>
            <Button
              onPress={() => setLocalResultado(null)}
              className="mt-5 w-full"
              size="lg"
            >
              {localResultado?.gano ? 'Ver mi premio' : 'Seguir'}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

/* ── GamificacionCard ──────────────────────────────────────────────────── */

function GamificacionCard({
  gamificacion,
  color,
}: {
  gamificacion: {
    puntos: number
    saldo: number
    nivel: { nivel: number; nombre: string; color: string }
    siguiente: { nombre: string; min: number } | null
    progreso: number
    faltan: number
    logros: unknown[]
  }
  color?: string
}) {
  const { nivel, puntos, siguiente, progreso, faltan, logros } = gamificacion
  const accent = color || '#0ea5e9'
  const logrosArr = logros as Array<{
    id: string
    nombre: string
    desbloqueado: boolean
    icono: string
    objetivo: number
    valor: number
  }>
  const desbloqueados = logrosArr.filter((l) => l.desbloqueado).length

  return (
    <Card className="overflow-hidden p-0">
      {/* Header gradient */}
      <LinearGradient
        className="p-5"
        colors={[nivel.color, `${nivel.color}bb`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Trophy size={24} color="#ffffff" />
            </View>
            <View>
              <Text className="text-xs font-inter-semibold uppercase tracking-wider text-white/80">
                Nivel {nivel.nivel}
              </Text>
              <Text className="text-xl font-inter-extrabold text-white">
                {nivel.nombre}
              </Text>
            </View>
          </View>
          <View className="items-end">
            <Text className="text-2xl font-inter-extrabold text-white tabular-nums">
              {puntos.toLocaleString('es-DO')}
            </Text>
            <Text className="text-xs font-inter-semibold uppercase tracking-wider text-white/80">
              puntos
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View className="mt-4">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-xs font-inter-medium text-white/85">
              {siguiente ? `Rumbo a ${siguiente.nombre}` : '¡Nivel máximo!'}
            </Text>
            {siguiente && (
              <Text className="text-xs font-inter-medium text-white/85">
                Faltan {faltan.toLocaleString('es-DO')} pts
              </Text>
            )}
          </View>
          <View className="h-2.5 overflow-hidden rounded-full bg-white/25">
            <View
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.min(100, progreso)}%` }}
            />
          </View>
        </View>
      </LinearGradient>

      {/* Logros */}
      {logrosArr.length > 0 && (
        <View className="p-4">
          <View className="mb-2 flex-row items-center gap-1.5">
            <Trophy size={16} color="#f59e0b" />
            <Text className="text-sm font-inter-semibold text-foreground">
              Tus logros
            </Text>
            <Text className="ml-auto text-xs text-muted-foreground">
              {desbloqueados}/{logrosArr.length}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-3">
            {logrosArr.map((logro) => (
              <View
                key={logro.id}
                className={cn(
                  'w-20 items-center gap-1.5',
                  !logro.desbloqueado && 'opacity-55',
                )}
              >
                <View
                  className={cn(
                    'h-12 w-12 items-center justify-center rounded-2xl',
                    logro.desbloqueado
                      ? 'bg-warning'
                      : 'border border-dashed border-border bg-muted/40',
                  )}
                >
                  <Sparkles
                    size={20}
                    color={logro.desbloqueado ? '#ffffff' : '#71717a'}
                  />
                  {!logro.desbloqueado && (
                    <View className="absolute -bottom-1 -right-1 h-4 w-4 items-center justify-center rounded-full bg-muted">
                      <Lock size={8} color="#71717a" />
                    </View>
                  )}
                </View>
                <Text
                  className="text-center text-xs font-inter-semibold leading-tight text-foreground"
                  numberOfLines={2}
                >
                  {logro.nombre}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </Card>
  )
}

/* ── Main screen ───────────────────────────────────────────────────────── */

export default function RuletaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  const { data, isLoading, isError, refetch } = useRuleta(isAuthenticated)
  const girar = useGirarRuleta()

  const [resultado, setResultado] = useState<GiroResult | null>(null)

  const handleGirar = useCallback(() => {
    girar.mutate(undefined, {
      onSuccess: (res) => {
        if (res.ok) {
          setResultado({
            gano: !!res.gano,
            premioNombre: res.premioNombre ?? '',
            premioId: res.premioId,
            saldoRestante: res.saldoRestante,
          })
        } else {
          // Error from business logic
          setResultado(null)
        }
      },
    })
  }, [girar])

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="mb-5 h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles size={32} color="#0284c7" />
        </View>
        <Text className="mb-2 text-center text-h2 font-inter-bold text-foreground">
          Ruleta de premios
        </Text>
        <Text className="mb-6 text-center text-small text-muted-foreground">
          Inicia sesión para girar la ruleta y ganar premios.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#0284c7" size="large" />
      </View>
    )
  }

  /* ── Error ─────────────────────────────────────────────────────────── */
  if (isError || !data) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-3 px-4 pb-3">
          <Pressable onPress={() => goBackOr(router, '/(tabs)/beneficios')} className="p-2">
            <ArrowLeft size={20} color="#71717a" />
          </Pressable>
          <Text className="text-h2 font-inter-bold text-foreground">
            Ruleta de premios
          </Text>
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<AlertCircle size={32} color="#e7000b" />}
            title="No pudimos cargar la ruleta"
            description="Verifica tu conexión e intenta de nuevo."
            action={
              <Button onPress={() => refetch()} variant="outline">
                Reintentar
              </Button>
            }
          />
        </View>
      </View>
    )
  }

  const { saldo, costo, premios, jugadas, gamificacion, color } = data

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      style={{ paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-4 pb-3">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => goBackOr(router, '/(tabs)/beneficios')} className="p-2">
            <ArrowLeft size={20} color="#71717a" />
          </Pressable>
          <Text className="text-h2 font-inter-bold text-foreground">
            Ruleta de premios
          </Text>
        </View>
      </View>

      <View className="px-4">
        {/* Title section */}
        <View className="mb-5 flex-row items-center gap-2">
          <Sparkles size={22} color="#0284c7" />
          <Text className="text-h1 font-inter-extrabold tracking-tight text-foreground">
            Ruleta de premios
          </Text>
        </View>
        <Text className="mb-5 text-small text-muted-foreground">
          Gana puntos usando tus beneficios e invitando amigos, y cámbialos
          por premios reales.
        </Text>

        {/* Gamification card */}
        {gamificacion && (
          <View className="mb-5">
            <GamificacionCard gamificacion={gamificacion} color={color} />
          </View>
        )}

        {/* Wheel or empty */}
        {premios.length === 0 ? (
          <EmptyState
            icon={<Trophy size={40} color="#71717a" />}
            title="Aún no hay premios"
            description="Este negocio todavía no configuró su ruleta. ¡Vuelve pronto!"
          />
        ) : (
          <Card className="p-5">
            <RuletaWheel
              premios={premios}
              costo={costo}
              saldo={saldo}
              onGirar={handleGirar}
              spinning={girar.isPending}
              resultado={resultado}
            />
          </Card>
        )}

        {/* History */}
        {jugadas.length > 0 && (
          <View className="mt-6">
            <View className="mb-3 flex-row items-center gap-1.5">
              <History size={16} color="#71717a" />
              <Text className="text-sm font-inter-semibold text-foreground">
                Tus últimos giros
              </Text>
            </View>
            <Card className="p-0">
              {jugadas.map((j, idx) => (
                <View
                  key={j.id}
                  className={cn(
                    'flex-row items-center justify-between gap-3 px-4 py-3',
                    idx < jugadas.length - 1 && 'border-b border-border/60',
                  )}
                >
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-sm font-inter-medium text-foreground"
                      numberOfLines={1}
                    >
                      {j.premioNombre}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {fmtFecha(j.createdAt)}
                    </Text>
                  </View>
                  <Badge variant={j.gano ? 'success' : 'secondary'}>
                    {j.gano ? 'Ganaste' : 'Sigue participando'}
                  </Badge>
                </View>
              ))}
            </Card>
          </View>
        )}
      </View>
    </ScrollView>
  )
}
