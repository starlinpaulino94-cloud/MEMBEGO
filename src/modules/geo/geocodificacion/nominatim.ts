import 'server-only'
import type {
  GeocodificacionResultado,
  GeocodingProvider,
} from './proveedor'

/**
 * Proveedor NOMINATIM (OpenStreetMap) — fallback de desarrollo y plan gratuito.
 *
 * Sin API key. Dos reglas de la política de uso de Nominatim: máx. 1 petición/
 * segundo y un User-Agent/Referer identificativo (por eso se manda aquí).
 * No tiene SLA: en producción se prefiere Geoapify; la app no se acopla a este
 * proveedor gracias a `GeocodingProvider` (G-3).
 */

const BASE = 'https://nominatim.openstreetmap.org'

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'MembeGo/0.2 (membego.com; geolocalizacion@membego.com)',
}

interface NominatimItem {
  lat: string
  lon: string
  display_name: string
  importance?: number
  place_id?: number
  address?: {
    country_code?: string
    state?: string
    region?: string
    city?: string
    town?: string
    municipality?: string
    county?: string
    suburb?: string
    neighbourhood?: string
  }
}

function mapItem(item: NominatimItem): GeocodificacionResultado {
  const a = item.address ?? {}
  return {
    lat: Number(item.lat),
    lng: Number(item.lon),
    formattedAddress: item.display_name,
    countryCode: a.country_code?.toUpperCase(),
    region: a.state ?? a.region,
    city: a.city ?? a.town ?? a.municipality ?? a.county,
    sector: a.suburb ?? a.neighbourhood,
    confidence: item.importance ? Math.min(1, item.importance) : undefined,
    placeId: item.place_id ? String(item.place_id) : undefined,
  }
}

async function get(path: string, params: Record<string, string>): Promise<GeocodificacionResultado[]> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('accept-language', 'es')
  url.searchParams.set('countrycodes', 'do')

  const res = await fetch(url.toString(), { headers: HEADERS, signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`nominatim ${res.status}`)
  const items = (await res.json()) as NominatimItem[]
  return items.map(mapItem)
}

export const nominatimProvider: GeocodingProvider = {
  async forward(query, opts = {}) {
    return get('/search', {
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: String(opts.limit ?? 5),
    })
  },
  async autocomplete(query, opts = {}) {
    // Nominatim no tiene autocomplete separado: se reutiliza /search con más
    // tolerancia. El debounce en cliente evita golpear la política de 1 req/s.
    return get('/search', {
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: String(opts.limit ?? 6),
    })
  },
  async reverse(lat, lng) {
    const [r] = await get('/reverse', {
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
      zoom: '18',
    })
    return r ?? null
  },
}
