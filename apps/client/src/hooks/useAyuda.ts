import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CrearTicketAyudaBody } from '../lib/api'

export function useAyuda(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'ayuda'],
    queryFn: () => api.getAyuda(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}

export function useTicketAyuda(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'ayuda-ticket', id ?? ''],
    queryFn: () => api.getTicketAyuda(id as string),
    staleTime: 1000 * 60,
    enabled: enabled && !!id,
  })
}

export function useCrearTicketAyuda() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CrearTicketAyudaBody) => api.crearTicketAyuda(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'ayuda'] })
    },
  })
}
