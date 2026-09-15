import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useEmpresa(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', 'empresa', slug ?? ''],
    queryFn: () => api.getEmpresa(slug as string),
    staleTime: 1000 * 60 * 5,
    enabled: enabled && !!slug,
  })
}
