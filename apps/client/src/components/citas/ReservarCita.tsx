import React, { useState } from 'react'
import { View, Text, Pressable, TextInput, Alert } from 'react-native'
import { CalendarCheck2, Car } from 'lucide-react-native'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'
import { useCrearCita } from '../../hooks/useCitas'
import type { CrearCitaBody } from '../../lib/api'

interface Slot {
  hm: string
  inicioIso: string
  libres: number
  vencido: boolean
}

interface Vehiculo {
  id: string
  marca: string
  modelo: string
}

interface ReservarCitaProps {
  fecha: string
  etiquetaFecha: string
  slots: Slot[]
  vehiculos: Vehiculo[]
  limiteDiaAlcanzado: boolean
  notas: string | null
  compraId?: string | null
  compraTitulo?: string | null
}

/**
 * Grid de turnos del dia + sheet de confirmacion de la reserva.
 * La disponibilidad viene calculada del BFF; el servidor la revalida
 * de todos modos al reservar.
 */
export function ReservarCita({
  fecha,
  etiquetaFecha,
  slots,
  vehiculos,
  limiteDiaAlcanzado,
  notas,
  compraId,
  compraTitulo,
}: ReservarCitaProps) {
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(null)
  const [vehiculoId, setVehiculoId] = useState<string>(
    vehiculos.length === 1 ? vehiculos[0].id : '',
  )
  const [servicio, setServicio] = useState('')
  const crearCita = useCrearCita({
    onSuccess: (data) => {
      Alert.alert('Cita reservada', data.mensaje ?? 'Tu cita ha sido reservada.')
      setHoraSeleccionada(null)
    },
    onError: (error) => {
      Alert.alert('Error', error.message ?? 'No se pudo reservar la cita.')
    },
  })

  // Reset form when sheet closes (inline in the close handler, not in an effect)
  const resetForm = () => {
    setVehiculoId(vehiculos.length === 1 ? vehiculos[0].id : '')
    setServicio('')
  }

  const handleReservar = () => {
    if (!horaSeleccionada) return
    const body: CrearCitaBody = {
      fecha,
      hora: horaSeleccionada,
      ...(vehiculoId ? { vehiculoId } : {}),
      ...(servicio.trim() ? { servicio: servicio.trim() } : {}),
      ...(compraId ? { compraId } : {}),
    }
    crearCita.mutate(body)
  }

  if (limiteDiaAlcanzado) {
    return (
      <View className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 items-center">
        <Text className="text-sm text-muted-foreground text-center">
          Este dia ya alcanzo el maximo de citas. Prueba con otro dia.
        </Text>
      </View>
    )
  }

  const hayDisponibles = slots.some((s) => s.libres > 0 && !s.vencido)

  return (
    <View>
      {!hayDisponibles ? (
        <View className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 items-center">
          <Text className="text-sm text-muted-foreground text-center">
            No quedan turnos disponibles para este dia.
          </Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {slots.map((s) => {
            const agotado = s.libres <= 0 || s.vencido
            return (
              <Pressable
                key={s.hm}
                disabled={agotado}
                onPress={() => setHoraSeleccionada(s.hm)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 items-center',
                  // 3-col grid: each item ~31% width
                  'w-[31.5%]',
                  agotado
                    ? 'border-border/50 bg-muted/40'
                    : 'border-border/70 bg-card active:border-foreground/40',
                )}
                accessibilityRole="button"
                accessibilityLabel={`Reservar a las ${s.hm}`}
                accessibilityState={{ disabled: agotado }}
              >
                <Text
                  className={cn(
                    'text-sm font-inter-semibold',
                    agotado
                      ? 'text-muted-foreground/50 line-through'
                      : 'text-foreground',
                  )}
                >
                  {s.hm}
                </Text>
                {!agotado && s.libres > 1 && (
                  <Text className="text-xs font-inter-medium text-muted-foreground mt-0.5">
                    {s.libres} cupos
                  </Text>
                )}
              </Pressable>
            )
          })}
        </View>
      )}

      {/* Sheet de confirmacion */}
      <Sheet
        visible={horaSeleccionada != null}
        onClose={() => { setHoraSeleccionada(null); resetForm() }}
        title="Confirmar cita"
      >
        <View className="gap-4">
          {/* Fecha y hora */}
          <View className="flex-row items-center gap-2">
            <CalendarCheck2 size={20} color="#0284c7" />
            <Text className="text-sm text-muted-foreground">
              {etiquetaFecha} a las{' '}
            </Text>
            <Text className="text-sm font-inter-semibold text-foreground">
              {horaSeleccionada}
            </Text>
          </View>

          {/* Notas de la agenda */}
          {notas && (
            <View className="rounded-xl bg-muted/40 p-3">
              <Text className="text-xs text-muted-foreground leading-relaxed">
                {notas}
              </Text>
            </View>
          )}

          {/* Banner de canje */}
          {compraId && compraTitulo && (
            <View className="rounded-xl border border-success/25 bg-success/10 p-3">
              <Text className="text-xs text-foreground leading-relaxed">
                Esta cita es para canjear tu{' '}
                <Text className="font-inter-bold">{compraTitulo}</Text> gratis.
                Al confirmarla, tu QR quedara habilitado.
              </Text>
            </View>
          )}

          {/* Selector de vehiculo */}
          {vehiculos.length > 0 && (
            <View>
              <View className="flex-row items-center gap-1.5 mb-2">
                <Car size={16} color="#71717a" />
                <Text className="text-sm font-inter-medium text-foreground">
                  Vehiculo (opcional)
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => setVehiculoId('')}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    vehiculoId === ''
                      ? 'border-foreground bg-foreground'
                      : 'border-border bg-card',
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm font-inter-medium',
                      vehiculoId === '' ? 'text-background' : 'text-foreground',
                    )}
                  >
                    Sin especificar
                  </Text>
                </Pressable>
                {vehiculos.map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => setVehiculoId(v.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      vehiculoId === v.id
                        ? 'border-foreground bg-foreground'
                        : 'border-border bg-card',
                    )}
                  >
                    <Text
                      className={cn(
                        'text-sm font-inter-medium',
                        vehiculoId === v.id ? 'text-background' : 'text-foreground',
                      )}
                    >
                      {v.marca} {v.modelo}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Servicio (textarea) */}
          <View>
            <Text className="text-sm font-inter-medium text-foreground mb-2">
              Que necesitas? (opcional)
            </Text>
            <TextInput
              multiline
              numberOfLines={2}
              maxLength={300}
              value={servicio}
              onChangeText={setServicio}
              placeholder="Ej.: lavado completo y aspirado"
              placeholderTextColor="#4b5563"
              className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground font-sans min-h-[80px] text-top"
              textAlignVertical="top"
            />
          </View>

          {/* Boton reservar */}
          <Button
            onPress={handleReservar}
            loading={crearCita.isPending}
            className="w-full h-12"
            icon={<CalendarCheck2 size={18} color="#ffffff" />}
          >
            Reservar este turno
          </Button>
        </View>
      </Sheet>
    </View>
  )
}
