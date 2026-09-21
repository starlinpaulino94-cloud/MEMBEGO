/**
 * Pantalla "Cerca de mí" — native (react-native-maps).
 *
 * NOTA: requiere dev build (`expo run:android` / `expo run:ios`).
 * NO funciona en Expo Go — react-native-maps es un módulo nativo.
 *
 * ponytail: sin expo-location instalado, el permiso de GPS queda como banner
 * de consentimiento. Agregar `expo-location` + `Location.getCurrentPositionAsync`
 * cuando se permita instalar dependencias.
 */

import { useState } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native'
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps'
import { Home, LocateFixed, MapPin, Navigation, Search, Star, X } from 'lucide-react-native'
import { cn } from '../src/lib/cn'
import { Sheet } from '../src/components/ui/Sheet'
import { useGeoCercanos } from '../src/hooks/useGeoCercanos'
import { useGeoAutocompletar, type SugerenciaUbicacion } from '../src/hooks/useGeoAutocompletar'
import type { CercanoItem } from '../src/lib/api'

// Centro por defecto: Santo Domingo.
const DEFAULT_CENTER = { latitude: 18.4861, longitude: -69.9312, latitudeDelta: 0.1, longitudeDelta: 0.1 }

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
  spa: 'Spa',
  barberia: 'Barbería',
}

const RADIOS = [1, 3, 5, 10, 20] as const

