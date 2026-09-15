import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useReferidos(empresa?: string, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'referidos', empresa ?? ''],
    queryFn: () => api.getReferidos(empresa),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}