/**
 * Onboarding v2 · BANDERA DEL ASISTENTE DE REGISTRO (Fase 4).
 *
 * El asistente progresivo es el flujo por defecto. La bandera existe como
 * SALIDA DE EMERGENCIA: si algo falla en producción, poner
 * `NEXT_PUBLIC_REGISTRO_V2=0` devuelve el formulario clásico sin deploy de
 * código. Cuando el asistente lleve un tiempo estable, la bandera y el
 * formulario clásico se retiran juntos.
 */
export function isRegistroV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_REGISTRO_V2 !== '0'
}
