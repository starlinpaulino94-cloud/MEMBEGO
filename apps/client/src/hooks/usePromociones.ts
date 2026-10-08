import { useQuery } from '@tanstack/react-query'
import { api, type PromocionesParams } from '../lib/api'

export function usePromociones(params?: PromocionesParams, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'promociones', params ?? {}],
    queryFn: () => api.getPromociones(params),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}

export function usePromocion(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'promocion', id ?? ''],
    queryFn: () => api.getPromocion(id as string),
    staleTime: 1000 * 60 * 2,
    enabled: enabled && !!id,
  })
}
