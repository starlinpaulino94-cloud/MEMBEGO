import { CircleCheck, Clock, Hourglass, PiggyBank, Wallet, BadgeCheck, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TableroDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import { MONO, Tarjeta } from '../resumen/superficie'

/**
 * «El dinero de la fidelización» (Stitch, propuesta A): lo gastado de verdad y
 * lo que podría costar. La ESTIMACIÓN va siempre marcada y con su advertencia
 * al lado (§41): una estimación no se enseña como dinero que ya se debe.
 */
export function PanelDinero({ t }: { t: TableroDeFidelizacion['totales'] }) {
  const pctVencidos = t.puntosEmitidos > 0 ? (t.puntosVencidos / t.puntosEmitidos) * 100 : null
  const caja = 'flex flex-col gap-1 rounded-[8px] border border-sv2-border bg-sv2-well p-4'
  const etiqueta = 'text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const valor = 'text-[28px] font-bold leading-8 tracking-[-0.025em] tabular-nums'
  return (
    <Tarjeta className="flex flex-col gap-4 p-5" data-testid="panel-dinero-fidelizacion">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-primary">
            <Wallet className="size-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">El dinero de la fidelización</h2>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Lo gastado de verdad y lo que podría costar: la estimación va siempre marcada.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-[8px] bg-sv2-soft px-2 py-1 text-[12px] font-medium leading-4 text-sv2-ink-variant">
          <Info aria-hidden className="size-3.5" />
          Solo con permiso de finanzas
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
        <div className={caja}>
          <span className={etiqueta}>Costo ya realizado</span>
          <span className={valor} data-testid="tablero-costo-realizado">{t.costoRealizado}</span>
          <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Recompensas entregadas y premios concedidos. Esto sí es dinero gastado.</p>
          <span className="mt-auto flex items-center gap-1 pt-2 text-[12px] font-semibold leading-4 text-sv2-secondary">
            <CircleCheck aria-hidden className="size-4" />
            Solo lo ya entregado
          </span>
        </div>
        <div className={caja}>
          <span className={etiqueta}>Recompensas entregadas</span>
          <span className={valor}>
            <span data-testid="tablero-entregadas">{t.recompensasEntregadas.toLocaleString('es-DO')}</span>
            <span className="ml-1.5 text-base font-normal tracking-normal text-sv2-ink-variant">{t.recompensasEntregadas === 1 ? 'canje' : 'canjes'}</span>
          </span>
          <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Recompensas que el cliente ya recibió.</p>
          <span className="mt-auto flex items-center gap-1 pt-2 text-[12px] font-semibold leading-4 text-sv2-primary">
            <BadgeCheck aria-hidden className="size-4" />
            {t.ticketMedio ? `Ticket medio: ${t.ticketMedio}` : 'Sin entregas todavía'}
          </span>
        </div>
        <div className={cn(caja, 'border-sv2-border')}>
          <span className={cn(etiqueta, 'flex items-center justify-between gap-1 text-sv2-tertiary')}>
            Costo potencial (estimación)
            <Clock aria-hidden className="size-4 shrink-0" />
          </span>
          <span className={cn(valor, 'text-sv2-tertiary')} data-testid="tablero-costo-estimado">{t.costoPotencialEstimado}</span>
          <p className="text-[13px] leading-[18px] text-sv2-tertiary" data-testid="tablero-advertencia">{t.estimacionAdvertencia}</p>
          <span className="mt-auto flex items-center gap-1 pt-2 text-[12px] font-semibold leading-4 text-sv2-tertiary">
            <Hourglass aria-hidden className="size-4 shrink-0" />
            Costo medio por punto × puntos sin canjear
          </span>
        </div>
        <div className={caja}>
          <span className={etiqueta}>Puntos vencidos</span>
          <span className={valor} data-testid="tablero-puntos-vencidos">{pctVencidos === null ? '—' : `${pctVencidos.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%`}</span>
          <p className="text-[13px] leading-[18px] text-sv2-ink-variant">De los puntos emitidos, los que vencieron sin canjear (dato real, no una proyección).</p>
          <span className={cn(MONO, 'mt-auto flex items-center gap-1 pt-2 font-semibold text-sv2-secondary')}>
            <PiggyBank aria-hidden className="size-4" />
            {t.puntosVencidos.toLocaleString('es-DO')} de {t.puntosEmitidos.toLocaleString('es-DO')} pts
          </span>
        </div>
      </div>
    </Tarjeta>
  )
}
