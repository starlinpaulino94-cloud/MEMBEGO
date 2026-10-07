import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AgendarPromocionBody } from '../lib/api'

export function useMisPromociones(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'mis-promociones'],
    queryFn: () => api.getMisPromociones(),
    staleTime: 1000 * 60,
    enabled,
  })
}

export function useMisPromocion(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'mis-promocion', id ?? ''],
    queryFn: () => api.getMisPromocion(id as string),
    staleTime: 1000 * 60,
    enabled: enabled && !!id,
  })
}

export function useAgendarPromocion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgendarPromocionBody }) =>
      api.agendarPromocion(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'mis-promociones'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'citas'] })
    },
  })
}

export function useRegaloInvitado(invitadoId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'regalo-invitado', invitadoId ?? ''],
    queryFn: () => api.getRegaloInvitado(invitadoId as string),
    staleTime: 1000 * 60,
    enabled: enabled && !!invitadoId,
  })
}

export function useReclamarRegaloInvitado() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invitadoId: string) => api.reclamarRegaloInvitado(invitadoId),
    onSuccess: (_data, invitadoId) => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'regalo-invitado', invitadoId] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'mis-promociones'] })
    },
  })
}
