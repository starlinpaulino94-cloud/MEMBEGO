'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  registrarMovimiento,
  type InventarioActionState,
} from '@/modules/carwash/inventario-actions'
import { MOV_TIPOS, MOV_TIPO_LABELS } from '@/modules/carwash/inventario'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * App Car Wash · E5 — movimiento rápido de stock por producto (fila de la
 * tabla): tipo + cantidad + motivo. AJUSTE fija el stock en la cantidad.
 */
export function MovimientoForm({ productoId }: { productoId: string }) {
  const [state, action, pending] = useActionState<InventarioActionState, FormData>(
    registrarMovimiento,
    {}
  )
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      formRef.current?.reset()
    }
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="productoId" value={productoId} />
      <select
        name="tipo"
        defaultValue="ENTRADA"
        className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground"
      >
        {MOV_TIPOS.map((t) => (
          <option key={t} value={t}>
            {MOV_TIPO_LABELS[t]}
          </option>
        ))}
      </select>
      <Input
        name="cantidad"
        inputMode="decimal"
        required
        placeholder="Cant."
        className="h-9 w-20 text-xs"
      />
      <Input
        name="motivo"
        maxLength={200}
        placeholder="Motivo (opcional)"
        className="h-9 w-36 text-xs"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'OK'}
      </Button>
    </form>
  )
}
