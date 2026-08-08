'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Map as LeafletMap } from 'leaflet'
import {
  Clock,
  Home,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Star,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/system/EmptyState'
import { MobileBottomSheet } from '@/components/ui/mobile-bottom-sheet'
import { cn } from '@/lib/utils'
import { formatearDistancia } from '@/modules/geo/cercanos/distancia'
import { aceptarConsentimientoGeo } from '@/modules/geo/consentimiento/actions'
import type {
  ContextoUbicacion,
  FiltrosCercanos,
  ResultadoCercanos,
  SucursalCercana,
  SugerenciaUbicacion,
} from '@/modules/geo/cercanos/tipos'

// Centro por defecto: Santo Domingo.
const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]
const ZOOM_POR_RADIO: Record<number, number> = { 1: 15, 3: 14, 5: 13, 10: 12, 20: 11 }

type ErrorCodigo = 'consentimiento_requerido' | 'sin_ubicacion_vivienda' | 'sin_coordenadas' | 'error'

interface EstadoError {
  codigo: ErrorCodigo
  mensaje: string
}

const RADIOS = [1, 3, 5, 10, 20] as const
type FiltroBooleano = 'soloConOfertas' | 'soloGratis' | 'soloMembresias' | 'abiertosAhora'
const FILTROS: { key: FiltroBooleano; label: string }[] = [
  { key: 'soloConOfertas', label: 'Con ofertas' },
  { key: 'soloGratis', label: 'Gratis' },
  { key: 'soloMembresias', label: 'Membresías' },
  { key: 'abiertosAhora', label: 'Abierto ahora' },
]

/**
 * Mapa "Cerca de mí" (docs/GEOLOCALIZACION.md §13).
 *
 * El VIEWPORT del mapa es la única fuente de verdad: cada vez que el usuario
 * mueve/zoom (debounce de 700 ms) se consulta `/api/geo/cercanos?viewport=…`,
 * y la lista de tarjetas se reconstruye con el MISMO resultado — mapa y lista
 * nunca se contradicen. Los filtros y el radio solo re-centran/refiltran el
 * viewport (el radio cambia el zoom; "Ciudad" lo suelta a nivel de ciudad).
 *
 * Privacidad (§9): el GPS no se usa sin el gesto del usuario; "Usar mi
 * ubicación" pide permiso al navegador y registra DEVICE_LOCATION_SESSION.
 * Usar la vivienda exige FUNCTIONAL_USAGE; si falta, se muestra un aviso con
 * botón "Permitir" (la API responde `consentimiento_requerido`).
 */

const round = (n: number) => Number(n.toFixed(6))

