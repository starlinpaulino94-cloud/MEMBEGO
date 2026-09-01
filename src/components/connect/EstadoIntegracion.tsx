import { StatusChip } from '@/components/ui/status-chip'
import { ETIQUETA_ESTADO, type EstadoIntegracion as Estado } from '@/modules/connect/proveedores/tipos'

/**
 * EL ESTADO DE UNA INTEGRACIÓN, dicho para una persona.
 *
 * Es el ÚNICO sitio donde un estado interno se convierte en palabras. Que sea
 * uno solo es lo que impide que la rejilla, la página de detalle y el bloque
 * que aparece dentro de Citas digan tres cosas distintas del mismo hecho.
 */

const TONO: Record<Estado, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PROXIMAMENTE: 'neutral',
  NO_DISPONIBLE: 'neutral',
  SIN_PLAN: 'neutral',
  DISPONIBLE: 'info',
  ALTA_SIN_TERMINAR: 'warning',
  CONECTADA: 'success',
  REQUIERE_ATENCION: 'warning',
  REAUTORIZAR: 'warning',
  CON_PROBLEMAS: 'danger',
}

export function EstadoIntegracion({ estado }: { estado: Estado }) {
  // «Disponible» no es un estado que merezca un distintivo: todo lo que se
  // puede conectar lo está. Marcarlo llenaría la rejilla de ruido azul.
  if (estado === 'DISPONIBLE') return null
  return <StatusChip tone={TONO[estado]}>{ETIQUETA_ESTADO[estado]}</StatusChip>
}
