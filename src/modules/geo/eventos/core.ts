/** Redondeo de coordenadas para analítica: precisión aproximada de ~1 km. */
export function redondearCoordenada(coord: number): number {
  return Math.round(coord * 100) / 100
}
