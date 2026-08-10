import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const ESTILOS: Record<string, { label: string; clase: string }> = {
  PENDIENTE: { label: 'Por confirmar', clase: 'bg-warning/15 text-warning' },
  CONFIRMADA: { label: 'Confirmada', clase: 'bg-success/15 text-success' },
  COMPLETADA: { label: 'Completada', clase: 'bg-muted text-muted-foreground' },
  CANCELADA: { label: 'Cancelada', clase: 'bg-destructive/10 text-destructive' },
  NO_ASISTIO: { label: 'No asistió', clase: 'bg-destructive/10 text-destructive' },
}

export function CitaEstadoBadge({ estado }: { estado: string }) {
  const e = ESTILOS[estado] ?? { label: estado, clase: 'bg-muted text-muted-foreground' }
  return <Badge className={cn('hover:bg-inherit', e.clase)}>{e.label}</Badge>
}
