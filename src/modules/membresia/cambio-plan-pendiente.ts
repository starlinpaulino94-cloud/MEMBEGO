/**
 * Un cambio que el cliente ya solicitó solo puede aplicarse por la vía de
 * aprobación (`aprobarCambioPlan`), que cobra la DIFERENCIA prorrateada. La vía
 * directa del negocio (`cambiarPlanDeMembresia`) cobra el plan nuevo completo y
 * reinicia el período: si pasara por encima de una solicitud pendiente, el
 * mismo cambio quedaría con dos importes distintos según el botón.
 *
 * Devuelve el motivo del bloqueo, o `null` si la vía directa es legítima.
 */
export function motivoCambioDirectoBloqueado(
  planIdSolicitado: string | null | undefined
): string | null {
  if (!planIdSolicitado) return null
  return 'Esta membresía tiene un cambio de plan solicitado por el cliente: apruébalo o recházalo antes de cambiarlo por esta vía.'
}
