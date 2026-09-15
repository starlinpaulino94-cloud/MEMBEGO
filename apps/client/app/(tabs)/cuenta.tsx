import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import {
  Settings,
  QrCode,
  Gift,
  ChevronRight,
  LogOut,
  Car,
} from 'lucide-react-native'
import { usePerfil } from '../../src/hooks/usePerfil'
import { useAuth } from '../../src/lib/auth-context'
import { cn } from '../../src/lib/cn'
import { Button } from '../../src/components/ui/Button'
import { SectionHeader } from '../../src/components/ui/SectionHeader'

type FilterTab = 'todas' | 'favoritos' | 'pases'

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'todas', label: 'Todas mis cuentas' },
  { id: 'favoritos', label: 'Favoritos' },
  { id: 'pases', label: 'Pases a…' },
]

/** "24 sept" — same shape as web fmtFechaCorta. */
function fmtFechaCorta(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  try {
    return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(date)
  } catch {
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
    return `${date.getDate()} ${M[date.getMonth()]}`
  }
}

export default function CuentaScreen() {
  const router = useRouter()
  const { user, isAuthenticated, signOut } = useAuth()
  const { data, isLoading } = usePerfil(isAuthenticated)
  const [filterTab, setFilterTab] = useState<FilterTab>('todas')

  // ── Auth gate ──────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-primary-soft mb-4">
          <Settings size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para ver tu perfil
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Gestiona tus membresías, vehículos asociados y datos personales.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-vibe-fondo">
        <ActivityIndicator size="large" color="#0284c7" />
        <Text className="mt-3 text-sm text-muted-foreground">Cargando tus datos...</Text>
      </View>
    )
  }

  const cliente = data?.cliente
  const memberships = (data?.memberships ?? []) as any[]

  const nombre = cliente?.nombre || user?.email?.split('@')[0] || 'Cliente'
  const primerNombre = nombre.split(' ')[0] || 'ti'
  const iniciales = nombre.trim().slice(0, 1).toUpperCase()

  // ── Filters ────────────────────────────────────────────────────────────
  const ahora = new Date()
  const vigente = (m: any) =>
    m.estado === 'ACTIVA' && (!m.fechaVencimiento || new Date(m.fechaVencimiento) > ahora)

  const activas = memberships.filter(vigente)
  // ponytail: seguidasIds needs a separate endpoint; default to empty until available
  const favoritas = memberships.filter(() => false)
  const visibles =
    filterTab === 'favoritos' ? favoritas : filterTab === 'pases' ? activas : memberships
  const conteos = { todas: memberships.length, favoritos: favoritas.length, pases: activas.length }

  // ── Tiles (accesos rápidos) ───────────────────────────────────────────
  const tiles = [
    { label: 'Membresías', href: '/mis-membresias' },
    { label: 'Actividad y citas', href: '/citas' },
    { label: 'Mis pagos', href: '/pagos' },
    { label: 'Beneficios', href: '/mis-promociones' },
  ]

  // ── Empresas (unique companies from memberships) ──────────────────────
  const empresaMap = new Map<string, any>()
  for (const m of memberships) {
    const id = m.companyId || m.company?.id
    if (id && !empresaMap.has(id)) empresaMap.set(id, m.company)
  }
  const empresas = [...empresaMap.values()]

  return (
    <ScrollView className="flex-1 bg-vibe-fondo" contentContainerStyle={{ padding: 16, gap: 20 }}>
      {/* ── 1. Saludo ─────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft">
          <Text className="text-h3 font-inter-bold text-primary">{iniciales}</Text>
        </View>
        <Text
          className="min-w-0 flex-1 text-h2 font-inter-bold text-foreground"
          numberOfLines={1}
        >
          Hola, {primerNombre}
        </Text>
        <Pressable
          onPress={() => router.push('/ajustes')}
          className="h-10 w-10 items-center justify-center rounded-full"
          accessibilityLabel="Configuración"
          accessibilityRole="button"
        >
          <Settings size={20} color="#4b5563" />
        </Pressable>
      </View>

      {/* ── 2. Grid 2×2 accesos rápidos ──────────────────────────────── */}
      <View className="flex-row flex-wrap gap-2">
        {tiles.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.href as any)}
            className="min-h-14 rounded-lg bg-retail-mist flex-1 items-center justify-center px-3 active:opacity-80"
          >
            <Text className="text-label-lg text-foreground">{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── 3. Chips de filtro (siempre visibles) ────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {TABS.map((t) => {
          const activo = filterTab === t.id
          const n = t.id === 'todas' ? null : conteos[t.id]
          return (
            <Pressable
              key={t.id}
              onPress={() => setFilterTab(t.id)}
              className={cn(
                'min-h-10 shrink-0 rounded-full px-4 items-center justify-center active:opacity-80',
                activo ? 'bg-retail-deep' : 'border border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-label-lg',
                  activo ? 'font-inter-semibold text-white' : 'text-muted-foreground',
                )}
              >
                {t.label}
                {n !== null ? ` (${n})` : ''}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* ── 4. Tus membresías ────────────────────────────────────────── */}
      <View>
        <SectionHeader
          title="Tus membresías"
          className="px-1"
          action={
            <Pressable onPress={() => router.push('/mis-membresias')}>
              <Text className="text-label-lg font-inter-semibold text-primary">
                Ver todas ({memberships.length})
              </Text>
            </Pressable>
          }
        />
        {visibles.length === 0 ? (
          <View className="mt-3 rounded-lg border border-border bg-card p-6 items-center">
            <QrCode size={40} color="#0284c7" />
            <Text className="mt-3 text-h3 font-inter-bold text-foreground text-center">
              {filterTab === 'todas' ? 'Aún no tienes membresías' : 'Nada aquí con este filtro'}
            </Text>
            <Text className="mt-1 text-small text-muted-foreground text-center">
              Al suscribirte a un negocio, tus pases aparecen aquí.
            </Text>
          </View>
        ) : (
          <View className="mt-3 gap-3">
            {visibles.map((m: any) => {
              const ok = vigente(m)
              const companyName: string = m.company?.name || m.companyName || 'Negocio'
              const planNombre: string = m.plan?.nombre || m.planNombre || 'Plan'
              const lavadosRestantes = m.lavadosRestantes ?? 0
              const lavadosIncluidos = m.plan?.lavadosIncluidos ?? m.lavadosIncluidos ?? '—'
              const esIlimitado = m.plan?.esIlimitado ?? false
              const fechaVenc = m.fechaVencimiento ? fmtFechaCorta(m.fechaVencimiento) : null

              return (
                <View key={m.id} className="rounded-lg border border-border bg-card p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1 min-w-0">
                      {/* Status dot + label */}
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <View
                          className={cn(
                            'h-2 w-2 rounded-full',
                            ok ? 'bg-success' : 'bg-muted-foreground/50',
                          )}
                        />
                        <Text
                          className={cn(
                            'text-label-md',
                            ok ? 'font-inter-semibold text-success' : 'text-muted-foreground',
                          )}
                        >
                          {ok ? 'ACTIVO' : m.estado}
                        </Text>
                        {fechaVenc && (
                          <Text className="text-label-md text-muted-foreground">
                            · Renueva {fechaVenc}
                          </Text>
                        )}
                      </View>
                      {/* Company name */}
                      <Text
                        className="mt-1 text-h3 font-inter-bold text-foreground"
                        numberOfLines={1}
                      >
                        {companyName}
                      </Text>
                      {/* Plan + uses */}
                      <Text className="text-caption text-muted-foreground">
                        Plan {planNombre} ·{' '}
                        {esIlimitado
                          ? 'usos ilimitados'
                          : `${lavadosRestantes} de ${lavadosIncluidos} disponibles`}
                      </Text>
                    </View>
                    {/* Company icon */}
                    <View className="h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-retail-mist">
                      <Car size={24} color="#0284c7" />
                    </View>
                  </View>
                  {/* QR bar */}
                  <View className="mt-3 flex-row items-center justify-between rounded-lg bg-retail-mist p-2 pl-3">
                    <View className="flex-row items-center gap-2 min-w-0">
                      <QrCode size={16} color="#0284c7" />
                      <Text
                        className="text-label-md font-inter-semibold text-foreground"
                        numberOfLines={1}
                      >
                        Pase digital listo
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => router.push(`/(tabs)/qr?id=${m.id}`)}
                      className="shrink-0 rounded-full bg-retail-deep px-4 py-2 active:opacity-90"
                    >
                      <Text className="text-label-md font-inter-semibold text-white">
                        Ver QR y uso
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      {/* ── 5. Banner comercial ──────────────────────────────────────── */}
      <View className="flex-row items-center justify-between gap-3 rounded-lg bg-retail-deep p-4">
        <View className="flex-1 min-w-0">
          <Text className="text-body font-inter-bold text-white">
            Disfruta visitas y servicios sin límite
          </Text>
          <Text className="mt-0.5 text-caption text-white/85" numberOfLines={1}>
            Ahorra hasta un 40% en tus locales favoritos
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/planes')}
          className="shrink-0 rounded-full bg-card min-h-10 items-center justify-center px-4 active:opacity-90"
        >
          <Text className="text-label-md font-inter-bold text-primary">Explorar planes</Text>
        </Pressable>
      </View>

      {/* ── 6. Usar de nuevo ─────────────────────────────────────────── */}
      {empresas.length > 0 && (
        <View>
          <SectionHeader
            title="Usar de nuevo"
            className="px-1"
            action={
              <Pressable onPress={() => router.push('/empresas')}>
                <Text className="text-label-lg font-inter-semibold text-primary">
                  Visitar frecuentes
                </Text>
              </Pressable>
            }
          />
          <View className="mt-3 flex-row flex-wrap gap-3">
            {empresas.slice(0, 4).map((e: any, i: number) => {
              const name: string = e.name || 'Negocio'
              const initial = name.slice(0, 1).toUpperCase()
              return (
                <View key={e.id || i} className="rounded-lg border border-border bg-card overflow-hidden" style={{ width: '48%' }}>
                  <View className="aspect-[16/10] items-center justify-center bg-brand-primary-soft">
                    <Text className="text-h1 font-inter-bold text-primary">{initial}</Text>
                  </View>
                  <View className="p-3">
                    <Text className="text-label-lg text-foreground" numberOfLines={1}>
                      {name}
                    </Text>
                    <Pressable
                      onPress={() => router.push('/citas')}
                      className="mt-2 min-h-10 items-center justify-center rounded-full border border-primary active:bg-brand-primary-soft"
                    >
                      <Text className="text-label-md font-inter-bold text-primary">
                        Pedir turno rápido
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        </View>
      )}

      {/* ── 7. Tus beneficios y cupones ──────────────────────────────── */}
      <View>
        <SectionHeader
          title="Tus beneficios y cupones"
          className="px-1"
          action={
            <Pressable onPress={() => router.push('/mis-promociones')}>
              <Text className="text-label-lg font-inter-semibold text-primary">
                Ver todos (0)
              </Text>
            </Pressable>
          }
        />
        <View className="mt-2 rounded-lg border border-border bg-card p-4">
          <Text className="text-small text-muted-foreground">
            Sin beneficios activos por ahora.
          </Text>
        </View>
      </View>

      {/* ── 8. Invita amigos y gana ──────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/invita-y-gana')}
        className="flex-row items-center gap-3 rounded-lg bg-brand-primary-soft p-4 active:opacity-80"
      >
        <View className="h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card">
          <Gift size={20} color="#0284c7" />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-small font-inter-bold text-retail-deep" numberOfLines={1}>
            Invita amigos y gana
          </Text>
          <Text className="text-label-md text-retail-deep/75" numberOfLines={1}>
            Recompensas por cada invitado que se une
          </Text>
        </View>
        <ChevronRight size={16} color="#0369a1" />
      </Pressable>

      {/* ── 9. Cerrar sesión ─────────────────────────────────────────── */}
      <Pressable
        onPress={async () => {
          await signOut()
          router.replace('/(tabs)/inicio')
        }}
        className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 active:opacity-80"
      >
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
          <LogOut size={20} color="#e7000b" />
        </View>
        <Text className="flex-1 text-small font-inter-bold text-destructive">Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  )
}
