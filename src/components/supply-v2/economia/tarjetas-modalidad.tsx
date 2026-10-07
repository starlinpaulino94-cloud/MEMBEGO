import { CircleDot, Lock, PiggyBank } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import type { EconomiaCalculada } from '@/modules/supply-v2/economics/queries'
import { Tarjeta } from '../resumen/superficie'

function Dato({ etiqueta, valor, testId, tono }: { etiqueta: string; valor: string; testId?: string; tono?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">{etiqueta}</span>
      <span className={cn('whitespace-nowrap text-[15px] font-semibold leading-5 tabular-nums', tono)} data-testid={testId}>{valor}</span>
    </div>
  )
}

function Barra({ etiqueta, valor, ancho, clase }: { etiqueta: string; valor: string; ancho: number; clase: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[12px] font-medium leading-4 text-sv2-ink-variant">
        <span>{etiqueta}</span>
        <span className="font-semibold text-foreground">{valor}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-sv2-track">
        <div className={cn('h-full rounded-full', clase)} style={{ width: `${Math.max(0, Math.min(100, ancho))}%` }} />
      </div>
    </div>
  )
}

/** Dos tarjetas: supply adquirido (prepago / pagar después) y venta a comisión. Mismas cifras y testids de siempre. */
export function TarjetasModalidad({ e }: { e: EconomiaCalculada }) {
  const p = e.prepurchase
  const c = e.commission
  const margenPrepago = Number(p.revenue) - Number(p.cost)
  const pctPrepago = Number(p.revenue) > 0 ? (margenPrepago / Number(p.revenue)) * 100 : 0
  const pctNeto = Number(c.gmv) > 0 ? (Number(c.supplierNet) / Number(c.gmv)) * 100 : 0
  return (
    <div className="grid grid-cols-1 gap-3 @5xl:grid-cols-2">
      <Tarjeta className="flex flex-col gap-4 p-5" data-testid="eco-prepago">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em]">
            <CircleDot aria-hidden className="size-3 text-sv2-primary" />
            Supply adquirido
          </h3>
          <span className="whitespace-nowrap rounded-[8px] bg-sv2-primary-fixed px-2 py-0.5 text-[12px] font-bold uppercase leading-4 tracking-wide text-sv2-on-primary-fixed">Prepago / pagar después</span>
        </div>
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Membego compró el lote y asume el inventario: el ingreso es el GMV y el costo es el del lote.</p>
        <div className="grid grid-cols-2 gap-3 rounded-[8px] border border-sv2-border bg-sv2-well p-3">
          <Dato etiqueta="GMV" valor={dineroSupplyV2(p.gmv)} testId="eco-prepago-gmv" />
          <Dato etiqueta="Ingreso (= GMV)" valor={dineroSupplyV2(p.revenue)} testId="eco-prepago-revenue" />
          <Dato etiqueta="Costo real del supply" valor={dineroSupplyV2(p.cost)} testId="eco-prepago-cost" />
          <Dato etiqueta="Unidades vendidas" valor={p.unitsSold.toLocaleString('es-DO')} />
        </div>
        <Barra etiqueta="Margen sobre el ingreso" valor={Number(p.revenue) > 0 ? `${pctPrepago.toLocaleString('es-DO', { maximumFractionDigits: 1 })} %` : '—'} ancho={pctPrepago} clase="bg-sv2-secondary" />
        <div className="flex items-center gap-2 rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2 text-[13px] leading-[18px]">
          <Lock aria-hidden className="size-4 shrink-0 text-sv2-primary" />
          Costo congelado en el derecho: no cambia con precios actuales.
        </div>
      </Tarjeta>
      <Tarjeta className="flex flex-col gap-4 p-5" data-testid="eco-comision">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em]">
            <CircleDot aria-hidden className="size-3 text-sv2-tertiary" />
            Venta a comisión
          </h3>
          <span className="whitespace-nowrap rounded-[8px] bg-sv2-tertiary-fixed px-2 py-0.5 text-[12px] font-bold uppercase leading-4 tracking-wide text-sv2-on-tertiary-fixed">Sin inventario de Membego</span>
        </div>
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant">El proveedor cobra su neto tras la entrega; Membego solo reconoce la comisión como ingreso.</p>
        <div className="grid grid-cols-2 gap-3 rounded-[8px] border border-sv2-border bg-sv2-well p-3">
          <Dato etiqueta="GMV (lo que pagó el cliente)" valor={dineroSupplyV2(c.gmv)} testId="eco-comision-gmv" />
          <Dato etiqueta="Ingreso de Membego (comisión)" valor={dineroSupplyV2(c.revenue)} testId="eco-comision-revenue" tono="text-sv2-primary" />
          <Dato etiqueta="Neto de proveedores" valor={dineroSupplyV2(c.supplierNet)} testId="eco-comision-neto" />
          <Dato etiqueta="Unidades vendidas" valor={c.unitsSold.toLocaleString('es-DO')} testId="eco-comision-unidades" />
        </div>
        <Barra etiqueta="Neto de proveedores sobre el GMV (no es ingreso ni costo)" valor={Number(c.gmv) > 0 ? `${pctNeto.toLocaleString('es-DO', { maximumFractionDigits: 1 })} %` : '—'} ancho={pctNeto} clase="bg-sv2-tertiary" />
        <div className="flex items-center justify-between gap-2 rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2 text-[13px] leading-[18px]">
          <span className="flex items-center gap-2">
            <PiggyBank aria-hidden className="size-4 shrink-0 text-sv2-secondary" />
            Obligaciones con proveedores
          </span>
          <span className="font-semibold tabular-nums" data-testid="eco-obligaciones">{dineroSupplyV2(e.supplierObligations)}</span>
        </div>
      </Tarjeta>
    </div>
  )
}
