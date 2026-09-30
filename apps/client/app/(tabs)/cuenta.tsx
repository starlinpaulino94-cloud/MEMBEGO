import React, { useMemo } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertCircle,
  ChevronRight,
  Gift,
  LogOut,
  Settings,
  Store,
  TicketPercent,
} from 'lucide-react-native'
import { usePerfil } from '../../src/hooks/usePerfil'
import { useMembresias } from '../../src/hooks/useMembresias'
import { useMisPromociones } from '../../src/hooks/useMisPromociones'
import { useExplorar } from '../../src/hooks/useExplorar'
import { useAuth } from '../../src/lib/auth-context'
import { goBackOr } from '../../src/lib/navigation'
import { Button } from '../../src/components/ui/Button'
import { BackHeader } from '../../src/components/ui/BackHeader'
import { Card } from '../../src/components/ui/Card'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { SectionHeader } from '../../src/components/ui/SectionHeader'
import { CuentaMembresiasSection } from '../../src/components/cliente/CuentaMembresiasSection'
import type { CuentaMembresia } from '../../src/lib/api'
import { colors } from '../../src/theme/tokens'
import { HorizontalScrollWithFade } from '../../src/components/ui/HorizontalScrollWithFade'
import { LinearGradient } from 'expo-linear-gradient'

const TILES = [
  { label: 'Membresías', href: '/mis-membresias' },
  { label: 'Actividad y citas', href: '/citas' },
  { label: 'Mis pagos', href: '/pagos' },
  { label: 'Beneficios', href: '/mis-promociones' },
  { label: 'Vehículos', href: '/vehiculos' },
  { label: 'Historial', href: '/historial' },
  { label: 'Intereses', href: '/intereses' },
] as const

