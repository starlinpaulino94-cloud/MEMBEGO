'use client'

/**
 * Cobros de la reserva: registrar un abono y anular uno mal registrado.
 *
 * El pago anulado NO desaparece de la lista — se queda tachado y con su
 * motivo. La trazabilidad del dinero es más importante que una tabla limpia
 * (§99), y quien audite necesita ver que se cobró y se deshizo.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  registrarPago,
  anularPago,
  type ReservaActionState,
} from '@/modules/excursiones/reservas/actions'
import { METODOS_PAGO, METODO_PAGO_LABEL } from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDateTime, formatMoney } from '@/lib/format'

const init: ReservaActionState = {}

export interface PagoFila {
  id: string
  monto: string
  metodo: string
  referencia: string | null
  estado: string
  notas: string | null
  createdAt: Date
}

export function ReservaPagos({
  reservaId,
  moneda,
  saldo,
  pagado,
  total,
  pagos,
  admitePagos,
}: {
  reservaId: string
  moneda: string
  saldo: number
  pagado: number
  total: number
  pagos: PagoFila[]
  admitePagos: boolean
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(registrarPago, init)
  const [anularState, anularAction, anulando] = useActionState(anularPago, init)
  const [anularId, setAnularId] = useState<string | null>(null)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  // Al refrescar, el pago ya viene ANULADO y esa rama se pinta antes que el
  // formulario: la fila se cierra sola, sin tocar el estado desde el efecto.
  useEffect(() => {
    if (anularState.success) {
      toast.success(anularState.success)
      router.refresh()
    }
    if (anularState.error) toast.error(anularState.error)
  }, [anularState, router])

  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Cobros</h2>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-muted/50 p-3">
          <dd className="text-h3 text-foreground">{dinero(total)}</dd>
          <dt className="text-caption text-muted-foreground">Total</dt>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <dd className="text-h3 text-foreground">{dinero(pagado)}</dd>
          <dt className="text-caption text-muted-foreground">Pagado</dt>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <dd className="text-h3 text-foreground">{dinero(saldo)}</dd>
          <dt className="text-caption text-muted-foreground">Saldo</dt>
        </div>
      </dl>

      {admitePagos && saldo > 0 ? (
        <form action={formAction} className="mt-4 space-y-3 rounded-xl border border-border p-4">
          <input type="hidden" name="reservaId" value={reservaId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="pago-monto">Monto *</Label>
              <Input
                id="pago-monto"
                name="monto"
                type="number"
                min="0.01"
                step="0.01"
                max={saldo}
                required
                placeholder={String(saldo)}
              />
            </div>
            <div>
              <Label htmlFor="pago-metodo">Método</Label>
              <select
                id="pago-metodo"
                name="metodo"
                className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m} value={m}>{METODO_PAGO_LABEL[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pago-ref">Referencia</Label>
              <Input id="pago-ref" name="referencia" placeholder="Autorización, depósito…" />
            </div>
          </div>
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Registrar pago
          </Button>
        </form>
      ) : null}

      {pagos.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Monto</th>
                <th className="py-2 pr-3">Método</th>
                <th className="py-2 pr-3">Referencia</th>
                <th className="py-2 pr-3">Cuándo</th>
                <th className="py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium text-foreground">
                    <span className={p.estado === 'ANULADO' ? 'line-through' : ''}>
                      {dinero(p.monto)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {METODO_PAGO_LABEL[p.metodo as keyof typeof METODO_PAGO_LABEL] ?? p.metodo}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{p.referencia ?? '—'}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDateTime(p.createdAt)}</td>
                  <td className="py-2">
                    {p.estado === 'ANULADO' ? (
                      <div>
                        <StatusChip tone="neutral">Anulado</StatusChip>
                        {p.notas ? (
                          <p className="mt-1 text-caption text-muted-foreground">{p.notas}</p>
                        ) : null}
                      </div>
                    ) : anularId === p.id ? (
                      <form action={anularAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="pagoId" value={p.id} />
                        <Input
                          name="motivo"
                          required
                          placeholder="Motivo de la anulación"
                          aria-label="Motivo de la anulación"
                          className="h-8 w-48"
                        />
                        <Button type="submit" size="sm" variant="destructive" disabled={anulando}>
                          Confirmar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAnularId(null)}
                        >
                          Cancelar
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <StatusChip tone="success">Registrado</StatusChip>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAnularId(p.id)}
                        >
                          Anular
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Todavía no hay cobros registrados.</p>
      )}
    </section>
  )
}
