import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useMenu() {
  return useQuery({
    queryKey: ['cliente', 'menu'],
    queryFn: () => api.getMenu(),
    staleTime: 1000 * 60 * 10, // 10 minutos
  })
}
