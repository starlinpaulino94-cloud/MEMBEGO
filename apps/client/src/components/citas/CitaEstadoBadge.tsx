import { Badge } from '../ui/Badge'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info'

const ESTILOS: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDIENTE: { label: 'Por confirmar', variant: 'warning' },
  CONFIRMADA: { label: 'Confirmada', variant: 'success' },
  COMPLETADA: { label: 'Completada', variant: 'secondary' },
  CANCELADA: { label: 'Cancelada', variant: 'destructive' },
  NO_ASISTIO: { label: 'No asistio', variant: 'destructive' },
}

export function CitaEstadoBadge({ estado }: { estado: string }) {
  const e = ESTILOS[estado] ?? { label: estado, variant: 'secondary' as BadgeVariant }
  return <Badge variant={e.variant}>{e.label}</Badge>
}
