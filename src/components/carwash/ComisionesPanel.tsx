'use client'

/**
 * App Car Wash · Fase 2 — comisiones por lavador.
 *
 * ORDEN DE LA PANTALLA, de arriba a abajo: primero a quién le debo y cuánto
 * (que es la pregunta del viernes), después el detalle vehículo por vehículo
 * (que es lo que se revisa cuando alguien reclama), y al final las tarifas.
 *
 * Las tarifas van al final a propósito: se configuran una vez y se miran poco.
 * Pero si NINGÚN servicio tiene tarifa, el aviso sube arriba del todo — porque
 * en ese caso el módulo devenga cero y parece roto sin estarlo.
 */

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2, TriangleAlert, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  pagarComisiones,
  guardarTarifaComision,
  type Fase2State,
} from '@/modules/carwash/fase2-actions'
import { COMISION_ESTADO_LABELS, type ComisionEstado, type PanelComisiones } from '@/modules/carwash/comisiones'

const initial: Fase2State = {}

const input =
  'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground'

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

export interface ServicioTarifa {
  id: string
  nombre: string
  comisionPorcentaje: number | null
  comisionMonto: number | null
}

export function ComisionesPanel({
  panel,
  servicios,
}: {
  panel: PanelComisiones
  servicios: ServicioTarifa[]
}) {
  const sinNingunaTarifa =
    servicios.length > 0 && servicios.every((s) => !s.comisionPorcentaje && !s.comisionMonto)

  return (
    <div className="space-y-6">
      {sinNingunaTarifa && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-foreground">Ningún servicio paga comisión todavía</p>
            <p className="mt-1 text-muted-foreground">
              El módulo está encendido pero devengará cero hasta que llenes las tarifas abajo. Es
              deliberado: encender la capacidad no puede empezar a generar nómina sola.
            </p>
          </div>
        </div>
      )}

      {/* ── A quién le debo ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Por lavador
        </h2>
        {panel.porLavador.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            <Wallet className="mx-auto mb-2 h-7 w-7 opacity-40" />
            Sin comisiones en este período. Se devengan al ENTREGAR un vehículo que tenga lavador
            asignado y servicios con tarifa.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {panel.porLavador.map((l) => (
              <TarjetaLavador key={l.userId} lavador={l} />
            ))}
          </div>
        )}
      </section>

      {/* ── Detalle ─────────────────────────────────────────────────────── */}
      {panel.filas.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Detalle · {panel.totales.vehiculos} vehículo(s)
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Lavador</th>
                  <th className="px-4 py-3 font-semibold">Placa</th>
                  <th className="px-4 py-3 font-semibold">Servicios</th>
                  <th className="px-4 py-3 font-semibold">Comisión</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {panel.filas.map((f) => (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtFecha(f.fecha)}
                    </td>
                    <td className="px-4 py-3 text-foreground">{f.lavador}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">
                      {f.placa ?? '—'}
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <p className="truncate text-xs text-muted-foreground" title={f.detalle ?? ''}>
                        {f.detalle ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">base {fmtRD(f.base)}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                      {fmtRD(f.monto)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                          f.estado === 'PAGADA'
                            ? 'bg-success/15 text-success'
                            : 'bg-warning/15 text-warning'
                        }`}
                      >
                        {COMISION_ESTADO_LABELS[f.estado as ComisionEstado] ?? f.estado}
                      </span>
                      {f.loteRef && (
                        <p className="font-mono text-xs text-muted-foreground">{f.loteRef}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Tarifas ─────────────────────────────────────────────────────── */}
      <Tarifas servicios={servicios} />
    </div>
  )
}

function TarjetaLavador({
  lavador,
}: {
  lavador: PanelComisiones['porLavador'][number]
}) {
  const [state, formAction, pending] = useActionState(pagarComisiones, initial)
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <p className="truncate font-semibold text-foreground">{lavador.nombre}</p>
      <p className="text-xs text-muted-foreground">{lavador.vehiculos} vehículo(s)</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-foreground">
        {fmtRD(lavador.pendiente)}
      </p>
      <p className="text-xs text-muted-foreground">
        por pagar · {fmtRD(lavador.pagado)} ya pagado
      </p>
      {lavador.pendiente > 0 && (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="userId" value={lavador.userId} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending} className="w-full gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Marcar como pagado
          </Button>
        </form>
      )}
    </div>
  )
}

function Tarifas({ servicios }: { servicios: ServicioTarifa[] }) {
  const [state, formAction, pending] = useActionState(guardarTarifaComision, initial)
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  if (servicios.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No tienes servicios en el catálogo todavía. Créalos primero: la comisión se calcula sobre lo
        que se vendió.
      </p>
    )
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Tarifas de comisión por servicio
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Si pones porcentaje, se calcula sobre el precio cobrado y el monto fijo se ignora. Ambos
        vacíos = ese servicio no paga comisión.
      </p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {servicios.map((s) => (
          <form
            key={s.id}
            action={formAction}
            className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap"
          >
            <input type="hidden" name="servicioId" value={s.id} />
            <span className="min-w-40 flex-1 truncate text-sm font-medium text-foreground">
              {s.nombre}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">%</span>
              <input
                name="comisionPorcentaje"
                inputMode="decimal"
                defaultValue={s.comisionPorcentaje ?? ''}
                className={`${input} w-20`}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">RD$</span>
              <input
                name="comisionMonto"
                inputMode="decimal"
                defaultValue={s.comisionMonto ?? ''}
                className={`${input} w-24`}
              />
            </label>
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
            </Button>
          </form>
        ))}
      </div>
    </section>
  )
}
