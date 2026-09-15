import React from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  AlertCircle,
  Paperclip,
} from 'lucide-react-native'
import { useAuth } from '../../src/lib/auth-context'
import { useTicketAyuda } from '../../src/hooks/useAyuda'
import { Button } from '../../src/components/ui/Button'
import { Card } from '../../src/components/ui/Card'
import { Badge } from '../../src/components/ui/Badge'
import { Skeleton } from '../../src/components/ui/Skeleton'
import type { TicketAyudaResponse } from '../../src/lib/api'

/* ── Helpers ───────────────────────────────────────────────────────────── */

const estadoLabel = (e: string): string =>
  ({
    NUEVO: 'Nuevo',
    EN_PROCESO: 'En proceso',
    ESPERANDO_CLIENTE: 'Esperando cliente',
    RESUELTO: 'Resuelto',
    CERRADO: 'Cerrado',
  } as Record<string, string>)[e] ?? e

const estadoVariant = (
  e: string,
): 'info' | 'warning' | 'default' | 'success' | 'secondary' =>
  ({
    NUEVO: 'info',
    EN_PROCESO: 'warning',
    ESPERANDO_CLIENTE: 'default',
    RESUELTO: 'success',
    CERRADO: 'secondary',
  } as Record<string, 'info' | 'warning' | 'default' | 'success' | 'secondary'>)[
    e
  ] ?? 'secondary'

const categoriaLabel = (c: string): string =>
  ({
    PAGO: 'Pago',
    MEMBRESIA: 'Membresía',
    BENEFICIOS: 'Beneficios',
    APP: 'App',
    OTRO: 'Otro',
  } as Record<string, string>)[c] ?? c

function fmt(d: string): string {
  return new Date(d).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* ── Message Bubble ────────────────────────────────────────────────────── */

function MessageBubble({
  mensaje,
}: {
  mensaje: TicketAyudaResponse['ticket']['mensajes'][number]
}) {
  const isClient = mensaje.autorTipo === 'CLIENTE'

  return (
    <View
      className={isClient ? 'items-end' : 'items-start'}
    >
      <View
        className={
          isClient
            ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3'
            : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3'
        }
      >
        {!isClient && (
          <Text className="text-xs font-inter-semibold text-primary mb-1">
            {mensaje.autorNombre}
          </Text>
        )}
        <Text
          className={
            isClient
              ? 'text-sm text-primary-foreground leading-5'
              : 'text-sm text-foreground leading-5'
          }
        >
          {mensaje.cuerpo}
        </Text>
        <Text
          className={
            isClient
              ? 'text-[10px] text-primary-foreground/70 mt-1'
              : 'text-[10px] text-muted-foreground mt-1'
          }
        >
          {fmt(mensaje.createdAt)}
        </Text>
      </View>
    </View>
  )
}

/* ── Screen ────────────────────────────────────────────────────────────── */

export default function TicketDetalleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useTicketAyuda(
    id,
    isAuthenticated,
  )

  /* ── Auth gate ─────────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-lg font-inter-bold text-foreground mb-4 text-center">
          Inicia sesión para ver este ticket
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  const ticketData = data as TicketAyudaResponse | undefined
  const ticket = ticketData?.ticket

  return (
    <View className="flex-1 bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center gap-2 bg-background border-b border-border"
        style={{
          paddingLeft: insets.left + 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          className="p-2 rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
        <Text
          className="flex-1 text-lg font-inter-bold text-foreground"
          numberOfLines={1}
        >
          Detalle del ticket
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {isLoading ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </View>
        ) : isError || !ticket ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                {isError
                  ? 'No pudimos cargar el ticket.'
                  : 'Ticket no encontrado.'}
              </Text>
              {isError && (
                <Button
                  variant="outline"
                  onPress={() => refetch()}
                  className="mt-4"
                >
                  Reintentar
                </Button>
              )}
            </View>
          </Card>
        ) : (
          <View className="gap-4">
            {/* ── Ticket header ─────────────────────────────────────── */}
            <Card>
              <Text className="font-inter-bold text-lg text-foreground mb-3">
                {ticket.asunto}
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-2">
                <Badge variant={estadoVariant(ticket.estado)}>
                  {estadoLabel(ticket.estado)}
                </Badge>
                {ticket.categoria && (
                  <Badge variant="secondary">
                    {categoriaLabel(ticket.categoria)}
                  </Badge>
                )}
              </View>
              {ticket.empresa && (
                <Text className="text-xs text-muted-foreground">
                  {ticket.empresa.name}
                </Text>
              )}
              {/* Adjunto */}
              {ticket.adjuntoUrl && (
                <Pressable
                  onPress={() => Linking.openURL(ticket.adjuntoUrl!).catch(() => {})}
                  className="flex-row items-center gap-2 mt-3 active:opacity-80"
                  accessibilityRole="link"
                >
                  <Paperclip size={14} color="#0284c7" />
                  <Text className="text-sm text-primary font-inter-medium">
                    Ver adjunto
                  </Text>
                </Pressable>
              )}
            </Card>

            {/* ── Conversación ──────────────────────────────────────── */}
            <Card>
              <Text className="font-inter-semibold text-base text-foreground mb-4">
                Conversación
              </Text>
              {ticket.mensajes.length === 0 ? (
                <Text className="text-sm text-muted-foreground text-center py-4">
                  Aún no hay mensajes en este ticket.
                </Text>
              ) : (
                <View className="gap-3">
                  {ticket.mensajes.map((m) => (
                    <MessageBubble key={m.id} mensaje={m} />
                  ))}
                </View>
              )}
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
