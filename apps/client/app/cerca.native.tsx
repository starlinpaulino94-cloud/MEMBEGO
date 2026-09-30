import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native'
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps'
import * as Location from 'expo-location'
import { Navigation, Star, X } from 'lucide-react-native'
import { Sheet } from '../src/components/ui/Sheet'
import { goBackOr } from '../src/lib/navigation'
import { CercaMapControls } from '../src/components/geo/CercaMapControls'
import { useGeoCercanos } from '../src/hooks/useGeoCercanos'
import { useGeoAutocompletar, type SugerenciaUbicacion } from '../src/hooks/useGeoAutocompletar'
import type { CercanoItem } from '../src/lib/api'
import { filtrarCercanosEnViewport, type MapViewportBounds } from '../src/lib/map-viewport'
import { cn } from '../src/lib/cn'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../src/theme/tokens'

// Centro por defecto: Santo Domingo.
const DEFAULT_CENTER = { latitude: 18.4861, longitude: -69.9312 }

function BusinessMapMarker({ item, selected }: { item: CercanoItem; selected: boolean }) {
  const nombre = typeof item.empresaNombre === 'string' ? item.empresaNombre : 'Negocio'
  const logoUrl = typeof item.logoUrl === 'string' ? item.logoUrl : null
  const tieneOfertas = item.tieneOfertas === true
  const edgeColor = tieneOfertas ? colors.state.warning : colors.primary.DEFAULT

  return (
    <View
      accessible
      accessibilityLabel={nombre}
      style={{ width: 48, height: 48, alignItems: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          top: 32,
          width: 11,
          height: 11,
          backgroundColor: edgeColor,
          borderRadius: 2,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          width: selected ? 42 : 38,
          height: selected ? 42 : 38,
          borderRadius: 21,
          borderWidth: 2,
          borderColor: selected ? colors.primary.DEFAULT : edgeColor,
          backgroundColor: colors.primary[100],
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
          elevation: selected ? 8 : 4,
        }}
      >
        <Text style={{ color: colors.primary.DEFAULT, fontSize: 15, fontWeight: '700' }}>
          {nombre.charAt(0).toUpperCase() || '?'}
        </Text>
        {logoUrl && (
          <Image
            source={{ uri: logoUrl }}
            resizeMode="cover"
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
        )}
      </View>
      {tieneOfertas && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: colors.state.warning,
            borderWidth: 2,
            borderColor: colors.surface.card,
          }}
        />
      )}
      {selected && (
        <View
          style={{
            position: 'absolute',
            top: -3,
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 3,
            borderColor: colors.primary[100],
          }}
        />
      )}
    </View>
  )
}

function formatearDistancia(m: number | null): string {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

async function abrirNavegacion(item: CercanoItem) {
  const lat = item.latitud
  const lng = item.longitud
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) return

  const destino = `${lat},${lng}`
  const url = Platform.OS === 'ios'
    ? `maps://?daddr=${destino}&dirflg=d`
    : `google.navigation:q=${destino}`

  try {
    await Linking.openURL(url)
  } catch (error) {
    if (Platform.OS === 'android') {
      const nombre = typeof item.empresaNombre === 'string' ? item.empresaNombre : 'Negocio'
      const urlAlternativa = `geo:${destino}?q=${destino}(${encodeURIComponent(nombre)})`

      try {
        await Linking.openURL(urlAlternativa)
      } catch (errorAlternativo) {
        const detalle = errorAlternativo instanceof Error
          ? errorAlternativo.message
          : 'No se encontró una aplicación de mapas compatible.'
        Alert.alert('No se pudo abrir el mapa', detalle)
      }
      return
    }

    const detalle = error instanceof Error
      ? error.message
      : 'No se encontró una aplicación de mapas compatible.'
    Alert.alert('No se pudo abrir el mapa', detalle)
  }
}

