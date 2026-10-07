import Link from 'next/link'
import { ArrowRight, Clock, Layers, ShieldAlert, Ticket } from 'lucide-react'
import type { SupplyV2BenefitFunding, SupplyV2CampaignAudience, SupplyV2CampaignStatus } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BENEFIT_FUNDING_LABELS, CAMPAIGN_AUDIENCE_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, dineroSupplyV2, RUTA_CAMPANAS } from '@/modules/supply-v2/core/catalogo'
import type { CampanaEnLista } from '@/modules/supply-v2/campaigns/queries'
import { diasHasta } from '../supply/estado-stock'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'

const CHIP = 'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]'

const TONO = {
  success: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  danger: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
  warning: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  info: { fondo: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', punto: 'bg-sv2-primary' },
  neutral: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
} as const

const PUBLICO: Record<SupplyV2CampaignAudience, string> = {
  ALL: 'Todos los clientes',
  NEW_CUSTOMERS: 'Clientes nuevos',
  RETURNING_CUSTOMERS: 'Clientes recurrentes',
  PAST_CAMPAIGN: 'Usaron una promoción',
  SELECTED: 'Lista seleccionada',
}

const FINANCIA: Record<SupplyV2BenefitFunding, { corto: string; tono: keyof typeof TONO }> = {
  MEMBEGO: { corto: 'Financia Membego', tono: 'info' },
  SUPPLIER: { corto: 'Financia proveedor', tono: 'neutral' },
  SHARED: { corto: 'Compartida', tono: 'warning' },
}

/**
 * Estado de la campaña con la vigencia (Stitch): «Activa · 27 días restantes»,
 * «Programada · inicia en 42 días». El texto del estado es el de
 * `CAMPAIGN_STATUS_LABELS` y conserva el identificador de `ChipCampana`.
 */
function ChipVigencia({ c, ahora }: { c: CampanaEnLista; ahora: Date }) {
  const t = TONO[CAMPAIGN_STATUS_TONE[c.status as SupplyV2CampaignStatus]]
  let detalle: string | null = null
  if (c.status === 'ACTIVE' && c.endsAt) {
    const d = diasHasta(c.endsAt, ahora)
    detalle = d <= 0 ? 'termina hoy' : `${d} ${d === 1 ? 'día restante' : 'días restantes'}`
  } else if (c.status === 'SCHEDULED' && c.startsAt > ahora) {
    const d = diasHasta(c.startsAt, ahora)
    detalle = `inicia en ${d} ${d === 1 ? 'día' : 'días'}`
  }
  return (
    <span className={cn(CHIP, t.fondo)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', t.punto, c.vigenteAhora && 'animate-pulse')} />
      <span data-testid="estado-campana">{CAMPAIGN_STATUS_LABELS[c.status]}</span>
      {detalle && <span className="font-medium">· {detalle}</span>}
    </span>
  )
}

function Presupuesto({ c }: { c: CampanaEnLista }) {
  const tope = c.budgetTotal ? Number(c.budgetTotal) : 0
  const pct = tope > 0 ? Math.min(100, (Number(c.budgetConsumido) / tope) * 100) : 0
  const pctReservado = tope > 0 ? Math.min(100 - pct, (Number(c.budgetReservado) / tope) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="whitespace-nowrap text-[13px] font-bold leading-[18px] tabular-nums">
          <span data-testid="campana-consumido">{dineroSupplyV2(c.budgetConsumido, c.currency)}</span>
          <span className="font-normal text-sv2-outline"> / {c.budgetTotal ? dineroSupplyV2(c.budgetTotal, c.currency) : 'sin tope'}</span>
        </span>
        {tope > 0 && <span className={cn(MONO, 'font-bold text-sv2-primary')}>{pct.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%</span>}
      </div>
      {tope > 0 && (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-sv2-track" role="img" aria-label={`${Math.round(pct)} % del presupuesto consumido`}>
          <div className="h-full bg-sv2-accent" style={{ width: `${pct}%` }} />
          <div className="h-full bg-sv2-accent/35" style={{ width: `${pctReservado}%` }} />
        </div>
      )}
      {c.budgetTotal ? (
        <span className="text-[12px] leading-4 text-sv2-ink-variant">
          {Number(c.budgetReservado) > 0 && <span className="font-medium text-sv2-tertiary">Reservado {dineroSupplyV2(c.budgetReservado, c.currency)} · </span>}
          Disponible {dineroSupplyV2(c.budgetDisponible ?? '0', c.currency)}
        </span>
      ) : (
        <span className="flex items-start gap-1 text-[12px] font-medium leading-4 text-sv2-tertiary">
          <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {c.sinTopeAutorizado ? 'Sin tope, autorizada por finanzas' : 'Sin tope de presupuesto'}
        </span>
      )}
    </div>
  )
}

/**
 * Listado de campañas (Stitch, propuesta A). Una sola tabla que en
 * contenedores estrechos reacomoda cada fila como tarjeta: cada campaña
 * existe una vez (las pruebas buscan su `tr` dentro de `tabla-campanas`).
 */
export function TablaCampanas({ filas, total, pie, ahora }: { filas: CampanaEnLista[]; total: number; pie: React.ReactNode; ahora: Date }) {
  const th = 'px-2 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-2 @4xl:py-3 @4xl:align-top'
  return (
    <Tarjeta className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sv2-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">Listado de campañas</h2>
          <span className={cn(MONO, 'rounded-full bg-sv2-primary-fixed px-2 py-0.5 font-semibold text-sv2-on-primary-fixed')}>{total.toLocaleString('es-DO')} {total === 1 ? 'registro' : 'registros'}</span>
        </div>
        <span className="text-[12px] font-medium leading-4 text-sv2-ink-variant">Atribución por pedido pagado; cada pedido cuenta una vez</span>
      </div>
      <div className="@4xl:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table" data-testid="tabla-campanas">
          <thead className="hidden @4xl:table-header-group">
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'pl-4')}>Campaña &amp; tipo</th>
              <th scope="col" className={th}>Ofertas agrupadas</th>
              <th scope="col" className={th}>Motor económico</th>
              <th scope="col" className={cn(th, 'min-w-[180px]')}>Presupuesto &amp; ejecución</th>
              <th scope="col" className={th}>Atribución &amp; GMV</th>
              <th scope="col" className={th}>Vigencia y estado</th>
              <th scope="col" className={cn(th, 'pr-4 text-right')}>Acción</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((c) => {
              const f = FINANCIA[c.funding]
              const restantes = c.ofertas - c.ofertasNombres.length
              return (
                <tr key={c.id} data-testid="fila-campana" className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-3 @4xl:table-row @4xl:p-0">
                  <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:col-span-1 @4xl:max-w-[190px] @4xl:pl-4')}>
                    <div className="flex flex-col gap-1.5">
                      <Link href={`${RUTA_CAMPANAS}/${c.id}`} className="text-[14px] font-semibold leading-5 hover:underline">{c.name}</Link>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={cn(MONO, 'whitespace-nowrap rounded-[4px] bg-sv2-soft px-1.5 py-0.5 font-semibold text-sv2-ink-variant')}>{c.code}</span>
                        <span className="rounded-full border border-sv2-border bg-sv2-primary-fixed px-2 py-0.5 text-[12px] font-medium leading-4 text-sv2-primary" title={CAMPAIGN_AUDIENCE_LABELS[c.audience]}>{PUBLICO[c.audience]}</span>
                      </div>
                    </div>
                  </td>
                  <td className={cn(td, '@4xl:max-w-[160px]')}>
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1 font-semibold">
                        <Layers aria-hidden className="size-4 shrink-0 text-sv2-primary" />
                        {c.ofertas === 0 ? 'Sin ofertas todavía' : `${c.ofertas} ${c.ofertas === 1 ? 'oferta asociada' : 'ofertas asociadas'}`}
                      </span>
                      {c.ofertasNombres.length > 0 && (
                        <ul className="flex flex-col gap-1">
                          {c.ofertasNombres.map((n, i) => (
                            <li key={`${n}-${i}`} className="truncate rounded-[4px] bg-sv2-well px-1.5 py-0.5 text-[12px] font-medium leading-4 text-sv2-ink-variant" title={n}>{n}</li>
                          ))}
                          {restantes > 0 && <li className="text-[12px] leading-4 text-sv2-outline">+{restantes} más</li>}
                        </ul>
                      )}
                    </div>
                  </td>
                  <td className={cn(td, '@4xl:max-w-[170px]')}>
                    <div className="flex flex-col gap-1">
                      {c.promocionesNombres.length > 0 && <span className="line-clamp-2 font-semibold" title={c.promocionesNombres.join(' + ')}>{c.promocionesNombres.join(' + ')}</span>}
                      <span className={cn(CHIP, TONO[f.tono].fondo)} title={BENEFIT_FUNDING_LABELS[c.funding]}>
                        <span aria-hidden className={cn('size-1.5 rounded-full', TONO[f.tono].punto)} />
                        {f.corto}
                      </span>
                      {c.proveedor && <span className="truncate text-[12px] leading-4 text-sv2-ink-variant" title={c.proveedor}>{c.proveedor}</span>}
                      <span className={cn(MONO, 'flex items-center gap-1 text-sv2-outline @4xl:whitespace-nowrap')}>
                        <Ticket aria-hidden className="size-3.5 shrink-0" />
                        {c.promociones} {c.promociones === 1 ? 'promoción' : 'promociones'} · {c.cupones} {c.cupones === 1 ? 'cupón' : 'cupones'}
                      </span>
                    </div>
                  </td>
                  <td className={cn(td, 'col-span-2 @xl:col-span-1')}>
                    <Presupuesto c={c} />
                  </td>
                  <td className={td}>
                    <div className="flex flex-col">
                      <span className="font-semibold">
                        <span data-testid="campana-ventas">{c.ventasConfirmadas.toLocaleString('es-DO')}</span> {c.ventasConfirmadas === 1 ? 'venta confirmada' : 'ventas confirmadas'}
                      </span>
                      <span className={cn(MONO, 'whitespace-nowrap text-sv2-ink-variant')}>GMV {dineroSupplyV2(c.gmv, c.currency)}</span>
                      <span className={cn(MONO, 'whitespace-nowrap text-sv2-primary')}>Subsidio {dineroSupplyV2(c.subsidio, c.currency)}</span>
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex flex-col gap-1.5">
                      <span className={cn(MONO, 'whitespace-nowrap font-semibold')}>
                        {formatDate(c.startsAt)} → {c.endsAt ? formatDate(c.endsAt) : 'sin fin'}
                      </span>
                      <ChipVigencia c={c} ahora={ahora} />
                      {c.horario && (
                        <span className="flex items-center gap-1 text-[12px] leading-4 text-sv2-ink-variant">
                          <Clock aria-hidden className="size-3.5" />
                          {c.horario}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(td, 'self-end @4xl:pr-4 @4xl:text-right @4xl:align-middle')}>
                    <Link href={`${RUTA_CAMPANAS}/${c.id}`} data-testid="link-campana" className={cn(claseBotonSuave, 'h-8 gap-1 whitespace-nowrap border border-sv2-border bg-card px-3 text-[13px] leading-4 hover:bg-sv2-soft')}>
                      Ver<span className="@4xl:sr-only"> ficha</span> <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pie}
    </Tarjeta>
  )
}
