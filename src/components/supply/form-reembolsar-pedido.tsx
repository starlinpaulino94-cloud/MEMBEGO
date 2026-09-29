'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { reembolsarPedidoAction, type EstadoAccion } from '@/modules/supply/actions'

/** Reembolso de un cobro PAGADO: exige motivo y deja el pedido en su estado final propio. */
export function FormReembolsarPedido({ pedidoId }: { pedidoId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(reembolsarPedidoAction, {})
  if (estado.success) return <span className="text-caption text-success">{estado.success}</span>
  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (!window.confirm('Registra que Membego devolvió el dinero y cancela el beneficio o la venta. ¿Continuar?')) e.preventDefault()
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input name="motivo" required maxLength={500} placeholder="Motivo del reembolso" aria-label="Motivo del reembolso" className="h-9 min-w-40 rounded-lg border border-input bg-background px-2 text-body" />
      <Button type="submit" size="sm" variant="ghost" disabled={pendiente}>
        {pendiente ? 'Reembolsando…' : 'Reembolsar'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
    </form>
  )
}
