/**
 * Contrato del proveedor de geocodificación (docs/GEOLOCALIZACION.md §7.3).
 *
 * La capa de abstracción cumple "no acoplar a un único proveedor": la
 * aplicación habla con `GeocodingService`, y el proveedor se elige por flag de
 * entorno (`GEOCODING_PROVIDER=geoapify|nominatim`). Migrar a Mapbox (ruta de
 * upgrade documentada, G-3) es escribir un proveedor nuevo, no tocar la app.
 */

export interface GeocodificacionResultado {
  lat: number
  lng: number
  formattedAddress: string
  /** ISO 3166-1 alfa-2 en mayúsculas, ej. "DO". */
  countryCode?: string
  /** Provincia/estado (etiqueta local), ej. "Santo Domingo". */
  region?: string
  /** Ciudad/municipio, ej. "Santo Domingo". */
  city?: string
  /** Sector/barrio, ej. "Naco". */
  sector?: string
  /** Confianza 0–1 (para ordenar sugerencias, no para decidir). */
  confidence?: number
  placeId?: string
}

export interface GeocodingProvider {
  /** Geocodificación directa: dirección → coordenadas. */
  forward(query: string, opts?: { limit?: number }): Promise<GeocodificacionResultado[]>
  /** Autocompletado (más tolerante; para sugerencias de búsqueda). */
  autocomplete(query: string, opts?: { limit?: number }): Promise<GeocodificacionResultado[]>
  /** Geocodificación inversa: coordenadas → dirección. */
  reverse(lat: number, lng: number): Promise<GeocodificacionResultado | null>
}
