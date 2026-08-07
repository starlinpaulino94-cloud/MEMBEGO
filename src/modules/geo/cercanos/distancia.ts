/**
 * Distancia geográfica (docs/GEOLOCALIZACION.md §16).
 *
 * `calcularDistanciaM` usa la fórmula de Haversine: distancia en línea recta
 * sobre la esfera. El servidor ordena por esta distancia (SQL) para la búsqueda
 * cercana; la tarjeta la muestra formateada con `formatearDistancia`.
 *
 * Solo se usa para ordenar y mostrar; JAMÁS se presenta como tiempo de llegada
 * por carretera (no hay integración de rutas en el MVP).
 */

const RADIO_TIERRA_M = 6371008.8

export function calcularDistanciaM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a))
}

/**
 * "A 850 m" / "A 2.4 km" / "A 45 m". Con distancia desconocida (null) devuelve
 * "a poca distancia" — nunca un número inventado.
 */
export function formatearDistancia(distanciaM: number | null | undefined): string {
  if (distanciaM === null || distanciaM === undefined || !Number.isFinite(distanciaM)) {
    return 'a poca distancia'
  }
  if (distanciaM < 1000) {
    return `A ${Math.round(distanciaM / 10) * 10} m`
  }
  const km = distanciaM / 1000
  return `A ${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`
}
