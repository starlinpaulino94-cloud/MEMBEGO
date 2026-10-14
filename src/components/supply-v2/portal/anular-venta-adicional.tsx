'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { reversarVentaAdicionalAction } from '@/modules/visitas-membego/actions'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el proveedor anula una venta adicional
 * que reportó por error (§36). Motivo obligatorio; la comisión, si la había,
 * se reversa con su propio asiento: nada se edita ni se borra.
 */
export function AnularVentaAdicional({ saleId, visitId }: { saleId: string; visitId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(reversarVentaAdicionalAction, {})
  const [abierto, setAbierto] = useState(false)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      setAbierto(false)
      router.refresh()
    }
  }, [estado, router])

  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)} data-testid="btn-anular-venta">
        Anular esta venta
      </Button>
    )
  }
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-anular-venta">
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="visitId" value={visitId} />
      <div>
        <Label htmlFor={`motivo-${saleId}`}>Motivo (obligatorio)</Label>
        <Textarea id={`motivo-${saleId}`} name="motivo" rows={2} maxLength={500} required autoFocus data-testid="motivo-anular-venta" />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pendiente} loading={pendiente} data-testid="btn-anular-venta-confirmar">Anular</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