export default function CuentaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, isLoading: authLoading, isAuthenticated, signOut } = useAuth()
  const perfilQuery = usePerfil(isAuthenticated)
  const tieneFicha = Boolean(perfilQuery.data?.cliente)
  const membresiasQuery = useMembresias(isAuthenticated && tieneFicha)
  const beneficiosQuery = useMisPromociones(isAuthenticated && tieneFicha)
  const explorarQuery = useExplorar(undefined, isAuthenticated && tieneFicha)

  const cliente = perfilQuery.data?.cliente
  const membresias = useMemo<readonly CuentaMembresia[]>(
    () => membresiasQuery.data?.membresias ?? [],
    [membresiasQuery.data?.membresias],
  )
  const seguidasIds = explorarQuery.data?.seguidasIds ?? []
  const empresas = useMemo(() => {
    const unicas = new Map<string, CuentaMembresia>()
    for (const membresia of membresias) {
      if (!unicas.has(membresia.companyId)) unicas.set(membresia.companyId, membresia)
    }
    return [...unicas.values()].slice(0, 4)
  }, [membresias])
  const empresasCatalogo = explorarQuery.data?.empresas ?? []
  const comprasActivas = (beneficiosQuery.data?.compras ?? [])
    .filter((compra) => compra.estado === 'ACTIVA' && compra.usosRestantes > 0)
    .slice(0, 5)
  const beneficiosTotal = beneficiosQuery.data?.resumen.activas ?? comprasActivas.length
  const nombre = cliente?.nombre || user?.email?.split('@')[0] || 'Cliente'
  const primerNombre = nombre.split(' ')[0] || 'ti'
  const inicial = nombre.trim().slice(0, 1).toUpperCase()

  if (authLoading) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.vibe.deep} />
        </View>
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        <View className="flex-1 items-center justify-center p-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-vibe-lavanda">
            <Settings size={32} color={colors.vibe.deep} />
          </View>
          <Text className="mb-2 text-center text-xl font-inter-bold text-foreground">
            Inicia sesión para ver tu perfil
          </Text>
          <Text className="mb-6 max-w-xs text-center text-sm text-muted-foreground">
            Gestiona tus membresías, beneficios y negocios favoritos.
          </Text>
          <Button className="bg-vibe-deep" onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
        </View>
      </View>
    )
  }

  if (perfilQuery.isLoading) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.vibe.deep} />
          <Text className="mt-3 text-sm text-muted-foreground">Cargando tu cuenta...</Text>
        </View>
      </View>
    )
  }

  if (perfilQuery.isError) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        <View className="flex-1 justify-center p-4">
          <EmptyState
            icon={<AlertCircle size={36} color="#e7000b" />}
            title="No pudimos cargar tu cuenta"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={<Button variant="outline" onPress={() => void perfilQuery.refetch()}>Reintentar</Button>}
          />
        </View>
      </View>
    )
  }

  if (!cliente) {
    return (
      <View className="flex-1 bg-vibe-fondo">
        <View className="flex-1 justify-center p-4">
          <EmptyState
            icon={<Store size={36} color={colors.vibe.deep} />}
            title="Todavía no tienes una ficha de cliente"
            description="Tu cuenta está lista. Únete a un negocio para ver aquí tus membresías y beneficios."
            action={<Button className="bg-vibe-deep" onPress={() => router.push('/explorar')}>Explorar negocios</Button>}
          />
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-vibe-fondo">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 32 }}
      >
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft">
            <Text className="text-h3 font-inter-bold text-vibe-deep">{inicial}</Text>
          </View>
          <Text className="min-w-0 flex-1 text-h2 font-inter-bold text-foreground" numberOfLines={1}>
            Hola, {primerNombre}
          </Text>
          <Pressable
            onPress={() => router.push('/ajustes')}
            className="h-10 w-10 items-center justify-center rounded-full"
            accessibilityLabel="Configuración de la cuenta"
            accessibilityRole="button"
          >
            <Settings size={20} color="#4b5563" />
          </Pressable>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {TILES.map((tile) => (
            <Card
              key={tile.href}
              onPress={() => router.push(tile.href)}
              accessibilityLabel={tile.label}
              className="min-h-14 flex-1 items-center justify-center bg-primary-100 px-3"
              style={{ minWidth: '46%' }}
            >
              <Text className="text-center text-label-lg text-foreground">{tile.label}</Text>
            </Card>
          ))}
        </View>

        <CuentaMembresiasSection
          membresias={membresias}
          seguidasIds={seguidasIds}
          isLoading={membresiasQuery.isLoading}
          isError={membresiasQuery.isError}
          onRetry={() => void membresiasQuery.refetch()}
        />

        <Card
          className="flex-row items-center justify-between gap-3 p-4"
          gradient={colors.gradient.primary}
        >
          <Gift size={20} color="white" />
          <View className="min-w-0 flex-1">
            <Text className="text-body font-inter-bold text-white">Disfruta visitas y servicios sin límite</Text>
            <Text className="mt-1 text-caption text-white/85">Ahorra en tus negocios favoritos.</Text>
          </View>
          <Button variant="outline" onPress={() => router.push('/planes')}>
            Explorar planes
          </Button>
        </Card>

        {membresiasQuery.isError ? null : (
          <View className="gap-3">
            <SectionHeader
              title="Usar de nuevo"
              action={(
                <Pressable onPress={() => router.push('/empresas')} accessibilityRole="button" className="flex-row items-center gap-1">
                  <Text className="text-label-lg font-inter-semibold text-vibe-deep">Ver empresas</Text>
                  <ChevronRight size={16} color={colors.vibe.deep} />
                </Pressable>
              )}
            />
            {empresas.length === 0 ? (
              <Text className="mt-2 text-small text-muted-foreground">Tus negocios frecuentes aparecerán aquí cuando tengas una membresía.</Text>
            ) : (
              <HorizontalScrollWithFade
                contentContainerClassName="gap-3"
              >
                {empresas.map((m) => {
                  const empresa = empresasCatalogo.find((e) => e.id === m.companyId)
                  const esCarwash = empresa?.type === 'carwash'
                  return (
                    <Card
                      onPress={() => router.push(esCarwash ? '/citas' : `/empresas/${m.companySlug}`)}
                      key={m.companyId}
                      className="flex-1 max-w-[176.288px] justify-between overflow-hidden p-0 gap-2 ">
                      <View className="flex-1 gap-2">
                        <View className="h-24 aspect-video rounded-lg bg-brand-primary-soft">
                          {m.companyLogoUrl ? (
                            <Image source={{ uri: m.companyLogoUrl }} style={{ flex: 1 }} resizeMode="cover" />
                          ) : (
                            <View className="flex-1 items-center justify-center">
                              <Text className="text-h1 font-inter-bold text-vibe-deep">{m.companyName.slice(0, 1).toUpperCase()}</Text>
                            </View>
                          )}
                        </View>

                        <Text className="text-label-lg text-foreground" numberOfLines={1}>{m.companyName}</Text>
                      </View>
                      <View>
                        <LinearGradient
                          colors={colors.gradient.primary}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{ flex: 1, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' }}
                        >
                          <Text className="text-label-sm font-inter-bold text-white">
                            {esCarwash ? 'Pedir turno' : 'Ver negocio'}
                          </Text>
                        </LinearGradient>
                      </View>
                    </Card>
                  )
                })}
              </HorizontalScrollWithFade>
            )}
          </View>
        )}

        <View>
          <SectionHeader
            title="Tus beneficios y cupones"
            action={(
              <Pressable onPress={() => router.push('/mis-promociones')} accessibilityRole="button">
                <Text className="text-label-lg font-inter-semibold text-vibe-deep">Ver todos ({beneficiosTotal})</Text>
              </Pressable>
            )}
          />
          {beneficiosQuery.isLoading ? (
            <View className="mt-3 items-center py-5"><ActivityIndicator color={colors.vibe.deep} /></View>
          ) : beneficiosQuery.isError ? (
            <Card className="mt-3">
              <Text className="text-small text-muted-foreground">No pudimos cargar tus beneficios.</Text>
              <Button variant="outline" className="mt-3 self-start" onPress={() => void beneficiosQuery.refetch()}>
                Reintentar
              </Button>
            </Card>
          ) : comprasActivas.length === 0 ? (
            <Card className="mt-3 flex-row items-center gap-3">
              <TicketPercent size={20} color={colors.vibe.deep} />
              <Text className="flex-1 text-small text-muted-foreground">Sin beneficios activos por ahora.</Text>
            </Card>
          ) : (
            <View className="mt-3 gap-2">
              {comprasActivas.map((compra) => (
                <Card
                  key={compra.id}
                  onPress={() => router.push(`/mis-promociones/${compra.id}`)}
                  accessibilityLabel={`Ver beneficio ${compra.promocion?.titulo ?? ''}`}
                  className="flex-row items-center gap-3 bg-primary-50 p-3"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-lg bg-vibe-lavanda">
                    <TicketPercent size={20} color={colors.vibe.deep} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-small font-inter-semibold text-foreground" numberOfLines={1}>
                      {compra.promocion?.titulo ?? 'Beneficio'}
                    </Text>
                    <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                      {compra.company?.name ?? 'Negocio'} · {compra.usosRestantes} usos disponibles
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#71717a" />
                </Card>
              ))}
            </View>
          )}
        </View>

        <Card
          onPress={() => router.push('/invita-y-gana')}
          accessibilityLabel="Invita amigos y gana recompensas"
          className="flex-row items-center gap-3 bg-primary-100 p-4"
        >
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-brand-primary-soft">
            <Gift size={20} color={colors.vibe.deep} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-small font-inter-bold text-vibe-deep">Invita amigos y gana</Text>
            <Text className="text-caption text-vibe-deep/75">Recompensas por cada invitado que se une.</Text>
          </View>
          <ChevronRight size={16} color={colors.vibe.deep} />
        </Card>

        {explorarQuery.isError ? (
          <Card className="flex-row items-center gap-2">
            <AlertCircle size={16} color="#71717a" />
            <Text className="flex-1 text-caption text-muted-foreground">No pudimos cargar tus empresas seguidas.</Text>
            <Pressable onPress={() => void explorarQuery.refetch()} accessibilityRole="button">
              <Text className="text-label-md font-inter-semibold text-vibe-deep">Reintentar</Text>
            </Pressable>
          </Card>
        ) : null}

        <Pressable
          onPress={async () => {
            await signOut()
            router.replace('/(tabs)/inicio')
          }}
          className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 active:opacity-80"
          accessibilityRole="button"
        >
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
            <LogOut size={20} color="#e7000b" />
          </View>
          <Text className="flex-1 text-small font-inter-bold text-destructive">Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
