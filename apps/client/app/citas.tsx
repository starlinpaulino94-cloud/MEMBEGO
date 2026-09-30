import React, { useState, useMemo } from 'react'
import { ResponsiveDetailSheet } from '../src/components/ui/ResponsiveDetailSheet'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  CalendarDays,
  CalendarX2,
  Clock,
  AlertCircle,
  Gift,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { goBackOr } from '../src/lib/navigation'
import { BackHeader } from '../src/components/ui/BackHeader'
import { useCitas } from '../src/hooks/useCitas'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { EmptyState } from '../src/components/ui/EmptyState'
import { CitaEstadoBadge } from '../src/components/citas/CitaEstadoBadge'
import { CancelarCitaButton } from '../src/components/citas/CancelarCitaButton'
import { ReservarCita } from '../src/components/citas/ReservarCita'
import { cn } from '../src/lib/cn'
import type { CitaItem } from '../src/lib/api'

// ── Date helpers (port from web src/modules/citas/disponibilidad.ts) ────────

/** "YYYY-MM-DD" de un instante visto en la zona horaria dada. */
function ymdEnTz(instante: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instante)
  } catch {
    return instante.toISOString().slice(0, 10)
  }
}

/** "HH:MM" de un instante visto en la zona horaria dada. */
function hmEnTz(instante: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).format(instante)
  } catch {
    const h = String(instante.getUTCHours()).padStart(2, '0')
    const m = String(instante.getUTCMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }
}

