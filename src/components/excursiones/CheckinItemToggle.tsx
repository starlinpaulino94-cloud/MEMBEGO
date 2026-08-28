'use client'

import { useTransition } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { toggleCheckinItem } from '@/modules/excursiones/checkin/actions'
import { Button } from '@/components/ui/button'

interface CheckinItemToggleProps {
  reservaId: string
  itemId: string
  actividadNombre: string
  checkinAt: Date | string | null
  estado: string
}

export function CheckinItemToggle({
  reservaId,
  itemId,
  // `actividadNombre` sigue en las props porque quien lo monta lo pasa; este
  // componente no lo pinta, así que no se desestructura.
  checkinAt,
  estado,
}: CheckinItemToggleProps) {
  const [isPending, startTransition] = useTransition()
  const estaEmbarcado = !!checkinAt || estado === 'CHECKIN_COMPLETADO' || estado === 'EMBARCADA'

  const handleToggle = () => {
    const nuevoEstado = !estaEmbarcado
    startTransition(async () => {
      const res = await toggleCheckinItem(reservaId, itemId, nuevoEstado)
      if (res.error) {
        toast.error(res.error)
      } else if (res.success) {
        toast.success(res.success)
      }
    })
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={estaEmbarcado ? 'outline' : 'default'}
      onClick={handleToggle}
      disabled={isPending}
      className={`h-7 px-2.5 text-xs font-semibold gap-1.5 transition-all active:scale-95 shrink-0 ${
        estaEmbarcado
          ? 'border-success/30 text-success bg-success/5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
          : 'bg-primary text-primary-foreground hover:bg-primary/90'
      }`}
      title={estaEmbarcado ? 'Haz clic para desmarcar check-in' : 'Confirmar check-in de esta actividad'}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : estaEmbarcado ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span>Embarcado</span>
        </>
      ) : (
        <>
          <Circle className="h-3.5 w-3.5" />
          <span>Hacer Check-in</span>
        </>
      )}
    </Button>
  )
}
