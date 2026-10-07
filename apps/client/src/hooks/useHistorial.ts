import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useHistorial(page = 1, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'historial', page],
    queryFn: () => api.getHistorial(page),
    staleTime: 1000 * 60,
    enabled,
  })
}
