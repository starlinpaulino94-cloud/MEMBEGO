import { ArrowLeft, MapPin, Search, Home, LocateFixed, X } from 'lucide-react-native'
import { Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cn } from '../../lib/cn'
import type { SugerenciaUbicacion } from '../../hooks/useGeoAutocompletar'
import { LinearGradient } from 'expo-linear-gradient'
import { colors } from '../../theme/tokens'

const RADIOS = [1, 3, 5, 10, 20] as const

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
  spa: 'Spa',
  barberia: 'Barbería',
}

interface CercaMapControlsProps {
  floatingPanel?: boolean
  showSearch?: boolean
  showBackButton?: boolean
  onBack: () => void
  contexto: 'HOME' | 'CURRENT' | 'MANUAL'
  radioKm: number | null
  tipoActivo: string | null
  tipos: string[]
  busqueda: string
  sugerencias: SugerenciaUbicacion[]
  sugerenciaAbierta: boolean
  onContexto: (contexto: 'HOME' | 'CURRENT') => void
  onRadio: (radio: number | null) => void
  onTipo: (tipo: string | null) => void
  onBusqueda: (busqueda: string) => void
  onElegirSugerencia: (sugerencia: SugerenciaUbicacion) => void
  onSugerenciasAbiertas: (abierta: boolean) => void
}

