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
  actividadNombre,
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
          ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
          : 'bg-primary text-primary-foreground hover:bg-primary/90'
      }`}
      title={estaEmbarcado ? 'Haz clic para desmarcar check-in' : 'Confirmar check-in de esta actividad'}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : estaEmbarcado ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
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
