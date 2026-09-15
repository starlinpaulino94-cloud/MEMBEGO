import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useInicio() {
  return useQuery({
    queryKey: ['cliente', 'inicio'],
    queryFn: () => api.getInicio(),
    staleTime: 1000 * 60 * 2, // 2 minutos
  })
}
