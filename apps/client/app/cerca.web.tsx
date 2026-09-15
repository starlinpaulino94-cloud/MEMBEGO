/**
 * Pantalla "Cerca de mí" — web (Leaflet).
 *
 * Monta Leaflet sobre un `View` de react-native-web vía ref (el View renderiza
 * un div). Inicializa el mapa en useEffect y limpia en cleanup.
 *
 * Pills de contexto (Inicio/GPS), chips de tipo, tarjeta de negocio con Sheet,
 * banner de consentimiento de ubicación.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  type View as RNView,
} from 'react-native'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import { Home, LocateFixed, MapPin, Navigation, Search, Star, X } from 'lucide-react-native'
import { cn } from '../src/lib/cn'
import { Sheet } from '../src/components/ui/Sheet'
import { useGeoCercanos } from '../src/hooks/useGeoCercanos'
import { useGeoAutocompletar, type SugerenciaUbicacion } from '../src/hooks/useGeoAutocompletar'
import type { CercanoItem } from '../src/lib/api'

// Centro por defecto: Santo Domingo.
const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]

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

export default function CercaWebScreen() {
  const containerRef = useRef<RNView | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerLayerRef = useRef<LeafletMarker[]>([])

  const [contexto, setContexto] = useState<'HOME' | 'CURRENT' | 'MANUAL'>('HOME')
  const [radioKm, setRadioKm] = useState<number | null>(5)
  const [tipoActivo, setTipoActivo] = useState<string | null>(null)
  const [seleccionado, setSeleccionado] = useState<CercanoItem | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [sugerenciaAbierta, setSugerenciaAbierta] = useState(false)
  const [consentimientoVisible, setConsentimientoVisible] = useState(false)

  // Construir params para la query
  const filtrosStr = tipoActivo ? JSON.stringify({ tiposNegocio: [tipoActivo] }) : undefined

  const { data, isLoading, isError } = useGeoCercanos(
    {
      contexto,
      radioKm,
      filtros: filtrosStr,
    },
    true,
  )

  const { data: sugerenciasData } = useGeoAutocompletar(busqueda, busqueda.length >= 2)
  const sugerencias = sugerenciasData?.sugerencias ?? []

  const resultados = data?.resultados ?? []
  const tiposVistos = [...new Set(resultados.map((r) => (r.tipo as string) || '').filter(Boolean))].sort()

  // Inicializar mapa Leaflet
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!containerRef.current) return

    let cancelled = false

    Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css')
    ]).then(([mod]) => {
      if (cancelled) return
      const L = mod.default || mod
      // react-native-web renders View as a div; grab the DOM node.
      const el = (containerRef.current as unknown as { __nativeTag?: number })
      // Find the actual DOM node — the View ref in react-native-web.
      const domNode = document.querySelector(`[data-rnw-id="${(containerRef.current as any)._nativeTag}"]`) as HTMLElement
        ?? (containerRef.current as unknown as HTMLElement)

      if (!domNode || mapRef.current) return

      const map = L.map(domNode, {
        zoomControl: true,
        attributionControl: true,
      }).setView(DEFAULT_CENTER, 12)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map)

      mapRef.current = map
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Pintar marcadores cuando cambian los resultados
  const pintarMarcadores = useCallback(async (items: CercanoItem[]) => {
    if (!mapRef.current) return

    const mod = await import('leaflet')
    const L = mod.default || mod

    // Limpiar marcadores anteriores
    for (const m of markerLayerRef.current) {
      m.remove()
    }
    markerLayerRef.current = []

    for (const item of items) {
      const lat = item.latitud as number
      const lng = item.longitud as number
      if (typeof lat !== 'number' || typeof lng !== 'number') continue

      const marker = L.marker([lat, lng]).addTo(mapRef.current!)
      marker.on('click', () => setSeleccionado(item))
      markerLayerRef.current.push(marker)
    }
  }, [])

  useEffect(() => {
    if (resultados.length > 0) {
      pintarMarcadores(resultados)
    }
  }, [resultados, pintarMarcadores])

  const toggleContexto = (ctx: 'HOME' | 'CURRENT') => {
    if (ctx === 'CURRENT') {
      // ponytail: sin expo-location, el GPS web pide permiso via navigator.geolocation
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setContexto('CURRENT')
            if (mapRef.current) {
              mapRef.current.setView([pos.coords.latitude, pos.coords.longitude], 14)
            }
          },
          () => setConsentimientoVisible(true),
        )
      } else {
        setConsentimientoVisible(true)
      }
    } else {
      setContexto('HOME')
    }
  }

  const elegirSugerencia = (s: SugerenciaUbicacion) => {
    setBusqueda('')
    setSugerenciaAbierta(false)
    if (s.lat != null && s.lng != null && mapRef.current) {
      setContexto('MANUAL')
      mapRef.current.setView([s.lat, s.lng], 14)
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
            style={{ position: 'absolute', left: 12, top: '50%', transform: [{ translateY: -8 }] }}
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
              style={{ position: 'absolute', right: 10, top: '50%', transform: [{ translateY: -9 }] }}
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
                  activo
                    ? 'border-primary bg-primary'
                    : 'border-border bg-card',
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
        <View ref={containerRef} className="flex-1" />
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

      {/* Consentimiento banner */}
      {consentimientoVisible && (
        <View className="mx-4 mb-2 rounded-xl border border-border bg-card p-4">
          <Text className="text-h4 font-inter-bold text-foreground">
            Autoriza el uso de tu ubicación
          </Text>
          <Text className="mt-1 text-caption text-muted-foreground">
            Solo usamos tu ubicación para mostrarte negocios cercanos. Nunca la compartimos.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => {
                setConsentimientoVisible(false)
                toggleContexto('CURRENT')
              }}
              className="rounded-lg bg-primary px-4 py-2"
            >
              <Text className="text-small font-inter-semibold text-primary-foreground">Permitir</Text>
            </Pressable>
            <Pressable
              onPress={() => setConsentimientoVisible(false)}
              className="rounded-lg border border-border px-4 py-2"
            >
              <Text className="text-small font-inter-semibold text-foreground">Ahora no</Text>
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
                const lat = seleccionado.latitud
                const lng = seleccionado.longitud
                if (typeof lat === 'number' && typeof lng === 'number') {
                  // En web, abrir Google Maps
                  if (Platform.OS === 'web' && typeof window !== 'undefined') {
                    window.open(
                      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
                      '_blank',
                    )
                  }
                }
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
