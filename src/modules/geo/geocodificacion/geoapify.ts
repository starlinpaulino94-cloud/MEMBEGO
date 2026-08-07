import 'server-only'
import type {
  GeocodificacionResultado,
  GeocodingProvider,
} from './proveedor'

/**
 * Proveedor GEOAPIFY (decisión G-3, aprobada 2026-08-06).
 *
 * Se eligió porque permite ALMACENAR las coordenadas resultantes (a diferencia
 * de Mapbox Temporary, que lo prohíbe), tiene capa gratuita (~3.000 créditos/
 * día) y autocomplete de calidad. Requiere `GEOAPIFY_API_KEY` en el servidor.
 *
 * La clave NUNCA viaja al navegador: este módulo es server-only.
 */

const BASE = 'https://api.geoapify.com/v1/geocode'

function apiKey(): string {
  const key = process.env.GEOAPIFY_API_KEY
  if (!key) throw new Error('GEOAPIFY_API_KEY no configurada (docs/GEOLOCALIZACION.md §16 G-3)')
  return key
}

interface GeoapifyFeature {
  properties: {
    lat?: number
    lon?: number
    formatted?: string
    country_code?: string
    region?: string
    state?: string
    city?: string
    county?: string
    suburb?: string
    neighbourhood?: string
    district?: string
    result_type?: string
    rank?: { confidence?: number; confidence_city_level?: number }
    place_id?: string
  }
}

function mapFeature(f: GeoapifyFeature): GeocodificacionResultado | null {
  const p = f.properties
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !p.formatted) return null
  return {
    lat: p.lat,
    lng: p.lon,
    formattedAddress: p.formatted,
    countryCode: p.country_code?.toUpperCase(),
    region: p.state ?? p.region,
    city: p.city ?? p.county,
    sector: p.suburb ?? p.neighbourhood ?? p.district,
    confidence: p.rank?.confidence,
    placeId: p.place_id,
  }
}

async function get(path: string, params: Record<string, string>): Promise<GeocodificacionResultado[]> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('apiKey', apiKey())

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) {
    // 429 = cuota del día agotada. Se deja pasar al servicio para que lo
    // traduzca en un mensaje amigable y sugiera el fallback.
    if (res.status === 429 || res.status === 403) throw new Error(`geoapify ${res.status}`)
    throw new Error(`geoapify ${res.status}`)
  }
  const data = (await res.json()) as { features?: GeoapifyFeature[] }
  return (data.features ?? []).map(mapFeature).filter((x): x is GeocodificacionResultado => x !== null)
}

export const geoapifyProvider: GeocodingProvider = {
  async forward(query, opts = {}) {
    return get('/search', {
      text: query,
      lang: 'es',
      limit: String(opts.limit ?? 5),
      format: 'json',
    })
  },
  async autocomplete(query, opts = {}) {
    return get('/autocomplete', {
      text: query,
      lang: 'es',
      limit: String(opts.limit ?? 6),
    })
  },
  async reverse(lat, lng) {
    const [r] = await get('/reverse', {
      lat: String(lat),
      lon: String(lng),
      lang: 'es',
      format: 'json',
    })
    return r ?? null
  },
}
