'use client'

/**
 * App Car Wash · Fase 2 — estado de cuenta de una flota.
 *
 * LO QUE ORDENA ESTA PANTALLA: el ciclo del dinero, en el orden en que ocurre.
 *   1. Se acumulan consumos (por facturar).
 *   2. Se cierra el período → todos pasan a facturado con una referencia.
 *   3. Se cobra ese corte → pasa a pagado.
 * Cada paso es un botón, y el número que se ve arriba es el que se le reclama
 * al cliente. Sin esos tres estados, "¿cuánto me debe la flota?" se responde
 * sumando a mano.
 */

import { useActionState, useEffect, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Receipt, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  agregarVehiculoCuenta,
  quitarVehiculoCuenta,
  agregarCargoManual,
  cerrarCorte,
  marcarCortePagado,
  type Fase2State,
} from '@/modules/carwash/fase2-actions'
import { CARGO_ESTADO_LABELS, type CargoEstado, type CuentaDetalle } from '@/modules/carwash/cuentas'

const initial: Fase2State = {}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(new Date(d))
}

const CHIP: Record<string, string> = {
  PENDIENTE: 'bg-warning/15 text-warning-foreground',
  FACTURADO: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PAGADO: 'bg-success/15 text-success',
  ANULADO: 'bg-muted text-muted-foreground',
}

