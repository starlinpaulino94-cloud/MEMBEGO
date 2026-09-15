import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePagos(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'pagos'],
    queryFn: () => api.getPagos(),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}