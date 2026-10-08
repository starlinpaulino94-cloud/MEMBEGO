import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePlanes(
  params?: { todos?: string | number; q?: string; categoria?: string; membershipId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['cliente', 'planes', params ?? {}],
    queryFn: () => api.getPlanes(params),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}
