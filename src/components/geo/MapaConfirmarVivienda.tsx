'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import { LocateFixed } from 'lucide-react'
import { OPCIONES_TESELAS, temaOscuroActivo, urlTeselas } from '@/modules/geo/mapa/teselas'

// Centro por defecto: Santo Domingo. Solo se usa si el selector no tiene
// referencia de la zona (ciudad/sector) que centrar.
const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]

const round = (n: number) => Number(n.toFixed(6))

export interface CoordsConfirmadas {
  lat: number
  lng: number
}

export type FuenteCoordenadas = 'MAP_SELECTION' | 'DEVICE_LOCATION'

/**
 * Confirmación visual de una ubicación aproximada (docs/GEOLOCALIZACION.md §4
 * Paso 6 y §8). Pin arrastrable sobre OpenStreetMap (Leaflet, sin API key, ya
 * en la CSP). Emite coordenadas APROXIMADAS por `onChange`; la persona puede
 * mover el pin o tocar el mapa. Este paso SIEMPRE es opcional (omitir).
 *
 * La `fuente` distingue si las coordenadas vinieron del pin (MAP_SELECTION) o
 * del botón GPS (DEVICE_LOCATION): el registro solo persiste DEVICE_LOCATION
 * si la persona las guarda como su vivienda (docs §9.3).
 */
export function MapaConfirmarVivienda({
  lat,
  lng,
  onChange,
}: {
  /** Centro inicial sugerido (p. ej. el punto de referencia del sector). */
  lat?: number | null
  lng?: number | null
  onChange: (coords: CoordsConfirmadas | null, fuente: FuenteCoordenadas) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const [coords, setCoords] = useState<CoordsConfirmadas | null>(
    lat != null && lng != null ? { lat, lng } : null
  )
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    let cancelled = false
    const start: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER

    import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current).setView(start, lat != null ? 14 : 12)
      // Mismo basemap que "Cerca de mí": tres mapas del producto no pueden
      // verse distintos según en cuál caigas.
      L.tileLayer(urlTeselas(temaOscuroActivo()), OPCIONES_TESELAS).addTo(map)

      const icon = L.divIcon({
        className: '',
        html: '<div style="font-size:26px;line-height:1;transform:translate(-2px,-6px)">📍</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      })
      const marker = L.marker(start, { draggable: true, icon }).addTo(map)
      const emitir = (fuente: FuenteCoordenadas) => {
        const p = marker.getLatLng()
        const c = { lat: round(p.lat), lng: round(p.lng) }
        setCoords(c)
        onChange(c, fuente)
      }

      marker.on('dragend', () => emitir('MAP_SELECTION'))
      map.on('click', (e) => {
        marker.setLatLng(e.latlng)
        emitir('MAP_SELECTION')
      })

      mapRef.current = map
      markerRef.current = marker
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markerRef.current = null
      }
    }
    // Inicialización única: el paso se monta/desmonta al entrar/salir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function usarMiUbicacion() {
    if (!('geolocation' in navigator)) return
    setBuscando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) }
        setCoords(c)
        markerRef.current?.setLatLng([c.lat, c.lng])
        mapRef.current?.setView([c.lat, c.lng], 16)
        onChange(c, 'DEVICE_LOCATION')
        setBuscando(false)
      },
      () => setBuscando(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-56 w-full overflow-hidden rounded-xl border border-border">
        <div ref={containerRef} className="h-full w-full" style={{ minHeight: 224 }} />
      </div>

      <button
        type="button"
        onClick={usarMiUbicacion}
        disabled={buscando}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
      >
        <LocateFixed className="h-3.5 w-3.5" />
        {buscando ? 'Buscando…' : 'Usar mi ubicación'}
      </button>

      <p className="text-xs text-muted-foreground">
        {coords
          ? `Ubicación aproximada: ${coords.lat}, ${coords.lng}. Muévela si quieres.`
          : 'Toca el mapa o arrastra el pin para señalar una zona aproximada (opcional).'}
      </p>
    </div>
  )
}
