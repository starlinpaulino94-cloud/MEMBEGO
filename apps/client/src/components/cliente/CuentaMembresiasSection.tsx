import React, { useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight, QrCode, Store } from 'lucide-react-native'
import type { CuentaMembresia } from '../../lib/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { SectionHeader } from '../ui/SectionHeader'
import { colors } from '../../theme/tokens'
import { HorizontalScrollWithFade } from '../ui/HorizontalScrollWithFade'

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'favoritas', label: 'Favoritas' },
  { id: 'activas', label: 'Activas' },
  { id: 'vencidas', label: 'Vencidas' },
] as const

type FiltroCuenta = (typeof FILTERS)[number]['id']

interface CuentaMembresiasSectionProps {
  readonly membresias: readonly CuentaMembresia[]
  readonly seguidasIds: readonly string[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly onRetry: () => void
}

function estaVigente(m: CuentaMembresia, ahora: number): boolean {
  return m.estado === 'ACTIVA' && (!m.fechaVencimiento || Date.parse(m.fechaVencimiento) > ahora)
}

function estaVencida(m: CuentaMembresia, ahora: number): boolean {
  return m.estado === 'VENCIDA' || Boolean(m.fechaVencimiento && Date.parse(m.fechaVencimiento) <= ahora)
}

function fechaCorta(fecha: string | null): string | null {
  if (!fecha) return null
  const parsed = new Date(fecha)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(parsed)
}

export function CuentaMembresiasSection({
  membresias,
  seguidasIds,
  isLoading,
  isError,
  onRetry,
}: CuentaMembresiasSectionProps) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<FiltroCuenta>('todas')
  const seguidas = new Set(seguidasIds)
  const [ahora] = useState(() => Date.now())
  const porFiltro: Record<FiltroCuenta, readonly CuentaMembresia[]> = {
    todas: membresias,
    favoritas: membresias.filter((m) => seguidas.has(m.companyId)),
    activas: membresias.filter((m) => estaVigente(m, ahora)),
    vencidas: membresias.filter((m) => estaVencida(m, ahora)),
  }
  const visibles = porFiltro[filtro]

  return (
    <View>
      <HorizontalScrollWithFade
        contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
      >
        {FILTERS.map((item) => {
          const selected = item.id === filtro
          return (
            <Pressable
              key={item.id}
              onPress={() => setFiltro(item.id)}
              className={selected
                ? 'min-h-10 flex-row items-center rounded-full bg-primary px-4'
                : 'min-h-10 flex-row items-center rounded-full border border-border bg-card px-4'}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Text className={selected ? 'text-label-lg text-white' : 'text-label-lg text-muted-foreground'}>
                {item.label}
              </Text>
              <Text className={selected ? 'ml-1 text-label-lg text-white' : 'ml-1 text-label-lg text-muted-foreground'}>
                ({porFiltro[item.id].length})
              </Text>
            </Pressable>
          )
        })}
      </HorizontalScrollWithFade>

      <View className="mt-4">
        <SectionHeader
          title="Tus membresías"
          action={(
            <Pressable onPress={() => router.push('/mis-membresias')} accessibilityRole="button" className="flex-row items-center gap-1">
              <Text className="text-label-lg font-inter-semibold text-primary">Ver todas</Text>
              <ChevronRight size={16} color={colors.primary.DEFAULT} />
            </Pressable>
          )}
        />
        {isLoading ? (
          <View className="mt-3 items-center py-6"><ActivityIndicator color={colors.primary.DEFAULT} /></View>
        ) : isError ? (
          <Card className="mt-3">
            <Text className="text-small text-muted-foreground">No pudimos cargar tus membresías.</Text>
            <Button variant="outline" className="mt-3 self-start" onPress={onRetry}>Reintentar</Button>
          </Card>
        ) : visibles.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<QrCode size={28} color={colors.primary.DEFAULT} />}
            title={filtro === 'todas' ? 'Aún no tienes membresías' : 'Nada aquí con este filtro'}
            description="Al suscribirte a un negocio, tus pases aparecerán aquí."
            action={<Button onPress={() => router.push('/planes')}>Explorar planes</Button>}
          />
        ) : (
          <View className="mt-3 gap-3">
            {visibles.map((m) => {
              const vigente = estaVigente(m, ahora)
              const vencida = estaVencida(m, ahora)
              const vencimiento = fechaCorta(m.fechaVencimiento)
              const estadoVisible = vigente ? 'ACTIVA' : vencida ? 'VENCIDA' : m.estado
              return (
                <Card key={m.id}>
                  <View className="flex-row items-start gap-3">
                    <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-brand-primary-soft">
                      {m.companyLogoUrl ? (
                        <Image source={{ uri: m.companyLogoUrl }} className="h-full w-full" resizeMode="cover" />
                      ) : (
                        <Store size={20} color={colors.primary.DEFAULT} />
                      )}
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Badge variant={vigente ? 'success' : m.estado.startsWith('PENDIENTE') ? 'warning' : 'secondary'}>
                          {estadoVisible.replace(/_/g, ' ')}
                        </Badge>
                        {vencimiento ? <Text className="text-caption text-muted-foreground">{vencida ? 'Venció' : 'Vence'} {vencimiento}</Text> : null}
                      </View>
                      <Text className="mt-1 text-h3 font-inter-semibold text-foreground" numberOfLines={1}>
                        {m.companyName}
                      </Text>
                      <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                        Plan {m.planNombre} · {m.planEsIlimitado
                          ? 'usos ilimitados'
                          : `${m.lavadosRestantes ?? 0} de ${m.planLavadosIncluidos ?? '—'} disponibles`}
                      </Text>
                    </View>
                  </View>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onPress={() => router.push(`/membresia/${m.id}`)}
                    icon={<QrCode size={16} color={colors.primary.DEFAULT} />}
                  >
                    Ver QR y uso
                  </Button>
                </Card>
              )
            })}
          </View>
        )}
      </View>
    </View>
  )
}
