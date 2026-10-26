import type { ReactNode } from 'react'
import { StatusChip } from './status-chip'

/**
 * Los seis tonos de un ESTADO, con el vocabulario del dominio (docs/auditoria-admin/10 §3):
 * éxito · aviso · peligro (error o rechazo) · info · pendiente · neutro (terminado, sin carga emocional).
 */
export type TonoEstado = 'exito' | 'aviso' | 'peligro' | 'info' | 'pendiente' | 'neutro'

const TONO_DEL_CHIP = {
  exito: 'success',
  aviso: 'warning',
  peligro: 'danger',
  info: 'info',
  pendiente: 'pending',
  neutro: 'neutral',
} as const satisfies Record<TonoEstado, string>

/** Para pruebas y para quien necesite recorrer los tonos sin repetir la lista. */
export const TONOS_ESTADO = Object.keys(TONO_DEL_CHIP) as readonly TonoEstado[]

/**
 * EL chip de estado del panel. Hoy hay `Badge`, `StatusChip` y cinco envoltorios para lo mismo, y 54 mapas «estado → clases»
 * repartidos (07 · FE-03). Esta pieza es el destino de todos: se alimenta de `estadoUi(dominio, estado)` (`src/lib/estados.ts`),
 * que decide etiqueta y tono, y SOLO pinta.
 *
 * Se apoya en `StatusChip` (punto + borde + contraste verificado); no lo duplica. `Badge` queda para etiquetas que no son un
 * estado («Nuevo», «Familia»).
 *
 *   const { label, tono } = estadoUi('membresia', m.estado)
 *   <EstadoChip tono={tono}>{label}</EstadoChip>
 *
 * Un estado se DICE además de colorearse: la etiqueta siempre va en texto (10 §1, principio 3).
 */
export function EstadoChip({
  tono,
  pulso,
  className,
  children,
}: {
  tono: TonoEstado
  /** Punto con pulso: solo para estados VIVOS (caja abierta, en línea). */
  pulso?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <StatusChip tone={TONO_DEL_CHIP[tono]} pulso={pulso} className={className}>
      {children}
    </StatusChip>
  )
}
