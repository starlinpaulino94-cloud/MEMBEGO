import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Linking,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  HelpCircle,
  MessageCircle,
  Mail,
  Clock,
  Ticket as TicketIcon,
  ChevronRight,
  ChevronDown,
  AlertCircle,
} from 'lucide-react-native'
import { useAuth } from '../src/lib/auth-context'
import { useAyuda } from '../src/hooks/useAyuda'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Badge } from '../src/components/ui/Badge'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Skeleton } from '../src/components/ui/Skeleton'
import { cn } from '../src/lib/cn'
import type { AyudaResponse } from '../src/lib/api'

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

/* ── FAQ Row ───────────────────────────────────────────────────────────── */

function FaqRow({
  pregunta,
  respuesta,
}: {
  pregunta: string
  respuesta: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <View className="border-b border-border/60">
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center justify-between py-4 active:opacity-80"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text className="flex-1 pr-3 font-inter-medium text-sm text-foreground">
          {pregunta}
        </Text>
        {open ? (
          <ChevronDown size={16} color="#6b7280" />
        ) : (
          <ChevronRight size={16} color="#6b7280" />
        )}
      </Pressable>
      {open && (
        <Text className="pb-4 text-sm text-muted-foreground leading-5">
          {respuesta}
        </Text>
      )}
    </View>
  )
}

/* ── Ticket Row ────────────────────────────────────────────────────────── */

function TicketRow({
  ticket,
  onPress,
}: {
  ticket: AyudaResponse['tickets'][number]
  onPress: () => void
}) {
  const teToca = ticket.estado === 'ESPERANDO_CLIENTE'

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 px-4 py-3 active:opacity-80',
        teToca ? 'bg-primary/5' : '',
      )}
      accessibilityRole="button"
    >
      <View className="flex-1 min-w-0">
        <Text
          className="font-inter-medium text-sm text-foreground"
          numberOfLines={1}
        >
          {ticket.asunto}
        </Text>
        <Text
          className="text-xs text-muted-foreground mt-0.5"
          numberOfLines={1}
        >
          {ticket.empresaNombre ?? 'MembeGo'}
        </Text>
      </View>
      {teToca ? (
        <Badge variant="default">Te toca</Badge>
      ) : (
        <Badge variant={estadoVariant(ticket.estado)}>
          {estadoLabel(ticket.estado)}
        </Badge>
      )}
      <ChevronRight size={16} color="#9ca3af" />
    </Pressable>
  )
}

/* ── Screen ────────────────────────────────────────────────────────────── */

export default function AyudaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { data, isLoading, isError, refetch } = useAyuda(isAuthenticated)

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
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/20 mb-4">
          <HelpCircle size={32} color="#0284c7" />
        </View>
        <Text className="text-xl font-inter-bold text-foreground mb-2 text-center">
          Inicia sesión para acceder a la ayuda
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          Contacta con soporte y revisa tus tickets.
        </Text>
        <Button onPress={() => router.push('/(auth)/login')}>
          Iniciar Sesión
        </Button>
      </View>
    )
  }

  const ayuda = data as AyudaResponse | undefined
  const temas = ayuda?.temas ?? []
  const tickets = ayuda?.tickets ?? []
  const contacto = ayuda?.contacto

  const handleWhatsApp = () => {
    const url =
      contacto?.whatsappUrl ??
      'https://wa.me/18090000000?text=Hola%2C%20necesito%20ayuda'
    Linking.openURL(url).catch(() => {})
  }

  const handleCorreo = () => {
    const correo = contacto?.correo ?? 'soporte@membego.com'
    Linking.openURL(`mailto:${correo}?subject=${encodeURIComponent('Soporte')}`).catch(() => {})
  }

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
        <Text className="text-lg font-inter-bold text-foreground">
          Centro de ayuda
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* ── Contacto rápido ───────────────────────────────────────── */}
        <View className="flex-row gap-3 mb-6">
          {/* WhatsApp */}
          <Card className="flex-1">
            <View className="flex-row items-center gap-2 mb-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <MessageCircle size={20} color="#0284c7" />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="font-inter-semibold text-sm text-foreground">
                  WhatsApp
                </Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {contacto?.whatsappNumero ?? 'Contactar'}
                </Text>
              </View>
            </View>
            <Button onPress={handleWhatsApp} size="sm">
              Contactar
            </Button>
          </Card>

          {/* Correo */}
          <Card className="flex-1">
            <View className="flex-row items-center gap-2 mb-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <Mail size={20} color="#6b7280" />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="font-inter-semibold text-sm text-foreground">
                  Correo
                </Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {contacto?.correo ?? 'soporte@membego.com'}
                </Text>
              </View>
            </View>
            <Button onPress={handleCorreo} variant="outline" size="sm">
              Enviar correo
            </Button>
          </Card>
        </View>

        {/* ── Horario ───────────────────────────────────────────────── */}
        {contacto?.horario ? (
          <View className="flex-row items-center gap-2 rounded-xl bg-muted/50 px-4 py-3 mb-6">
            <Clock size={16} color="#6b7280" />
            <Text className="text-xs text-muted-foreground">Horario:</Text>
            <Text className="text-xs font-inter-medium text-foreground">
              {contacto.horario}
            </Text>
          </View>
        ) : null}

        {/* ── Content states ────────────────────────────────────────── */}
        {isLoading ? (
          <View className="gap-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </View>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <View className="py-10 items-center">
              <AlertCircle size={24} color="#e7000b" />
              <Text className="font-inter-medium text-foreground mt-3 text-center">
                No pudimos cargar la ayuda.
              </Text>
              <Button
                variant="outline"
                onPress={() => refetch()}
                className="mt-4"
              >
                Reintentar
              </Button>
            </View>
          </Card>
        ) : (
          <View className="gap-6">
            {/* ── Preguntas frecuentes ──────────────────────────────── */}
            <Card>
              <View className="flex-row items-center gap-2 mb-3">
                <HelpCircle size={16} color="#0284c7" />
                <Text className="font-inter-semibold text-base text-foreground">
                  Preguntas frecuentes
                </Text>
              </View>
              {temas.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  Aún no hay preguntas frecuentes publicadas.
                </Text>
              ) : (
                <View>
                  {temas.map((t) => (
                    <FaqRow
                      key={t.id}
                      pregunta={t.pregunta}
                      respuesta={t.respuesta}
                    />
                  ))}
                </View>
              )}
            </Card>

            {/* ── Mis reportes ──────────────────────────────────────── */}
            <Card className="p-0">
              <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
                <TicketIcon size={16} color="#0284c7" />
                <Text className="font-inter-semibold text-base text-foreground">
                  Mis reportes
                </Text>
              </View>
              {tickets.length === 0 ? (
                <EmptyState
                  icon={<TicketIcon size={24} color="#9ca3af" />}
                  title="Sin reportes"
                  description="Cuando envíes un reporte, aparecerá aquí con su estado."
                  variant="inline"
                />
              ) : (
                <View>
                  {tickets.map((t, i) => (
                    <View
                      key={t.id}
                      className={
                        i === tickets.length - 1
                          ? ''
                          : 'border-b border-border/60'
                      }
                    >
                      <TicketRow
                        ticket={t}
                        onPress={() =>
                          router.push(`/ayuda/${t.id}` as any)
                        }
                      />
                    </View>
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
