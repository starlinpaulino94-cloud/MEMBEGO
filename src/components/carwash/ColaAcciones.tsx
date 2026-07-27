'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { moverCola } from '@/modules/carwash/cola-actions'
import { Button } from '@/components/ui/button'

/**
 * App Car Wash · E5 — botones de transición de una entrada de la cola.
 * Recibe los destinos permitidos ya calculados en el servidor.
 *
 * DISEÑO PARA PISTA (F4): esto se usa de pie, en un celular, con las manos
 * mojadas y a veces al sol. Por eso:
 *  - Los botones miden 44 px de alto como mínimo (el estándar táctil). Con el
 *    tamaño `sm` por defecto quedaban en 32 px: demasiado fáciles de errar.
 *  - "Cancelar" pide confirmación y se separa del resto: está pegado a la
 *    acción de avance y un toque errado cancelaba el vehículo sin vuelta atrás.
 */
export function ColaAcciones({
  id,
  destinos,
}: {
  id: string
  destinos: { estado: string; label: string }[]
}) {
  const [pending, startTransition] = useTransition()

  function mover(destino: string, label: string) {
    // Confirmación solo en lo irreversible: cancelar saca el vehículo de la
    // pista y no se puede deshacer desde la interfaz.
    if (destino === 'CANCELADO' && !window.confirm('¿Cancelar este vehículo de la cola?')) {
      return
    }
    startTransition(async () => {
      const res = await moverCola(id, destino)
      if (res.error) toast.error(res.error)
      else toast.success(`${label} ✓`)
    })
  }

  if (destinos.length === 0) return null

  const avances = destinos.filter((d) => d.estado !== 'CANCELADO')
  const cancelar = destinos.find((d) => d.estado === 'CANCELADO')

  return (
    <div className="flex items-center gap-2">
      {avances.map((d) => (
        <Button
          key={d.estado}
          type="button"
          className="min-h-11 flex-1 text-sm font-semibold"
          disabled={pending}
          onClick={() => mover(d.estado, d.label)}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : d.label}
        </Button>
      ))}
      {cancelar && (
        <Button
          type="button"
          variant="ghost"
          // Separado y sin color de acción: no compite con el botón de avance.
          className="min-h-11 shrink-0 px-3 text-xs text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={() => mover(cancelar.estado, cancelar.label)}
        >
          {cancelar.label}
        </Button>
      )}
    </div>
  )
}
