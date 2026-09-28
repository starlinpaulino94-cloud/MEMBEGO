'use client'

import { useActionState } from 'react'
import { Gift } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { abrirPedidoAction, reclamarOfertaAction, type EstadoAccion } from '@/modules/supply/actions'

interface Oferta {
  asignacionId: string
  etiqueta: string
  producto: string
  variante: string | null
  proveedor: string
  disponibles: number
  venceAt: string
  precioReferencia: number | null
  /** Lo que el cliente le paga a Membego. 0 = regalo. */
  precioMembego: number
  esGratis: boolean
}

/**
 * MEMBEGO SUPPLY · la oferta tal como la ve el cliente (Fase 56).
 *
 * «37 disponibles» sale del cupo REAL de la campaña, no de un número
 * decorativo: si la escasez que se enseña no es la que el servidor aplica, la
 * persona pulsa «Obtener» sobre algo que ya se acabó y el sitio queda como que
 * miente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REGALO Y VENTA NO SON EL MISMO BOTÓN
 *
 * Un regalo se obtiene y ya está: no hay dinero, así que el derecho se emite en
 * el acto. Una venta ABRE UN PEDIDO —aparta la unidad y espera el pago—, y hasta
 * que Membego vea el dinero el beneficio no es utilizable.
 *
 * Por eso son dos actions distintas y dos textos distintos. Un «Obtener» que a
 * veces cobra y a veces no es la clase de botón que hace que alguien crea que ya
 * tiene la pizza cuando lo que tiene es una transferencia pendiente.
 */
export function TarjetaOferta({
  oferta,
  clienteId,
  yaLoTengo,
}: {
  oferta: Oferta
  clienteId: string
  yaLoTengo: boolean
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(
    oferta.esGratis ? reclamarOfertaAction : abrirPedidoAction,
    {}
  )
  const obtenido = Boolean(estado.success) || yaLoTengo

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Gift className="size-5 text-primary" aria-hidden />
        </div>

        <div>
          <p className="font-semibold">
            {oferta.esGratis ? '🎁 ' : ''}
            {oferta.producto}
            {oferta.variante ? ` · ${oferta.variante}` : ''}
          </p>
          <p className="text-caption text-muted-foreground">{oferta.proveedor}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="success">Exclusivo Membego</Badge>
          <Badge variant="outline">{oferta.disponibles} disponibles</Badge>
          {oferta.precioReferencia && (
            <Badge variant="secondary">
              {oferta.esGratis ? 'Valor' : 'Antes'} RD$
              {oferta.precioReferencia.toLocaleString('es-DO')}
            </Badge>
          )}
        </div>

        {!oferta.esGratis && (
          <p className="text-h3 font-semibold">
            RD${oferta.precioMembego.toLocaleString('es-DO')}
          </p>
        )}

        <p className="text-caption text-muted-foreground">
          Válido hasta el{' '}
          {new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'long' }).format(
            new Date(oferta.venceAt)
          )}
        </p>

        {obtenido ? (
          <p className="rounded-lg bg-success/10 p-3 text-caption text-success">
            {estado.success ??
              (oferta.esGratis
                ? 'Ya tienes este beneficio. Búscalo en «Beneficios Membego».'
                : 'Ya tienes un pedido de este beneficio. Sigue en «Beneficios Membego».')}
          </p>
        ) : (
          <form action={accion}>
            <input type="hidden" name="asignacionId" value={oferta.asignacionId} />
            <input type="hidden" name="clienteId" value={clienteId} />
            <Button type="submit" className="w-full" disabled={pendiente || !clienteId}>
              {pendiente
                ? oferta.esGratis
                  ? 'Obteniendo…'
                  : 'Apartando…'
                : oferta.esGratis
                  ? 'Obtener'
                  : `Comprar por RD$${oferta.precioMembego.toLocaleString('es-DO')}`}
            </Button>
          </form>
        )}

        {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      </CardContent>
    </Card>
  )
}
