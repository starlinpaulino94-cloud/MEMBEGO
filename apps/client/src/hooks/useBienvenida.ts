import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useBienvenida(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'bienvenida'],
    queryFn: () => api.getBienvenida(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}