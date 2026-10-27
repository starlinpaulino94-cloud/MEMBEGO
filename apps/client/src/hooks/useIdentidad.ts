import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type PanelIdentidad } from '../lib/api'

export const IDENTIDAD_QUERY_KEY = ['cliente', 'identidad'] as const

/** Cada cuánto, mientras algo está por resolverse (`vista.sondear`), se le pregunta el estado al servidor. */
export const SONDEO_IDENTIDAD_MS = 5000

/**
 * El panel de verificación de identidad. El SERVIDOR decide todo (estado, botón, textos); esto solo lo trae y, mientras la
 * verificación está por resolverse, vuelve a preguntar. Un fallo de red conserva lo último que se vio.
 */
export function useIdentidadPanel(enabled: boolean) {
  return useQuery<PanelIdentidad>({
    queryKey: IDENTIDAD_QUERY_KEY,
    queryFn: api.getIdentidadPanel,
    enabled,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.vista.sondear ? SONDEO_IDENTIDAD_MS : false),
  })
}

/** Para refrescar el panel tras una acción o al volver del navegador. */
export function useRefrescarIdentidad() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: IDENTIDAD_QUERY_KEY })
}

export function useCambiarConsentimientoIdentidad() {
  const refrescar = useRefrescarIdentidad()
  return useMutation({ mutationFn: api.cambiarConsentimientoIdentidad, onSuccess: refrescar })
}

export function useReportarProblemaIdentidad() {
  const refrescar = useRefrescarIdentidad()
  return useMutation({ mutationFn: api.reportarProblemaIdentidad, onSuccess: refrescar })
}

export function useBorrarDatosIdentidad() {
  const refrescar = useRefrescarIdentidad()
  return useMutation({ mutationFn: api.borrarDatosIdentidad, onSuccess: refrescar })
}
