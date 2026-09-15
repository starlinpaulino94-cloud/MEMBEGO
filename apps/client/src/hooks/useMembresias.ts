import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useMembresias(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'membresias'],
    queryFn: () => api.getMembresias(),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}
