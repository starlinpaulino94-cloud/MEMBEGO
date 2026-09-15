import React from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  Sparkles,
  Zap,
  Calendar,
  Check,
  Store,
  Car,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { usePlanes } from '../src/hooks/usePlanes'
import { formatMoney } from '../src/lib/format'
import { cn } from '../src/lib/cn'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import type {
  PlanPublic,
  PlanEmpresaItem,
  PlanesResponse,
} from '../src/lib/api'

/* ── Helpers ───────────────────────────────────────────────────────────── */

/**
 * "PLAN SILVER (SUV PEQ)" → { base: "Plan Silver", variante: "SUV PEQ" }.
 * Mismo parseo que el web PlanesGrid.
 */
function parseNombre(nombre: string): { base: string; variante: string | null } {
  const m = nombre.match(/^(.*?)\s*[([](.+?)[)\]]\s*$/)
  if (!m) return { base: titleCase(nombre), variante: null }
  return { base: titleCase(m[1].trim()), variante: m[2].trim() }
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
}

/** ponytail: no hay endpoint de compra en el BFF aún. F4 candidate. */
function handleComprar(_planId: string) {
  // ponytail: F4 — agregar POST /api/v1/cliente/membresias/crear cuando
  // el BFF exponga la acción de selección de plan. Por ahora, noop.
}

/* ── PlanCard ──────────────────────────────────────────────────────────── */

