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
import {
  formatearDistancia,
  formatearMagnitudDistancia,
} from '@/modules/geo/cercanos/distancia'
import { aceptarConsentimientoGeo } from '@/modules/geo/consentimiento/actions'
import { OPCIONES_TESELAS, temaOscuroActivo, urlTeselas } from '@/modules/geo/mapa/teselas'
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

/** Nombre legible del tipo de negocio; si es desconocido, se muestra tal cual. */
const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
  spa: 'Spa',
  barberia: 'Barbería',
}
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
 * DOS MODOS DE BÚSQUEDA, Y LA UI DICE EN CUÁL ESTÁ:
 *
 *  · POR RADIO — al elegir "3 km" se busca dentro de esa distancia del ancla
 *    (tu GPS o tu vivienda) y el mapa se encuadra en consecuencia.
 *  · POR VIEWPORT — al mover o hacer zoom a mano (debounce de 700 ms) manda lo
 *    que se ve: `/api/geo/cercanos?viewport=…` devuelve el rectángulo visible.
 *    Eso deja sin efecto el radio, así que la píldora se apaga y pasa a
 *    "Ciudad".
 *
 * Esa última regla no es cosmética. Antes el radio solo cambiaba el zoom y la
 * búsqueda siempre era por viewport, así que con "3 km" marcado podía salir un
 * negocio a 29 km: el control prometía un filtro que nadie aplicaba. Un control
 * que miente deja de servir para orientarse.
 *
 * En los dos modos la lista de tarjetas se reconstruye con el MISMO resultado
 * que pinta los marcadores — mapa y lista nunca se contradicen.
 *
 * Privacidad (§9): el GPS no se usa sin el gesto del usuario; "Usar mi
 * ubicación" pide permiso al navegador y registra DEVICE_LOCATION_SESSION.
 * Usar la vivienda exige FUNCTIONAL_USAGE; si falta, se muestra un aviso con
 * botón "Permitir" (la API responde `consentimiento_requerido`).
 */

const round = (n: number) => Number(n.toFixed(6))

/**
 * SANEO PARA EL HTML DEL MARCADOR.
 *
 * Leaflet monta el `divIcon` con `innerHTML`, así que el nombre y el logo del
 * negocio —datos que escribe cada empresa en su panel— entran como marcado, no
 * como texto. Sin escapar, un nombre con comillas rompe el atributo y abre la
 * puerta a inyectar HTML en la página de cualquiera que mire el mapa.
 */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape para el interior de `url('…')` en un atributo `style`. */
