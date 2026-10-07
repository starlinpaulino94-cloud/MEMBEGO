import Link from 'next/link'
import { Infinity as SinFin, Link2, Package, Percent, Timer } from 'lucide-react'
import type { SupplyV2OfferStatus } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS, OFFER_STATUS_TONE } from '@/modules/supply-v2/core/catalogo'
import type { OfertaEnLista } from '@/modules/supply-v2/offers/queries'
import { AccionesOferta } from '../acciones-oferta'
import { MONO, Tarjeta } from '../resumen/superficie'

const DIA = 86_400_000

function dinero(n: number, moneda: string): string {
  const t = n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'DOP' ? `RD$${t}` : `${moneda} ${t}`
}

const CHIP = {
  success: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  warning: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  danger: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
  info: { fondo: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', punto: 'bg-sv2-primary' },
  neutral: { fondo: 'bg-sv2-soft text-sv2-ink-variant', punto: 'bg-sv2-outline' },
} as const

/** Estado con la geometría Stitch; mismos textos y tonos que `ChipOferta` (y el mismo identificador). */
function ChipEstado({ estado }: { estado: SupplyV2OfferStatus }) {
  const c = CHIP[OFFER_STATUS_TONE[estado]]
  return (
    <span className={cn('inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', c.fondo)} data-testid="estado-oferta">
      <span aria-hidden className={cn('size-1.5 rounded-full', c.punto, estado === 'ACTIVE' && 'animate-pulse')} />
      {OFFER_STATUS_LABELS[estado]}
    </span>
  )
}

function Modalidad({ o }: { o: OfertaEnLista }) {
  const comision = o.sourceType === 'COMMISSION'
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 py-1 text-[12px] font-semibold leading-4', comision ? 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed' : 'bg-sv2-primary-fixed text-sv2-on-primary-fixed')}>
        <span aria-hidden className={cn('size-1.5 rounded-full', comision ? 'bg-sv2-tertiary' : 'bg-sv2-primary')} />
        <span data-testid="chip-modelo">{OFFER_SOURCE_LABELS[o.sourceType]}</span>
        {comision && o.commissionPercentage && <span>({Number(o.commissionPercentage)}%)</span>}
      </span>
      <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>{comision ? 'Sin stock apartado' : o.lote ? `Lote ${o.lote}` : 'Sin lote'}</span>
    </div>
  )
}

