import { ArrowLeft, MapPin, PanelLeftClose, Search, Star, Tag, X } from 'lucide-react-native'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { cn } from '../../lib/cn'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'
import type { CercanoItem } from '../../lib/api'
import type { SugerenciaUbicacion } from '../../lib/api'
import { colors } from '../../theme/tokens'

interface CercaBusinessPanelProps {
  resultados: CercanoItem[]
  isLoading: boolean
  isError: boolean
  busqueda: string
  seleccionadoId: string | null
  sugerencias: SugerenciaUbicacion[]
  sugerenciaAbierta: boolean
  onBusqueda: (value: string) => void
  onSeleccionar: (resultado: CercanoItem) => void
  onElegirSugerencia: (sugerencia: SugerenciaUbicacion) => void
  onBack?: () => void
  onHide?: () => void
  floating?: boolean
}

function getString(item: CercanoItem, key: string): string | null {
  const value = item[key]
  return typeof value === 'string' ? value : null
}

function getNumber(item: CercanoItem, key: string): number | null {
  const value = item[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBoolean(item: CercanoItem, key: string): boolean | null {
  const value = item[key]
  return typeof value === 'boolean' ? value : null
}

function formatDistance(distance: number | null): string | null {
  if (distance === null) return null
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`
}

export function filtrarCercanos(resultados: CercanoItem[], busqueda: string): CercanoItem[] {
  const query = busqueda.trim().toLocaleLowerCase()
  if (!query) return resultados
  return resultados.filter((resultado) => [
    getString(resultado, 'empresaNombre'),
    getString(resultado, 'nombre'),
    getString(resultado, 'tipo'),
    getString(resultado, 'direccion'),
    getString(resultado, 'sector'),
    getString(resultado, 'ciudad'),
  ].some((value) => value?.toLocaleLowerCase().includes(query)))
}

export function CercaBusinessPanel({
  resultados,
  isLoading,
  isError,
  busqueda,
  seleccionadoId,
  sugerencias,
  sugerenciaAbierta,
  onBusqueda,
  onSeleccionar,
  onElegirSugerencia,
  onBack,
  onHide,
  floating = false,
}: CercaBusinessPanelProps) {
  const filtered = filtrarCercanos(resultados, busqueda)

  return (
    <View className={cn(
      'h-full w-full bg-background md:w-[340px] lg:w-[360px]',
      floating ? 'overflow-hidden rounded-2xl border border-border shadow-xl' : 'border-r border-border',
    )}>
      <View className="z-20 gap-4 border-b border-border bg-background px-5 pb-4 pt-5">
        <View className="flex-row items-center gap-3">
          {onBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver atrás"
              onPress={onBack}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
            >
              <ArrowLeft size={18} color="#111827" />
            </Pressable>
          )}
          <View className="min-w-0 flex-1">
            <Text className="text-h2 font-inter-bold text-foreground">Cerca de mí</Text>
            <Text className="mt-1 text-small text-muted-foreground">
              {isLoading ? 'Buscando negocios…' : `${filtered.length} negocios visibles`}
            </Text>
          </View>
          {isLoading && <ActivityIndicator color="#5b21b6" />}
          {onHide && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ocultar panel de negocios"
              onPress={onHide}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
            >
              <PanelLeftClose size={18} color="#111827" />
            </Pressable>
          )}
        </View>
        <View className="relative z-30">
          <Search size={17} color="#5b21b6" style={{ position: 'absolute', left: 14, top: 14, zIndex: 1 }} />
          <TextInput
            value={busqueda}
            onChangeText={onBusqueda}
            placeholder="Nombre, categoría o zona"
            placeholderTextColor="#4b5563"
            accessibilityLabel="Buscar negocios cercanos"
            returnKeyType="search"
            className="h-12 rounded-full border border-border bg-card pl-11 pr-11 text-small text-foreground focus:border-primary focus:outline-none"
          />
          {busqueda.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda de negocios"
              onPress={() => onBusqueda('')}
              className="absolute right-3 top-3 h-6 w-6 items-center justify-center rounded-full bg-muted"
            >
              <X size={14} color="#4b5563" />
            </Pressable>
          )}
          {sugerenciaAbierta && sugerencias.length > 0 && (
            <View className="absolute left-0 right-0 top-14 z-40 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              {sugerencias.slice(0, 5).map((sugerencia) => (
                <Pressable
                  key={sugerencia.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${sugerencia.etiqueta}, ${sugerencia.tipo}`}
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
        </View>
      </View>

      <ScrollView className="min-h-0 flex-1" contentContainerClassName="gap-2.5 p-3" keyboardShouldPersistTaps="handled">
        {isError && (
          <View className="rounded-xl border border-warning/40 bg-warning/10 p-3">
            <Text className="text-small text-warning">No pudimos cargar los negocios cercanos.</Text>
          </View>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <View className="items-center gap-2 rounded-2xl border border-dashed border-border px-5 py-8">
            <MapPin size={22} color="#5b21b6" />
            <Text className="text-small font-inter-semibold text-foreground">
              {resultados.length === 0 ? 'No hay negocios visibles en el mapa' : 'No encontramos coincidencias'}
            </Text>
            <Text className="text-center text-caption text-muted-foreground">
              {resultados.length === 0
                ? 'Mueve el mapa o aleja el zoom para explorar otras zonas. Aumenta el radio para ampliar la búsqueda.'
                : 'Prueba con otro nombre, negocio o sector.'}
            </Text>
          </View>
        )}

        {filtered.map((resultado) => {
          const id = getString(resultado, 'id') ?? ''
          const empresa = getString(resultado, 'empresaNombre') ?? 'Negocio'
          const sucursal = getString(resultado, 'nombre')
          const logo = getString(resultado, 'logoUrl')
          const direccion = getString(resultado, 'direccion')
          const sector = getString(resultado, 'sector')
          const ciudad = getString(resultado, 'ciudad')
          const rating = getNumber(resultado, 'promedioRating')
          const distance = formatDistance(getNumber(resultado, 'distanciaM'))
          const offers = getNumber(resultado, 'cantidadOfertas') ?? 0
          const opened = getBoolean(resultado, 'abierto')
          const selected = seleccionadoId === id
          const rawCompanyColor = getString(resultado, 'colorPrimario')
          const companyColor = brandColor(rawCompanyColor, colors.primary.DEFAULT)
          const companyForeground = brandDisplayForeground(rawCompanyColor, colors.primary.DEFAULT)

          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`${empresa}${sucursal ? `, ${sucursal}` : ''}${distance ? `, a ${distance}` : ''}`}
              accessibilityState={{ selected }}
              onPress={() => onSeleccionar(resultado)}
              className={cn('rounded-2xl border bg-card p-3', selected ? 'border-primary' : 'border-border')}
              style={{
                borderColor: selected ? companyColor : undefined,
                borderLeftColor: companyColor,
                borderLeftWidth: 4,
              }}
            >
              <View className="flex-row gap-3">
                {logo ? (
                  <Image
                    source={{ uri: logo }}
                    className="h-12 w-12 rounded-xl border-2 bg-muted"
                    style={{ borderColor: companyColor }}
                    resizeMode="cover"
                  />
                ) : (
                  <View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: companyColor }}>
                    <Text className="text-h3 font-inter-bold" style={{ color: companyForeground }}>{empresa.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View className="min-w-0 flex-1 gap-1">
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="min-w-0 flex-1">
                      <Text className="text-small font-inter-semibold text-foreground" numberOfLines={1}>{empresa}</Text>
                      {sucursal && <Text className="text-caption text-muted-foreground" numberOfLines={1}>{sucursal}</Text>}
                    </View>
                    {distance && (
                      <Text
                        className="rounded-md px-2 py-1 text-caption font-inter-semibold"
                        style={{ backgroundColor: companyColor, color: companyForeground }}
                      >
                        {distance}
                      </Text>
                    )}
                  </View>
                  <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                    {[direccion, sector, ciudad].filter(Boolean).join(' · ') || 'Dirección no disponible'}
                  </Text>
                  <View className="mt-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
                    {opened !== null && (
                      <Text className={cn('text-caption font-inter-medium', opened ? 'text-success' : 'text-muted-foreground')}>
                        {opened ? 'Abierto ahora' : 'Cerrado'}
                      </Text>
                    )}
                    {rating !== null && (
                      <View className="flex-row items-center gap-1">
                        <Star size={13} color="#ab6300" fill="#ab6300" />
                        <Text className="text-caption font-inter-medium text-foreground">{rating.toFixed(1)}</Text>
                      </View>
                    )}
                    {offers > 0 && (
                      <View className="flex-row items-center gap-1 rounded-md px-2 py-1" style={{ backgroundColor: companyColor }}>
                        <Tag size={13} color={companyForeground} />
                        <Text className="text-caption font-inter-medium" style={{ color: companyForeground }}>
                          {offers} {offers === 1 ? 'oferta' : 'ofertas'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}
