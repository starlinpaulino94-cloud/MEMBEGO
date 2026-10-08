import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useInicio(categoria?: string | null) {
  return useQuery({
    queryKey: ['cliente', 'inicio', categoria ?? null],
    queryFn: () => api.getInicio(categoria),
    staleTime: 1000 * 60 * 2, // 2 minutos
  })
}
