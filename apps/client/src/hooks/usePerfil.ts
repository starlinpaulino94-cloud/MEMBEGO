import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePerfil(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'perfil'],
    queryFn: () => api.getPerfil(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}
