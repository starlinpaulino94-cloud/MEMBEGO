import React from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ShieldCheck } from 'lucide-react-native'
import { useAuth } from '../../lib/auth-context'
import { useIdentidadPanel } from '../../hooks/useIdentidad'
import type { TonoIdentidad } from '../../lib/api'
import { colors } from '../../theme/tokens'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

const BADGE: Record<TonoIdentidad, 'success' | 'warning' | 'info' | 'secondary' | 'destructive'> = {
  exito: 'success',
  aviso: 'warning',
  info: 'info',
  neutro: 'secondary',
  peligro: 'destructive',
}

/**
 * El resumen de la verificación de identidad dentro de Configuración: el estado y un botón a su pantalla (`/identidad`).
 * Es lo único que Configuración sabe del tema. Si el panel no carga o la verificación no se ofrece (apagada y sin historial),
 * no se pinta nada: es opcional y no debe estorbar a Configuración.
 */
export function ResumenIdentidad() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const { data: panel } = useIdentidadPanel(isAuthenticated)
  if (!panel?.visible) return null
  const { vista } = panel
  const quiereAccion = vista.accion === 'verificar' || vista.accion === 'continuar' || vista.accion === 'reintentar'
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <ShieldCheck size={16} color={colors.surface.mutedForeground} />
        <Text className="flex-1 text-h4 font-inter-semibold text-foreground">Verificación de identidad</Text>
        <Badge variant={BADGE[vista.tono]}>{vista.etiqueta}</Badge>
      </View>
      <Text className="text-small text-muted-foreground">{vista.titulo}</Text>
      <Button variant={quiereAccion ? 'default' : 'outline'} onPress={() => router.push('/identidad')}>
        {quiereAccion ? (vista.textoAccion ?? 'Verificar') : 'Ver detalles'}
      </Button>
    </Card>
  )
}
