import Link from 'next/link'
import { ArrowRight, Percent, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dineroSupplyV2, RUTA_ECONOMIA, RUTA_LIQUIDACIONES } from '@/modules/supply-v2/core/catalogo'
import type { ResumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { MONO, Tarjeta } from '../resumen/superficie'

type Tono = 'neutral' | 'aviso' | 'error' | 'exito'
const TEXTO: Record<Tono, string> = { neutral: 'text-foreground', aviso: 'text-sv2-tertiary', error: 'text-sv2-error', exito: 'text-sv2-secondary' }

function Cifra({ etiqueta, valor, nota, tono = 'neutral', testId, href, enlace }: { etiqueta: string; valor: string; nota: string; tono?: Tono; testId?: string; href?: string; enlace?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2.5">
      <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">{etiqueta}</span>
      <span className={cn(MONO, 'text-[16px] font-bold leading-6 tabular-nums', TEXTO[tono])} data-testid={testId}>{valor}</span>
      <span className="text-[12px] leading-4 text-sv2-ink-variant">{nota}</span>
      {href && enlace && (
        <Link href={href} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold leading-4 text-sv2-primary hover:underline">
          {enlace}
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      )}
    </div>
  )
}

/** Economía del mes (GMV, ingreso, costo, margen, vencido, breakage), con la misma lógica y testids de siempre. */
export function PanelEconomia({ r }: { r: ResumenFinanzas }) {
  return (
    <Tarjeta className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp aria-hidden className="size-5 text-sv2-primary" />
          <h3 className="text-[15px] font-bold leading-5">Economía del mes</h3>
        </div>
        <Link href={RUTA_ECONOMIA} className="inline-flex items-center gap-1 text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
          Reporte completo con filtros
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      {!r.hayDatos ? (
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant" data-testid="economia-sin-datos">Sin datos todavía. Cuando se confirme la primera venta aparecerán ingreso, costo y margen.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @5xl:grid-cols-4">
          <Cifra etiqueta="GMV" valor={dineroSupplyV2(r.gmv)} nota={`${r.unitsSold.toLocaleString('es-DO')} unidades vendidas`} testId="kpi-gmv" />
          <Cifra etiqueta="Ingreso" valor={dineroSupplyV2(r.revenue)} nota="reconocido por Membego" testId="kpi-revenue" />
          <Cifra etiqueta="Costo" valor={dineroSupplyV2(r.cost)} nota="costo real del supply vendido" testId="kpi-cost" />
          <Cifra etiqueta="Margen bruto" valor={dineroSupplyV2(r.grossMargin)} nota={r.marginPct != null ? `${r.marginPct.toLocaleString('es-DO')} %` : '—'} tono="exito" testId="kpi-margen" />
          <Cifra etiqueta="Supply vencido sin vender" valor={dineroSupplyV2(r.supplyVencidoCosto)} nota={`${r.supplyVencidoUnidades.toLocaleString('es-DO')} unidades · costo histórico real`} tono={r.supplyVencidoUnidades > 0 ? 'error' : 'neutral'} testId="kpi-vencido" />
          <Cifra etiqueta="Breakage" valor={r.unitsExpired.toLocaleString('es-DO')} nota={r.breakageRate != null ? `${r.breakageRate.toLocaleString('es-DO')} % de lo vendido venció sin usarse` : 'derechos vencidos sin usar'} tono={r.unitsExpired > 0 ? 'aviso' : 'neutral'} testId="kpi-breakage" />
          <Cifra etiqueta="Redimidas" valor={r.unitsRedeemed.toLocaleString('es-DO')} nota="entregas vivas del mes" />
        </div>
      )}
    </Tarjeta>
  )
}

/** Ventas a comisión (§57): separadas de las del supply adquirido. */
export function PanelComision({ r }: { r: ResumenFinanzas }) {
  const c = r.comision
  return (
    <Tarjeta className="flex flex-col gap-3 p-5" data-testid="finanzas-comision">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Percent aria-hidden className="size-5 text-sv2-primary" />
          <h3 className="text-[15px] font-bold leading-5">Ventas a comisión</h3>
        </div>
        <Link href={RUTA_LIQUIDACIONES} className="inline-flex items-center gap-1 text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
          Ver liquidaciones
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @5xl:grid-cols-4">
        <Cifra etiqueta="Comisión del mes (ingreso)" valor={dineroSupplyV2(c.ingresoMes)} nota={`GMV ${dineroSupplyV2(c.gmvMes)} · ${c.unidadesMes.toLocaleString('es-DO')} unidades`} testId="kpi-comision-ingreso" />
        <Cifra etiqueta="Neto de proveedores (mes)" valor={dineroSupplyV2(c.netoProveedoresMes)} nota="cobrado por cuenta del proveedor; no es ingreso ni costo" testId="kpi-comision-neto" />
        <Cifra etiqueta="Pendiente de liquidar" valor={dineroSupplyV2(c.netoPendienteDeLiquidar)} nota={`${c.entregasPendientesDeLiquidar.toLocaleString('es-DO')} entrega(s) sin liquidación`} tono={c.entregasPendientesDeLiquidar > 0 ? 'aviso' : 'neutral'} testId="kpi-sin-liquidar" href={`${RUTA_LIQUIDACIONES}/nueva`} enlace="Generar liquidación" />
        <Cifra
          etiqueta="Liquidaciones por pagar"
          valor={dineroSupplyV2(c.liquidacionesPorPagarMonto)}
          nota={`${c.liquidacionesPorPagar} aprobada(s) · ${c.liquidacionesPendientesDeAprobar} pendiente(s) de aprobar${c.incidenciasAbiertas > 0 ? ` · ${c.incidenciasAbiertas} incidencia(s)` : ''}`}
          tono={c.liquidacionesPendientesDeAprobar > 0 || c.incidenciasAbiertas > 0 ? 'aviso' : 'neutral'}
          testId="kpi-liq-por-pagar"
        />
      </div>
    </Tarjeta>
  )
}
