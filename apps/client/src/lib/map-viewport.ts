import type { CercanoItem } from './api'

export interface MapViewportBounds {
  north: number
  south: number
  east: number
  west: number
}

export function filtrarCercanosEnViewport(
  resultados: CercanoItem[],
  bounds: MapViewportBounds | null,
): CercanoItem[] {
  if (!bounds) return []

  return resultados.filter((resultado) => {
    const latitude = resultado.latitud
    const longitude = resultado.longitud
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return false

    const longitudeEnRango = bounds.west <= bounds.east
      ? longitude >= bounds.west && longitude <= bounds.east
      : longitude >= bounds.west || longitude <= bounds.east

    return latitude >= bounds.south && latitude <= bounds.north && longitudeEnRango
  })
}
