'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { moverCola } from '@/modules/carwash/cola-actions'
import { Button } from '@/components/ui/button'

/**
 * App Car Wash · E5 — botones de transición de una entrada de la cola.
 * Recibe los destinos permitidos ya calculados en el servidor.
 */
export function ColaAcciones({
  id,
  destinos,
}: {
  id: string
  destinos: { estado: string; label: string }[]
}) {
  const [pending, startTransition] = useTransition()

  function mover(destino: string) {
    startTransition(async () => {
      const res = await moverCola(id, destino)
      if (res.error) toast.error(res.error)
    })
  }

  if (destinos.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {destinos.map((d) => (
        <Button
          key={d.estado}
          type="button"
          size="sm"
          variant={d.estado === 'CANCELADO' ? 'ghost' : 'secondary'}
          className={d.estado === 'CANCELADO' ? 'text-destructive hover:text-destructive' : ''}
          disabled={pending}
          onClick={() => mover(d.estado)}
        >
          {d.label}
        </Button>
      ))}
    </div>
  )
}