function formatearDistancia(m: number | null): string {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

export default function CercaNativeScreen() {
  const [contexto, setContexto] = useState<'HOME' | 'CURRENT' | 'MANUAL'>('HOME')
  const [radioKm, setRadioKm] = useState<number | null>(5)
  const [tipoActivo, setTipoActivo] = useState<string | null>(null)
  const [seleccionado, setSeleccionado] = useState<CercanoItem | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sugerenciaAbierta, setSugerenciaAbierta] = useState(false)
  const [consentimientoVisible, setConsentimientoVisible] = useState(false)

  const filtrosStr = tipoActivo ? JSON.stringify({ tiposNegocio: [tipoActivo] }) : undefined

  const { data, isLoading, isError } = useGeoCercanos(
    { contexto, radioKm, filtros: filtrosStr },
    true,
  )

  const { data: sugerenciasData } = useGeoAutocompletar(busqueda, busqueda.length >= 2)
  const sugerencias = sugerenciasData?.sugerencias ?? []

  const resultados = data?.resultados ?? []
  const tiposVistos = [...new Set(resultados.map((r) => (r.tipo as string) || '').filter(Boolean))].sort()

  const toggleContexto = (ctx: 'HOME' | 'CURRENT') => {
    if (ctx === 'CURRENT') {
      // GPS not available on native without expo-location dependency.
      // Show explicit unavailable state instead of fake consent banner.
      // Web uses navigator.geolocation at cerca.web.tsx:156-168.
      // To enable: install expo-location + Location.getCurrentPositionAsync().
      setConsentimientoVisible(true)
    } else {
      setContexto('HOME')
    }
  }

  const elegirSugerencia = (s: SugerenciaUbicacion) => {
    setBusqueda('')
    setSugerenciaAbierta(false)
    if (s.lat != null && s.lng != null) {
      setContexto('MANUAL')
    }
  }

  return (
    <View className="flex-1 bg-background">
      {/* Pills de contexto */}
      <View className="flex-row justify-center gap-2 pt-3 px-4">
        <Pressable
          onPress={() => toggleContexto('HOME')}
          className={cn(
            'flex-row items-center gap-1.5 rounded-full border px-3.5 py-2',
            contexto === 'HOME'
              ? 'border-primary bg-primary'
              : 'border-border bg-card',
          )}
        >
          <Home size={14} color={contexto === 'HOME' ? '#ffffff' : '#111827'} />
          <Text
            className={cn(
              'text-caption font-inter-semibold',
              contexto === 'HOME' ? 'text-primary-foreground' : 'text-foreground',
            )}
          >
            Mi vivienda
          </Text>
        </Pressable>
        <Pressable
          onPress={() => toggleContexto('CURRENT')}
          className={cn(
            'flex-row items-center gap-1.5 rounded-full border px-3.5 py-2',
            contexto === 'CURRENT'
              ? 'border-primary bg-primary'
              : 'border-border bg-card',
          )}
        >
          <LocateFixed size={14} color={contexto === 'CURRENT' ? '#ffffff' : '#111827'} />
          <Text
            className={cn(
              'text-caption font-inter-semibold',
              contexto === 'CURRENT' ? 'text-primary-foreground' : 'text-foreground',
            )}
          >
            Mi ubicación
          </Text>
        </Pressable>
      </View>

      {/* Búsqueda de zona */}
      <View className="px-4 pt-2">
        <View className="relative">
          <Search
            size={16}
            color="#4b5563"
            style={{ position: 'absolute', left: 12, top: 10 }}
          />
          <TextInput
            value={busqueda}
            onChangeText={(t) => {
              setBusqueda(t)
              setSugerenciaAbierta(t.length >= 2)
            }}
            onFocus={() => sugerencias.length > 0 && setSugerenciaAbierta(true)}
            placeholder="Buscar ciudad, sector o dirección…"
            placeholderTextColor="#4b5563"
            className="h-10 rounded-full border border-border bg-card pl-9 pr-9 text-small text-foreground"
          />
          {busqueda.length > 0 && (
            <Pressable
              onPress={() => { setBusqueda(''); setSugerenciaAbierta(false) }}
              style={{ position: 'absolute', right: 10, top: 10 }}
            >
              <X size={16} color="#4b5563" />
            </Pressable>
          )}
        </View>
        {sugerenciaAbierta && sugerencias.length > 0 && (
          <View className="mt-1.5 rounded-2xl border border-border bg-card overflow-hidden">
            {sugerencias.slice(0, 5).map((s) => (
              <Pressable
                key={s.id}
                onPress={() => elegirSugerencia(s)}
                className="flex-row items-center gap-2 px-3 py-2.5 active:bg-muted"
              >
                <MapPin size={16} color="#0284c7" />
                <View className="flex-1">
                  <Text className="text-small font-inter-medium text-foreground" numberOfLines={1}>
                    {s.etiqueta}
                  </Text>
                  <Text className="text-caption text-muted-foreground capitalize">{s.tipo}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Chips de tipo */}
      {tiposVistos.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-4 py-2"
        >
          {tiposVistos.map((tipo) => {
            const activo = tipoActivo === tipo
            return (
              <Pressable
                key={tipo}
                onPress={() => setTipoActivo(activo ? null : tipo)}
                className={cn(
                  'rounded-full border px-3.5 py-2',
                  activo ? 'border-primary bg-primary' : 'border-border bg-card',
                )}
              >
                <Text
                  className={cn(
                    'text-caption font-inter-semibold',
                    activo ? 'text-primary-foreground' : 'text-foreground',
                  )}
                >
                  {TIPO_LABEL[tipo] ?? tipo}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {/* Mapa */}
      <View className="flex-1 mx-4 my-2 rounded-2xl overflow-hidden border border-border">
        <MapView
          style={{ flex: 1 }}
          provider={PROVIDER_DEFAULT}
          initialRegion={DEFAULT_CENTER}
          showsUserLocation={contexto === 'CURRENT'}
          showsMyLocationButton={false}
        >
          {resultados.map((item) => {
            const lat = item.latitud as number
            const lng = item.longitud as number
            if (typeof lat !== 'number' || typeof lng !== 'number') return null
            return (
              <Marker
                key={item.id as string}
                coordinate={{ latitude: lat, longitude: lng }}
                title={item.empresaNombre as string}
                onPress={() => setSeleccionado(item)}
              />
            )
          })}
        </MapView>
        {isLoading && (
          <View className="absolute inset-0 items-center justify-center bg-card/60">
            <ActivityIndicator color="#0284c7" />
          </View>
        )}
      </View>

      {/* Radio pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-1 px-4 pb-2"
      >
        {RADIOS.map((km) => (
          <Pressable
            key={km}
            onPress={() => setRadioKm(km)}
            className={cn(
              'rounded-full px-3 py-2',
              radioKm === km ? 'bg-primary' : 'bg-muted',
            )}
          >
            <Text
              className={cn(
                'text-caption font-inter-semibold',
                radioKm === km ? 'text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {km} km
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setRadioKm(null)}
          className={cn(
            'rounded-full px-3 py-2',
            radioKm === null ? 'bg-primary' : 'bg-muted',
          )}
        >
          <Text
            className={cn(
              'text-caption font-inter-semibold',
              radioKm === null ? 'text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            Ciudad
          </Text>
        </Pressable>
      </ScrollView>

      {/* GPS unavailable banner — honest about limitation */}
      {consentimientoVisible && (
        <View className="mx-4 mb-2 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <Text className="text-h4 font-inter-bold text-foreground">
            Ubicación no disponible
          </Text>
          <Text className="mt-1 text-caption text-muted-foreground">
            La ubicación GPS requiere una compilación de desarrollo con expo-location.{'\n'}
            Por ahora, usa "Mi vivienda" o busca una dirección manualmente.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => setConsentimientoVisible(false)}
              className="flex-1 rounded-lg border border-border px-4 py-2 items-center"
            >
              <Text className="text-small font-inter-semibold text-foreground">Entendido</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Error banner */}
      {isError && (
        <View className="mx-4 mb-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <Text className="text-small text-warning">No pudimos cargar los negocios cercanos.</Text>
        </View>
      )}

      {/* Tarjeta de negocio seleccionado */}
      <Sheet
        visible={seleccionado !== null}
        onClose={() => setSeleccionado(null)}
        title={(seleccionado?.empresaNombre as string) ?? 'Negocio'}
      >
        {seleccionado && (
          <View className="gap-3 pb-4">
            <View className="flex-row items-start gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Text className="text-small font-inter-bold text-foreground">
                  {(seleccionado.empresaNombre as string)?.charAt(0).toUpperCase() ?? '?'}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-h4 font-inter-bold text-foreground" numberOfLines={1}>
                  {seleccionado.empresaNombre as string}
                </Text>
                <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                  {(seleccionado.sector as string) ?? (seleccionado.ciudad as string) ?? (seleccionado.direccion as string) ?? ''}
                </Text>
                {typeof seleccionado.distanciaM === 'number' && (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Navigation size={14} color="#0284c7" />
                    <Text className="text-small font-inter-semibold text-primary">
                      A {formatearDistancia(seleccionado.distanciaM as number)} de ti
                    </Text>
                  </View>
                )}
              </View>
              <Pressable onPress={() => setSeleccionado(null)}>
                <X size={18} color="#4b5563" />
              </Pressable>
            </View>

            {/* Rating */}
            {typeof seleccionado.promedioRating === 'number' && seleccionado.promedioRating !== null && (
              <View className="flex-row items-center gap-1">
                <Star size={14} color="#ab6300" fill="#ab6300" />
                <Text className="text-caption font-inter-semibold text-foreground tabular-nums">
                  {(seleccionado.promedioRating as number).toFixed(1)}
                </Text>
              </View>
            )}

            {/* Cómo llegar */}
            <Pressable
              className="flex-row items-center justify-center gap-2 rounded-lg border border-border py-3 active:bg-muted"
              onPress={() => {
                // ponytail: abrir Google Maps / Apple Maps con Linking.openURL
                // cuando se necesite navegación real.
              }}
            >
              <Navigation size={16} color="#0284c7" />
              <Text className="text-small font-inter-semibold text-foreground">Cómo llegar</Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </View>
  )
}
