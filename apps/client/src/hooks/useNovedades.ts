import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useNovedades(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'novedades'],
    queryFn: () => api.getNovedades(),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}
