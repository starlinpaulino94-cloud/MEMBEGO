import { useQuery } from '@tanstack/react-query'
import { api, type BuscarParams, type ExcursionesParams } from '../lib/api'

export function useExcursiones(params?: ExcursionesParams, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'excursiones', params ?? {}],
    queryFn: () => api.getExcursiones(params),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}

export function useBuscarExcursiones(params?: BuscarParams, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'excursiones-buscar', params ?? {}],
    queryFn: () => api.buscarExcursiones(params),
    staleTime: 1000 * 60,
    enabled,
  })
}

export function useMisExcursiones(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'mis-excursiones'],
    queryFn: () => api.getMisExcursiones(),
    staleTime: 1000 * 60 * 2,
    enabled,
  })
}

export function useMiExcursion(reservaId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'mi-excursion', reservaId ?? ''],
    queryFn: () => api.getMiExcursion(reservaId as string),
    staleTime: 1000 * 60,
    enabled: enabled && !!reservaId,
  })
}