function escaparCss(s: string): string {
  return s.replace(/[\\'"()\s]/g, (c) => `\\${c}`)
}

/**
 * Solo URLs de imagen http(s) o data URI de imagen. Descarta `javascript:` y
 * cualquier esquema raro que llegue de la base de datos.
 */
function urlImagenSegura(url: string | null): string | null {
  if (!url) return null
  const limpia = url.trim()
  if (/^https?:\/\//i.test(limpia)) return limpia
  if (/^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(limpia)) return limpia
  if (limpia.startsWith('/') && !limpia.startsWith('//')) return limpia
  return null
}

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
  /**
   * Ancla resuelta de la búsqueda actual (lat/lng). El refresco por viewport la
   * reenvía para que el servidor pueda seguir resolviendo el contexto: con
   * `contexto=CURRENT` y sin coordenadas, el GPS de la sesión se perdía en el
   * primer arrastre. Es el estado que faltaba, no un caché.
   */
  const anclaRef = useRef<{ lat: number; lng: number } | null>(null)
  /** Vigila el cambio de tema para swapear las teselas claras/oscuras. */
  const observadorTemaRef = useRef<MutationObserver | null>(null)

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
  /**
   * Categorías presentes ALREDEDOR, no el catálogo entero: ofrecer "Gimnasio"
   * donde no hay ninguno es un callejón sin salida. Solo se recalcula cuando
   * NO hay tipo filtrado — si no, al elegir "Car Wash" el resto de chips
   * desaparecería y no habría forma de volver.
   */
  const [tiposVistos, setTiposVistos] = useState<string[]>([])

  // Búsqueda de zona (MANUAL)
  const [busqueda, setBusqueda] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaUbicacion[]>([])
  const [buscandoZona, setBuscandoZona] = useState(false)
  const [abiertaSugerencias, setAbiertaSugerencias] = useState(false)
  const zonaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Valor vivo de los filtros para `buscar`, sin meterlo en sus dependencias. */
  const filtrosRef = useRef<FiltrosCercanos>({})
  useEffect(() => {
    filtrosRef.current = filtros
  }, [filtros])

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
        const items: SucursalCercana[] = data.resultados ?? []
        setResultados(items)
        if (!filtrosRef.current.tiposNegocio?.length) {
          setTiposVistos([...new Set(items.map((x) => x.tipo).filter(Boolean))].sort())
        }
        if (data.ubicacion?.etiqueta) setUbicacion(data.ubicacion.etiqueta)
        // El servidor es quien resuelve el ancla de HOME y de las zonas del
        // catálogo; guardarla aquí es lo que permite reenviarla al arrastrar.
        if (
          typeof data.ubicacion?.lat === 'number' &&
          typeof data.ubicacion?.lng === 'number'
        ) {
          anclaRef.current = { lat: data.ubicacion.lat, lng: data.ubicacion.lng }
        }
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
    // Mover el mapa a mano deja sin efecto el radio elegido: lo que se ve manda.
    // Si la píldora siguiera marcada estaría prometiendo un filtro que esta
    // búsqueda no aplica —"3 km" con un resultado a 29 km—, y una vez que un
    // control miente, deja de servir para orientarse.
    setRadioKm(null)
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
    // El ancla viaja siempre que se conozca: `contexto=CURRENT` sin coordenadas
    // hacía que el servidor respondiera "no recibimos una ubicación válida de
    // tu dispositivo" en cuanto se arrastraba el mapa tras usar el GPS.
    if (anclaRef.current) {
      p.set('lat', String(anclaRef.current.lat))
      p.set('lng', String(anclaRef.current.lng))
    }
    if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
    void buscar(p)
  }, [contexto, filtros, buscar])

  const refrescarRef = useRef(refrescarViewport)
  useEffect(() => {
    refrescarRef.current = refrescarViewport
  }, [refrescarViewport])

  /**
   * Seleccionar un negocio, venga del pin o de la lista.
   *
   * En escritorio basta con desplazar su fila a la vista. En MÓVIL no: la
   * lista vive en la hoja inferior, que arranca asomada, así que el
   * `scrollIntoView` de antes no hacía nada visible — tocar un pin no
   * mostraba nada. Por eso existe la tarjeta del seleccionado.
   */
  const seleccionar = useCallback((s: SucursalCercana) => {
    setSeleccionado(s.id)
    document.getElementById(`cercano-${s.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [])

  // ── Dibujar marcadores (clusters) y popups desde `resultados` ──────────────
  const pintarMarcadores = useCallback((cluster: { clear: () => void; add: (m: unknown) => void }, items: SucursalCercana[]) => {
    cluster.clear()
    markerRef.current.clear()
    const L = LRef.current
    if (!L) return
    /**
     * Marcador de negocio (§38): el LOGO de la empresa dentro de un disco.
     *
     * Antes era una gota con el color de marca, idéntica para todos. En un mapa
     * con varias empresas eso obliga a tocar pin por pin para saber cuál es
     * cuál — y reconocer la marca es justo a lo que se va al mapa.
     *
     * El HTML se construye a mano porque Leaflet lo inserta por fuera de React,
     * así que todo lo que venga de la base de datos SE ESCAPA: `logoUrl` y
     * `empresaNombre` acaban dentro de un atributo `style` y de un nodo de
     * texto, y una comilla suelta ahí es una inyección.
     */
    const icono = (s: SucursalCercana, activo: boolean) => {
      const clases = [
        'mg-pin',
        s.tieneOfertas ? 'mg-pin--oferta' : '',
        activo ? 'mg-pin--activo' : '',
      ]
        .filter(Boolean)
        .join(' ')

      // La inicial va SIEMPRE, y el logo encima cuando lo hay. Antes eran
      // excluyentes: con una URL presente pero rota —un logo borrado del
      // almacenamiento, un dominio caído— el disco se quedaba vacío, porque un
      // `background-image` que falla no pinta nada y no avisa. Con la inicial
      // debajo, ese fallo degrada a la letra del negocio en vez de a un hueco.
      const url = urlImagenSegura(s.logoUrl)
      const inicial = `<span class="mg-pin__inicial">${escaparHtml((s.empresaNombre[0] ?? '?').toUpperCase())}</span>`
      const interior = url
        ? `${inicial}<span class="mg-pin__logo" style="background-image:url('${escaparCss(url)}')"></span>`
        : inicial

      return L.divIcon({
        className: '',
        html: `<span class="${clases}" title="${escaparHtml(s.empresaNombre)}">
          ${interior}${s.tieneOfertas ? '<span class="mg-pin__oferta"></span>' : ''}
        </span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 40],
      })
    }

    for (const s of items) {
      const activo = s.id === seleccionado
      const m = L.marker([s.latitud, s.longitud], {
        icon: icono(s, activo),
        // El seleccionado se dibuja por encima de sus vecinos.
        zIndexOffset: activo ? 1000 : 0,
      })
      // Sin `bindPopup`: el popup de Leaflet es HTML plano, sin logo, sin
      // distancia y sin acciones. La tarjeta del seleccionado lo sustituye.
      m.on('click', () => seleccionar(s))
      markerRef.current.set(s.id, m)
      cluster.add(m)
    }
  }, [seleccionar, seleccionado])

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
        // Basemap compartido por los tres mapas del producto (modules/geo/mapa/teselas).
        const teselas = (oscuro: boolean) => L.tileLayer(urlTeselas(oscuro), OPCIONES_TESELAS)

        const esOscuro = temaOscuroActivo
        let oscuroActual = esOscuro()
        let capa = teselas(oscuroActual).addTo(map)

        // El tema se cambia desde el header sin recargar, así que el mapa tiene
        // que enterarse: sin esto, alternar a oscuro dejaba un mapa blanco
        // brillante dentro de una app oscura.
        const observador = new MutationObserver(() => {
          if (esOscuro() === oscuroActual) return
          oscuroActual = !oscuroActual
          map.removeLayer(capa)
          capa = teselas(oscuroActual).addTo(map)
          capa.bringToBack()
        })
        observador.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        })
        observadorTemaRef.current = observador

        L.control.zoom({ position: 'bottomright' }).addTo(map)

        // Cluster (o capa simple si markercluster no cargó en runtime).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyL = L as any
        const cluster =
          typeof anyL.markerClusterGroup === 'function'
            ? anyL.markerClusterGroup({
                showCoverageOnHover: false,
                // El marcador mide 38px: agrupar solo cuando de verdad se
                // solapan. Con 45 se juntaban logos que ni se tocaban, y un
                // número gris en lugar de dos marcas es justo lo que uno viene
                // a buscar al mapa.
                maxClusterRadius: 38,
              })
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
      observadorTemaRef.current?.disconnect()
      observadorTemaRef.current = null
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

  /**
   * Radio: busca DE VERDAD dentro de esa distancia, además de encuadrar.
   *
   * Antes solo cambiaba el zoom y dejaba que el `moveend` resultante disparara
   * una búsqueda por viewport. Dos problemas: el `moveend` programático se
   * ignora a propósito (`moviendoRef`), así que la lista podía no refrescarse;
   * y una búsqueda por viewport devuelve TODO lo que se ve, sin mirar el radio.
   * De ahí que con "3 km" marcado apareciera un negocio a 29 km — la píldora
   * prometía un filtro que nadie aplicaba.
   */
  const aplicarRadio = (km: number | null) => {
    setRadioKm(km)
    const map = mapRef.current
    if (!map || !ubicacion) return

    const zoom = km ? (ZOOM_POR_RADIO[km] ?? 12) : 12
    moviendoRef.current = true
    map.setView(map.getCenter(), zoom)

    // "Ciudad" (null) es explícitamente "sin radio": ahí sí manda el viewport.
    if (km === null) {
      refrescarViewport()
      return
    }
    const p = new URLSearchParams()
    p.set('contexto', contexto)
    p.set('radioKm', String(km))
    if (anclaRef.current) {
      p.set('lat', String(anclaRef.current.lat))
      p.set('lng', String(anclaRef.current.lng))
    }
    if (Object.keys(filtros).length) p.set('filtros', JSON.stringify(filtros))
    void buscar(p)
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
        // Antes de cualquier `moveend`: el re-centrado dispara el refresco por
        // viewport, que necesita el ancla ya puesta.
        anclaRef.current = { lat, lng }
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

  /** Un solo tipo a la vez: son categorías excluyentes, no acumulables. */
  const alternarTipo = (tipo: string) => {
    setFiltros((f) => {
      const activo = f.tiposNegocio?.[0] === tipo
      const { tiposNegocio: _ignorado, ...resto } = f
      return activo ? resto : { ...resto, tiposNegocio: [tipo] }
    })
  }

  const negocioSeleccionado = resultados.find((r) => r.id === seleccionado) ?? null

  const marcarEnMapa = (s: SucursalCercana) => {
    seleccionar(s)
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

        {/* ── Controles flotantes ────────────────────────────────────────────
            Un solo bloque en la esquina, no dos capas sueltas con posiciones
            absolutas independientes. Antes las pills iban en `top-3` y el
            buscador en `top-14`: al envolverse las pills en pantallas estrechas
            se montaban encima del campo. Apilados en un contenedor, el hueco lo
            reparte el `gap` y no hay colisión posible. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-col gap-2 sm:w-[min(340px,calc(100%-24px))]">
        <div className="pointer-events-auto flex flex-wrap gap-2">
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
        <div className="pointer-events-auto">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={busqueda}
              aria-label="Buscar ciudad, sector o dirección"
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

        {/* Categorías — §38. La API ya aceptaba `tiposNegocio`; solo faltaba
            exponerlo. Va sobre el mapa para que exista también en móvil, donde
            la columna de filtros no se pinta. Dentro del mismo apilado que las
            pills y el buscador: antes flotaba en `top-16` y se solapaba con
            ellos en cuanto el buscador bajaba de línea. */}
        {tiposVistos.length > 1 && (
          <div className="pointer-events-auto">
            <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {tiposVistos.map((tipo) => {
                const activo = filtros.tiposNegocio?.[0] === tipo
                return (
                  <li key={tipo} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => alternarTipo(tipo)}
                      aria-pressed={activo}
                      className={cn(
                        'inline-flex min-h-9 items-center rounded-full border px-3.5 text-caption font-semibold elevation-2 backdrop-blur transition',
                        activo
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card/95 text-foreground'
                      )}
                    >
                      {TIPO_LABEL[tipo] ?? tipo}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        </div>

        {/* Radio (zoom) */}
        {ubicacion && (
          // `bottom-[4.75rem]` en móvil: la hoja asomada se come las 4 rem
          // inferiores del mapa y este control quedaba debajo del tirador.
          // `flex-wrap` partía las seis opciones en dos filas y el control
          // acababa siendo un bloque que tapaba medio mapa. En una sola línea
          // que se desplaza, ocupa el alto de una píldora y se sigue leyendo.
          <div className="no-scrollbar absolute bottom-[4.75rem] left-1/2 z-[500] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-border bg-card/95 p-1 elevation-2 backdrop-blur lg:bottom-3">
            {RADIOS.map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => aplicarRadio(km)}
                className={cn(
                  'min-h-9 shrink-0 rounded-full px-3 text-caption font-semibold transition',
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
                'min-h-9 shrink-0 rounded-full px-3 text-caption font-semibold transition',
                radioKm === null ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Ciudad
            </button>
          </div>
        )}

        {/* Negocio seleccionado — §38 "card del negocio seleccionado".
            Solo en móvil: en escritorio su fila ya se resalta en la columna
            de al lado, y una tarjeta encima taparía el mapa sin aportar. */}
        {negocioSeleccionado && !error && (
          <div className="absolute inset-x-3 bottom-[8.5rem] z-[600] lg:hidden">
            <TarjetaSeleccionado
              s={negocioSeleccionado}
              onCerrar={() => setSeleccionado(null)}
            />
          </div>
        )}

        {/* Estado: consentimiento / errores */}
        {error?.codigo === 'consentimiento_requerido' && (
          <div className="absolute inset-x-3 bottom-[8.5rem] z-[500] mx-auto max-w-md rounded-xl border border-border bg-card/95 p-4 elevation-3 backdrop-blur lg:bottom-16">
            <p className="text-h4">Autoriza el uso de tu ubicación</p>
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
          <div className="absolute inset-x-3 bottom-[8.5rem] z-[500] mx-auto max-w-md rounded-xl border border-warning/40 bg-warning/10 p-3 text-small text-warning elevation-3 backdrop-blur lg:bottom-16">
            {error.mensaje}
          </div>
        )}
      </section>

      {/* ── Filtros + Lista ───────────────────────────────────────────────────
          Escritorio: columna fija al lado del mapa. */}
      <section className="hidden flex-col gap-3 lg:flex">
        <ChipsFiltro filtros={filtros} onToggle={toggleFiltro} />

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
        {/* Los filtros vivían SOLO en la columna de escritorio: en un teléfono
            no había forma de acotar la búsqueda. */}
        <div className="sticky top-0 z-10 -mx-4 bg-card px-4 pb-3 pt-1">
          <ChipsFiltro filtros={filtros} onToggle={toggleFiltro} />
        </div>
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
              {/* «Ya eres cliente» antes que «Favorita»: es la relación más
                  fuerte de las dos. El mapa marcaba solo el seguimiento, así
                  que un negocio donde la persona lleva un año siendo clienta
                  se le ofrecía igual que uno que no ha pisado nunca. */}
              {s.esCliente && <Badge variant="success">Ya eres cliente</Badge>}
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

/** Chips de filtro booleano. Mismos controles en escritorio y en la hoja. */
function ChipsFiltro({
  filtros,
  onToggle,
}: {
  filtros: FiltrosCercanos
  onToggle: (k: FiltroBooleano) => void
}) {
  return (
    <ul className="no-scrollbar flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
      {FILTROS.map((f) => {
        const activo = Boolean(filtros[f.key])
        return (
          <li key={f.key} className="shrink-0">
            <button
              type="button"
              onClick={() => onToggle(f.key)}
              aria-pressed={activo}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3.5 text-small font-semibold transition',
                activo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Tarjeta del negocio seleccionado, flotando sobre el mapa en móvil.
 *
 * Responde a lo que uno pregunta al tocar un pin: qué es, a qué distancia, si
 * está abierto, si tiene oferta — y las dos acciones que siguen. Sustituye al
 * popup de Leaflet, que era HTML plano sin logo, sin distancia y sin salida.
 */
function TarjetaSeleccionado({
  s,
  onCerrar,
}: {
  s: SucursalCercana
  onCerrar: () => void
}) {
  const comoLlegar = `https://www.google.com/maps/dir/?api=1&destination=${s.latitud},${s.longitud}`

  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-3 elevation-3">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-small font-bold">
          {s.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            s.empresaNombre.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-h4 text-foreground">{s.empresaNombre}</p>
          <p className="truncate text-caption">
            {s.sector ?? s.ciudad ?? s.direccion ?? s.nombre}
          </p>
          {/* La distancia es LA pregunta que se hace al tocar un pin —¿me
              queda cerca?—, así que va como dato propio y no como una insignia
              gris más entre otras tres. "de ti" es literal: se mide desde la
              ubicación activa, no desde el centro del mapa. */}
          {formatearMagnitudDistancia(s.distanciaM) && (
            <p className="mt-1 flex items-center gap-1.5 text-small font-semibold text-primary">
              <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden />
              A {formatearMagnitudDistancia(s.distanciaM)} de ti
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {s.abierto === true && <Badge variant="success">Abierto</Badge>}
            {s.abierto === false && <Badge variant="outline">Cerrado</Badge>}
            {s.cantidadOfertas > 0 && (
              <Badge variant="warning">
                {s.cantidadOfertas} oferta{s.cantidadOfertas > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {s.ofertaDestacada && (
        <p className="mt-2 truncate text-caption font-medium text-primary">{s.ofertaDestacada}</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button asChild size="lg" className="flex-1">
          <Link href={s.urlDetalle}>Ver negocio</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <a href={comoLlegar} target="_blank" rel="noopener noreferrer">
            <Navigation aria-hidden />
            Cómo llegar
          </a>
        </Button>
      </div>
    </div>
  )
}