export function MapaCercaDeMi({ userId }: { userId: string | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const clusterRef = useRef<{ clear: () => void; add: (m: unknown) => void } | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null)
  const markerRef = useRef<Map<string, unknown>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moviendoRef = useRef(false)

  const [contexto, setContexto] = useState<ContextoUbicacion>(userId ? 'HOME' : 'MANUAL')
  const [radioKm, setRadioKm] = useState<number | null>(5)
  const [filtros, setFiltros] = useState<FiltrosCercanos>({})
  const [resultados, setResultados] = useState<SucursalCercana[]>([])
  const [ubicacion, setUbicacion] = useState<string>('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<EstadoError | null>(null)
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [usandoGPS, setUsandoGPS] = useState(false)
  const [mapListo, setMapListo] = useState(false)
  /** Hoja inferior (solo móvil): asomada por defecto, para que el mapa mande. */
  const [hojaAbierta, setHojaAbierta] = useState(false)

  // Búsqueda de zona (MANUAL)
  const [busqueda, setBusqueda] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaUbicacion[]>([])
  const [buscandoZona, setBuscandoZona] = useState(false)
  const [abiertaSugerencias, setAbiertaSugerencias] = useState(false)
  const zonaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ocultarZona = () => {
    setSugerencias([])
    setAbiertaSugerencias(false)
  }

  const centrarEn = (lat: number, lng: number, zoom: number) => {
    const map = mapRef.current
    if (!map) return
    moviendoRef.current = true
    map.setView([lat, lng], zoom)
  }

  // ── Llamada a la API con abort (sin claves fantasma ni carreras) ───────────
  const buscar = useCallback(
    async (params: URLSearchParams, opts?: { reCentrar?: boolean }) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setCargando(true)
      setError(null)
      try {
        const res = await fetch(`/api/geo/cercanos?${params.toString()}`, { signal: ctrl.signal })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) {
          const codigo: ErrorCodigo = data?.codigo === 'consentimiento_requerido'
            ? 'consentimiento_requerido'
            : data?.codigo === 'sin_ubicacion_vivienda'
              ? 'sin_ubicacion_vivienda'
              : data?.codigo === 'sin_coordenadas'
                ? 'sin_coordenadas'
                : 'error'
          setError({ codigo, mensaje: data?.mensaje ?? 'No pudimos cargar los negocios cercanos.' })
          return null
        }
        setResultados(data.resultados ?? [])
        if (data.ubicacion?.etiqueta) setUbicacion(data.ubicacion.etiqueta)
        if (
          opts?.reCentrar &&
          typeof data.ubicacion?.lat === 'number' &&
          typeof data.ubicacion?.lng === 'number'
        ) {
          centrarEn(data.ubicacion.lat, data.ubicacion.lng, ZOOM_POR_RADIO[radioKm ?? 5] ?? 12)
        }
        return data as ResultadoCercanos
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null
        setError({ codigo: 'error', mensaje: 'No pudimos cargar los negocios cercanos.' })
        return null
      } finally {
        setCargando(false)
      }
    },
    [radioKm]
  )

  // ── Refrescar con el viewport ACTUAL (movimiento del mapa / filtros) ───────
  const refrescarViewport = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    const vp = {
      west: round(b.getWest()),
      south: round(b.getSouth()),
      east: round(b.getEast()),
      north: round(b.getNorth()),
    }
    const p = new URLSearchParams()
    p.set('contexto', contexto)
    p.set('viewport', JSON.stringify(vp))
    if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
    void buscar(p)
  }, [contexto, filtros, buscar])

  const refrescarRef = useRef(refrescarViewport)
  useEffect(() => {
    refrescarRef.current = refrescarViewport
  }, [refrescarViewport])

  // ── Dibujar marcadores (clusters) y popups desde `resultados` ──────────────
  const pintarMarcadores = useCallback((cluster: { clear: () => void; add: (m: unknown) => void }, items: SucursalCercana[]) => {
    cluster.clear()
    markerRef.current.clear()
    const L = LRef.current
    if (!L) return
    const icon = L.divIcon({
      className: '',
      html: '<div style="font-size:24px;line-height:1;transform:translate(-2px,-8px) drop-shadow(0 2px 2px rgba(0,0,0,.3))">📍</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    })
    for (const s of items) {
      const m = L.marker([s.latitud, s.longitud], { icon })
      m.bindPopup(`<strong>${s.empresaNombre}</strong><br/>${s.nombre}${s.direccion ? ` · ${s.direccion}` : ''}`)
      m.on('click', () => {
        setSeleccionado(s.id)
        document.getElementById(`cercano-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
      markerRef.current.set(s.id, m)
      cluster.add(m)
    }
  }, [])

  // ── Inicialización del mapa (una vez) ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    import('leaflet')
      .then(async (mod) => {
        const L = mod.default
        LRef.current = L
        await import('leaflet.markercluster').catch(() => null)
        if (cancelled || !containerRef.current || mapRef.current) return
        const map = L.map(containerRef.current, {
          zoomControl: false,
          attributionControl: true,
        }).setView(DEFAULT_CENTER, 12)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(map)
        L.control.zoom({ position: 'bottomright' }).addTo(map)

        // Cluster (o capa simple si markercluster no cargó en runtime).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyL = L as any
        const cluster =
          typeof anyL.markerClusterGroup === 'function'
            ? anyL.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 })
            : L.layerGroup()

        cluster.addTo(map)
        clusterRef.current = {
          clear: () => cluster.clearLayers(),
          add: (m: unknown) => cluster.addLayer(m as never),
        }
        mapRef.current = map
        setMapListo(true)

        map.on('moveend', () => {
          // Ignorar el re-centrado programático inicial (la primera carga usa
          // el radio; los movimientos reales del usuario usan el viewport).
          if (moviendoRef.current) {
            moviendoRef.current = false
            return
          }
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => refrescarRef.current(), 700)
        })

        // Carga inicial: con sesión se centra en la vivienda (el servidor
        // resuelve coordenadas); sin sesión, la persona elige una zona.
        if (userId) {
          const p = new URLSearchParams()
          p.set('contexto', 'HOME')
          p.set('radioKm', '5')
          void buscar(p, { reCentrar: true })
        }
      })
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (zonaTimer.current) clearTimeout(zonaTimer.current)
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        clusterRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mantener marcadores en sincronía con los resultados (repintar si los
  // resultados llegaron antes de que el mapa terminara de inicializarse).
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    pintarMarcadores(cluster, resultados)
  }, [resultados, pintarMarcadores, mapListo])

  // ── Acciones de contexto ────────────────────────────────────────────────────

  /** Radio: convierte a zoom (el viewport resultante dispara la búsqueda). */
  const aplicarRadio = (km: number | null) => {
    setRadioKm(km)
    if (!mapRef.current || !ubicacion) return
    const zoom = km ? (ZOOM_POR_RADIO[km] ?? 12) : 12
    moviendoRef.current = true
    mapRef.current.setView(mapRef.current.getCenter(), zoom)
  }

  /** "Usar mi ubicación actual" — GPS puntual con consentimiento de sesión. */
  const usarUbicacionActual = () => {
    if (!('geolocation' in navigator)) {
      setError({ codigo: 'error', mensaje: 'Tu dispositivo no permite ubicación.' })
      return
    }
    setUsandoGPS(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        if (userId) {
          await aceptarConsentimientoGeo('DEVICE_LOCATION_SESSION').catch(() => {})
        }
        setContexto('CURRENT')
        setUbicacion('Mi ubicación actual')
        setRadioKm(3)
        const p = new URLSearchParams()
        p.set('contexto', 'CURRENT')
        p.set('lat', String(lat))
        p.set('lng', String(lng))
        p.set('radioKm', '3')
        if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
        centrarEn(lat, lng, ZOOM_POR_RADIO[3])
        await buscar(p)
        setUsandoGPS(false)
      },
      () => {
        setUsandoGPS(false)
        setError({ codigo: 'error', mensaje: 'No pudimos obtener tu ubicación. Revisa los permisos del navegador.' })
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    )
  }

  /** "Mi vivienda" — el servidor resuelve coordenadas + etiqueta. */
  const usarVivienda = () => {
    setContexto('HOME')
    ocultarZona()
    const p = new URLSearchParams()
    p.set('contexto', 'HOME')
    p.set('radioKm', String(radioKm ?? 5))
    if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
    // El servidor resuelve coordenadas de la vivienda; re-centrar el mapa.
    void buscar(p, { reCentrar: true })
  }

  /** Seleccionar una sugerencia de zona (MANUAL). */
  const elegirZona = (s: SugerenciaUbicacion) => {
    ocultarZona()
    setBusqueda(s.etiqueta)
    setContexto('MANUAL')
    const p = new URLSearchParams()
    p.set('contexto', 'MANUAL')
    if (s.lat !== null && s.lng !== null) {
      setUbicacion(s.etiqueta)
      setRadioKm(5)
      p.set('lat', String(s.lat))
      p.set('lng', String(s.lng))
      p.set('radioKm', '5')
      if (s.cityId) p.set('cityId', s.cityId)
      if (s.sectorId) p.set('sectorId', s.sectorId)
      if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
      centrarEn(s.lat, s.lng, ZOOM_POR_RADIO[5])
      void buscar(p)
    } else {
      // Ciudad sin punto de referencia: el servidor resuelve y re-centra.
      if (s.cityId) p.set('cityId', s.cityId)
      if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
      void buscar(p, { reCentrar: true })
    }
  }

  /** Autocompletar de zonas (debounce 300 ms + abort). */
  const onBusqueda = (v: string) => {
    setBusqueda(v)
    if (zonaTimer.current) clearTimeout(zonaTimer.current)
    if (v.trim().length < 2) {
      setSugerencias([])
      setAbiertaSugerencias(false)
      return
    }
    setBuscandoZona(true)
    zonaTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geo/autocompletar?q=${encodeURIComponent(v.trim())}`)
        const data = await res.json().catch(() => null)
        setSugerencias(res.ok ? (data?.sugerencias ?? []) : [])
        setAbiertaSugerencias(true)
      } catch {
        setSugerencias([])
      } finally {
        setBuscandoZona(false)
      }
    }, 300)
  }

  const toggleFiltro = (key: FiltroBooleano) => {
    setFiltros((prev) => {
      const next: FiltrosCercanos = { ...prev }
      next[key] = !next[key]
      return next
    })
  }

  // Cuando cambian los filtros, se refresca el viewport actual (no se mueve).
  useEffect(() => {
    if (!mapRef.current) return
    const t = setTimeout(() => refrescarViewport(), 50)
    return () => clearTimeout(t)
  }, [filtros, refrescarViewport])

  /** Aceptar consentimiento desde el aviso y reintentar. */
  const permitirConsentimiento = async () => {
    const tipo = contexto === 'CURRENT' ? 'DEVICE_LOCATION_SESSION' : 'FUNCTIONAL_USAGE'
    const res = await aceptarConsentimientoGeo(tipo)
    if (res.ok) {
      setError(null)
      if (contexto === 'HOME') usarVivienda()
    } else {
      setError({ codigo: 'error', mensaje: res.error ?? 'No pudimos guardar tu autorización.' })
    }
  }

  const marcarEnMapa = (s: SucursalCercana) => {
    setSeleccionado(s.id)
    const map = mapRef.current
    if (map) map.flyTo([s.latitud, s.longitud], Math.max(map.getZoom(), 15), { duration: 0.6 })
  }

  return (
    <div className="lg:grid lg:gap-4 lg:px-8 lg:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      {/* ── Mapa ──────────────────────────────────────────────────────────────
          En móvil ocupa el alto útil completo (menos el header del shell y la
          barra inferior) y sin bordes: es la pantalla. En escritorio vuelve a
          ser un panel con su tarjeta al lado. */}
      <section className="relative overflow-hidden lg:rounded-xl lg:border lg:border-border">
        <div
          ref={containerRef}
          className="h-[calc(100svh-3.5rem-4.5rem)] w-full lg:h-[calc(100vh-8rem)]"
        />

        {/* Selector de contexto (pills sobre el mapa) */}
        <div className="absolute left-3 top-3 z-[500] flex flex-wrap gap-2">
          {userId && (
            <button
              type="button"
              onClick={usarVivienda}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-small font-semibold elevation-2 backdrop-blur transition',
                contexto === 'HOME' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground'
              )}
            >
              <Home className="h-3.5 w-3.5" /> Mi vivienda
            </button>
          )}
          <button
            type="button"
            onClick={usarUbicacionActual}
            disabled={usandoGPS}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-small font-semibold elevation-2 backdrop-blur transition disabled:opacity-60',
              contexto === 'CURRENT' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground'
            )}
          >
            {usandoGPS ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
            Mi ubicación
          </button>
        </div>

        {/* Búsqueda de zona (MANUAL) */}
        <div className="absolute left-3 top-14 z-[500] w-[min(320px,calc(100%-24px))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              onFocus={() => setAbiertaSugerencias(sugerencias.length > 0)}
              placeholder="Buscar ciudad, sector o dirección…"
              className="h-10 rounded-full border-border/70 bg-card/95 pl-9 pr-9 shadow-md backdrop-blur"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => { setBusqueda(''); ocultarZona() }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {abiertaSugerencias && (sugerencias.length > 0 || buscandoZona) && (
            <ul className="mt-1.5 max-h-64 overflow-auto rounded-2xl border border-border/70 bg-card/95 shadow-lg backdrop-blur">
              {buscandoZona && sugerencias.length === 0 && (
                <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </li>
              )}
              {sugerencias.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => elegirZona(s)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.etiqueta}</span>
                      <span className="block text-caption capitalize">{s.tipo}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Radio (zoom) */}
        {ubicacion && (
          <div className="absolute bottom-3 left-1/2 z-[500] flex -translate-x-1/2 flex-wrap justify-center gap-1 rounded-full border border-border bg-card/95 p-1 elevation-2 backdrop-blur">
            {RADIOS.map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => aplicarRadio(km)}
                className={cn(
                  'min-h-9 rounded-full px-3 text-caption font-semibold transition',
                  radioKm === km ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {km} km
              </button>
            ))}
            <button
              type="button"
              onClick={() => aplicarRadio(null)}
              className={cn(
                'min-h-9 rounded-full px-3 text-caption font-semibold transition',
                radioKm === null ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Ciudad
            </button>
          </div>
        )}

        {/* Estado: consentimiento / errores */}
        {error?.codigo === 'consentimiento_requerido' && (
          <div className="absolute inset-x-3 bottom-16 z-[500] mx-auto max-w-md rounded-xl border border-border bg-card/95 p-4 elevation-3 backdrop-blur">
            <p className="text-sm font-semibold">Autoriza el uso de tu ubicación</p>
            <p className="mt-1 text-caption">
              Solo usamos tu ubicación para mostrarte negocios cercanos. Nunca la compartimos con otras empresas.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={permitirConsentimiento}>Permitir</Button>
              <Button size="sm" variant="ghost" onClick={() => setError(null)}>Ahora no</Button>
            </div>
          </div>
        )}
        {error && error.codigo !== 'consentimiento_requerido' && (
          <div className="absolute inset-x-3 bottom-16 z-[500] mx-auto max-w-md rounded-xl border border-warning/40 bg-warning/10 p-3 text-small text-warning-foreground elevation-3 backdrop-blur">
            {error.mensaje}
          </div>
        )}
      </section>

      {/* ── Filtros + Lista ───────────────────────────────────────────────────
          Escritorio: columna fija al lado del mapa. */}
      <section className="hidden flex-col gap-3 lg:flex">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFiltro(f.key)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3.5 text-small font-semibold transition',
                filtros[f.key]
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            {ubicacion && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Navigation className="h-3.5 w-3.5 text-primary" />
                {ubicacion}
              </span>
            )}
          </p>
          <p className="shrink-0 text-caption">
            {cargando ? 'Actualizando…' : `${resultados.length} negocio${resultados.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {resultados.length === 0 && !cargando && !error ? (
          <EmptyState
            icon={MapPin}
            title="Sin negocios aquí"
            description="Muévete en el mapa o quita filtros para ver más."
            className="flex-1"
          />
        ) : (
          <ul className="flex flex-col gap-2.5 lg:max-h-[calc(100vh-300px)] lg:overflow-auto lg:pr-1">
            {resultados.map((s) => (
              <TarjetaNegocio key={s.id} s={s} activa={seleccionado === s.id} onAbrir={marcarEnMapa} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Móvil: los mismos resultados, en hoja inferior ───────────────── */}
      <MobileBottomSheet
        abierta={hojaAbierta}
        onToggle={setHojaAbierta}
        titulo="Negocios cerca"
        resumen={
          cargando
            ? 'Actualizando…'
            : `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`
        }
      >
        {resultados.length === 0 && !cargando && !error ? (
          <p className="py-6 text-center text-small text-muted-foreground">
            Sin negocios aquí. Muévete en el mapa o quita filtros.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5 pb-4">
            {resultados.map((s) => (
              <TarjetaNegocio
                key={s.id}
                s={s}
                activa={seleccionado === s.id}
                onAbrir={(x) => {
                  marcarEnMapa(x)
                  setHojaAbierta(false)
                }}
              />
            ))}
          </ul>
        )}
      </MobileBottomSheet>
    </div>
  )
}

/**
 * Resultado del mapa.
 *
 * NO usa `BusinessCard`: esto es una SUCURSAL, no una empresa. Lleva distancia
 * al punto activo, si está abierta ahora, su oferta destacada y dos acciones
 * propias —centrarla en el mapa y cómo llegar—. Forzarla dentro de la tarjeta
 * de empresa habría sido deformar las dos.
 */
function TarjetaNegocio({
  s,
  activa,
  onAbrir,
}: {
  s: SucursalCercana
  activa: boolean
  onAbrir: (s: SucursalCercana) => void
}) {
  // Deja que el sistema operativo elija su app de mapas; en escritorio abre
  // Google Maps. Con nombre además de coordenadas, el destino se reconoce.
  const comoLlegar = `https://www.google.com/maps/dir/?api=1&destination=${s.latitud},${s.longitud}&destination_place_id=`

  return (
    <li
      id={`cercano-${s.id}`}
      className={cn(
        'rounded-xl border bg-card p-3 transition',
        activa ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'
      )}
    >
      <div className="flex items-start gap-3">
        <Link href={s.urlDetalle} className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-small font-bold">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              s.empresaNombre.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-h4 text-foreground">{s.empresaNombre}</p>
              {s.promedioRating !== null && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-caption tabular-nums">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden />
                  {s.promedioRating.toFixed(1)}
                </span>
              )}
            </div>
            <p className="truncate text-caption">
              {s.sector ?? s.ciudad ?? s.direccion ?? s.nombre}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{formatearDistancia(s.distanciaM)}</Badge>
              {s.abierto === true && (
                <Badge variant="success">
                  <Clock className="h-3 w-3" aria-hidden /> Abierto
                </Badge>
              )}
              {s.abierto === false && <Badge variant="outline">Cerrado</Badge>}
              {s.cantidadOfertas > 0 && (
                <Badge variant="warning">
                  {s.cantidadOfertas} oferta{s.cantidadOfertas > 1 ? 's' : ''}
                </Badge>
              )}
              {s.esFavorita && <Badge variant="info">Favorita</Badge>}
            </div>
            {s.ofertaDestacada && (
              <p className="mt-1.5 truncate text-caption font-medium text-primary">
                {s.ofertaDestacada}
              </p>
            )}
          </div>
        </Link>

        <button
          type="button"
          data-mapa
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAbrir(s)
          }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-primary"
          aria-label={`Centrar ${s.empresaNombre} en el mapa`}
        >
          <MapPin className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Cómo llegar: la acción que faltaba. Un mapa sin ruta obliga a copiar
          la dirección a mano y salir de la aplicación por su cuenta. */}
      <a
        href={comoLlegar}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2.5 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-small font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Navigation className="h-4 w-4 text-primary" aria-hidden />
        Cómo llegar
        <span className="sr-only"> a {s.empresaNombre} (se abre en otra pestaña)</span>
      </a>
    </li>
  )
}
