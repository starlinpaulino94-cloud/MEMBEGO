'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { editarOfertaAction } from '@/modules/supply-v2/actions-ofertas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

export interface OfertaEditable {
  title: string
  description: string
  publicPrice: string
  salePrice: string
  perCustomerLimit: number
  /** `yyyy-mm-dd` o vacío si la oferta no tiene fin. */
  endsAt: string
}

/**
 * MEMBEGO SUPPLY 2.0 · formulario de EDICIÓN de una oferta.
 *
 * El servidor recalcula y revalida todo: esto solo recoge. Lo que NO está aquí
 * está fuera a propósito y la pantalla lo explica —las unidades, el producto y
 * el enlace público no se editan—, para que nadie busque un campo que no va a
 * encontrar.
 */
export function FormEditarOferta({
  offerId,
  inicial,
  moneda,
  unidades,
}: {
  offerId: string
  inicial: OfertaEditable
  moneda: string
  unidades: number
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(editarOfertaAction, {})
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

  const simbolo = moneda === 'DOP' ? 'RD$' : moneda

  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="offerId" value={offerId} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" defaultValue={inicial.title} maxLength={160} required data-testid="editar-titulo" />
          </div>
          <div>
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" defaultValue={inicial.description} rows={3} maxLength={2000} data-testid="editar-descripcion" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium">Precio</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="publicPrice">Precio público ({simbolo})</Label>
              <Input id="publicPrice" name="publicPrice" defaultValue={inicial.publicPrice} inputMode="decimal" required data-testid="editar-precio-publico" />
            </div>
            <div>
              <Label htmlFor="salePrice">Precio Membego ({simbolo})</Label>
              <Input id="salePrice" name="salePrice" defaultValue={inicial.salePrice} inputMode="decimal" required data-testid="editar-precio-membego" />
            </div>
          </div>
          <p className="text-caption text-muted-foreground">
            El precio solo se puede cambiar si no hay compras en curso: quien ya tiene una reserva viva está a punto de
            pagar lo que la pantalla le prometió.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="perCustomerLimit">Máximo por persona</Label>
              <Input id="perCustomerLimit" name="perCustomerLimit" type="number" min={1} max={unidades} defaultValue={inicial.perCustomerLimit} required data-testid="editar-limite" />
            </div>
            <div>
              <Label htmlFor="endsAt">Válida hasta (opcional)</Label>
              <Input id="endsAt" name="endsAt" type="date" defaultValue={inicial.endsAt} data-testid="editar-fin" />
            </div>
          </div>
          <p className="text-caption text-muted-foreground">
            Las {unidades.toLocaleString('es-DO')} unidades, el producto y el enlace público no se editan: cambiarlos es
            otra oferta. Para terminarla antes de tiempo usa «Finalizar», que devuelve al supply lo que no se vendió.
          </p>
        </CardContent>
      </Card>

      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}

      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-oferta">
        Guardar cambios
      </Button>
    </form>
  )
}
