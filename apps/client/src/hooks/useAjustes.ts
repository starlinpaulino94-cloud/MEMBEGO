import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ActualizarAjustesBody } from '../lib/api'

export function useAjustes(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'ajustes'],
    queryFn: () => api.getAjustes(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}

export function useActualizarAjustes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ActualizarAjustesBody) => api.actualizarAjustes(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'ajustes'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'perfil'] })
    },
  })
}