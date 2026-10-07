import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useCelebracion(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'celebracion'],
    queryFn: () => api.getCelebracion(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}