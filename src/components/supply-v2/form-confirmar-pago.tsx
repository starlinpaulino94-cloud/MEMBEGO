'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { confirmarPagoClienteAction, rechazarPagoClienteAction } from '@/modules/supply-v2/actions-ofertas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { PagoConfirmado } from '@/modules/supply-v2/commerce/checkout'

/**
 * MEMBEGO SUPPLY · una persona de Membego confirma (o rechaza) el pago de
 * un cliente (§30). Declara el monto que vio; el servidor lo compara con el
 * total congelado. Nunca el cliente.
 */
export function FormConfirmarPago({ orderId, total, moneda }: { orderId: string; total: string; moneda: string }) {
  const [estado, confirmar, pendiente] = useActionState<EstadoAccion<PagoConfirmado>, FormData>(confirmarPagoClienteAction, {})
  const [rechazo, rechazar, rechazando] = useActionState<EstadoAccion, FormData>(rechazarPagoClienteAction, {})
  const [modo, setModo] = useState<'confirmar' | 'rechazar' | null>(null)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const exito = estado.success ?? rechazo.success
    if (exito && visto.current !== exito) {
      visto.current = exito
      toast.success(exito)
      setModo(null)
      router.refresh()
    }
  }, [estado, rechazo, router])

  if (modo === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setModo('confirmar')} data-testid="btn-confirmar-pago">Confirmar pago</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setModo('rechazar')} data-testid="btn-rechazar-pago">Rechazar</Button>
      </div>
    )
  }
  if (modo === 'confirmar') {
    return (
      <form action={confirmar} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="orderId" value={orderId} />
        <div>
          <Label htmlFor={`monto-${orderId}`}>Monto visto ({moneda})</Label>
          <Input id={`monto-${orderId}`} name="amountSeen" type="number" min={0} step="0.01" defaultValue={total} required className="w-36" />
        </div>
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-confirmar-pago-confirmar">Confirmar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
        {estado.error && <p className="w-full text-sm text-destructive" role="alert">{estado.error}</p>}
      </form>
    )
  }
  return (
    <form action={rechazar} className="w-full space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <div>
        <Label htmlFor={`rechazo-${orderId}`}>Motivo del rechazo</Label>
        <Textarea id={`rechazo-${orderId}`} name="reason" rows={2} maxLength={500} required autoFocus />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={rechazando} loading={rechazando}>Rechazar pago</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
      </div>
      {rechazo.error && <p className="text-sm text-destructive" role="alert">{rechazo.error}</p>}
    </form>
  )
}
