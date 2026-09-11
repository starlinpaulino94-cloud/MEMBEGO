'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Minus, Plus, Printer, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { ajustarLavados, type AjusteLavadosState } from '@/modules/admin/ajusteLavadosActions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * SUMAR O RESTAR LAVADOS, CON MOTIVO Y COMPROBANTE.
 *
 * Se pide el MOVIMIENTO, no el total: «súmale 1» dice lo que pasó, «ponlo en
 * 4» exige saber cuánto había y se equivoca en cuanto dos personas lo tocan a
 * la vez. El total lo calcula el servidor con el valor del momento.
 *
 * El diálogo NO se cierra al guardar. Un ajuste sin su comprobante impreso es
 * exactamente el agujero que esto viene a tapar, así que al terminar se queda
 * enseñando el enlace al comprobante. Cerrarlo es una decisión de quien lo
 * hizo, no un efecto secundario del éxito.
 */
export function AjustarLavadosDialog({
  membershipId,
  clienteNombre,
  lavados,
  esIlimitado,
}: {
  membershipId: string
  clienteNombre: string
  lavados: number
  esIlimitado: boolean
}) {
  const [open, setOpen] = useState(false)
  const [signo, setSigno] = useState<1 | -1>(1)
  const [cantidad, setCantidad] = useState('1')
  const init: AjusteLavadosState = {}
  const [state, formAction, pending] = useActionState(ajustarLavados, init)

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.comprobanteId) toast.success('Ajuste aplicado. Ya puedes imprimir el comprobante.')
  }, [state])

  // Un plan ilimitado no lleva contador: no hay nada que sumar ni restar.
  if (esIlimitado) return null

  const n = Math.max(1, Math.trunc(Number(cantidad) || 0))
  const resultado = lavados + signo * n

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Sumar o restar lavados"
          aria-label={`Ajustar lavados de ${clienteNombre}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar lavados de {clienteNombre}</DialogTitle>
          <DialogDescription>
            Tiene <span className="font-semibold text-foreground">{lavados}</span> disponibles. El
            ajuste queda auditado y genera un comprobante imprimible.
          </DialogDescription>
        </DialogHeader>

        {state.comprobanteId ? (
          <div className="space-y-4">
            <p className="text-small text-muted-foreground">
              Ajuste registrado. Guarda o imprime el comprobante para la contabilidad.
            </p>
            <Button asChild className="w-full">
              <Link href={`/admin/membresias/ajuste/${state.comprobanteId}`}>
                <Printer className="h-4 w-4" /> Ver comprobante
              </Link>
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="membershipId" value={membershipId} />
            <input type="hidden" name="delta" value={String(signo * n)} />

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">Movimiento</legend>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={signo === -1 ? 'destructive' : 'outline'}
                  size="icon"
                  aria-pressed={signo === -1}
                  aria-label="Restar lavados"
                  onClick={() => setSigno(-1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={signo === 1 ? 'default' : 'outline'}
                  size="icon"
                  aria-pressed={signo === 1}
                  aria-label="Sumar lavados"
                  onClick={() => setSigno(1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  required
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  aria-label="Cantidad de lavados"
                  className="w-24 rounded-xl border border-input bg-background px-3 py-2.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-small text-muted-foreground">
                  queda en{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {Math.max(0, resultado)}
                  </span>
                </span>
              </div>
              {resultado < 0 && (
                <p className="text-caption text-destructive">
                  Solo quedan {lavados}: no se pueden restar {n}.
                </p>
              )}
            </fieldset>

            <label className="block text-sm font-medium text-foreground">
              Motivo
              <textarea
                name="motivo"
                required
                rows={3}
                maxLength={300}
                placeholder="Ej.: la máquina falló y el lavado no se hizo."
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-1 block text-caption text-muted-foreground">
                Aparece en el comprobante. Es lo que le permite cuadrar a quien lleva las cuentas.
              </span>
            </label>

            <Button type="submit" disabled={pending || resultado < 0} className="w-full">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Aplicar ajuste
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
