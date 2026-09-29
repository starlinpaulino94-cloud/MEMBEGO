'use client'

import { useActionState, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { abrirVentaAction, type EstadoAccion } from '@/modules/supply/actions-ventas'

export interface OfertaVentaVista {
  acuerdoId: string
  producto: string
  variante: string | null
  proveedor: string
  precio: number
  disponibles: number
  finAt: string
}

/**
 * MEMBEGO SUPPLY · oferta de VENTA SIN PRECOMPRA tal como la ve el cliente.
 *
 * Distinta de la tarjeta de beneficio: aquí Membego no compró nada por
 * adelantado. Comprar abre un pedido (transferencia + comprobante) y, cuando
 * Membego confirma el pago, el cliente recibe un código de recogida que el
 * negocio escanea al entregar.
 */
export function TarjetaVenta({ oferta, clienteId }: { oferta: OfertaVentaVista; clienteId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(abrirVentaAction, {})
  const [cantidad, setCantidad] = useState(1)
  const total = oferta.precio * cantidad

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <ShoppingBag className="size-5 text-primary" aria-hidden />
        </div>
        <div>
          <p className="font-semibold">
            {oferta.producto}
            {oferta.variante ? ` · ${oferta.variante}` : ''}
          </p>
          <p className="text-caption text-muted-foreground">{oferta.proveedor}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">Vende Membego</Badge>
          <Badge variant="outline">{oferta.disponibles} disponibles</Badge>
        </div>
        <p className="text-h3 font-semibold">RD${oferta.precio.toLocaleString('es-DO')}</p>
        <p className="text-caption text-muted-foreground">
          Hasta el {new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'long' }).format(new Date(oferta.finAt))}. Pagas a
          Membego por transferencia y recoges en el negocio con tu código.
        </p>

        {estado.success ? (
          <p className="rounded-lg bg-success/10 p-3 text-caption text-success">{estado.success}</p>
        ) : (
          <form action={accion} className="space-y-2">
            <input type="hidden" name="acuerdoId" value={oferta.acuerdoId} />
            <input type="hidden" name="clienteId" value={clienteId} />
            <input type="hidden" name="intento" value={String(Date.now())} />
            <label className="flex items-center gap-2 text-sm">
              Cantidad
              <input
                type="number"
                name="cantidad"
                min={1}
                max={Math.min(20, oferta.disponibles)}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="h-9 w-20 rounded-lg border border-input bg-transparent px-3 text-sm"
              />
            </label>
            <Button type="submit" className="w-full" disabled={pendiente || !clienteId}>
              {pendiente ? 'Abriendo pedido…' : `Comprar por RD$${total.toLocaleString('es-DO')}`}
            </Button>
          </form>
        )}
        {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      </CardContent>
    </Card>
  )
}