export default function CercaNativeScreen() {
  const router = useRouter()
  const [contexto, setContexto] = useState<'HOME' | 'CURRENT' | 'MANUAL'>('HOME')
  const [radioKm, setRadioKm] = useState<number | null>(5)
  const [tipoActivo, setTipoActivo] = useState<string | null>(null)
  const [seleccionado, setSeleccionado] = useState<CercanoItem | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sugerenciaAbierta, setSugerenciaAbierta] = useState(false)
  const [consentimientoVisible, setConsentimientoVisible] = useState(false)
  const [gpsState, setGpsState] = useState<'idle' | 'requesting' | 'ready' | 'denied'>('idle')
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [manualLocation, setManualLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [viewportBounds, setViewportBounds] = useState<MapViewportBounds | null>(null)
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView>(null)

  const filtrosStr = tipoActivo ? JSON.stringify({ tiposNegocio: [tipoActivo] }) : undefined

  const { data, isLoading, isError } = useGeoCercanos(
    {
      contexto,
      radioKm,
      lat: (contexto === 'MANUAL' ? manualLocation : contexto === 'CURRENT' ? currentLocation : null)?.latitude,
      lng: (contexto === 'MANUAL' ? manualLocation : contexto === 'CURRENT' ? currentLocation : null)?.longitude,
      filtros: filtrosStr,
    },
    true,
  )

  const { data: sugerenciasData } = useGeoAutocompletar(busqueda, busqueda.length >= 2)
  const sugerencias = sugerenciasData?.sugerencias ?? []

  const resultados = data?.resultados ?? []
  const resultadosEnViewport = filtrarCercanosEnViewport(resultados, viewportBounds)
  const tiposVistos = [...new Set(resultados.map((r) => (r.tipo as string) || '').filter(Boolean))].sort()
  const mapCenter = contexto === 'MANUAL' && manualLocation
    ? manualLocation
    : contexto === 'CURRENT' && currentLocation
      ? currentLocation
      : contexto === 'HOME' && data?.ubicacion
        ? { latitude: data.ubicacion.lat, longitude: data.ubicacion.lng }
        : DEFAULT_CENTER

  useEffect(() => {
    if (!mapReady) return
    const delta = contexto === 'HOME' ? 0.1 : 0.05
    mapRef.current?.animateToRegion({
      latitude: mapCenter.latitude,
      longitude: mapCenter.longitude,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }, 300)
  }, [contexto, mapCenter.latitude, mapCenter.longitude, mapReady])

  useEffect(() => {
    if (!mapReady || !seleccionado) return
    const latitude = seleccionado.latitud
    const longitude = seleccionado.longitud
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return
    mapRef.current?.animateToRegion({
      latitude,
      longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 350)
  }, [mapReady, seleccionado])

  const toggleContexto = async (ctx: 'HOME' | 'CURRENT') => {
    if (ctx === 'CURRENT') {
      setGpsState('requesting')
      setConsentimientoVisible(false)

      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setGpsState('denied')
        setConsentimientoVisible(true)
        return
      }

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        setCurrentLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setGpsState('ready')
        setContexto('CURRENT')
      } catch {
        setGpsState('denied')
        setConsentimientoVisible(true)
      }
    } else {
      setGpsState(currentLocation ? 'ready' : 'idle')
      setContexto('HOME')
    }
  }

  const elegirSugerencia = (s: SugerenciaUbicacion) => {
    setBusqueda('')
    setSugerenciaAbierta(false)
    if (s.lat != null && s.lng != null) {
      setManualLocation({ latitude: s.lat, longitude: s.lng })
      setContexto('MANUAL')
    }
  }

  const actualizarViewport = () => {
    void mapRef.current?.getMapBoundaries().then((bounds) => {
      setViewportBounds({
        north: bounds.northEast.latitude,
        east: bounds.northEast.longitude,
        south: bounds.southWest.latitude,
        west: bounds.southWest.longitude,
      })
    }).catch(() => { })
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 overflow-hidden">
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          userInterfaceStyle="light"
          initialRegion={{ ...DEFAULT_CENTER, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
          onMapReady={() => {
            setMapReady(true)
            actualizarViewport()
          }}
          onRegionChangeComplete={actualizarViewport}
          showsUserLocation={gpsState === 'ready'}
          showsMyLocationButton={false}
        >
          {resultadosEnViewport.map((item) => {
            const lat = item.latitud
            const lng = item.longitud
            if (typeof lat !== 'number' || typeof lng !== 'number') return null
            return (
              <Marker
                key={String(item.id)}
                coordinate={{ latitude: lat, longitude: lng }}
                title={String(item.empresaNombre ?? 'Negocio')}
                anchor={{ x: 0.5, y: 1 }}
                onPress={() => setSeleccionado(item)}
              >
                <BusinessMapMarker item={item} selected={seleccionado?.id === item.id} />
              </Marker>
            )
          })}
        </MapView>
        <CercaMapControls
          showBackButton
          onBack={() => goBackOr(router, '/(tabs)/inicio')}
          contexto={contexto}
          radioKm={radioKm}
          tipoActivo={tipoActivo}
          tipos={tiposVistos}
          busqueda={busqueda}
          sugerencias={sugerencias}
          sugerenciaAbierta={sugerenciaAbierta}
          onContexto={toggleContexto}
          onRadio={setRadioKm}
          onTipo={(tipo) => setTipoActivo(tipo)}
          onBusqueda={setBusqueda}
          onElegirSugerencia={elegirSugerencia}
          onSugerenciasAbiertas={setSugerenciaAbierta}
        />
        <View
          style={{ bottom: Math.max(insets.bottom + 100, 100) }}
          className={cn("absolute bottom-20 left-4", consentimientoVisible ? "right-20" : "")}
        >
          {isLoading && (
            <View className="flex-row items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
              <ActivityIndicator color="#5b21b6" />
              <Text className="text-caption font-inter-medium text-foreground">Buscando negocios…</Text>
            </View>
          )}
          {isError && (
            <View className="max-w-[70%] rounded-xl border border-warning/40 bg-card p-3">
              <Text className="text-small text-warning">No pudimos cargar los negocios cercanos.</Text>
            </View>
          )}
          {!isLoading && !isError && resultados.length === 0 && (
            <View className="max-w-[70%] rounded-xl border border-border bg-card p-3">
              <Text className="text-small font-inter-semibold text-foreground">No hay negocios en esta zona</Text>
              <Text className="mt-1 text-caption text-muted-foreground">Aumenta el radio para buscar en un área más amplia.</Text>
            </View>
          )}
          {consentimientoVisible && (
            <View className="rounded-xl border border-warning/40 bg-card p-4">
              <Text className="text-h4 font-inter-bold text-foreground">No pudimos obtener tu ubicación</Text>
              <Text className="mt-1 text-caption text-muted-foreground">
                Activa el permiso de ubicación para buscar negocios cerca de ti. Por ahora, puedes usar «Mi vivienda» o buscar una dirección.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConsentimientoVisible(false)}
                className="mt-3 self-start rounded-lg border border-border px-4 py-2"
              >
                <Text className="text-small font-inter-semibold text-foreground">Entendido</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* Tarjeta de negocio seleccionado */}
      <Sheet
        visible={seleccionado !== null}
        onClose={() => setSeleccionado(null)}
        contentStyle={{
          width: '95%',
          maxWidth: 640,
          height: '25%',
          alignSelf: 'center',
        }}
        footer={seleccionado
          && typeof seleccionado.latitud === 'number'
          && Number.isFinite(seleccionado.latitud)
          && typeof seleccionado.longitud === 'number'
          && Number.isFinite(seleccionado.longitud) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cómo llegar a este negocio"
            className="flex-row items-center justify-center gap-2 rounded-lg border border-border py-3 active:bg-muted"
            onPress={() => void abrirNavegacion(seleccionado)}
          >
            <Navigation size={16} color={colors.primary.DEFAULT} />
            <Text className="text-small font-inter-semibold text-foreground">Cómo llegar</Text>
          </Pressable>
        ) : null}
      >
        {seleccionado && (
          <View className="gap-3 pb-4">
            <View className="flex-row items-start gap-3">
              <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
                {typeof seleccionado.logoUrl === 'string' && seleccionado.logoUrl.length > 0 ? (
                  <Image
                    accessibilityLabel={`Logo de ${typeof seleccionado.empresaNombre === 'string' ? seleccionado.empresaNombre : 'negocio'}`}
                    source={{ uri: seleccionado.logoUrl }}
                    resizeMode="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <Text className="text-small font-inter-bold text-primary">
                    {(seleccionado.empresaNombre as string)?.charAt(0).toUpperCase() ?? '?'}
                  </Text>
                )}
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
                    <Navigation size={14} color={colors.primary.DEFAULT} />
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

          </View>
        )}
      </Sheet>
    </View>
  )
}
