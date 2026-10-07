import { useQuery } from '@tanstack/react-query'
import { api, type SugerenciaUbicacion } from '../lib/api'

/**
 * Hook para autocompletar ubicaciones via BFF `/api/v1/cliente/geo/autocompletar`.
 * Debounce recomendado: 300ms en el caller.
 */
export function useGeoAutocompletar(q: string, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'geo', 'autocompletar', q],
    queryFn: () => api.getGeoAutocompletar({ q }),
    staleTime: 1000 * 60 * 5,
    enabled: enabled && q.length >= 2,
  })
}

export type { SugerenciaUbicacion }
