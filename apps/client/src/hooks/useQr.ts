import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useQr(id?: string, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'qr', id ?? 'default'],
    queryFn: () => api.getQr(id),
    staleTime: 1000 * 30,
    enabled,
  })
}
