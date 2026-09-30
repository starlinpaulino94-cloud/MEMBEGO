import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import {
  ArrowLeft,
  ArrowRightLeft,
  Sparkles,
  Zap,
  Calendar,
  Check,
  Clock,
  CreditCard,
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
import { colors } from '../src/theme/tokens'
import type {
  PlanPublic,
  PlanGlobalItem,
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

export function PlanCard({
  plan,
  destacado,
  onPress,
  className,
  mostrarNegocio = true,
}: {
  plan: PlanPublic | PlanGlobalItem | PlanEmpresaItem
  destacado: boolean
  onPress: () => void
  className?: string
  mostrarNegocio?: boolean
}) {
  const { base, variante } = parseNombre(plan.nombre)
  const precioPorUso =
    !plan.esIlimitado && plan.lavadosIncluidos && plan.lavadosIncluidos > 0
      ? Math.round(plan.precio / plan.lavadosIncluidos)
      : null

  return (
    <Card
      className={cn(
        'p-5 flex-col justify-between',
        className,
        destacado && 'border-2 border-primary bg-primary/[0.02]',
      )}
    >
      <View>

        {mostrarNegocio && 'company' in plan && (
          <View className="mb-3 flex-row items-center gap-2">
            {plan.company.logoUrl ? (
              <Image
                source={{ uri: plan.company.logoUrl }}
                accessibilityLabel={`Logo de ${plan.company.name}`}
                className="h-7 w-7 rounded-full"
              />
            ) : (
              <View className="h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                <Store size={14} color={colors.primary.DEFAULT} />
              </View>
            )}
            <Text className="text-small font-inter-semibold text-muted-foreground">
              {plan.company.name}
            </Text>
          </View>
        )}

        {/* Badge "Recomendado" para el destacado */}
        {destacado && (
          <View className="mb-3 self-start">
            <Badge variant="default" className="flex-row border-primary bg-primary">
              Recomendado
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
      </View>

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

const PENDIENTE_PAGO_ESTADOS = new Set(['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'])

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
  const { width } = useWindowDimensions()
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError, refetch } = usePlanes(
    { todos: 1 },
    isAuthenticated,
  )
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [planesSeleccionados, setPlanesSeleccionados] = useState<Record<string, string>>({})
  const isDesktop = width >= 1024
  const isTablet = width >= 768 && width < 1024
  const isPlanGrid = isTablet || isDesktop

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
  const gruposDeNegocios = data?.modo === 'global'
    ? agruparPlanesPorNegocio(data.planes)
    : []
  const destacadoIdx = planes.length > 1 ? 1 : 0
  const activePlanId = planes.some((plan) => plan.id === selectedPlanId)
    ? selectedPlanId
    : planes[0]?.id ?? ''
  const context = data?.modo === 'empresa' ? data.cliente : null
  const membership = context?.membership ?? null
  const pendingPayment = membership && PENDIENTE_PAGO_ESTADOS.has(membership.estado)
    ? membership
    : null
  const pendingChange = membership?.estado === 'ACTIVA' && membership.planIdSolicitado
    ? membership
    : null

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}>
        <View className="mb-6">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="min-w-0 flex-1 text-overline font-inter-semibold text-primary">
              Membresías · Todos los negocios
            </Text>
            <Pressable
              onPress={() => router.push('/mis-membresias')}
              className="min-h-10 flex-row items-center rounded-full px-2 active:bg-muted"
              accessibilityRole="button"
            >
              <Store size={15} color={colors.surface.mutedForeground} />
              <Text className="ml-1 text-caption text-muted-foreground">Mis membresías</Text>
            </Pressable>
            {context && (
              <View className="flex-row items-center gap-1">
                <Pressable
                  onPress={() => router.push('/mis-membresias')}
                  className="min-h-10 flex-row items-center rounded-full px-2 active:bg-muted"
                  accessibilityRole="button"
                >
                  <ArrowLeft size={15} color={colors.surface.mutedForeground} />
                  <Text className="ml-1 text-caption text-muted-foreground">Mis membresías</Text>
                </Pressable>
              </View>
            )}
          </View>
          <Text className="mt-2 text-h2 font-inter-bold text-foreground">
            Planes para cada negocio
          </Text>
          <Text className="mt-1.5 text-small leading-relaxed text-muted-foreground">
            Compara las opciones disponibles y encuentra los planes de cada negocio.
          </Text>
        </View>

        {pendingPayment && (
          <View className="mb-4 flex-row items-center gap-3 rounded-xl border border-warning/25 bg-warning/10 p-4">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-warning/15">
              <Clock size={18} color={colors.state.warning} />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-h4 font-inter-semibold text-foreground">
                Plan {pendingPayment.plan.nombre} pendiente de pago
              </Text>
              <Text className="mt-0.5 text-small text-muted-foreground">
                {pendingPayment.estado === 'RECHAZADA'
                  ? 'Tu comprobante fue rechazado. Envía uno nuevo para activarlo.'
                  : 'Sube tu comprobante para que el equipo active tu membresía.'}
              </Text>
            </View>
            <Button
              size="sm"
              className="shrink-0 rounded-full"
              icon={<CreditCard size={15} color={colors.surface.background} />}
              onPress={() => router.push(`/membresia/${pendingPayment.id}`)}
            >
              Completar pago
            </Button>
          </View>
        )}

        {pendingChange && (
          <View className="mb-4 flex-row items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <ArrowRightLeft size={18} color={colors.primary.DEFAULT} />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-h4 font-inter-semibold text-foreground">
                Cambio a {pendingChange.planSolicitado?.nombre ?? 'otro plan'} solicitado
              </Text>
              <Text className="mt-0.5 text-small text-muted-foreground">
                Sube el comprobante del nuevo plan para completar el cambio.
              </Text>
            </View>
          </View>
        )}

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
        {!isLoading && !isError && data?.modo === 'global' && gruposDeNegocios.length > 0 && (
          <View className="gap-6">
            {gruposDeNegocios.map(({ company, planes: planesDelNegocio }) => {
              const planSeleccionado = planesDelNegocio.find(
                (plan) => plan.id === planesSeleccionados[company.id],
              ) ?? planesDelNegocio[0]
              const indiceSeleccionado = planesDelNegocio.findIndex(
                (plan) => plan.id === planSeleccionado.id,
              )

              return (
                <View key={company.id} className="gap-3">
                  <Card className="flex-row items-center gap-3 border-border bg-card p-4">
                    {company.logoUrl ? (
                      <Image
                        source={{ uri: company.logoUrl }}
                        accessibilityLabel={`Logo de ${company.name}`}
                        className="h-12 w-12 rounded-xl bg-muted"
                      />
                    ) : (
                      <View className="h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <Store size={22} color={colors.primary.DEFAULT} />
                      </View>
                    )}
                    <View className="min-w-0 flex-1">
                      <Text className="text-h3 font-inter-bold text-foreground" numberOfLines={1}>
                        {company.name}
                      </Text>
                      <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={1}>
                        {company.ciudad ? `${company.ciudad} · ` : ''}
                        {planesDelNegocio.length} {planesDelNegocio.length === 1 ? 'plan' : 'planes'}
                      </Text>
                    </View>
                  </Card>

                  {isPlanGrid ? (
                    <View
                      className="gap-4"
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'stretch',
                      }}
                    >
                      {planesDelNegocio.map((plan, index) => (
                        <View
                          key={plan.id}
                          className="flex"
                          style={{
                            width: isDesktop ? '32%' : '48%',
                            minWidth: 0,
                            flexGrow: 0,
                            flexShrink: 0,
                          }}
                        >
                          <PlanCard
                            plan={plan}
                            destacado={index === (planesDelNegocio.length > 1 ? 1 : 0)}
                            mostrarNegocio={false}
                            onPress={() => router.push(`/planes/${plan.id}`)}
                            className="flex-1"
                          />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View className="gap-3">
                      {planesDelNegocio.length > 1 && (
                        <View className="rounded-xl bg-retail-mist p-1.5">
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ width: '100%' }}
                            contentContainerStyle={{ gap: 6, flexGrow: 1 }}
                            accessibilityRole="radiogroup"
                            accessibilityLabel={`Planes de ${company.name}`}
                          >
                            {planesDelNegocio.map((plan) => {
                              const seleccionado = plan.id === planSeleccionado.id
                              const { base, variante } = parseNombre(plan.nombre)

                              return (
                                <Pressable key={plan.id} style={{ flexGrow: 1 }}
                                  onPress={() => setPlanesSeleccionados((actuales) => ({
                                    ...actuales,
                                    [company.id]: plan.id,
                                  }))}
                                  className={cn(
                                    'min-h-11 flex-row items-center justify-center rounded-lg px-4',
                                    seleccionado && 'bg-card',
                                  )}
                                  accessibilityRole="radio"
                                  accessibilityLabel={`${plan.nombre}, ${formatMoney(plan.precio)}`}
                                  accessibilityState={{ checked: seleccionado }}
                                >
                                  <Text
                                    className={cn(
                                      'text-label-lg font-inter-semibold',
                                      seleccionado ? 'text-foreground' : 'text-muted-foreground',
                                    )}
                                    numberOfLines={1}
                                  >
                                    {variante ?? base}
                                  </Text>
                                </Pressable>
                              )
                            })}
                          </ScrollView>
                        </View>
                      )}

                      <PlanCard
                        plan={planSeleccionado}
                        destacado={indiceSeleccionado === (planesDelNegocio.length > 1 ? 1 : 0)}
                        mostrarNegocio={false}
                        onPress={() => router.push(`/planes/${planSeleccionado.id}`)}
                      />
                    </View>
                  )}
                </View>
              )
            })}

            <View className="mt-2 items-center gap-2">
              <View className="flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <TrustItem text="Pago verificado por el equipo" />
                <TrustItem text="Tu QR se activa al aprobarse" />
                <TrustItem text="Sin contratos ni permanencia" />
              </View>
            </View>
          </View>
        )}

        {!isLoading && !isError && data?.modo === 'empresa' && planes.length > 0 && (
          <View>
            {planes.length > 1 && !isPlanGrid && (
              <View className="mb-5 flex-row gap-1.5 rounded-xl bg-retail-mist p-1.5">
                {planes.map((plan) => {
                  const { base, variante } = parseNombre(plan.nombre)
                  const active = activePlanId === plan.id
                  return (
                    <Pressable
                      key={plan.id}
                      onPress={() => setSelectedPlanId(plan.id)}
                      className={cn(
                        'min-h-10 flex-1 items-center justify-center rounded-lg px-3',
                        active ? 'bg-card shadow-sm' : 'bg-transparent',
                      )}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                    >
                      <Text className={cn('text-label-lg font-inter-semibold', active ? 'text-foreground' : 'text-muted-foreground')}>
                        {variante ?? base}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            )}
            <View className="gap-5">
              <View
                className="gap-5"
                style={isPlanGrid
                  ? {
                    flexDirection: 'row',
                    flexWrap: isTablet ? 'wrap' : 'nowrap',
                    alignItems: 'stretch',
                  }
                  : undefined}
              >
                {planes.map((plan, idx) => {
                  const visible = isPlanGrid || activePlanId === plan.id

                  return (
                    <View
                      key={plan.id}
                      className={visible ? 'flex' : 'hidden'}
                      style={isPlanGrid
                        ? {
                          width: isDesktop ? '32%' : '48%',
                          minWidth: 0,
                          flexGrow: 0,
                          flexShrink: 0,
                        }
                        : undefined}
                    >
                      <PlanCard
                        plan={plan}
                        destacado={idx === destacadoIdx}
                        onPress={() => router.push(`/planes/${plan.id}`)}
                        className="flex-1"
                      />
                    </View>
                  )
                })}
              </View>

              {/* Confianza */}
              <View className="mt-4 items-center gap-2">
                <View className="flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2">
                  <TrustItem text="Pago verificado por el equipo" />
                  <TrustItem text="Tu QR se activa al aprobarse" />
                  <TrustItem text="Sin contratos ni permanencia" />
                </View>
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

function agruparPlanesPorNegocio(planes: readonly PlanGlobalItem[]) {
  const grupos = new Map<string, { company: PlanGlobalItem['company']; planes: PlanGlobalItem[] }>()

  for (const plan of planes) {
    const grupo = grupos.get(plan.company.id)
    if (grupo) {
      grupo.planes.push(plan)
    } else {
      grupos.set(plan.company.id, { company: plan.company, planes: [plan] })
    }
  }

  return [...grupos.values()].sort((a, b) => a.company.name.localeCompare(b.company.name, 'es'))
}
