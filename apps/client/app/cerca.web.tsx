/// <reference types="@types/google.maps" />
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  type View as RNView,
} from 'react-native'
import { Navigation, PanelLeftOpen, Star, X } from 'lucide-react-native'
import { cn } from '../src/lib/cn'
import { Sheet } from '../src/components/ui/Sheet'
import { goBackOr } from '../src/lib/navigation'
import { CercaMapControls } from '../src/components/geo/CercaMapControls'
import { CercaBusinessPanel, filtrarCercanos } from '../src/components/geo/CercaBusinessPanel'
import { useGeoCercanos } from '../src/hooks/useGeoCercanos'
import { useGeoAutocompletar } from '../src/hooks/useGeoAutocompletar'
import type { CercanoItem, SugerenciaUbicacion } from '../src/lib/api'
import { filtrarCercanosEnViewport, type MapViewportBounds } from '../src/lib/map-viewport'
import { brandColor, brandDisplayForeground } from '../src/lib/brand-color'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../src/theme/tokens'

// Centro por defecto: Santo Domingo.
const DEFAULT_CENTER = { lat: 18.4861, lng: -69.9312 }
const GOOGLE_MAPS_WEB_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ?? ''

let googleMapsApiPromise: Promise<void> | null = null

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function') return Promise.resolve()
  if (!apiKey) return Promise.reject(new Error('Missing Google Maps web API key'))
  if (googleMapsApiPromise) return googleMapsApiPromise

  googleMapsApiPromise = new Promise((resolve, reject) => {
    const startTime = Date.now()
    const readyInterval = window.setInterval(() => {
      if (typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function') {
        window.clearInterval(readyInterval)
        resolve()
      } else if (Date.now() - startTime > 10000) {
        window.clearInterval(readyInterval)
        googleMapsApiPromise = null
        reject(new Error('Google Maps JavaScript API failed to initialize'))
      }
    }, 50)

    if (typeof google !== 'undefined') return

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly`
    script.async = true
    script.onerror = () => {
      window.clearInterval(readyInterval)
      googleMapsApiPromise = null
      reject(new Error('Google Maps JavaScript API failed to load'))
    }
    document.head.appendChild(script)
  })

  return googleMapsApiPromise
}

function formatearDistancia(m: number | null): string {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

function crearIconoMarcador(item: CercanoItem, selected: boolean): google.maps.Icon {
  const nombre = typeof item.empresaNombre === 'string' ? item.empresaNombre : 'Negocio'
  const rawCompanyColor = typeof item.colorPrimario === 'string' ? item.colorPrimario : null
  const companyColor = brandColor(rawCompanyColor, colors.primary.DEFAULT)
  // const companyForeground = brandDisplayForeground(rawCompanyColor, colors.primary.DEFAULT)
  const logoUrl = typeof item.logoUrl === 'string' && /^(https?:\/\/|data:image\/)/i.test(item.logoUrl)
    ? item.logoUrl
    : null
  const tieneOfertas = item.tieneOfertas === true
  const edgeColor = companyColor
  const safeLogoUrl = logoUrl?.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const logo = safeLogoUrl
    ? `<image href="${safeLogoUrl}" x="3" y="3" width="38" height="38" preserveAspectRatio="xMidYMid slice" clip-path="url(%23logo-clip)"/>`
    : `<text x="22" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="${companyColor}">${(nombre.charAt(0) || '?').replace(/[<>&]/g, '')}</text>`
  const offerBadge = tieneOfertas
    ? `<circle cx="38" cy="5" r="6" fill="${companyColor}" stroke="${colors.surface.card}" stroke-width="2"/>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="48" viewBox="0 0 44 48"><defs><clipPath id="logo-clip"><circle cx="22" cy="21" r="18"/></clipPath></defs><path d="M15 33 L22 45 L29 33 Z" fill="${companyColor}"/><circle cx="22" cy="21" r="19" fill="${logo ? colors.primary[100] : companyColor}" stroke="${edgeColor}" stroke-width="${selected ? 4 : 2}"/>${logo}${offerBadge}</svg>`

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: new google.maps.Size(44, 48),
    scaledSize: new google.maps.Size(44, 48),
    anchor: new google.maps.Point(22, 46),
  }
}

export default function CercaWebScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const showBusinessPanel = width >= 768
  const containerRef = useRef<RNView | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerLayerRef = useRef<google.maps.Marker[]>([])
  const [viewportBounds, setViewportBounds] = useState<MapViewportBounds | null>(null)
  const [mapError, setMapError] = useState<'missing-key' | 'load-failed' | null>(
    Platform.OS === 'web' && !GOOGLE_MAPS_WEB_API_KEY ? 'missing-key' : null,
  )

  const geolocationAvailable = typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
  const [contexto, setContexto] = useState<'HOME' | 'CURRENT' | 'MANUAL'>(geolocationAvailable ? 'CURRENT' : 'HOME')
  const [radioKm, setRadioKm] = useState<number | null>(5)
  const [tipoActivo, setTipoActivo] = useState<string | null>(null)
  const [seleccionado, setSeleccionado] = useState<CercanoItem | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaNegocio, setBusquedaNegocio] = useState('')
  const [sugerenciaAbierta, setSugerenciaAbierta] = useState(false)
  const [consentimientoVisible, setConsentimientoVisible] = useState(!geolocationAvailable)
  const [panelVisible, setPanelVisible] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const [locationReady, setLocationReady] = useState(!geolocationAvailable)
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [manualLocation, setManualLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [manualArea, setManualArea] = useState<{ cityId?: string; sectorId?: string }>({})

  // Construir params para la query
  const filtrosStr = tipoActivo ? JSON.stringify({ tiposNegocio: [tipoActivo] }) : undefined

  const { data, isLoading, isError } = useGeoCercanos(
    {
      contexto,
      radioKm,
      lat: (contexto === 'MANUAL' ? manualLocation : contexto === 'CURRENT' ? currentLocation : null)?.latitude,
      lng: (contexto === 'MANUAL' ? manualLocation : contexto === 'CURRENT' ? currentLocation : null)?.longitude,
      cityId: contexto === 'MANUAL' ? manualArea.cityId : undefined,
      sectorId: contexto === 'MANUAL' ? manualArea.sectorId : undefined,
      filtros: filtrosStr,
    },
    locationReady,
  )

  const { data: sugerenciasData } = useGeoAutocompletar(busqueda, busqueda.length >= 2)
  const sugerencias = sugerenciasData?.sugerencias ?? []
  const { data: sugerenciasNegocioData } = useGeoAutocompletar(busquedaNegocio, busquedaNegocio.trim().length >= 2)
  const sugerenciasNegocio = sugerenciasNegocioData?.sugerencias ?? []

  const resultados = data?.resultados ?? []
  const tiposVistos = [...new Set(resultados.map((r) => (r.tipo as string) || '').filter(Boolean))].sort()
  const resultadosEnViewport = filtrarCercanosEnViewport(resultados, viewportBounds)
  const resultadosVisibles = showBusinessPanel
    ? filtrarCercanos(resultadosEnViewport, busquedaNegocio)
    : resultadosEnViewport

  useEffect(() => {
    if (!mapReady) return

    if (contexto === 'CURRENT' && currentLocation) {
      mapRef.current?.setCenter({ lat: currentLocation.latitude, lng: currentLocation.longitude })
      mapRef.current?.setZoom(14)
      return
    }

    if ((contexto !== 'HOME' && contexto !== 'MANUAL') || !data?.ubicacion) return
    mapRef.current?.setCenter({ lat: data.ubicacion.lat, lng: data.ubicacion.lng })
    mapRef.current?.setZoom(contexto === 'MANUAL' ? 14 : 12)
  }, [contexto, currentLocation, data?.ubicacion, mapReady])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        setCurrentLocation(location)
        setContexto('CURRENT')
        setLocationReady(true)
        mapRef.current?.setCenter({ lat: location.latitude, lng: location.longitude })
        mapRef.current?.setZoom(14)
      },
      () => {
        setContexto('HOME')
        setLocationReady(true)
        setConsentimientoVisible(true)
      },
    )
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!containerRef.current) return
    if (!GOOGLE_MAPS_WEB_API_KEY) return

    let active = true
    let viewportListener: google.maps.MapsEventListener | null = null
    const domNode = containerRef.current as unknown as HTMLElement
    const initializeMap = async () => {
      try {
        await loadGoogleMapsApi(GOOGLE_MAPS_WEB_API_KEY)
        if (!active || !domNode || mapRef.current) return
        const { Map: GoogleMap } = await google.maps.importLibrary('maps') as google.maps.MapsLibrary
        if (!active) return
        const map = new GoogleMap(domNode, {
          center: DEFAULT_CENTER,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
        mapRef.current = map
        viewportListener = map.addListener('idle', () => {
          const bounds = map.getBounds()
          if (!bounds) return
          const northEast = bounds.getNorthEast()
          const southWest = bounds.getSouthWest()
          setViewportBounds({
            north: northEast.lat(),
            east: northEast.lng(),
            south: southWest.lat(),
            west: southWest.lng(),
          })
        })
        setMapError(null)
        setMapReady(true)
      } catch {
        if (active) setMapError('load-failed')
      }
    }

    void initializeMap()

    return () => {
      active = false
      viewportListener?.remove()
      setMapReady(false)
      for (const marker of markerLayerRef.current) marker.setMap(null)
      markerLayerRef.current = []
      mapRef.current = null
    }
  }, [])

  // Pintar marcadores cuando cambian los resultados
  const pintarMarcadores = useCallback((items: CercanoItem[]) => {
    if (!mapRef.current) return

    for (const marker of markerLayerRef.current) marker.setMap(null)
    markerLayerRef.current = []

    for (const item of items) {
      const lat = item.latitud as number
      const lng = item.longitud as number
      if (typeof lat !== 'number' || typeof lng !== 'number') continue

      const marker = new google.maps.Marker({
        map: mapRef.current,
        position: { lat, lng },
        title: String(item.empresaNombre ?? 'Negocio'),
        icon: crearIconoMarcador(item, seleccionado?.id === item.id),
      })
      marker.addListener('click', () => setSeleccionado(item))
      markerLayerRef.current.push(marker)
    }
  }, [seleccionado])

  useEffect(() => {
    if (mapReady) pintarMarcadores(resultadosVisibles)
  }, [mapReady, resultadosVisibles, pintarMarcadores])

  const toggleContexto = (ctx: 'HOME' | 'CURRENT') => {
    if (ctx === 'CURRENT') {
      // ponytail: sin expo-location, el GPS web pide permiso via navigator.geolocation
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setCurrentLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
            setContexto('CURRENT')
            setLocationReady(true)
            if (mapRef.current) {
              mapRef.current.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
              mapRef.current.setZoom(14)
            }
          },
          () => setConsentimientoVisible(true),
        )
      } else {
        setConsentimientoVisible(true)
      }
    } else {
      setContexto('HOME')
      mapRef.current?.setCenter(DEFAULT_CENTER)
      mapRef.current?.setZoom(12)
    }
  }

  const elegirSugerencia = (s: SugerenciaUbicacion) => {
    setBusqueda('')
    setSugerenciaAbierta(false)
    setManualLocation(s.lat != null && s.lng != null ? { latitude: s.lat, longitude: s.lng } : null)
    setManualArea({ cityId: s.cityId ?? undefined, sectorId: s.sectorId ?? undefined })
    setContexto('MANUAL')
    if (s.lat != null && s.lng != null) {
      mapRef.current?.setCenter({ lat: s.lat, lng: s.lng })
      mapRef.current?.setZoom(14)
    }
  }

  const elegirSugerenciaNegocio = (s: SugerenciaUbicacion) => {
    setBusquedaNegocio('')
    elegirSugerencia(s)
  }

  const seleccionarNegocio = (item: CercanoItem) => {
    setSeleccionado(item)
    const lat = item.latitud
    const lng = item.longitud
    if (typeof lat === 'number' && typeof lng === 'number') {
      mapRef.current?.setCenter({ lat, lng })
      mapRef.current?.setZoom(Math.max(mapRef.current.getZoom() ?? 12, 14))
    }
  }

  const selectedCompanyColorValue = typeof seleccionado?.colorPrimario === 'string'
    ? seleccionado.colorPrimario
    : null
  const selectedCompanyColor = brandColor(selectedCompanyColorValue, colors.primary.DEFAULT)
  const selectedCompanyForeground = brandDisplayForeground(selectedCompanyColorValue, colors.primary.DEFAULT)

  return (
    <View className="relative flex-1 bg-background">
      {showBusinessPanel && panelVisible && (
        <View className="absolute bottom-20 left-4 top-4 z-20 md:w-[340px] lg:w-[360px]">
          <CercaBusinessPanel
            floating
            onBack={() => goBackOr(router, '/(tabs)/inicio')}
            resultados={resultadosEnViewport}
            isLoading={isLoading || (!mapError && viewportBounds === null)}
            isError={isError}
            busqueda={busquedaNegocio}
            seleccionadoId={seleccionado ? String(seleccionado.id ?? '') : null}
            sugerencias={sugerenciasNegocio}
            sugerenciaAbierta={busquedaNegocio.trim().length >= 2}
            onBusqueda={setBusquedaNegocio}
            onSeleccionar={seleccionarNegocio}
            onElegirSugerencia={elegirSugerenciaNegocio}
            onHide={() => setPanelVisible(false)}
          />
        </View>
      )}
      {showBusinessPanel && !panelVisible && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mostrar panel de negocios"
          onPress={() => setPanelVisible(true)}
          className="absolute left-[60px] top-3 z-30 h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-md md:left-[72px] md:top-5"
        >
          <PanelLeftOpen size={18} color="#111827" />
        </Pressable>
      )}
      <View className="absolute inset-0 overflow-hidden">
        <View ref={containerRef} className="absolute inset-0" />
        <CercaMapControls
          floatingPanel={showBusinessPanel && panelVisible}
          showSearch={!showBusinessPanel || !panelVisible}
          showBackButton={!showBusinessPanel || !panelVisible}
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
          style={{ bottom: Math.max(insets.bottom + 60, 60) }}
          className={cn("absolute bottom-20 left-4 block: md:hidden", consentimientoVisible ? "right-20 z-30" : "")}
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
            <View className={cn(
              'absolute bottom-20 right-20 z-30 rounded-xl border border-border bg-card p-4',
              showBusinessPanel ? 'left-[380px] lg:left-[396px]' : 'left-4',
            )}>
              <Text className="text-h4 font-inter-bold text-foreground">Autoriza el uso de tu ubicación</Text>
              <Text className="mt-1 text-caption text-muted-foreground">
                Solo usamos tu ubicación para mostrarte negocios cercanos.
              </Text>
              <View className="mt-3 flex-row gap-2">
                <Pressable onPress={() => { setConsentimientoVisible(false); toggleContexto('CURRENT') }} className="rounded-lg bg-primary px-4 py-2">
                  <Text className="text-small font-inter-semibold text-primary-foreground">Permitir</Text>
                </Pressable>
                <Pressable onPress={() => setConsentimientoVisible(false)} className="rounded-lg border border-border px-4 py-2">
                  <Text className="text-small font-inter-semibold text-foreground">Ahora no</Text>
                </Pressable>
              </View>
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
          height: '30%',
          alignSelf: 'center',
        }}
        footer={seleccionado ? (
          <Pressable
            className="flex-row items-center justify-center gap-2 rounded-lg py-3 active:opacity-80"
            style={{ backgroundColor: selectedCompanyColor }}
            onPress={() => {
              const lat = seleccionado.latitud
              const lng = seleccionado.longitud
              if (typeof lat === 'number' && typeof lng === 'number') {
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                  window.open(
                    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
                    '_blank',
                  )
                }
              }
            }}
          >
            <Navigation size={16} color={selectedCompanyForeground} />
            <Text className="text-small font-inter-semibold" style={{ color: selectedCompanyForeground }}>Cómo llegar</Text>
          </Pressable>
        ) : null}
      >
        {seleccionado && (
          <View className="gap-3 pb-4">
            <View className="flex-row items-start gap-3">
              <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: selectedCompanyColor }}>
                {typeof seleccionado.logoUrl === 'string' && seleccionado.logoUrl.length > 0 ? (
                  <Image
                    accessibilityLabel={`Logo de ${typeof seleccionado.empresaNombre === 'string' ? seleccionado.empresaNombre : 'negocio'}`}
                    source={{ uri: seleccionado.logoUrl }}
                    resizeMode="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <Text className="text-small font-inter-bold" style={{ color: selectedCompanyForeground }}>
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
                  <View className="mt-1 flex-row items-center gap-1.5 self-start rounded-full px-2 py-1" style={{ backgroundColor: selectedCompanyColor }}>
                    <Navigation size={14} color={selectedCompanyForeground} />
                    <Text className="text-small font-inter-semibold" style={{ color: selectedCompanyForeground }}>
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
