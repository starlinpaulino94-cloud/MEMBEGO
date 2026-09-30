'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { reversarRedencionAction } from '@/modules/supply-v2/actions-canje'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { ReversaHecha } from '@/modules/supply-v2/redemption/service'

/** Reversar una redención con motivo obligatorio (§36). */
export function ReversarRedencion({ redemptionId }: { redemptionId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<ReversaHecha>, FormData>(reversarRedencionAction, {})
  const [abierto, setAbierto] = useState(false)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
    if (estado.error) toast.error(estado.error)
  }, [estado, router])

  if (!abierto) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Reversar devuelve la unidad al cliente (REDEEMED → ISSUED). Úsalo por error humano, entrega marcada por error o incidencia validada.</p>
        <Button type="button" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-reversar">Reversar redención</Button>
      </div>
    )
  }
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="redemptionId" value={redemptionId} />
      <div>
        <Label htmlFor="motivoReversa">Motivo de la reversa (obligatorio)</Label>
        <Textarea id="motivoReversa" name="motivo" rows={2} maxLength={500} required autoFocus data-testid="motivo-reversa" />
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pendiente} loading={pendiente} data-testid="btn-reversar-confirmar">Confirmar reversa</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
