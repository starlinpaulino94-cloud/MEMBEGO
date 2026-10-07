'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarMiPedido, confirmarMontoPedido, renovarQrDeMiPedido } from '@/modules/orders/cliente-actions'
import { formatearMonto } from '@/modules/orders/formato'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  pedidoId: string
  moneda: string
  total: string
  puede: { confirmar: boolean; cancelar: boolean; renovarQr: boolean }
  /** `true` si el monto actual ya es distinto al que se pidió (la empresa lo ajustó). */
  hayAjuste: boolean
}

/** Lo que el cliente puede hacer con su pedido; el servidor decidió qué se ofrece y lo vuelve a comprobar. */
export function AccionesMiPedido({ pedidoId, moneda, total, puede, hayAjuste }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [motivo, setMotivo] = useState('')

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) {
    start(async () => {
      const r = await accion()
      if (!r.ok) {
        toast.error(r.error)
        // Si el monto cambió mientras tanto, recargar muestra el nuevo.
        router.refresh()
        return
      }
      toast.success(exito)
      router.refresh()
    })
  }

  if (!puede.confirmar && !puede.cancelar && !puede.renovarQr) return null
  const spinner = pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null

  return (
    <div className="space-y-4" aria-label="Acciones de mi pedido">
      {puede.confirmar && (
        <Card className="border-primary/30">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm">
              {hayAjuste ? 'La empresa ajustó el monto. ' : ''}Confirma que el monto final es <span className="font-semibold tabular-nums">{formatearMonto(total, moneda)}</span>.
            </p>
            <Button disabled={pending} onClick={() => ejecutar(() => confirmarMontoPedido({ pedidoId, montoVisto: total }), 'Monto confirmado.')}>
              {spinner}
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirmar {formatearMonto(total, moneda)}
            </Button>
            <p className="text-xs text-muted-foreground">Confirmar no es pagar: es dejar constancia de que estás de acuerdo con el monto. El pago lo haces con la empresa.</p>
          </CardContent>
        </Card>
      )}

      {puede.renovarQr && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => ejecutar(() => renovarQrDeMiPedido(pedidoId), 'QR nuevo generado: el anterior ya no vale.')}>
          {spinner}
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Generar un QR nuevo
        </Button>
      )}

      {puede.cancelar && (
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <form
              className="space-y-3"
              aria-label="Cancelar mi pedido"
              onSubmit={(e) => {
                e.preventDefault()
                ejecutar(() => cancelarMiPedido({ pedidoId, motivo }), 'Pedido cancelado.')
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="cm-motivo">¿Por qué lo cancelas?</Label>
                <Input id="cm-motivo" name="motivo" maxLength={300} autoComplete="off" required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: ya no lo necesito" />
              </div>
              <Button type="submit" size="sm" variant="destructive" disabled={pending || motivo.trim() === ''}>
                {spinner}
                <Ban className="mr-2 h-3.5 w-3.5" />
                Cancelar pedido
              </Button>
              <p className="text-xs text-muted-foreground">Puedes cancelar mientras la empresa no lo haya aceptado.</p>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