export function CercaMapControls({
  floatingPanel = false,
  showSearch = true,
  showBackButton = false,
  onBack,
  contexto,
  radioKm,
  tipoActivo,
  tipos,
  busqueda,
  sugerencias,
  sugerenciaAbierta,
  onContexto,
  onRadio,
  onTipo,
  onBusqueda,
  onElegirSugerencia,
  onSugerenciasAbiertas,
}: CercaMapControlsProps) {
  const insets = useSafeAreaInsets()
  const topOffset = Platform.OS === 'web' ? undefined : Math.max(insets.top + 8, 12)

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      {!floatingPanel && showBackButton && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver atrás"
          onPress={onBack}
          style={topOffset == null ? undefined : { top: topOffset }}
          className="absolute left-3 top-3 z-20 h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-md md:left-5 md:top-5"
        >
          <ArrowLeft size={19} color="#111827" />
        </Pressable>
      )}
      <View
        pointerEvents="box-none"
        style={topOffset == null ? undefined : { top: topOffset }}
        className={cn(
          'absolute right-16 top-3 z-10 md:right-20 md:top-5',
          floatingPanel
            ? 'left-3 md:left-[372px] lg:left-[392px]'
            : showBackButton
              ? 'left-[60px] md:left-5'
              : 'left-3 md:left-5',
        )}
      >
        <View className="w-full max-w-xl gap-2 self-center">
          {showSearch && (
            <>
              <View className="relative rounded-full border border-border bg-card">
                <Search size={17} color="#4b5563" style={{ position: 'absolute', left: 14, top: 12, zIndex: 1 }} />
                <TextInput
                  value={busqueda}
                  onChangeText={(value) => {
                    onBusqueda(value)
                    onSugerenciasAbiertas(value.length >= 2)
                  }}
                  onFocus={() => sugerencias.length > 0 && onSugerenciasAbiertas(true)}
                  placeholder="Buscar ciudad o sector…"
                  placeholderTextColor="#4b5563"
                  accessibilityLabel="Buscar ciudad, sector o dirección"
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="h-11 rounded-full pl-11 pr-10 text-small text-foreground"
                />
                {busqueda.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Limpiar búsqueda de dirección"
                    onPress={() => {
                      onBusqueda('')
                      onSugerenciasAbiertas(false)
                    }}
                    className="absolute right-3 top-3"
                  >
                    <X size={16} color="#4b5563" />
                  </Pressable>
                )}
              </View>

              {sugerenciaAbierta && sugerencias.length > 0 && (
                <View className="overflow-hidden rounded-2xl border border-border bg-card">
                  {sugerencias.slice(0, 5).map((sugerencia) => (
                    <Pressable
                      key={sugerencia.id}
                      accessibilityRole="button"
                      onPress={() => onElegirSugerencia(sugerencia)}
                      className="flex-row items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0"
                    >
                      <MapPin size={16} color="#5b21b6" />
                      <View className="min-w-0 flex-1">
                        <Text className="text-small font-inter-medium text-foreground" numberOfLines={1}>
                          {sugerencia.etiqueta}
                        </Text>
                        <Text className="text-caption capitalize text-muted-foreground">{sugerencia.tipo}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          {tipos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: tipoActivo === null }}
                onPress={() => onTipo(null)}
                className={cn('rounded-full border px-3 py-1.5', tipoActivo === null ? 'border-primary bg-primary' : 'border-border bg-card')}
              >
                <Text className={cn('text-caption font-inter-semibold', tipoActivo === null ? 'text-primary-foreground' : 'text-foreground')}>Todos</Text>
              </Pressable>
              {tipos.map((tipo) => {
                const activo = tipoActivo === tipo
                return (
                  <Pressable
                    key={tipo}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activo }}
                    onPress={() => onTipo(activo ? null : tipo)}
                    className={cn('rounded-full border px-3 py-1.5', activo ? 'border-primary bg-primary' : 'border-border bg-card')}
                  >
                    <Text className={cn('text-caption font-inter-semibold', activo ? 'text-primary-foreground' : 'text-foreground')}>
                      {TIPO_LABEL[tipo] ?? tipo}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )}
        </View>
      </View>

      <View
        style={{ bottom: Math.max(insets.bottom + 16, 16) }}
        className="absolute left-3 z-30 flex-row gap-2 md:left-5"
      >
        <ContextButton active={contexto === 'HOME'} icon="home" label="Mi vivienda" onPress={() => onContexto('HOME')} />
        <ContextButton active={contexto === 'CURRENT'} icon="location" label="Mi ubicación" onPress={() => onContexto('CURRENT')} />
      </View>

      <View
        style={{ bottom: Math.max(insets.bottom + 16, 16) }}
        className="absolute right-3 z-10 gap-1 rounded-2xl border border-border bg-card p-1.5 md:right-5"
      >
        {RADIOS.map((radio) => (
          <RadiusButton key={radio} active={radioKm === radio} label={`${radio} km`} onPress={() => onRadio(radio)} />
        ))}
        <RadiusButton active={radioKm === null} label="Ciudad" onPress={() => onRadio(null)} />
      </View>
    </View>
  )
}

function ContextButton({ active, icon, label, onPress }: { active: boolean; icon: 'home' | 'location'; label: string; onPress: () => void }) {
  const Icon = icon === 'home' ? Home : LocateFixed
  const content = (
    <>
      <Icon size={15} color={active ? '#ffffff' : '#111827'} />
      <Text className={cn('text-caption font-inter-semibold', active ? 'text-primary-foreground' : 'text-foreground')}>{label}</Text>
    </>
  )

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="rounded-full"
    >
      {active ? (
        <LinearGradient
          colors={colors.gradient.primary}
          locations={colors.gradient.primary.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          {content}
        </LinearGradient>
      ) : (
        <View className="flex-row items-center gap-1.5 rounded-full px-3.5 py-2 border-vibe-borde bg-card">
          {content}
        </View>
      )}
    </TouchableOpacity>
  )
}

function RadiusButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const content = <Text className={cn('text-caption font-inter-semibold', active ? 'text-primary-foreground' : 'text-foreground')}>{label}</Text>

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="rounded-xl"
    >
      {active ? (
        <LinearGradient
          colors={colors.gradient.primary}
          locations={colors.gradient.primary.length === 4 ? [0, 0.35, 0.7, 1] : [0, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            minWidth: 54,
            alignItems: 'center',
            borderRadius: 14,
            paddingHorizontal: 8,
            paddingVertical: 8,
          }}
        >
          {content}
        </LinearGradient>
      ) : (
        <View className="min-w-[54px] items-center rounded-xl px-2 py-2 bg-transparent">
          {content}
        </View>
      )}
    </TouchableOpacity>
  )
}
