import { useQuery } from '@tanstack/react-query'
import { api, type BuscarParams } from '../lib/api'

export function useBuscar(params?: BuscarParams, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'buscar', params ?? {}],
    queryFn: () => api.getBuscar(params),
    staleTime: 1000 * 60,
    enabled,
  })
}
