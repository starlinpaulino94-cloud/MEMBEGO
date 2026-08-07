'use server'

import { getRequestMeta } from '@/lib/server-utils'
import { createRateLimiter } from '@/lib/rate-limit'
import { GeocodingService, GeocodingError } from './service'
import type { GeocodificacionResultado } from './proveedor'

/**
 * Acciones de geocodificación (onboarding, formularios y mapa). Server-only:
 * la API key privada nunca sale del servidor. Límite por IP porque es un
 * servicio externo de pago (cuota diaria) — el navegador no es barrera.
 */

const geoLimiter = createRateLimiter({
  interval: 60 * 1000,
  maxRequests: 30,
  name: 'geo',
})

export interface GeoResult {
  error?: string
  results?: GeocodificacionResultado[]
}

/** Autocompletado de direcciones (sugerencias mientras se escribe). */
export async function autocompletarDireccion(query: string): Promise<GeoResult> {
  const { ipAddress } = await getRequestMeta()
  if (!(await geoLimiter(ipAddress ?? 'unknown'))) {
    return { error: 'Demasiadas búsquedas. Espera un momento e inténtalo de nuevo.' }
  }
  try {
    return { results: await GeocodingService.autocomplete(query) }
  } catch {
    return { error: 'No se pudo completar la búsqueda. Intenta de nuevo.' }
  }
}

/** Geocodifica una dirección completa (primera coincidencia). */
export async function geocodificarDireccion(query: string): Promise<GeoResult> {
  const { ipAddress } = await getRequestMeta()
  if (!(await geoLimiter(ipAddress ?? 'unknown'))) {
    return { error: 'Demasiadas búsquedas. Espera un momento e inténtalo de nuevo.' }
  }
  try {
    return { results: await GeocodingService.forward(query) }
  } catch (e) {
    return { error: e instanceof GeocodingError ? e.message : 'No se pudo resolver la dirección.' }
  }
}

/** Reverso: pin del mapa → dirección legible. */
export async function reverseGeocodificar(
  lat: number,
  lng: number
): Promise<{ error?: string; result?: GeocodificacionResultado }> {
  const { ipAddress } = await getRequestMeta()
  if (!(await geoLimiter(ipAddress ?? 'unknown'))) {
    return { error: 'Demasiadas búsquedas. Espera un momento e inténtalo de nuevo.' }
  }
  try {
    const result = await GeocodingService.reverse(lat, lng)
    return result ? { result } : { error: 'No se encontró una dirección para ese punto.' }
  } catch {
    return { error: 'No se pudo resolver el punto en el mapa.' }
  }
}
