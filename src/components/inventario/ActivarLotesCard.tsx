'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Boxes, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { activarLotesInventario } from '@/modules/inventory/actions'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * INV-5a · Activar los LOTES de un producto. Es de UN SOLO SENTIDO, así que se pide confirmar en dos pasos. Lo que ya hay pasa íntegro
 * al lote «SIN LOTE»; desde ahí cada unidad es de un lote, y se vende, se aparta y se saca primero lo que antes vence.
 */
export function ActivarLotesCard({ varianteId }: { varianteId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmando, setConfirmando] = useState(false)
  const [exigir, setExigir] = useState(false)
  // INV-5c: lotes (varias unidades por lote, con vencimiento) o series (un número de serie por unidad).
  const [modo, setModo] = useState<'LOTES' | 'SERIES'>('LOTES')
  const series = modo === 'SERIES'

  function activar() {
    start(async () => {
      const r = await activarLotesInventario({ varianteId, exigirVencimiento: !series && exigir, series })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? 'Este producto ya llevaba lotes o series.' : series ? `Series activadas. ${formatearCantidad(r.unidades)} unidades quedaron «SIN SERIE» hasta que les asignes su número.` : `Lotes activados. ${formatearCantidad(r.unidades)} unidades pasaron al lote «SIN LOTE».`)
      router.refresh()
    })
  }

  return (
    <Card aria-label="Lotes y vencimiento">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4" aria-hidden />
          Lotes y vencimiento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Con lotes sabes de qué lote es cada unidad y cuándo vence. Se vende, se aparta y se saca <strong>primero lo que antes vence</strong>, y lo vencido deja de venderse. Lo que ya tienes pasa al lote «SIN LOTE».
        </p>
        {!confirmando ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(true)}>
            Activar lotes en este producto
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3" role="group" aria-label="Confirmar la activación de lotes">
            <p className="text-sm">
              <strong>Esto no se puede deshacer en cuanto el producto se mueva con lotes</strong> (una venta, una entrada, una transferencia o un ajuste); antes de eso, sí. Desde ahora este producto se cuenta lote por lote, en un conteo de Inventario → Conteos, no con la cifra suelta de esta ficha; se transfiere y se envía a otra sucursal lote por lote (sale el que antes vence, o el que elijas); se puede recibir —con una entrada de mercancía o con una orden de compra, diciendo de qué lote llegó—, vender, ajustar, dañar y dar de baja. Mientras el producto vaya en camino en una transferencia, no se pueden activar los lotes.
            </p>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">¿Cómo se identifica lo que llega?</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="modo-lotes" className="h-4 w-4" checked={modo === 'LOTES'} onChange={() => setModo('LOTES')} />
                Por lotes (varias unidades comparten un lote y una fecha de vencimiento)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="modo-lotes" className="h-4 w-4" checked={modo === 'SERIES'} onChange={() => setModo('SERIES')} />
                Por series (cada unidad tiene su propio número de serie, sin vencimiento)
              </label>
            </fieldset>
            {series ? (
              <p className="text-sm text-muted-foreground">
                Con series, cada unidad es única: un número de serie no puede estar en dos sitios a la vez y se vende primero la más antigua. Lo que ya tienes queda «SIN SERIE» hasta que le asignes su número (Asignar series).
              </p>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={exigir} onChange={(e) => setExigir(e.target.checked)} />
                Exigir fecha de vencimiento en cada lote nuevo
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={activar} disabled={pending}>
                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
                {series ? 'Sí, activar series' : 'Sí, activar lotes'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
