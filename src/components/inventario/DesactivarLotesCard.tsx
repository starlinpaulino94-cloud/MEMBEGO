'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { desactivarLotesInventario } from '@/modules/inventory/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * INV-5b5 · Deshacer la activación de lotes. Solo se ofrece mientras ningún movimiento se haya repartido entre lotes (el servidor lo vuelve a
 * comprobar): se activaron por error o antes de usarlos. Las existencias no se tocan; el producto vuelve a ser un producto sin lotes.
 */
export function DesactivarLotesCard({ varianteId }: { varianteId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmando, setConfirmando] = useState(false)

  function desactivar() {
    start(async () => {
      const r = await desactivarLotesInventario({ varianteId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? 'Este producto ya no llevaba lotes.' : 'Lotes desactivados. El producto vuelve a llevarse sin lotes; sus existencias no cambiaron.')
      router.refresh()
    })
  }

  return (
    <Card aria-label="Deshacer la activación de lotes">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Undo2 className="h-4 w-4" aria-hidden />
          ¿Activaste los lotes por error?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Todavía no se ha vendido, recibido, transferido ni ajustado nada de este producto con lotes, así que la activación se puede deshacer. En cuanto eso pase, ya no.
        </p>
        {!confirmando ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(true)}>
            Desactivar los lotes de este producto
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3" role="group" aria-label="Confirmar la desactivación de lotes">
            <p className="text-sm">El producto vuelve a llevarse sin lotes. Sus existencias, sus sucursales y su historial no cambian.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={desactivar} disabled={pending}>
                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                Sí, desactivar lotes
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(false)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
