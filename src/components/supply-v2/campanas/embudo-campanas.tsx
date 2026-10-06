import Link from 'next/link'
import { BellRing, CircleCheck, Gauge, ShieldAlert, TrendingUp, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import type { TableroCampanas } from '@/modules/supply-v2/campaigns/queries'
import { MONO, Tarjeta } from '../resumen/superficie'

function pct(parte: number, todo: number): number {
  return todo > 0 ? (parte / todo) * 100 : 0
}

function textoPct(v: number): string {
  return `${v.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%`
}

/**
 * Embudo de campañas (Stitch, propuesta A) con lo que SÍ se mide: pedidos
 * atribuidos → pagados → derechos emitidos → redimidos. Vistas, clics y CPC no
 * existen en Membego y no se inventan.
 */
export function EmbudoCampanas({ t }: { t: TableroCampanas }) {
  const etapas = [
    { n: '01', texto: 'Pedidos con campaña', valor: t.pedidos, nota: t.pedidos > 0 ? '(100%)' : 'Sin pedidos todavía', ancho: t.pedidos > 0 ? 100 : 0 },
    { n: '02', texto: 'Pagados (ventas confirmadas)', valor: t.ventasConfirmadas, nota: `${textoPct(pct(t.ventasConfirmadas, t.pedidos))} de los pedidos`, ancho: pct(t.ventasConfirmadas, t.pedidos) },
    { n: '03', texto: 'Derechos emitidos (QR)', valor: t.derechosEmitidos, nota: 'Uno por unidad pagada', ancho: t.derechosEmitidos > 0 ? pct(t.ventasConfirmadas, t.pedidos) : 0 },
    { n: '04', texto: 'Redimidos en el comercio', valor: t.derechosRedimidos, nota: `${textoPct(pct(t.derechosRedimidos, t.derechosEmitidos))} de los emitidos`, ancho: pct(t.ventasConfirmadas, t.pedidos) * (t.derechosEmitidos > 0 ? t.derechosRedimidos / t.derechosEmitidos : 0) },
  ]
  const subsidioPorVenta = t.ventasConfirmadas > 0 ? Number(t.subsidio) / t.ventasConfirmadas : null
  const mini = [
    { titulo: 'Pedidos en curso', valor: t.pedidosEnCurso.toLocaleString('es-DO'), nota: 'Reservas que aún no son venta' },
    { titulo: 'Subsidio por venta', valor: subsidioPorVenta === null ? '—' : dineroSupplyV2(subsidioPorVenta), nota: 'Subsidio Membego / ventas' },
    { titulo: 'Derechos vencidos', valor: t.derechosVencidos.toLocaleString('es-DO'), nota: 'Sin redimir a tiempo' },
  ]
  return (
    <Tarjeta className="flex flex-col gap-4 p-5 @5xl:col-span-2" data-testid="embudo-campanas">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">Analítica integral</span>
          <h3 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">Embudo real de campañas</h3>
        </div>
        <span className={cn(MONO, 'flex items-center gap-1 rounded-[8px] border border-sv2-border bg-sv2-well px-2 py-1 text-sv2-ink-variant')}>
          <TrendingUp aria-hidden className="size-3.5" />
          Pedidos atribuidos
        </span>
      </div>
      <ol className="flex flex-col gap-4">
        {etapas.map((e) => (
          <li key={e.n} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-medium leading-[18px]">
                <span className={cn(MONO, 'rounded-[4px] bg-sv2-primary-fixed px-1.5 py-0.5 font-bold text-sv2-primary')}>{e.n}</span>
                {e.texto}
              </span>
              <span className="flex items-baseline gap-2 whitespace-nowrap">
                <span className={cn(MONO, 'text-[13px] font-bold')}>{e.valor.toLocaleString('es-DO')}</span>
                <span className="text-[12px] leading-4 text-sv2-ink-variant">{e.nota}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-sv2-track">
              <div className="h-full rounded-full bg-sv2-accent" style={{ width: `${Math.min(100, e.ancho)}%` }} />
            </div>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
        {mini.map((m) => (
          <div key={m.titulo} className="flex flex-col rounded-[8px] border border-sv2-border bg-sv2-well px-3 py-2">
            <span className="text-[12px] font-semibold leading-4 text-sv2-outline">{m.titulo}</span>
            <span className={cn(MONO, 'text-[13px] font-bold text-foreground')}>{m.valor}</span>
            <span className="text-[12px] font-medium leading-4 text-sv2-primary">{m.nota}</span>
          </div>
        ))}
      </div>
    </Tarjeta>
  )
}

export interface AlertaCampanas {
  icono: 'revision' | 'tope' | 'consumo' | 'ok'
  titulo: string
  texto: string
}

const ICONOS: Record<AlertaCampanas['icono'], { icono: LucideIcon; clase: string }> = {
  revision: { icono: BellRing, clase: 'text-sv2-tertiary' },
  tope: { icono: ShieldAlert, clase: 'text-sv2-error' },
  consumo: { icono: Gauge, clase: 'text-sv2-tertiary' },
  ok: { icono: CircleCheck, clase: 'text-sv2-secondary' },
}

/** Alertas de presupuesto (en lugar de las «recomendaciones automáticas» de Stitch, que no existen). */
export function AlertasCampanas({ alertas, accion }: { alertas: AlertaCampanas[]; accion?: { href: string; texto: string } }) {
  return (
    <Tarjeta className="flex flex-col justify-between gap-4 p-5" data-testid="alertas-campanas">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <BellRing aria-hidden className="size-5 text-sv2-primary" />
          <h3 className="text-[15px] font-bold leading-5">Alertas de presupuesto</h3>
        </div>
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Avisos calculados con el presupuesto y el estado real de cada campaña.</p>
        <ul className="flex flex-col gap-2 pt-1">
          {alertas.map((a) => {
            const I = ICONOS[a.icono]
            return (
              <li key={a.titulo} className="flex items-start gap-2 rounded-[8px] border border-sv2-border bg-sv2-well p-3">
                <I.icono aria-hidden className={cn('mt-px size-4 shrink-0', I.clase)} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold leading-4">{a.titulo}</span>
                  <span className="text-[13px] leading-[18px] text-sv2-ink-variant">{a.texto}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex h-9 w-full items-center justify-center rounded-[8px] border border-sv2-border bg-card text-[13px] font-semibold leading-4 transition-colors hover:bg-sv2-soft">
          {accion.texto}
        </Link>
      )}
    </Tarjeta>
  )
}
