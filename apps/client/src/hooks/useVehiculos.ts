import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CrearVehiculoBody } from '../lib/api'

export function useVehiculos(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'vehiculos'],
    queryFn: () => api.getVehiculos(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}

export function useVehiculoTipos(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'vehiculos-tipos'],
    queryFn: () => api.getVehiculoTipos(),
    staleTime: 1000 * 60 * 30,
    enabled,
  })
}

export function useCrearVehiculo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CrearVehiculoBody) => api.crearVehiculo(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'vehiculos'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'ajustes'] })
    },
  })
}