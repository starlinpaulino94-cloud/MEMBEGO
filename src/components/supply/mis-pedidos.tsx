'use client'

import { useActionState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  adjuntarComprobanteAction,
  cancelarPedidoAction,
  type EstadoAccion,
} from '@/modules/supply/actions'
import { TEXTO_ESTADO_PEDIDO, type EstadoPedido } from '@/modules/supply/cobro-nucleo'

export interface PedidoVista {
  id: string
  numero: string
  estado: EstadoPedido
  producto: string
  monto: number
  motivoRechazo: string | null
  expiraAt: string
}

export interface CuentaVista {
  id: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
}

/**
 * MEMBEGO SUPPLY · lo que el cliente ve de su compra (Fases 22-23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARÍSIMO
 *
 * Que todavía NO tiene el beneficio. Ha apartado una unidad y tiene un plazo.
 *
 * Es el punto donde una compra por transferencia se rompe de verdad: la persona
 * pulsa «Comprar», ve una pantalla amable, y se va convencida de que ya está.
 * Vuelve tres días después, el pedido expiró y la culpa parece del sitio. Por eso
 * aquí se dice el estado con palabras, se enseña la hora límite, y el botón que
 * queda pendiente es el de enviar el comprobante — no un «listo».
 */
export function MisPedidos({
  pedidos,
  cuentas,
  clienteId,
}: {
  pedidos: PedidoVista[]
  cuentas: CuentaVista[]
  clienteId: string
}) {
  if (pedidos.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-h3 font-semibold">Mis pedidos</h2>
      {pedidos.map((p) => (
        <Pedido key={p.id} pedido={p} cuentas={cuentas} clienteId={clienteId} />
      ))}
    </section>
  )
}

function Pedido({
  pedido,
  cuentas,
  clienteId,
}: {
  pedido: PedidoVista
  cuentas: CuentaVista[]
  clienteId: string
}) {
  const [envio, enviar, enviando] = useActionState<EstadoAccion, FormData>(
    adjuntarComprobanteAction,
    {}
  )
  const [cancel, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(
    cancelarPedidoAction,
    {}
  )

  const esperandoComprobante = pedido.estado === 'INICIADO' && !envio.success
  const limite = new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(pedido.expiraAt))

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{pedido.producto}</p>
            <p className="text-caption text-muted-foreground">Pedido {pedido.numero}</p>
          </div>
          <Badge variant={pedido.estado === 'PAGADO' ? 'success' : 'secondary'}>
            {TEXTO_ESTADO_PEDIDO[pedido.estado]}
          </Badge>
        </div>

        <p className="text-h3 font-semibold">RD${pedido.monto.toLocaleString('es-DO')}</p>

        {pedido.motivoRechazo && (
          <p className="rounded-lg bg-destructive/10 p-3 text-caption">{pedido.motivoRechazo}</p>
        )}

        {esperandoComprobante && (
          <>
            <p className="text-caption text-muted-foreground">
              Apartamos tu unidad hasta el <strong>{limite}</strong>. Transfiere el monto exacto y
              envíanos el comprobante: hasta entonces el beneficio no se puede usar.
            </p>

            {cuentas.length > 0 && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                {cuentas.map((c) => (
                  <div key={c.id} className="text-caption">
                    <p className="font-medium">{c.nombre}</p>
                    {c.titular && <p className="text-muted-foreground">Titular: {c.titular}</p>}
                    {c.numeroCuenta && (
                      <p className="text-muted-foreground">
                        Cuenta: {c.numeroCuenta}
                        {c.tipoCuenta ? ` (${c.tipoCuenta})` : ''}
                      </p>
                    )}
                    {c.instrucciones && <p className="text-muted-foreground">{c.instrucciones}</p>}
                  </div>
                ))}
              </div>
            )}

            <form action={enviar} className="space-y-2">
              <input type="hidden" name="pedidoId" value={pedido.id} />
              <input type="hidden" name="clienteId" value={clienteId} />
              <input
                name="comprobanteUrl"
                required
                maxLength={500}
                placeholder="Enlace a la foto del comprobante"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-body"
              />
              <input
                name="nota"
                maxLength={500}
                placeholder="Nota (opcional): banco, hora de la transferencia…"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-body"
              />
              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? 'Enviando…' : 'Enviar comprobante'}
              </Button>
            </form>

            <form action={cancelar}>
              <input type="hidden" name="pedidoId" value={pedido.id} />
              <input type="hidden" name="clienteId" value={clienteId} />
              <Button type="submit" variant="ghost" size="sm" disabled={cancelando}>
                {cancelando ? 'Cancelando…' : 'Cancelar pedido'}
              </Button>
            </form>
          </>
        )}

        {envio.success && <p className="text-caption text-success">{envio.success}</p>}
        {envio.error && <p className="text-caption text-destructive">{envio.error}</p>}
        {cancel.error && <p className="text-caption text-destructive">{cancel.error}</p>}
      </CardContent>
    </Card>
  )
}
