import 'server-only'
import { LRUCache } from 'lru-cache'
import type { GeocodificacionResultado, GeocodingProvider } from './proveedor'
import { geoapifyProvider } from './geoapify'
import { nominatimProvider } from './nominatim'

/**
 * GeocodingService (docs/GEOLOCALIZACION.md §7.2).
 *
 * Front común de geocodificación: elige el proveedor por flag de entorno,
 * cachea resultados por dirección normalizada (lru-cache en memoria) y traduce
 * errores de cuota/red en fallos controlados. Server-only: la API key privada
 * nunca sale de aquí.
 */

/** Cache de forward por query normalizada (una petición ≈ una búsqueda). */
const forwardCache = new LRUCache<string, GeocodificacionResultado[]>({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24, // 24h: las direcciones casi no cambian
})

// lru-cache no acepta `null` como valor (genérico `{}`), así que la ausencia
// de resultado se guarda en un wrapper (caché negativa de 24h).
const reverseCache = new LRUCache<string, { resultado: GeocodificacionResultado | null }>({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24,
})

function cacheKey(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function proveedorActivo(): GeocodingProvider {
  switch (process.env.GEOCODING_PROVIDER) {
    case 'nominatim':
      return nominatimProvider
    case 'geoapify':
    default:
      return geoapifyProvider
  }
}

export class GeocodingError extends Error {}

export const GeocodingService = {
  /** Geocodifica una dirección (con caché de 24h). */
  async forward(query: string, opts?: { limit?: number }): Promise<GeocodificacionResultado[]> {
    if (!query.trim()) return []
    const key = cacheKey(query)
    const hit = forwardCache.get(key)
    if (hit) return hit

    try {
      const r = await proveedorActivo().forward(query, opts)
      forwardCache.set(key, r)
      return r
    } catch (e) {
      // 429/403 = cuota: mensaje claro y vacío en vez de romper la UI.
      const msg = e instanceof Error ? e.message : 'geo'
      if (msg.includes('429') || msg.includes('403')) {
        throw new GeocodingError(
          'El servicio de direcciones está sobrecargado. Intenta de nuevo en unos minutos.'
        )
      }
      throw new GeocodingError('No se pudo resolver la dirección. Intenta de nuevo.')
    }
  },

  /** Autocompletado (debounce en cliente; caché de 24h). */
  async autocomplete(query: string, opts?: { limit?: number }): Promise<GeocodificacionResultado[]> {
    if (query.trim().length < 3) return []
    const key = `ac:${cacheKey(query)}`
    const hit = forwardCache.get(key)
    if (hit) return hit

    try {
      const r = await proveedorActivo().autocomplete(query, opts)
      forwardCache.set(key, r)
      return r
    } catch {
      return []
    }
  },

  /** Reverso (pin del mapa → dirección legible). */
  async reverse(lat: number, lng: number): Promise<GeocodificacionResultado | null> {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
    const hit = reverseCache.get(key)
    if (hit !== undefined) return hit.resultado

    try {
      const r = await proveedorActivo().reverse(lat, lng)
      reverseCache.set(key, { resultado: r })
      return r
    } catch {
      return null
    }
  },
}
