'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import { MapPin, LocateFixed } from 'lucide-react'
import { OPCIONES_TESELAS, temaOscuroActivo, urlTeselas } from '@/modules/geo/mapa/teselas'

// Centro por defecto: Santo Domingo. Solo se usa si aún no hay coordenadas.
const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]

const round = (n: number) => Number(n.toFixed(6))

/**
 * Selector de ubicación con pin arrastrable sobre OpenStreetMap (Leaflet).
 * Gratuito y sin API key; los tiles se cargan como <img https> (permitido por
 * la CSP). Emite las coordenadas en dos inputs ocultos (latitud/longitud) que
 * viajan con el formulario del perfil.
 */
export function MapaUbicacion({
  lat,
  lng,
}: {
  lat: number | null
  lng: number | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null
  )

  useEffect(() => {
    let cancelled = false
    const start: [number, number] = coords ? [coords.lat, coords.lng] : DEFAULT_CENTER

    import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current).setView(start, coords ? 15 : 12)
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

      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setCoords({ lat: round(p.lat), lng: round(p.lng) })
      })
      map.on('click', (e) => {
        marker.setLatLng(e.latlng)
        setCoords({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) })
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
    // Init una sola vez; las actualizaciones posteriores mueven el marcador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function locateMe() {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) }
      setCoords(c)
      markerRef.current?.setLatLng([c.lat, c.lng])
      mapRef.current?.setView([c.lat, c.lng], 16)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          Arrastra el pin o toca el mapa para marcar tu ubicación exacta.
        </p>
        <button
          type="button"
          onClick={locateMe}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <LocateFixed className="h-3.5 w-3.5" /> Usar mi ubicación
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-xl border border-border"
        // Leaflet necesita un contenedor con altura definida.
        style={{ minHeight: 256 }}
      />

      <p className="text-xs text-muted-foreground">
        {coords
          ? `Coordenadas: ${coords.lat}, ${coords.lng}`
          : 'Sin coordenadas todavía.'}
      </p>

      <input type="hidden" name="latitud" value={coords?.lat ?? ''} />
      <input type="hidden" name="longitud" value={coords?.lng ?? ''} />
    </div>
  )
}
