'use client'

/**
 * Aprobar, pagar o anular una liquidación con diálogos modales interactivos.
 * Pagar solicita método y referencia para auditoría bancaria.
 * Anular solicita motivo y libera las comisiones de vuelta al estado APROBADA.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CreditCard, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  cambiarEstadoLiquidacion,
  type LiquidacionActionState,
} from '@/modules/excursiones/liquidaciones/actions'
import {
  ESTADO_LIQUIDACION_LABEL,
  puedeTransicionarLiquidacion,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { METODOS_PAGO, METODO_PAGO_LABEL } from '@/modules/excursiones/reservas/nucleo'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: LiquidacionActionState = {}

export function LiquidacionAcciones({
  liquidacionId,
  estado,
  numero,
  total,
  moneda = 'DOP',
  vendedor,
}: {
  liquidacionId: string
  estado: EstadoLiquidacion
  numero?: string
  total?: number
  moneda?: string
  vendedor?: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cambiarEstadoLiquidacion, init)
  const [pagarOpen, setPagarOpen] = useState(false)
  const [anularOpen, setAnularOpen] = useState(false)
  const [metodoSeleccionado, setMetodoSeleccionado] = useState<string>('TRANSFERENCIA')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      setPagarOpen(false)
      setAnularOpen(false)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  if (estado === 'ANULADA') {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
        <span>Esta liquidación está anulada. Su registro histórico no se reescribe.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Botón: Aprobar Borrador */}
      {puedeTransicionarLiquidacion(estado, 'APROBADA') ? (
        <form action={formAction}>
          <input type="hidden" name="liquidacionId" value={liquidacionId} />
          <input type="hidden" name="estado" value="APROBADA" />
          <Button type="submit" size="sm" variant="default" disabled={pending} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {ESTADO_LIQUIDACION_LABEL.APROBADA}
          </Button>
        </form>
      ) : null}

      {/* Botón: Abrir Modal de Pago */}
      {puedeTransicionarLiquidacion(estado, 'PAGADA') ? (
        <Button
          type="button"
          size="sm"
          onClick={() => setPagarOpen(true)}
          className="gap-1.5"
        >
          <CreditCard className="h-4 w-4" />
          Registrar el pago
        </Button>
      ) : null}

      {/* Botón: Abrir Modal de Anular */}
      {puedeTransicionarLiquidacion(estado, 'ANULADA') ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAnularOpen(true)}
          className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <XCircle className="h-4 w-4" />
          Anular liquidación
        </Button>
      ) : null}

      {/* ── MODAL: REGISTRAR PAGO ── */}
      <Dialog open={pagarOpen} onOpenChange={setPagarOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-h3 font-semibold text-foreground">
              Registrar Pago de Liquidación
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {numero ? `Liquidación ${numero}` : 'Registro de comprobante de pago'}
              {vendedor ? ` · A: ${vendedor}` : ''}
            </DialogDescription>
          </DialogHeader>

          {/* Resumen del monto */}
          {total !== undefined && (
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium block">
                Monto Total a Pagar
              </span>
              <span className="text-h2 font-mono font-bold text-foreground">
                {formatMoney(total, { moneda }, 2)}
              </span>
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="liquidacionId" value={liquidacionId} />
            <input type="hidden" name="estado" value="PAGADA" />

            <div className="space-y-1.5">
              <Label htmlFor="liq-modal-metodo">Método de Pago *</Label>
              <select
                id="liq-modal-metodo"
                name="metodo"
                value={metodoSeleccionado}
                onChange={(e) => setMetodoSeleccionado(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {METODO_PAGO_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="liq-modal-ref">
                Referencia o Comprobante Bancario {metodoSeleccionado !== 'EFECTIVO' ? '*' : '(Opcional)'}
              </Label>
              <Input
                id="liq-modal-ref"
                name="referencia"
                required={metodoSeleccionado !== 'EFECTIVO'}
                placeholder={
                  metodoSeleccionado === 'TRANSFERENCIA'
                    ? 'Ej. TRX-889123'
                    : metodoSeleccionado === 'CHEQUE'
                    ? 'Ej. Cheque #4910'
                    : 'Referencia de pago'
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="liq-modal-notas">Notas u Observaciones</Label>
              <Input
                id="liq-modal-notas"
                name="notas"
                placeholder="Detalles adicionales del pago (opcional)"
              />
            </div>

            <Alert>
              <AlertDescription className="text-xs text-muted-foreground">
                Al confirmar el pago, todas las comisiones asociadas a esta liquidación pasarán
                automáticamente al estado <strong>PAGADA</strong>.
              </AlertDescription>
            </Alert>

            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPagarOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Confirmar y Registrar Pago
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: ANULAR LIQUIDACIÓN ── */}
      <Dialog open={anularOpen} onOpenChange={setAnularOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-h3 font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              ¿Anular esta liquidación?
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {numero ? `Liquidación #${numero}` : ''}
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="liquidacionId" value={liquidacionId} />
            <input type="hidden" name="estado" value="ANULADA" />

            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-muted-foreground">
              Las comisiones en estado <strong>Pendiente de Pago</strong> asociadas a esta
              liquidación se liberarán automáticamente y regresarán a estado <strong>APROBADA</strong>,
              pudiendo incluirse en futuras liquidaciones.
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="liq-anular-motivo">Motivo de anulación *</Label>
              <Input
                id="liq-anular-motivo"
                name="motivo"
                required
                placeholder="Por qué se anula esta liquidación"
              />
            </div>

            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAnularOpen(false)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button type="submit" variant="destructive" disabled={pending} className="gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Confirmar Anulación
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
