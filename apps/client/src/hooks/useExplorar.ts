import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useExplorar(params?: { q?: string; category?: string }, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'explorar', params?.q ?? '', params?.category ?? ''],
    queryFn: () => api.getExplorar(params),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}
