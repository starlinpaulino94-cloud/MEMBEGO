import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type NotificacionesResponse } from '../lib/api'

export const notificacionesQueryKey = (userId: string | null) =>
  ['cliente', 'notificaciones', userId ?? 'sin-usuario'] as const

interface MutationContext {
  readonly previous: NotificacionesResponse | undefined
}

export function useNotificaciones(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: notificacionesQueryKey(userId),
    queryFn: () => api.getNotificaciones(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: enabled && userId !== null,
  })
}

export function useMarcarNotificacionLeida(userId: string | null) {
  const queryClient = useQueryClient()
  const queryKey = notificacionesQueryKey(userId)

  return useMutation({
    mutationFn: (id: string) => api.marcarNotificacionLeida(id),
    onMutate: async (id): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<NotificacionesResponse>(queryKey)
      if (previous) {
        const item = previous.notificaciones.find((notification) => notification.id === id)
        if (item && !item.leida) {
          queryClient.setQueryData<NotificacionesResponse>(queryKey, {
            ...previous,
            notificaciones: previous.notificaciones.map((notification) =>
              notification.id === id ? { ...notification, leida: true } : notification,
            ),
            noLeidas: Math.max(0, previous.noLeidas - 1),
          })
        }
      }
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSuccess: (result) => {
      queryClient.setQueryData<NotificacionesResponse>(queryKey, (current) =>
        current ? { ...current, noLeidas: result.noLeidas } : current,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}

export function useMarcarTodasNotificacionesLeidas(userId: string | null) {
  const queryClient = useQueryClient()
  const queryKey = notificacionesQueryKey(userId)

  return useMutation({
    mutationFn: () => api.marcarTodasNotificacionesLeidas(),
    onMutate: async (): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<NotificacionesResponse>(queryKey)
      if (previous) {
        queryClient.setQueryData<NotificacionesResponse>(queryKey, {
          ...previous,
          notificaciones: previous.notificaciones.map((notification) => ({
            ...notification,
            leida: true,
          })),
          noLeidas: 0,
        })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSuccess: (result) => {
      queryClient.setQueryData<NotificacionesResponse>(queryKey, (current) =>
        current ? { ...current, noLeidas: result.noLeidas } : current,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}
