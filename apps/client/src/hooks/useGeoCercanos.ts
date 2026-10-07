import { useQuery } from '@tanstack/react-query'
import { api, type ResultadoCercanos } from '../lib/api'

export interface GeoCercanosParams {
  contexto?: string
  radioKm?: number | null
  lat?: number
  lng?: number
  cityId?: string
  sectorId?: string
  viewport?: string
  filtros?: string
}

/**
 * Hook para obtener negocios cercanos via BFF `/api/v1/cliente/geo/cercanos`.
 * Refrescar al cambiar contexto, radio, viewport o filtros.
 */
export function useGeoCercanos(params: GeoCercanosParams, enabled = true) {
  const key = [
    'cliente',
    'geo',
    'cercanos',
    params.contexto ?? '',
    params.radioKm ?? '',
    params.lat ?? '',
    params.lng ?? '',
    params.cityId ?? '',
    params.sectorId ?? '',
    params.viewport ?? '',
    params.filtros ?? '',
  ]

  return useQuery({
    queryKey: key,
    queryFn: () => {
      const qs: Record<string, string | number | boolean | null | undefined> = {}
      if (params.contexto) qs.contexto = params.contexto
      if (params.radioKm != null) qs.radioKm = params.radioKm
      if (params.lat != null) qs.lat = params.lat
      if (params.lng != null) qs.lng = params.lng
      if (params.cityId) qs.cityId = params.cityId
      if (params.sectorId) qs.sectorId = params.sectorId
      if (params.viewport) qs.viewport = params.viewport
      if (params.filtros) qs.filtros = params.filtros
      return api.getGeoCercanos(qs)
    },
    staleTime: 1000 * 30,
    enabled,
  })
}

export type { ResultadoCercanos }
