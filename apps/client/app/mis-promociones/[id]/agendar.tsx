import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Clock, MapPin } from 'lucide-react-native'
import { useAuth } from '../../../src/lib/auth-context'
import { goBackOr } from '../../../src/lib/navigation'
import { useAgendarPromocion, useDisponibilidadPromocion, useMisPromocion } from '../../../src/hooks/useMisPromociones'
import { ResponsiveDetailSheet, useIsResponsiveDetailSheet } from '../../../src/components/ui/ResponsiveDetailSheet'
import { Button } from '../../../src/components/ui/Button'
import { Card } from '../../../src/components/ui/Card'
import { colors } from '../../../src/theme/tokens'

function formatAgendaDay(ymd: string, timeZone: string) {
  const date = new Date(`${ymd}T12:00:00.000Z`)
  return {
    weekday: new Intl.DateTimeFormat('es-DO', { weekday: 'short', timeZone }).format(date).replace('.', '').toLocaleUpperCase('es-DO'),
    monthDay: new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', timeZone }).format(date),
  }
}

function AgendarCitaScreenContent() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const inResponsiveSheet = useIsResponsiveDetailSheet()
  const { isAuthenticated } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const compraQuery = useMisPromocion(id, isAuthenticated)
  const compra = compraQuery.data
  const [fecha, setFecha] = useState<string>()
  const [hora, setHora] = useState<string>()
  const [successMessage, setSuccessMessage] = useState<string>()
  const disponibilidad = useDisponibilidadPromocion(id, fecha, isAuthenticated && Boolean(compra))
  const agendar = useAgendarPromocion()

  useEffect(() => {
    if (fecha) return
    const primerDiaAbierto = disponibilidad.data?.dias.find((dia) => !dia.etiquetaCerrado)
    if (primerDiaAbierto) setFecha(primerDiaAbierto.ymd)
  }, [disponibilidad.data?.dias, fecha])

  if (!isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <CalendarDays size={32} color={colors.primary.DEFAULT} />
        <Text className="my-4 text-center text-xl font-inter-bold text-foreground">Inicia sesión para agendar</Text>
        <Button onPress={() => router.push('/(auth)/login')}>Iniciar Sesión</Button>
      </View>
    )
  }

  const titulo = compra?.promocion?.titulo ?? 'Tu beneficio'
  const empresa = compra?.company?.name ?? ''
  const timeZone = disponibilidad.data?.empresa?.zonaHoraria ?? 'America/Santo_Domingo'
  const dias = disponibilidad.data?.dias ?? []
  const dia = disponibilidad.data?.disponibilidad
  const horarios = dia?.slots ?? []
  const horario = horarios.find((slot) => slot.hm === hora)
  const agendaActiva = disponibilidad.data?.agenda?.activa ?? false
  const tieneDisponibilidad = Boolean(
    dia && !dia.cerrado && !dia.limiteDiaAlcanzado && !disponibilidad.data?.yaTieneCita &&
    horario && !horario.vencido && horario.libres > 0,
  )
  const mensajeError = agendar.error instanceof Error ? agendar.error.message : 'Intenta de nuevo más tarde.'
  const mensajeDisponibilidad = disponibilidad.error instanceof Error
    ? disponibilidad.error.message
    : 'No pudimos cargar los horarios disponibles.'

  function seleccionarDia(ymd: string) {
    setFecha(ymd)
    setHora(undefined)
    setSuccessMessage(undefined)
    agendar.reset()
  }

  function handleAgendar() {
    if (!id || !fecha || !hora || !tieneDisponibilidad) return
    agendar.mutate({ id, body: { fecha, hora } }, { onSuccess: (res) => setSuccessMessage(res.mensaje) })
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 border-b border-border bg-background"
        style={{ paddingLeft: insets.left + 16, paddingRight: 16, paddingTop: inResponsiveSheet ? 12 : insets.top + 12, paddingBottom: 12 }}
      >
        <Pressable
          onPress={() => goBackOr(router, '/mis-promociones')}
          className="min-h-11 min-w-11 items-center justify-center rounded-lg active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color={colors.surface.foreground} />
        </Pressable>
        <Text className="text-lg font-inter-bold text-foreground">Agendar cita</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <View className="items-center gap-5 py-4">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 size={36} color={colors.state.success} />
          </View>
          <View className="items-center gap-2">
            <Text className="text-center text-2xl font-inter-bold text-foreground">¡Listo, ya es tuyo!</Text>
            <Text className="text-center text-sm text-muted-foreground">
              <Text className="font-inter-semibold text-foreground">{titulo}</Text> quedó guardado en tus beneficios
              {empresa ? ` de ${empresa}` : ''}. Tu código QR ya está disponible.
            </Text>
          </View>

          <Card className="w-full border-primary/30 bg-primary/5">
            <View className="gap-4 p-5">
              <View className="flex-row items-center gap-2">
                <CalendarDays size={20} color={colors.primary.DEFAULT} />
                <Text className="flex-1 font-inter-bold text-foreground">¿Quieres agendar tu cita ahora?</Text>
              </View>
              <Text className="text-sm text-muted-foreground">
                Es <Text className="font-inter-semibold text-foreground">opcional</Text>. Elige un horario disponible y el negocio reservará el turno.
              </Text>

              {compraQuery.isLoading ? (
                <View className="items-center py-5"><ActivityIndicator color={colors.primary.DEFAULT} /></View>
              ) : compraQuery.isError ? (
                <Notice icon={<AlertCircle size={18} color={colors.state.danger} />}>
                  No pudimos cargar este beneficio. Vuelve a tus beneficios e inténtalo de nuevo.
                </Notice>
              ) : disponibilidad.isError ? (
                <View className="gap-3 rounded-xl bg-destructive/10 p-4">
                  <Notice icon={<AlertCircle size={18} color={colors.state.danger} />}>
                    {mensajeDisponibilidad}
                  </Notice>
                  <Button variant="outline" onPress={() => disponibilidad.refetch()}>Reintentar</Button>
                </View>
              ) : disponibilidad.isLoading ? (
                <View className="items-center gap-2 py-5">
                  <ActivityIndicator color={colors.primary.DEFAULT} />
                  <Text className="text-sm text-muted-foreground">Buscando horarios…</Text>
                </View>
              ) : !agendaActiva ? (
                <Notice icon={<Clock size={18} color={colors.surface.mutedForeground} />}>
                  Este negocio no tiene la agenda activa. Puedes usar tu beneficio sin reservar.
                </Notice>
              ) : dias.length === 0 || dias.every((item) => item.etiquetaCerrado) ? (
                <Notice icon={<Clock size={18} color={colors.surface.mutedForeground} />}>
                  No hay días disponibles para reservar en este momento.
                </Notice>
              ) : (
                <>
                  <View className="gap-2">
                    <Text className="font-inter-semibold text-foreground">Elige un día</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {dias.map((item) => {
                        const label = formatAgendaDay(item.ymd, timeZone)
                        const selected = fecha === item.ymd
                        return (
                          <Pressable
                            key={item.ymd}
                            disabled={item.etiquetaCerrado}
                            onPress={() => seleccionarDia(item.ymd)}
                            className={`min-w-[76px] items-center justify-center rounded-xl border px-3 py-2.5 ${selected ? 'border-primary bg-primary' : 'border-border bg-background'} ${item.etiquetaCerrado ? 'opacity-45' : ''}`}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: item.etiquetaCerrado }}
                            accessibilityLabel={`${label.weekday} ${label.monthDay}${item.etiquetaCerrado ? ', cerrado' : ''}`}
                          >
                            <Text className={`text-xs font-inter-semibold ${selected ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{label.weekday}</Text>
                            <Text className={`mt-1 text-sm font-inter-bold ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{label.monthDay}</Text>
                          </Pressable>
                        )
                      })}
                    </ScrollView>
                  </View>

                  <View className="gap-2">
                    <Text className="font-inter-semibold text-foreground">Elige una hora</Text>
                    {disponibilidad.isFetching ? (
                      <View className="items-center py-4"><ActivityIndicator color={colors.primary.DEFAULT} /></View>
                    ) : disponibilidad.data?.yaTieneCita ? (
                      <Notice icon={<CalendarDays size={18} color={colors.surface.mutedForeground} />}>
                        Ya tienes una cita reservada para ese día. Elige otra fecha.
                      </Notice>
                    ) : dia?.limiteDiaAlcanzado ? (
                      <Notice icon={<Clock size={18} color={colors.surface.mutedForeground} />}>
                        Este día alcanzó el máximo de reservas. Elige otra fecha.
                      </Notice>
                    ) : horarios.filter((slot) => !slot.vencido && slot.libres > 0).length === 0 ? (
                      <Notice icon={<Clock size={18} color={colors.surface.mutedForeground} />}>
                        No quedan horarios disponibles para este día.
                      </Notice>
                    ) : (
                      <View className="flex-row flex-wrap gap-2">
                        {horarios.map((slot) => {
                          const selected = hora === slot.hm
                          const disabled = slot.vencido || slot.libres <= 0
                          return (
                            <Pressable
                              key={slot.hm}
                              disabled={disabled}
                              onPress={() => {
                                setHora(slot.hm)
                                setSuccessMessage(undefined)
                                agendar.reset()
                              }}
                              className={`min-h-11 min-w-[88px] items-center justify-center rounded-xl border px-3 py-2 ${selected ? 'border-primary bg-primary' : 'border-border bg-background'} ${disabled ? 'opacity-40' : ''}`}
                              accessibilityRole="radio"
                              accessibilityState={{ selected, disabled }}
                              accessibilityLabel={`${slot.hm}${disabled ? ', no disponible' : `, ${slot.libres} cupos disponibles`}`}
                            >
                              <Text className={`text-sm font-inter-semibold ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>
                                {slot.hm}
                              </Text>
                            </Pressable>
                          )
                        })}
                      </View>
                    )}
                  </View>
                </>
              )}

              {agendar.isError ? (
                <Notice icon={<AlertCircle size={18} color={colors.state.danger} />}>
                  {mensajeError}
                </Notice>
              ) : null}
              {successMessage ? (
                <View className="gap-3 rounded-xl bg-success/10 p-4">
                  <Notice icon={<CheckCircle2 size={18} color={colors.state.success} />}>
                    {successMessage}
                  </Notice>
                  <Button onPress={() => router.replace('/mis-promociones')}>Ver mis beneficios</Button>
                </View>
              ) : (
                <Button
                  onPress={handleAgendar}
                  disabled={!tieneDisponibilidad || agendar.isPending || !agendaActiva}
                  loading={agendar.isPending}
                  className="w-full"
                >
                  Agendar cita
                </Button>
              )}
              <View className="flex-row items-center gap-2">
                <MapPin size={16} color={colors.primary.DEFAULT} />
                <Text className="flex-1 text-xs text-muted-foreground">
                  El negocio te esperará en el horario reservado.
                </Text>
              </View>
            </View>
          </Card>
          <Button variant="outline" onPress={() => goBackOr(router, '/mis-promociones')}>
            Omitir por ahora
          </Button>
        </View>
      </ScrollView>
    </View>
  )
}

function Notice({ icon, children }: { readonly icon: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-muted p-4">
      {icon}
      <Text className="flex-1 text-sm text-muted-foreground">{children}</Text>
    </View>
  )
}

export default function AgendarCitaScreen() {
  return (
    <ResponsiveDetailSheet>
      <AgendarCitaScreenContent />
    </ResponsiveDetailSheet>
  )
}
