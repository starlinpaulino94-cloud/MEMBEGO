import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useIntereses(enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'intereses'],
    queryFn: () => api.getIntereses(),
    staleTime: 1000 * 60 * 5,
    enabled,
  })
}

export function useGuardarIntereses() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (categoryIds: string[]) => api.guardarIntereses(categoryIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', 'intereses'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'explorar'] })
      queryClient.invalidateQueries({ queryKey: ['cliente', 'promociones'] })
    },
  })
}
