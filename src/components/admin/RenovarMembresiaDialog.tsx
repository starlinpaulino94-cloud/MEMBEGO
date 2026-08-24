'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Printer, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { renovarMembresia } from '@/modules/admin/actions'
import {
  METODOS_COBRO_MEMBRESIA,
  METODO_COBRO_LABEL,
  exigeReferencia,
} from '@/modules/membresias/cobro'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * RENOVAR UNA MEMBRESÍA EN MOSTRADOR.
 *
 * Antes era un botón con una confirmación genérica («¿Renovar membresía?»).
 * El problema no era la interfaz: era que renovar ESCRIBE UN COBRO —pone
 * `pagoConfirmado` y `montoPagado`, o sea que el importe entra en los ingresos
 * del mes— y un clic de más registraba dinero que nadie había recibido.
 *
 * Ahora son dos momentos separados a propósito:
 *
 *   1. DECLARAR el cobro: qué se va a aplicar, por cuánto, y la afirmación
 *      explícita de que el pago ya está en la mano, con su método y
 *      referencia. Hasta aquí no se ha tocado nada.
 *   2. APLICAR y entregar el comprobante, que se imprime leyendo lo que quedó
 *      guardado en el registro.
 *
 * El monto NO es un campo editable. Lo calcula el servidor con el precio
 * vigente del plan; el formulario solo lo enseña. Antes había un input con el
 * precio pintado al renderizar, y ese número acababa en los ingresos aunque el
 * plan hubiera cambiado de precio con la pestaña abierta.
 */
export function RenovarMembresiaDialog({
  membershipId,
  clienteId,
  clienteNombre,
  planNombre,
  precioTexto,
  lavadosPlan,
  lavadosRegalo,
  vigenciaDias,
  vence,
}: {
  membershipId: string
  clienteId: string
  clienteNombre: string
  planNombre: string
  precioTexto: string
  /** Lavados que repone el plan. `null` = plan ilimitado. */
  lavadosPlan: number | null
  /** Lavados de regalo que el cliente ya tiene y que la renovación conserva. */
  lavadosRegalo: number
  vigenciaDias: number
  /** Vencimiento actual, para poder decir si el período se encadena. */
  vence: string | null
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(renovarMembresia, {})
  const [open, setOpen] = useState(false)
  const [metodo, setMetodo] = useState<string>('EFECTIVO')
  const [pagoRecibido, setPagoRecibido] = useState(false)

  const aplicada = Boolean(state.success)

  useEffect(() => {
    if (state.success) {
      toast.success('Membresía renovada.')
      router.refresh()
    }
  }, [state.success, router])

  const sigueVigente = vence != null && new Date(vence) > new Date()
  const necesitaReferencia = exigeReferencia(metodo)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        // Al cerrar se vuelve al estado limpio: dejar marcada la casilla de
        // «ya recibí el pago» de una renovación anterior sería una trampa.
        if (!v) {
          setPagoRecibido(false)
          setMetodo('EFECTIVO')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Renovar
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {aplicada ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                Membresía renovada
              </DialogTitle>
              <DialogDescription>
                {clienteNombre} · {planNombre}
                {lavadosPlan != null ? ` · ${lavadosPlan} lavados disponibles` : ''}
              </DialogDescription>
            </DialogHeader>

            {lavadosRegalo > 0 && (
              <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                Además conserva <strong className="text-foreground">{lavadosRegalo}</strong>{' '}
                lavado{lavadosRegalo === 1 ? '' : 's'} de regalo. La renovación no los toca.
              </p>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cerrar
              </Button>
              {state.registroId && (
                <Button
                  onClick={() =>
                    window.open(
                      `/admin/clientes/${clienteId}/renovacion/${state.registroId}`,
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                >
                  <Printer className="mr-2 h-4 w-4" aria-hidden /> Imprimir comprobante
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="membershipId" value={membershipId} />

            <DialogHeader>
              <DialogTitle>Cobro de la renovación</DialogTitle>
              <DialogDescription>
                Confirma que ya recibiste el pago antes de aplicar. Esto registra
                un ingreso.
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cliente</dt>
                <dd className="text-right font-medium text-foreground">{clienteNombre}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="text-right font-medium text-foreground">{planNombre}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Período</dt>
                <dd className="text-right text-foreground">
                  {vigenciaDias} días
                  {sigueVigente ? ' · desde que vence el actual' : ' · desde hoy'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Se repone a</dt>
                <dd className="text-right text-foreground">
                  {lavadosPlan == null ? 'Lavados ilimitados' : `${lavadosPlan} lavados`}
                </dd>
              </div>
              {lavadosRegalo > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Regalos que conserva</dt>
                  <dd className="text-right text-foreground">{lavadosRegalo}</dd>
                </div>
              )}
              <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">Total a cobrar</dt>
                <dd className="text-right text-h3 text-foreground">{precioTexto}</dd>
              </div>
            </dl>

            <div className="space-y-2">
              <Label htmlFor={`metodo-${membershipId}`}>¿Cómo pagó?</Label>
              <select
                id={`metodo-${membershipId}`}
                name="metodo"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
              >
                {METODOS_COBRO_MEMBRESIA.map((m) => (
                  <option key={m} value={m}>
                    {METODO_COBRO_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>

            {necesitaReferencia && (
              <div className="space-y-2">
                <Label htmlFor={`ref-${membershipId}`}>Referencia</Label>
                <Input
                  id={`ref-${membershipId}`}
                  name="referenciaPago"
                  placeholder="Número de transferencia, voucher…"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Sin referencia no se puede conciliar el pago contra el banco.
                </p>
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
              <input
                type="checkbox"
                name="pagoRecibido"
                checked={pagoRecibido}
                onChange={(e) => setPagoRecibido(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
              />
              <span className="text-foreground">
                Confirmo que <strong>ya recibí</strong> el pago de {precioTexto} de este
                cliente.
              </span>
            </label>

            {state.error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !pagoRecibido}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Aplicar renovación
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
