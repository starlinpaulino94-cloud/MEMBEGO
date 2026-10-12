'use client'

/**
 * Cierre de un PEDIDO MEMBEGO desde el escáner. El empleado ve qué se entrega y a
 * quién, y confirma: eso cierra el pedido (venta del inventario apartado incluida).
 * Un QR ya canjeado, vencido o de un pedido que aún no está listo se explica en
 * vez de fallar.
 */

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, PackageCheck, ScanLine, ShoppingBag, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { completarPedidoPorQr } from '@/modules/orders/escaner-actions'
import type { PedidoQrLookup } from '@/modules/orders/escaner'
import { ETIQUETA_NIVEL, formatearMonto } from '@/modules/orders/formato'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export function ConfirmPedido({ pedido, onDone, onScanNext }: { pedido: PedidoQrLookup; onDone: () => void; onScanNext?: () => void }) {
  const [pending, start] = useTransition()
  const [cerrado, setCerrado] = useState<{ code: string; nivel: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function confirmar() {
    setError(null)
    start(async () => {
      const r = await completarPedidoPorQr(pedido.token)
      if (!r.ok) {
        setError(r.error)
        toast.error(r.error)
        return
      }
      toast.success('Pedido entregado.')
      setCerrado({ code: r.code, nivel: r.nivel })
    })
  }

  if (cerrado) {
    return (
      <div className="space-y-5" data-testid="pedido-cerrado">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="h-9 w-9 text-success" />
          </div>
          <h3 className="text-h2 text-foreground">Pedido entregado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {cerrado.code} · {ETIQUETA_NIVEL[cerrado.nivel as keyof typeof ETIQUETA_NIVEL] ?? cerrado.nivel}
          </p>
        </div>
        {onScanNext && (
          <Button onClick={onScanNext} size="xl" className="w-full gap-2 font-semibold">
            <ScanLine className="h-5 w-5" />
            Escanear siguiente
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={onDone}>
          Finalizar
        </Button>
      </div>
    )
  }

  const puede = pedido.puedeCerrar
  return (
    <div className="space-y-4" data-testid="pedido-lookup">
      <div className={cn('flex items-center gap-3 rounded-xl border px-4 py-3', puede ? 'border-success/25 bg-success/10' : 'border-destructive/25 bg-destructive/10')}>
        {puede ? <CheckCircle2 className="h-6 w-6 shrink-0 text-success" /> : <XCircle className="h-6 w-6 shrink-0 text-destructive" />}
        <div>
          <p className={cn('font-bold', puede ? 'text-success' : 'text-destructive')}>{puede ? 'Pedido listo para entregar' : 'No se puede entregar'}</p>
          {!puede && pedido.mensaje && <p className="text-sm text-destructive/90">{pedido.mensaje}</p>}
        </div>
      </div>

      <div className={cn('rounded-xl border-2 bg-card p-4', puede ? 'border-success/30' : 'border-destructive/30')}>
        <div className="flex items-start gap-3">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', puede ? 'bg-success/10' : 'bg-destructive/10')}>
            <ShoppingBag className={cn('h-6 w-6', puede ? 'text-success' : 'text-destructive')} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-h2 leading-tight text-foreground">{pedido.code}</p>
            <p className="text-sm text-muted-foreground">
              {pedido.clienteNombre} · {pedido.empresa}
            </p>
            <Badge variant="info" className="mt-1.5 text-caption">
              <PackageCheck className="mr-1 h-3 w-3" /> Pedido Membego
            </Badge>
          </div>
        </div>

        <ul className="mt-4 divide-y border-t border-border/60 pt-1 text-sm" aria-label="Lo que se entrega">
          {pedido.lineas.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="text-foreground">{l.description}</span>
              <span className="tabular-nums text-muted-foreground">× {l.quantity}</span>
            </li>
          ))}
        </ul>

        <div className="mt-2 space-y-1 border-t border-border/60 pt-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="text-h3 font-semibold tabular-nums text-foreground">{formatearMonto(pedido.total, pedido.currency)}</span>
          </div>
          {pedido.oferta && <p className="text-sm font-medium text-primary">Oferta «{pedido.oferta}»: el precio ya trae el descuento.</p>}
          {pedido.ajuste && (
            <p className="text-xs text-muted-foreground">Incluye un ajuste de {formatearMonto(pedido.ajuste, pedido.currency)} de la empresa.</p>
          )}
          <p className="text-xs text-muted-foreground">{pedido.confirmado ? 'El cliente confirmó este monto.' : 'El cliente todavía no confirmó el monto.'}</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!puede ? (
        <Button onClick={onScanNext ?? onDone} size="xl" className="w-full">
          Escanear siguiente
        </Button>
      ) : (
        <div className="flex gap-3">
          <Button type="button" variant="success" disabled={pending} onClick={confirmar} className="flex-1 font-semibold" size="lg">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Entregar y cerrar pedido
          </Button>
          <Button type="button" variant="outline" onClick={onDone} size="xl">
            Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}
