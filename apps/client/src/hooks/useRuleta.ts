import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useRuleta(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'ruleta'],
    queryFn: () => api.getRuleta(),
    staleTime: 1000 * 30,
    enabled,
  })
}

export function useGirarRuleta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.girarRuleta(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'ruleta'] })
    },
  })
}