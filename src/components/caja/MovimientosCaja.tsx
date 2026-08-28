'use client'

/**
 * Movimientos de efectivo intra-turno (Control de comprobantes · Fase 4 · G9):
 * registrar entradas (aporte de fondo) y salidas (retiro, gasto, pago a
 * proveedor) durante el turno, y ver el neto que afecta el arqueo al cerrar.
 */

import { useActionState, useEffect, useRef } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { registrarMovimientoCaja, type CajaActionState } from '@/modules/caja/actions'
import type { MovimientosSesion } from '@/modules/caja/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const initial: CajaActionState = {}

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
const fmtHora = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)

export function MovimientosCaja({
  cajaSesionId,
  movimientos,
}: {
  cajaSesionId: string
  movimientos: MovimientosSesion
}) {
  const [state, formAction, pending] = useActionState(registrarMovimientoCaja, initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success && state.detalle) {
      toast.success(state.detalle)
      formRef.current?.reset()
    }
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Movimientos de efectivo</h2>
      <p className="mb-4 text-caption text-muted-foreground">
        Entradas y salidas de caja que no son cobros (fondo, retiros, gastos).
        Afectan el arqueo al cerrar.
      </p>

      <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end">
        <input type="hidden" name="cajaSesionId" value={cajaSesionId} />
        <div className="space-y-1.5">
          <Label htmlFor="mov-tipo">Tipo</Label>
          <select
            id="mov-tipo"
            name="tipo"
            defaultValue="SALIDA"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="SALIDA">Salida</option>
            <option value="ENTRADA">Entrada</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mov-concepto">Concepto</Label>
          <Input id="mov-concepto" name="concepto" required maxLength={200} placeholder="Ej. Retiro a banco, compra de insumos…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mov-monto">Monto (RD$)</Label>
          <Input id="mov-monto" name="monto" type="number" min="0.01" step="0.01" required className="w-32" />
        </div>
        <Button type="submit" disabled={pending} className="gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
        </Button>
      </form>

      {movimientos.items.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap gap-3 text-caption">
            <span className="inline-flex items-center gap-1 text-success">
              <ArrowDownCircle className="h-3.5 w-3.5" /> Entradas {fmtRD(movimientos.entrada)}
            </span>
            <span className="inline-flex items-center gap-1 text-destructive">
              <ArrowUpCircle className="h-3.5 w-3.5" /> Salidas {fmtRD(movimientos.salida)}
            </span>
            <span className="font-semibold text-foreground">Neto {fmtRD(movimientos.neto)}</span>
          </div>
          <ul className="mt-3 divide-y divide-border/50">
            {movimientos.items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-foreground">{m.concepto}</p>
                  <p className="text-caption text-muted-foreground">
                    {fmtHora(m.createdAt)}
                    {m.registradoPor ? ` · ${m.registradoPor}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${m.tipo === 'ENTRADA' ? 'text-success' : 'text-destructive'}`}
                >
                  {m.tipo === 'ENTRADA' ? '+' : '−'}{fmtRD(m.monto)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