/** Hook compartido: avisa del resultado de una acción de formulario. */
function useAviso(state: Fase2State) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export function EstadoCuenta({ cuenta }: { cuenta: CuentaDetalle }) {
  // Cortes ya facturados que todavía no se cobraron: son los que se reclaman.
  const cortesPorCobrar = [
    ...new Set(
      cuenta.cargos.filter((c) => c.estado === 'FACTURADO' && c.corteRef).map((c) => c.corteRef!)
    ),
  ]

  return (
    <div className="space-y-6">
      {/* ── El número que se le reclama al cliente ──────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tarjeta label="Por facturar" valor={cuenta.totales.porFacturar} destacar />
        <Tarjeta label="Facturado sin cobrar" valor={cuenta.totales.facturado} />
        <Tarjeta label="Deuda viva" valor={cuenta.totales.saldo} />
        <Tarjeta label="Cobrado histórico" valor={cuenta.totales.pagado} />
      </div>

      {cuenta.limiteCredito != null &&
        cuenta.limiteCredito > 0 &&
        cuenta.totales.saldo > cuenta.limiteCredito && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            La deuda viva ({fmtRD(cuenta.totales.saldo)}) pasó el límite acordado de{' '}
            {fmtRD(cuenta.limiteCredito)}. Es un aviso, no un bloqueo: sus vehículos se siguen
            atendiendo normal.
          </p>
        )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Flota cuenta={cuenta} />
          <CargoManual cuentaId={cuenta.id} />
          <Cierre cuentaId={cuenta.id} cortesPorCobrar={cortesPorCobrar} />
        </div>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Movimientos
          </h2>
          {cuenta.cargos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Sin consumos todavía. Cuando una de las placas de la flota se entregue en pista, el
              servicio aparecerá aquí solo.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Concepto</th>
                    <th className="px-4 py-3 font-semibold">Placa</th>
                    <th className="px-4 py-3 font-semibold">Monto</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {cuenta.cargos.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {fmtFecha(c.fecha)}
                      </td>
                      <td className="max-w-64 px-4 py-3">
                        <p className="truncate text-foreground">{c.concepto}</p>
                        {c.corteRef && (
                          <p className="font-mono text-[11px] text-muted-foreground">{c.corteRef}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">
                        {c.placa ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                        {fmtRD(c.monto)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            CHIP[c.estado] ?? 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {CARGO_ESTADO_LABELS[c.estado as CargoEstado] ?? c.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Tarjeta({ label, valor, destacar }: { label: string; valor: number; destacar?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destacar ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">{fmtRD(valor)}</p>
    </div>
  )
}

function Flota({ cuenta }: { cuenta: CuentaDetalle }) {
  const [state, formAction, pending] = useActionState(agregarVehiculoCuenta, initial)
  useAviso(state)
  const activos = cuenta.vehiculos.filter((v) => v.activo)

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="text-sm font-bold text-foreground">Placas de la flota</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Cuando una de estas placas se entregue en pista, el servicio se carga a esta cuenta en vez
        de cobrarse en caja.
      </p>

      <form action={formAction} className="mt-3 flex gap-2">
        <input type="hidden" name="cuentaId" value={cuenta.id} />
        <input
          name="placa"
          required
          maxLength={20}
          placeholder="A123456"
          className={`${input} font-mono uppercase`}
        />
        <Button type="submit" size="sm" disabled={pending} className="shrink-0">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>

      {activos.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Sin placas registradas todavía.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {activos.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5"
            >
              <span className="font-mono text-sm font-semibold uppercase text-foreground">
                {v.placa}
              </span>
              <QuitarPlaca id={v.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function QuitarPlaca({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className="h-7 px-2 text-muted-foreground hover:text-destructive"
      onClick={() =>
        start(async () => {
          const r = await quitarVehiculoCuenta(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  )
}

function CargoManual({ cuentaId }: { cuentaId: string }) {
  const [state, formAction, pending] = useActionState(agregarCargoManual, initial)
  useAviso(state)
  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <h2 className="text-sm font-bold text-foreground">Cargo manual</h2>
      <p className="text-xs text-muted-foreground">
        Para lo que no pasó por la pista: un ajuste, un servicio a domicilio, un producto vendido.
      </p>
      <input name="concepto" required maxLength={160} placeholder="Concepto" className={input} />
      <div className="grid grid-cols-2 gap-2">
        <input name="monto" required inputMode="decimal" placeholder="Monto" className={input} />
        <input name="placa" maxLength={20} placeholder="Placa (opcional)" className={`${input} font-mono uppercase`} />
      </div>
      <Button type="submit" size="sm" disabled={pending} variant="secondary" className="gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Agregar cargo
      </Button>
    </form>
  )
}

function Cierre({ cuentaId, cortesPorCobrar }: { cuentaId: string; cortesPorCobrar: string[] }) {
  const [stateCorte, accionCorte, pendCorte] = useActionState(cerrarCorte, initial)
  const [statePago, accionPago, pendPago] = useActionState(marcarCortePagado, initial)
  useAviso(stateCorte)
  useAviso(statePago)

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Receipt className="h-4 w-4" /> Cerrar el período
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Agrupa todo lo pendiente bajo una referencia para facturarlo de una vez.
        </p>
      </div>

      <form action={accionCorte} className="space-y-2">
        <input type="hidden" name="cuentaId" value={cuentaId} />
        <input
          name="corteRef"
          maxLength={40}
          placeholder="Referencia (vacío = fecha de hoy)"
          className={input}
        />
        <Button type="submit" size="sm" disabled={pendCorte} className="w-full gap-1.5">
          {pendCorte && <Loader2 className="h-4 w-4 animate-spin" />} Facturar lo pendiente
        </Button>
      </form>

      {cortesPorCobrar.length > 0 && (
        <form action={accionPago} className="space-y-2 border-t border-border/60 pt-4">
          <input type="hidden" name="cuentaId" value={cuentaId} />
          <span className="block text-xs font-medium text-muted-foreground">
            Registrar el cobro de un corte
          </span>
          <select name="corteRef" className={input} defaultValue={cortesPorCobrar[0]}>
            {cortesPorCobrar.map((ref) => (
              <option key={ref} value={ref}>
                {ref}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={pendPago}
            className="w-full gap-1.5"
          >
            {pendPago && <Loader2 className="h-4 w-4 animate-spin" />} Marcar como cobrado
          </Button>
        </form>
      )}
    </section>
  )
}
