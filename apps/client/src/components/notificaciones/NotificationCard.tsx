import React from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CreditCard,
  Gift,
  Tag,
  Trash2,
  Ticket,
} from 'lucide-react-native'
import { formatDateTime } from '../../lib/format'
import type { NotificacionCliente } from '../../lib/api'
import { Card } from '../ui/Card'
import { colors } from '../../theme/tokens'

function NotificationTypeIcon({ tipo }: { readonly tipo: string }) {
  const normalized = tipo.toLocaleUpperCase()
  const iconProps = { size: 20, color: colors.primary.DEFAULT }

  if (normalized.includes('MEMBRESIA') || normalized.includes('PAGO') || normalized.includes('PLAN')) {
    return <CreditCard {...iconProps} />
  }
  if (normalized.includes('PROMO') || normalized.includes('BENEFICIO')) {
    return <Tag {...iconProps} />
  }
  if (normalized.includes('CITA') || normalized.includes('RESERVA')) {
    return <CalendarDays {...iconProps} />
  }
  if (normalized.includes('EXCURSION')) return <Ticket {...iconProps} />
  if (normalized.includes('REGALO')) return <Gift {...iconProps} />
  return <Bell {...iconProps} />
}

interface NotificationCardProps {
  readonly notification: NotificacionCliente
  readonly onPress: () => void
  /** Eliminar este aviso de la bandeja. */
  readonly onDelete?: () => void
}

export function NotificationCard({ notification, onPress, onDelete }: NotificationCardProps) {
  return (
    <Card
      className={notification.leida ? 'p-4' : 'border-primary/30 bg-primary/5 p-4'}
      onPress={onPress}
      accessibilityLabel={
        notification.titulo +
        '. ' +
        notification.mensaje +
        (notification.leida
          ? ''
          : (notification.mensaje.endsWith('.') ? ' ' : '. ') + 'Sin leer')
      }
    >
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <NotificationTypeIcon tipo={notification.tipo} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text className="flex-1 text-sm font-inter-semibold text-foreground">
              {notification.titulo}
            </Text>
            {notification.leida ? null : (
              <View
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                accessibilityLabel="Sin leer"
              />
            )}
          </View>
          <Text className="text-sm leading-5 text-muted-foreground">
            {notification.mensaje}
          </Text>
          <View className="mt-1 flex-row items-center justify-between gap-2">
            <Text className="text-xs text-muted-foreground">
              {formatDateTime(notification.createdAt)}
            </Text>
            <View className="flex-row items-center gap-1">
              {onDelete ? (
                <Pressable
                  onPress={onDelete}
                  hitSlop={8}
                  className="min-h-9 min-w-9 items-center justify-center rounded-full"
                  accessibilityRole="button"
                  accessibilityLabel={'Eliminar notificación: ' + notification.titulo}
                >
                  <Trash2 size={16} color={colors.surface.mutedForeground} />
                </Pressable>
              ) : null}
              <ChevronRight size={16} color={colors.surface.mutedForeground} />
            </View>
          </View>
        </View>
      </View>
    </Card>
  )
}
