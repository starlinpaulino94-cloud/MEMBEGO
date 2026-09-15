import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type EnviarRegaloBody, type RegalarBody } from '../lib/api'

export function useRegalos(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'regalos'],
    queryFn: () => api.getRegalos(),
    staleTime: 1000 * 60,
    enabled,
  })
}

export function useGiftcardConfig(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'regalos-giftcard'],
    queryFn: () => api.getGiftcardConfig(),
    staleTime: 1000 * 60 * 30,
    enabled,
  })
}

export function useEnviarRegalo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: EnviarRegaloBody) => api.enviarRegalo(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'regalos'] })
    },
  })
}

export function useRegalar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: RegalarBody) => api.regalar(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'regalos'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'mis-promociones'] })
    },
  })
}