/** Etiqueta corta de un ymd para chips de dia ("lun 20 jul"). */
function etiquetaDia(ymd: string, timeZone: string, idioma = 'es-DO'): string {
  try {
    // Construir una fecha en mediodia local para evitar ambiguedades de borde
    const [y, mo, d] = ymd.split('-').map(Number)
    const instante = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
    return new Intl.DateTimeFormat(idioma, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(instante)
  } catch {
    return ymd
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACTIVAS = ['PENDIENTE', 'CONFIRMADA']

// ── Screen ──────────────────────────────────────────────────────────────────

function CitasScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated } = useAuth()
  const params = useLocalSearchParams<{ fecha?: string; compra?: string }>()

  // Fecha seleccionada (local state, initialized from URL param)
  const [fechaSel, setFechaSel] = useState<string | null>(params.fecha ?? null)

  // Fetch citas (pass fechaSel to get availability for that day)
  const { data, isLoading, isError, refetch } = useCitas(
    fechaSel ?? undefined,
    isAuthenticated,
  )

  // Derived data
  const citas = data?.citas ?? []
  const agenda = data?.agenda ?? null
  const dias = data?.dias ?? []
  const disponibilidad = data?.disponibilidad ?? null
  const vehiculos = data?.vehiculos ?? []
  const empresa = data?.empresa

  // Filter open days (etiquetaCerrado is truthy when closed)
  const diasAbiertos = useMemo(
    () => dias.filter((d) => !d.etiquetaCerrado),
    [dias],
  )

  // Resolve selected date: use fechaSel if valid, otherwise first open day
  const fechaResuelta =
    fechaSel && diasAbiertos.some((d) => d.ymd === fechaSel)
      ? fechaSel
      : (diasAbiertos[0]?.ymd ?? null)

  // Split citas into proximas and historial
  const ahora = new Date()
  const proximas = useMemo(
    () =>
      citas
        .filter((c) => ACTIVAS.includes(c.estado) && new Date(c.inicio) >= ahora)
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [citas],
  )
  const historial = useMemo(
    () => citas.filter((c) => !proximas.includes(c)).slice(0, 10),
    [citas, proximas],
  )

  // Compra param (for redeem banner)
  const compraId = params.compra ?? null

  // ── Auth gate ───────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <CalendarDays size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesion para ver tus citas
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Reserva tu turno y gestiona tus citas.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesion
        </Button>
      </View>
    )
  }

  // ── Back bar ────────────────────────────────────────────────────────────
  const BackBar = (
    <BackHeader
      title="Mis citas"
      leftInset={insets.left}
      onBack={() => goBackOr(router, '/(tabs)/inicio')}
    />
  )

  // ── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {BackBar}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0284c7" />
        </View>
      </View>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {BackBar}
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar tus citas.
              </Text>
              <Button variant="outline" onPress={() => refetch()} className="mt-4">
                Reintentar
              </Button>
            </View>
          </Card>
        </ScrollView>
      </View>
    )
  }

  // ── Empty: no agenda activa ─────────────────────────────────────────────
  if (!agenda?.activa) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {BackBar}
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <EmptyState
            icon={<CalendarX2 size={40} color="#9ca3af" />}
            title="Aun no hay citas en linea"
            description={`${empresa?.name ?? 'El negocio'} todavia no activo las reservas desde la app. Vuelve pronto.`}
          />
        </ScrollView>
      </View>
    )
  }

  // ── Empty: no open days ─────────────────────────────────────────────────
  if (diasAbiertos.length === 0) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        {BackBar}
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <EmptyState
            icon={<CalendarX2 size={40} color="#9ca3af" />}
            title="Sin dias disponibles"
            description="El negocio no tiene horarios abiertos en los proximos dias."
          />
        </ScrollView>
      </View>
    )
  }

  const tz = empresa?.zonaHoraria ?? 'America/Santo_Domingo'

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-vibe-fondo">
      {BackBar}

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View className="mb-6">
          <Text className="text-xs font-inter-bold uppercase tracking-[0.22em] text-primary">
            Citas · {empresa?.name ?? ''}
          </Text>
          <Text className="mt-2 text-3xl font-inter-extrabold tracking-tight text-foreground">
            Reserva tu turno
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            Elige el dia y la hora que te convengan; te esperamos sin filas.
          </Text>
        </View>

        {/* Banner de canje */}
        {compraId && (
          <View className="rounded-2xl border border-success/30 bg-success/10 p-4 mb-6">
            <View className="flex-row items-center gap-2">
              <Gift size={16} color="#00864d" />
              <Text className="text-sm font-inter-semibold text-foreground">
                Estas agendando tu recompensa GRATIS
              </Text>
            </View>
            <Text className="mt-1 text-sm text-muted-foreground">
              Elige el dia y la hora en que vendras. Al confirmar la cita, el QR
              de tu recompensa quedara habilitado para presentarlo ese dia.
            </Text>
          </View>
        )}

        {/* Selector de dia */}
        <View className="mb-4">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
          >
            {diasAbiertos.map((d) => {
              const isActive = d.ymd === fechaResuelta
              return (
                <Pressable
                  key={d.ymd}
                  onPress={() => setFechaSel(d.ymd)}
                  className={cn(
                    'shrink-0 rounded-xl border px-3.5 py-2',
                    isActive
                      ? 'border-foreground bg-foreground'
                      : 'border-border/70 bg-card',
                  )}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    className={cn(
                      'text-sm font-inter-semibold capitalize',
                      isActive ? 'text-background' : 'text-foreground',
                    )}
                  >
                    {etiquetaDia(d.ymd, tz)}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>

        {/* Turnos del dia */}
        {disponibilidad && fechaResuelta && (
          <View className="mb-8">
            <ReservarCita
              fecha={fechaResuelta}
              etiquetaFecha={etiquetaDia(fechaResuelta, tz)}
              slots={disponibilidad.slots}
              vehiculos={vehiculos}
              limiteDiaAlcanzado={disponibilidad.limiteDiaAlcanzado}
              notas={agenda.notas ?? null}
              compraId={compraId}
              compraTitulo={null}
            />
          </View>
        )}

        {/* Proximas citas */}
        {proximas.length > 0 && (
          <View className="mb-8">
            <View className="flex-row items-center gap-2 mb-3">
              <CalendarDays size={20} color="#0284c7" />
              <Text className="text-lg font-inter-bold text-foreground">
                Proximas citas
              </Text>
            </View>
            <View className="gap-3">
              {proximas.map((c) => (
                <CitaCard key={c.id} cita={c} tz={tz} />
              ))}
            </View>
          </View>
        )}

        {/* Historial */}
        {historial.length > 0 && (
          <View className="mb-8">
            <View className="flex-row items-center gap-2 mb-3">
              <Clock size={16} color="#71717a" />
              <Text className="text-sm font-inter-semibold text-muted-foreground">
                Historial
              </Text>
            </View>
            <Card className="p-0">
              {historial.map((c, index) => (
                <View
                  key={c.id}
                  className={cn(
                    'flex-row items-center justify-between gap-3 px-4 py-3',
                    index < historial.length - 1 && 'border-b border-border/50',
                  )}
                >
                  <Text className="flex-1 text-sm capitalize text-foreground/80">
                    {etiquetaDia(ymdEnTz(new Date(c.inicio), c.company.zonaHoraria), c.company.zonaHoraria)}{' '}
                    · {hmEnTz(new Date(c.inicio), c.company.zonaHoraria)}
                    <Text className="ml-1.5 text-muted-foreground">
                      {c.company.name}
                    </Text>
                  </Text>
                  <CitaEstadoBadge estado={c.estado} />
                </View>
              ))}
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

// ── CitaCard ────────────────────────────────────────────────────────────────

function CitaCard({ cita, tz }: { cita: CitaItem; tz: string }) {
  const citaTz = cita.company.zonaHoraria || tz
  return (
    <Card className="flex-row flex-wrap items-center justify-between gap-3">
      <View className="flex-1 min-w-0">
        <Text className="font-inter-semibold capitalize text-foreground">
          {etiquetaDia(ymdEnTz(new Date(cita.inicio), citaTz), citaTz)} ·{' '}
          {hmEnTz(new Date(cita.inicio), citaTz)}
        </Text>
        <Text className="mt-0.5 text-sm text-muted-foreground" numberOfLines={2}>
          {cita.company.name}
          {cita.vehiculo ? ` · ${cita.vehiculo.marca} ${cita.vehiculo.modelo}` : null}
          {cita.servicio ? ` · ${cita.servicio}` : null}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        <CitaEstadoBadge estado={cita.estado} />
        <CancelarCitaButton citaId={cita.id} />
      </View>
    </Card>
  )
}

export default function CitasScreen() {
  return (
    <ResponsiveDetailSheet>
      <CitasScreenContent />
    </ResponsiveDetailSheet>
  )
}