function PlanCard({
  plan,
  destacado,
  onPress,
}: {
  plan: PlanPublic | PlanEmpresaItem
  destacado: boolean
  onPress: () => void
}) {
  const { base, variante } = parseNombre(plan.nombre)
  const precioPorUso =
    !plan.esIlimitado && plan.lavadosIncluidos && plan.lavadosIncluidos > 0
      ? Math.round(plan.precio / plan.lavadosIncluidos)
      : null

  return (
    <Card
      className={cn(
        'p-5',
        destacado && 'border-primary bg-primary/[0.02]',
      )}
    >
      {/* Badge "Recomendado" para el destacado */}
      {destacado && (
        <View className="mb-3 self-start">
          <Badge variant="default">
            <Sparkles size={12} color="#ffffff" />
            <Text className="ml-1 text-xs font-inter-semibold text-primary-foreground">
              Recomendado
            </Text>
          </Badge>
        </View>
      )}

      {/* Nombre + variante */}
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-h3 font-inter-bold text-foreground">{base}</Text>
        {variante && (
          <Badge variant="secondary">{variante}</Badge>
        )}
        {plan.esIlimitado && (
          <Badge variant="secondary">Ilimitado</Badge>
        )}
      </View>

      {/* Precio */}
      <View className="mt-3 items-baseline flex-row gap-1.5">
        <Text className="text-h1 font-inter-extrabold tabular-nums text-foreground">
          {formatMoney(plan.precio)}
        </Text>
        <Text className="text-small font-inter-medium text-muted-foreground">
          /mes
        </Text>
      </View>
      {precioPorUso != null && (
        <Text className="mt-1 text-caption text-muted-foreground">
          Equivale a {formatMoney(precioPorUso)} por uso
        </Text>
      )}

      {/* Usos + vigencia */}
      <View className="mt-4 flex-row gap-3 rounded-xl bg-retail-mist p-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          <View className="h-8 w-8 items-center justify-center rounded-lg bg-card">
            <Zap size={16} color="#0284c7" />
          </View>
          <View>
            <Text className="text-small font-inter-bold text-foreground">
              {plan.esIlimitado ? 'Ilimitados' : plan.lavadosIncluidos ?? '—'}
            </Text>
            <Text className="text-caption text-muted-foreground">
              usos incluidos
            </Text>
          </View>
        </View>
        <View className="flex-1 flex-row items-center gap-2.5">
          <View className="h-8 w-8 items-center justify-center rounded-lg bg-card">
            <Calendar size={16} color="#0284c7" />
          </View>
          <View>
            <Text className="text-small font-inter-bold text-foreground">
              {plan.vigenciaDias} días
            </Text>
            <Text className="text-caption text-muted-foreground">
              de vigencia
            </Text>
          </View>
        </View>
      </View>

      {/* Descripción */}
      {plan.descripcion && (
        <Text className="mt-4 text-small leading-relaxed text-foreground/75">
          {plan.descripcion}
        </Text>
      )}

      {/* Beneficios */}
      {plan.beneficios && plan.beneficios.length > 0 && (
        <View className="mt-4">
          <Text className="mb-2 text-overline font-inter-semibold text-muted-foreground">
            BENEFICIOS
          </Text>
          {plan.beneficios.map((b) => (
            <View key={b} className="mb-2 flex-row items-start gap-2.5">
              <View className="mt-0.5">
                <Check size={16} color="#00864d" />
              </View>
              <Text className="flex-1 text-small leading-relaxed text-foreground/80">
                {b}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Condiciones (solo modo empresa) */}
      {'condiciones' in plan && plan.condiciones && (
        <View className="mt-4">
          <Text className="mb-1 text-overline font-inter-semibold text-muted-foreground">
            CONDICIONES
          </Text>
          <Text className="text-caption leading-relaxed text-muted-foreground">
            {plan.condiciones}
          </Text>
        </View>
      )}

      {/* CTA */}
      <View className="mt-5">
        <Button
          variant={destacado ? 'default' : 'outline'}
          className="w-full rounded-full"
          onPress={onPress}
        >
          {destacado ? 'Aprovechar' : 'Suscribirse'}
        </Button>
      </View>
    </Card>
  )
}

/* ── Loading skeletons ─────────────────────────────────────────────────── */

function PlanCardSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="mb-3 h-6 w-3/5" />
      <Skeleton className="mt-2 h-8 w-2/5" />
      <Skeleton className="mt-4 h-16 w-full rounded-xl" />
      <View className="mt-4 gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </View>
      <Skeleton className="mt-5 h-10 w-full rounded-full" />
    </Card>
  )
}

/* ── Screen ────────────────────────────────────────────────────────────── */

export default function PlanesScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError, refetch } = usePlanes(undefined, isAuthenticated)

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-primary/20">
          <Sparkles size={32} color="#0284c7" />
        </View>
        <Text className="mb-2 text-center text-xl font-inter-bold text-foreground">
          Inicia sesión para ver los planes
        </Text>
        <Text className="mb-6 max-w-xs text-center text-sm text-muted-foreground">
          Elige o cambia tu plan de membresía.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  const planes = getPlanesFromResponse(data)
  const destacadoIdx = planes.length > 1 ? 1 : 0

  return (
    <View className="flex-1 bg-background">
      {/* ── Barra con back + título ──────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 border-b border-border bg-background"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          className="rounded-lg p-2 active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">Planes</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <View className="mb-6">
          <Text className="text-overline font-inter-semibold text-primary">
            Membresías
          </Text>
          <Text className="mt-2 text-h1 font-inter-extrabold tracking-tight text-foreground">
            Elige tu plan ideal
          </Text>
          <Text className="mt-1.5 text-small text-muted-foreground leading-relaxed">
            Paga menos por lo que ya haces. Aquí tienes cada plan con todos
            sus detalles para decidir con calma.
          </Text>
        </View>

        {/* ── Aviso vitrina / requiere vehículo (modo empresa) ──────── */}
        {data && data.modo === 'empresa' && data.requiereVehiculo && data.vitrina && (
          <Card className="mb-4 flex-row items-center gap-3 border-border bg-card p-4">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-retail-mist">
              <Car size={18} color="#0284c7" />
            </View>
            <Text className="flex-1 text-small text-muted-foreground">
              Registra tu vehículo para ver el precio exacto de tu categoría
              y comprar en línea.
            </Text>
          </Card>
        )}

        {/* ── Error ──────────────────────────────────────────────────── */}
        {isError && (
          <EmptyState
            icon={<Sparkles size={40} color="#0284c7" />}
            title="No pudimos cargar los planes"
            description="Intenta más tarde."
            action={
              <Button variant="outline" onPress={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        )}

        {/* ── Loading ────────────────────────────────────────────────── */}
        {isLoading && !isError && (
          <View className="gap-5">
            <PlanCardSkeleton />
            <PlanCardSkeleton />
          </View>
        )}

        {/* ── Empty (cargó pero sin planes) ──────────────────────────── */}
        {!isLoading && !isError && planes.length === 0 && (
          <EmptyState
            icon={<Sparkles size={40} color="#0284c7" />}
            title="Sin planes disponibles"
            description="Aún no hay planes de membresía publicados. Vuelve pronto."
            action={
              <Button variant="outline" onPress={() => router.push('/mis-membresias')}>
                Volver a mis membresías
              </Button>
            }
          />
        )}

        {/* ── Lista de planes ────────────────────────────────────────── */}
        {!isLoading && !isError && planes.length > 0 && (
          <View className="gap-5">
            {planes.map((plan, idx) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                destacado={idx === destacadoIdx}
                onPress={() => handleComprar(plan.id)}
              />
            ))}

            {/* Confianza */}
            <View className="mt-4 items-center gap-2">
              <View className="flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <TrustItem text="Pago verificado por el equipo" />
                <TrustItem text="Tu QR se activa al aprobarse" />
                <TrustItem text="Sin contratos ni permanencia" />
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

/* ── TrustItem ─────────────────────────────────────────────────────────── */

function TrustItem({ text }: { text: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Check size={14} color="#00864d" />
      <Text className="text-caption text-muted-foreground">{text}</Text>
    </View>
  )
}

/* ── Data extraction ───────────────────────────────────────────────────── */

function getPlanesFromResponse(
  data: PlanesResponse | undefined,
): Array<PlanPublic | PlanEmpresaItem> {
  if (!data) return []
  return data.planes
}
