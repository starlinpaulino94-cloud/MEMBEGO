import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CrearCitaBody } from '../lib/api'

export function useCitas(fecha?: string, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'citas', fecha ?? ''],
    queryFn: () => api.getCitas(fecha),
    staleTime: 1000 * 60,
    enabled,
  })
}

export function useCrearCita() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CrearCitaBody) => api.crearCita(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'citas'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'mis-promociones'] })
    },
  })
}

export function useCancelarCita() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (citaId: string) => api.cancelarCita(citaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'citas'] })
    },
  })
}
