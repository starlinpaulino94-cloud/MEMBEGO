'use client'

import { useActionState } from 'react'
import { Gift } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { reclamarOfertaAction, type EstadoAccion } from '@/modules/supply/actions'

interface Oferta {
  asignacionId: string
  etiqueta: string
  producto: string
  variante: string | null
  proveedor: string
  disponibles: number
  venceAt: string
  precioReferencia: number | null
  esGratis: boolean
}

/**
 * MEMBEGO SUPPLY · la oferta tal como la ve el cliente (Fase 56).
 *
 * «37 disponibles» sale del cupo REAL de la campaña, no de un número
 * decorativo: si la escasez que se enseña no es la que el servidor aplica, la
 * persona pulsa «Obtener» sobre algo que ya se acabó y el sitio queda como que
 * miente.
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
    reclamarOfertaAction,
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
              Valor RD${oferta.precioReferencia.toLocaleString('es-DO')}
            </Badge>
          )}
        </div>

        <p className="text-caption text-muted-foreground">
          Válido hasta el{' '}
          {new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'long' }).format(
            new Date(oferta.venceAt)
          )}
        </p>

        {obtenido ? (
          <p className="rounded-lg bg-success/10 p-3 text-caption text-success">
            {estado.success ?? 'Ya tienes este beneficio. Búscalo en «Beneficios Membego».'}
          </p>
        ) : (
          <form action={accion}>
            <input type="hidden" name="asignacionId" value={oferta.asignacionId} />
            <input type="hidden" name="clienteId" value={clienteId} />
            <Button type="submit" className="w-full" disabled={pendiente || !clienteId}>
              {pendiente ? 'Obteniendo…' : 'Obtener'}
            </Button>
          </form>
        )}

        {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      </CardContent>
    </Card>
  )
}