function Cupos({ o }: { o: OfertaEnLista }) {
  const sinTope = o.sourceType === 'COMMISSION' && o.disponiblesComision === null
  const pct = o.asignadas > 0 ? Math.round((o.disponibles / o.asignadas) * 100) : 0
  return (
    <div className="flex w-full min-w-[150px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn(MONO, 'whitespace-nowrap font-bold')}>
          {sinTope ? 'Sin tope' : <><span data-testid="oferta-disponibles">{o.disponibles.toLocaleString('es-DO')}</span> disp.</>}
        </span>
        <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>{sinTope ? 'bajo demanda' : `${o.asignadas.toLocaleString('es-DO')} ${o.sourceType === 'COMMISSION' ? 'de tope' : 'asignadas'}`}</span>
      </div>
      {sinTope ? <span className="sr-only" data-testid="oferta-disponibles">Sin tope</span> : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sv2-track">
        <div className={cn('h-full rounded-full', sinTope ? 'w-full bg-sv2-outline/40' : 'bg-sv2-secondary')} style={sinTope ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-[12px] leading-4 text-sv2-ink-variant">
        <span>{o.vendidas.toLocaleString('es-DO')} {o.vendidas === 1 ? 'vendida' : 'vendidas'}</span>
        <span><span data-testid="oferta-reservadas">{o.reservadas.toLocaleString('es-DO')}</span> reservadas</span>
      </div>
    </div>
  )
}

function Precio({ o }: { o: OfertaEnLista }) {
  const venta = Number(o.salePrice)
  const [entero, centavos] = dinero(venta, o.currency).split('.')
  const comision = o.sourceType === 'COMMISSION'
  const pct = Number(o.commissionPercentage ?? 0)
  const costo = o.costoUnitario === null ? null : Number(o.costoUnitario)
  const margen = comision ? (venta * pct) / 100 : costo === null ? null : venta - costo
  const margenPct = margen === null || venta <= 0 ? null : (margen / venta) * 100
  return (
    <div className="flex flex-col items-end">
      <span className="whitespace-nowrap text-[15px] font-bold leading-5 tabular-nums">
        {entero}<span className="text-[12px] font-semibold text-sv2-ink-variant">.{centavos}</span>
      </span>
      {Number(o.publicPrice) > venta && <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-outline line-through">{dinero(Number(o.publicPrice), o.currency)}</span>}
      {comision ? (
        <>
          <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>Neto prov.: {dinero(venta - (margen ?? 0), o.currency)}</span>
          <span className="whitespace-nowrap text-[12px] font-semibold leading-4 text-sv2-primary">Comisión: {dinero(margen ?? 0, o.currency)}</span>
        </>
      ) : costo !== null ? (
        <>
          <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>Costo: {dinero(costo, o.currency)}</span>
          <span className={cn('whitespace-nowrap text-[12px] font-semibold leading-4', (margen ?? 0) >= 0 ? 'text-sv2-secondary' : 'text-sv2-error')}>
            {(margen ?? 0) >= 0 ? '+' : ''}{dinero(margen ?? 0, o.currency)} ({margenPct?.toFixed(1)}%)
          </span>
        </>
      ) : null}
    </div>
  )
}

function Vigencia({ o, ahora }: { o: OfertaEnLista; ahora: Date }) {
  const dias = o.endsAt ? Math.ceil((o.endsAt.getTime() - ahora.getTime()) / DIA) : null
  const vigente = o.startsAt <= ahora && (dias === null || dias >= 0)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap text-[13px] leading-[18px]">{o.endsAt ? `${formatDate(o.startsAt)} →` : 'Indefinida'}</span>
      {o.endsAt && <span className="whitespace-nowrap text-[13px] leading-[18px]">{formatDate(o.endsAt)}</span>}
      {o.endsAt ? (
        vigente ? (
          <span className={cn('flex items-center gap-1 text-[12px] font-semibold leading-4', dias !== null && dias <= 7 ? 'text-sv2-tertiary' : 'text-sv2-secondary')}>
            <Timer aria-hidden className="size-3.5" /> Vigente ({dias} d. restantes)
          </span>
        ) : (
          <span className="text-[12px] font-semibold leading-4 text-sv2-outline">{o.startsAt > ahora ? 'Aún no inicia' : 'Vencida'}</span>
        )
      ) : (
        <span className="flex items-center gap-1 text-[12px] leading-4 text-sv2-ink-variant"><SinFin aria-hidden className="size-3.5 shrink-0" /> Sin fecha de fin</span>
      )}
    </div>
  )
}

/**
 * Tabla de Ofertas (Stitch, propuesta A). Es UNA sola tabla que en
 * contenedores estrechos reacomoda cada fila como tarjeta: así cada oferta
 * existe una vez en la página (las pruebas buscan su `tr` dentro de
 * `tabla-ofertas`).
 */
export function TablaOfertas({ ofertas, ahora, pie }: { ofertas: OfertaEnLista[]; ahora: Date; pie: React.ReactNode }) {
  const th = 'px-2 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-2 @4xl:py-3 @4xl:align-top'
  return (
    <Tarjeta className="overflow-hidden">
      <div className="@4xl:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table" data-testid="tabla-ofertas">
          <thead className="hidden @4xl:table-header-group">
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'min-w-[190px] pl-3')}>Oferta &amp; SKU</th>
              <th scope="col" className={th}>Proveedor / origen</th>
              <th scope="col" className={th}>Modalidad</th>
              <th scope="col" className={th}>Cupos &amp; stock</th>
              <th scope="col" className={cn(th, 'text-right')}>Precio &amp; margen</th>
              <th scope="col" className={th}>Vigencia</th>
              <th scope="col" className={th}>Estado</th>
              <th scope="col" className={cn(th, 'pr-3 text-right')}>Acciones</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {ofertas.map((o) => (
              <tr key={o.id} data-testid="fila-oferta" className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-3 @4xl:table-row @4xl:p-0">
                <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:pl-3')}>
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-primary">
                      {o.sourceType === 'COMMISSION' ? <Percent className="size-[18px]" /> : <Package className="size-[18px]" />}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <Link href={`/superadmin/supply/ofertas/${o.id}`} className="text-[15px] font-bold leading-5 hover:underline">{o.title}</Link>
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={cn(MONO, 'text-sv2-outline')}>{o.code}</span>
                        {(o.categoria || o.sku) && <span className={cn(MONO, 'rounded-[4px] border border-sv2-border px-1 text-sv2-ink-variant')}>{o.categoria ?? o.sku}</span>}
                      </span>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <div className="flex flex-col">
                    <span className="font-semibold">{o.proveedor}</span>
                    <span className="text-[12px] leading-4 text-sv2-ink-variant">{o.producto}</span>
                    <span className={cn('mt-0.5 flex items-center gap-1 text-[12px] font-semibold leading-4', o.proveedorEnMembego ? 'text-sv2-secondary' : 'text-sv2-tertiary')}>
                      {o.proveedorEnMembego ? <Link2 aria-hidden className="size-3.5" /> : <span aria-hidden className="size-1.5 rounded-full bg-sv2-tertiary" />}
                      {o.proveedorEnMembego ? 'Empresa en Membego' : 'Proveedor externo'}
                    </span>
                  </div>
                </td>
                <td className={td}><Modalidad o={o} /></td>
                <td className={cn(td, 'col-span-2 @xl:col-span-1')}><Cupos o={o} /></td>
                <td className={td}><Precio o={o} /></td>
                <td className={td}><Vigencia o={o} ahora={ahora} /></td>
                <td className={td}><ChipEstado estado={o.status} /></td>
                <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:pr-3')}>
                  <div className="flex items-center justify-end gap-1 [&_button]:h-8 [&_button]:rounded-[8px] [&_button]:px-3 [&_button]:text-[13px] [&_form]:inline">
                    <Link href={`/superadmin/supply/ofertas/${o.id}`} className="px-2 py-1 text-[13px] font-semibold text-sv2-primary hover:underline">Ver</Link>
                    <AccionesOferta offerId={o.id} estado={o.status} compacto />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pie}
    </Tarjeta>
  )
}
