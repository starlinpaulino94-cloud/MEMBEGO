import {
  ESTADO_CLIENTE_LABEL,
  ESTADO_CLIENTE_TONO,
  type EstadoCliente,
} from '@/modules/riesgo/semaforo'

/**
 * La insignia del semáforo. Siempre lleva el MOTIVO en el `title`: un color sin
 * explicación es una etiqueta que cada persona del equipo interpreta a su
 * manera, y de ahí a discutir sobre si «en riesgo» significa lo mismo para
 * todos hay un paso.
 *
 * El punto de color no es solo decoración: en gris (impresión, daltonismo) el
 * texto sigue diciendo el estado, así que la información nunca depende del
 * color.
 */
const CLASES: Record<'success' | 'warning' | 'danger' | 'muted', string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}

export function SemaforoCliente({
  estado,
  motivo,
  className = '',
}: {
  estado: EstadoCliente
  /** La frase que explica el color. La produce `clasificarCliente`. */
  motivo?: string
  className?: string
}) {
  const tono = ESTADO_CLIENTE_TONO[estado]
  return (
    <span
      title={motivo}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold ${CLASES[tono]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {ESTADO_CLIENTE_LABEL[estado]}
    </span>
  )
}
