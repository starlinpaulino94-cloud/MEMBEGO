import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { AlertTriangle, X, ShieldAlert, Check } from 'lucide-react-native'
import { api, type ReportarResenaBody } from '../../lib/api'
import { colors } from '../../theme/tokens'
import { Button } from '../ui/Button'

interface Props {
  readonly visible: boolean
  readonly resena: { id: string; clienteNombre: string; comment: string | null } | null
  readonly companySlug: string
  readonly onClose: () => void
  readonly onReportSuccess: (resenaId: string) => void
  readonly onBlockAuthor?: (clienteNombre: string) => void
}

const MOTIVOS: Array<{ key: ReportarResenaBody['motivo']; label: string; desc: string }> = [
  { key: 'OFENSIVO', label: 'Contenido ofensivo', desc: 'Lenguaje inapropiado o vulgar' },
  { key: 'ACOSO', label: 'Acoso o difamación', desc: 'Insultos personales o ataques' },
  { key: 'SPAM', label: 'Spam o publicidad', desc: 'Promoción comercial o contenido repetitivo' },
  { key: 'ENGANOSO', label: 'Información falsa', desc: 'Reseña fraudulenta o engañosa' },
  { key: 'OTRO', label: 'Otro motivo', desc: 'Incumple las normas de la comunidad' },
]

export function ReportarResenaModal({
  visible,
  resena,
  companySlug,
  onClose,
  onReportSuccess,
  onBlockAuthor,
}: Props) {
  const [motivo, setMotivo] = useState<ReportarResenaBody['motivo']>('OFENSIVO')
  const [detalle, setDetalle] = useState('')
  const [bloquearUsuario, setBloquearUsuario] = useState(false)
  const [enviando, setEnviando] = useState(false)

  if (!resena) return null

  const handleEnviar = async () => {
    setEnviando(true)
    try {
      await api.reportarResena({
        resenaId: resena.id,
        companySlug,
        motivo,
        detalle: detalle.trim() || undefined,
      })

      if (bloquearUsuario && onBlockAuthor) {
        onBlockAuthor(resena.clienteNombre)
      }

      onReportSuccess(resena.id)
      onClose()
      Alert.alert(
        'Reporte recibido',
        'Gracias por ayudarnos a mantener una comunidad segura. Revisaremos este contenido en un plazo máximo de 24 horas y tomaremos las acciones correspondientes.'
      )
    } catch (error) {
      Alert.alert(
        'No se pudo enviar el reporte',
        error instanceof Error ? error.message : 'Intenta de nuevo en unos minutos.'
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/60 px-4">
        <View className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center justify-between pb-3 border-b border-border">
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle size={18} color="#ef4444" />
              </View>
              <Text className="text-base font-inter-bold text-foreground">
                Reportar reseña
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Cerrar modal"
            >
              <X size={20} color={colors.surface.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Subtitle & review excerpt */}
          <Text className="mt-3 text-xs text-muted-foreground">
            Reseña de <Text className="font-inter-semibold text-foreground">{resena.clienteNombre}</Text>:
          </Text>
          {resena.comment ? (
            <View className="mt-1.5 rounded-lg bg-surface-muted/60 p-2.5">
              <Text className="text-xs italic text-foreground" numberOfLines={2}>
                "{resena.comment}"
              </Text>
            </View>
          ) : null}

          {/* Motivos */}
          <Text className="mt-4 mb-2 text-xs font-inter-semibold text-foreground uppercase tracking-wider">
            ¿Cuál es el problema?
          </Text>
          <View className="gap-2">
            {MOTIVOS.map((item) => {
              const selected = motivo === item.key
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setMotivo(item.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  className={`flex-row items-center justify-between rounded-xl border p-2.5 ${
                    selected ? 'border-primary bg-primary/5' : 'border-border bg-background'
                  }`}
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-inter-medium text-foreground">
                      {item.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {item.desc}
                    </Text>
                  </View>
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-full border ${
                      selected ? 'border-primary bg-primary' : 'border-border bg-background'
                    }`}
                  >
                    {selected ? <Check size={12} color="#ffffff" /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>

          {/* Optional comment */}
          <TextInput
            placeholder="Detalles adicionales (opcional)…"
            placeholderTextColor={colors.surface.mutedForeground}
            value={detalle}
            onChangeText={setDetalle}
            maxLength={500}
            multiline
            textAlignVertical="top"
            className="mt-3 min-h-16 rounded-xl border border-border bg-background p-3 text-xs text-foreground"
          />

          {/* Block author checkbox */}
          <Pressable
            onPress={() => setBloquearUsuario(!bloquearUsuario)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: bloquearUsuario }}
            className="mt-3 flex-row items-center gap-2.5 py-1"
          >
            <View
              className={`h-5 w-5 items-center justify-center rounded-md border ${
                bloquearUsuario ? 'border-destructive bg-destructive' : 'border-border bg-background'
              }`}
            >
              {bloquearUsuario ? <Check size={12} color="#ffffff" /> : null}
            </View>
            <Text className="flex-1 text-xs text-muted-foreground">
              Bloquear a este usuario (no volverás a ver sus reseñas).
            </Text>
          </Pressable>

          {/* Action buttons */}
          <View className="mt-5 flex-row gap-2.5">
            <Button
              variant="outline"
              className="flex-1"
              onPress={onClose}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onPress={handleEnviar}
              disabled={enviando}
            >
              {enviando ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                'Enviar reporte'
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}
