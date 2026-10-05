import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import type { SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import { PO_STATUS_LABELS, PO_STATUS_TONE } from '@/modules/supply-v2/core/catalogo'
import type { OrdenEnLista } from '@/modules/supply-v2/procurement/queries'
import { claseBotonSuave, MONO, TarjetaSeccion } from './superficie'

const CHIP: Record<(typeof PO_STATUS_TONE)[SupplyV2PurchaseOrderStatus], { fondo: string; punto: string }> = {
  success: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  danger: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
  warning: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  info: { fondo: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', punto: 'bg-sv2-primary' },
  neutral: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
}

/** Estado de la orden con la geometría de Stitch (pastilla con punto); mismos textos y tonos que `ChipOrden`. */
export function ChipOrdenSv2({ estado, className }: { estado: SupplyV2PurchaseOrderStatus; className?: string }) {
  const c = CHIP[PO_STATUS_TONE[estado]]
  return (
    <span className={cn('inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', c.fondo, className)} data-testid="estado-orden">
      <span aria-hidden className={cn('size-1.5 rounded-full', c.punto, estado === 'PENDING_APPROVAL' && 'animate-pulse')} />
      {PO_STATUS_LABELS[estado]}
    </span>
  )
}

const CERRADA: SupplyV2PurchaseOrderStatus[] = ['CANCELLED', 'CLOSED']

function subtitulo(o: OrdenEnLista): string {
  return o.recibidas > 0 ? `${o.recibidas.toLocaleString('es-DO')} unidades recibidas` : o.producto
}

/**
 * Órdenes de Compra Recientes: tabla compacta en escritorio y tarjetas en
 * móvil, donde cinco columnas no caben sin desplazar.
 */
export function OrdenesRecientes({ ordenes, filtro }: { ordenes: OrdenEnLista[]; filtro: string }) {
  const boton = cn(claseBotonSuave, 'rounded-[4px] px-2 py-1 text-[12px] font-medium leading-4 tracking-[0.04em]')
  return (
    <TarjetaSeccion
      icono={ClipboardList}
      titulo="Órdenes de Compra Recientes"
      data-testid="resumen-ordenes"
      extra={
        <Link href="/superadmin/supply-v2/compras" className="shrink-0 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline hover:text-foreground hover:underline">
          Últimos registros
        </Link>
      }
    >
      {ordenes.length === 0 ? (
        <p className="p-3 text-[13px] leading-[18px] text-sv2-ink-variant">{filtro ? `Ninguna orden coincide con «${filtro}».` : 'Todavía no hay órdenes de compra.'}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto @2xl:block">
            <table className="w-full text-left text-[13px] leading-[18px]">
              <thead className="bg-sv2-well text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-sv2-ink-variant">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Orden</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Proveedor</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Cantidad</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Estado</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-sv2-well">
                    <td className={cn(MONO, 'px-3 py-3 font-semibold', CERRADA.includes(o.status) ? 'text-sv2-ink-variant' : 'text-sv2-primary')}>
                      <Link href={`/superadmin/supply-v2/compras/${o.id}`} className="hover:underline">{o.number}</Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{o.proveedor}</span>
                        <span className="text-[12px] leading-4 text-sv2-outline">{subtitulo(o)}</span>
                      </div>
                    </td>
                    <td className={cn(MONO, 'whitespace-nowrap px-3 py-3 font-medium')}>{o.compradas.toLocaleString('es-DO')} un.</td>
                    <td className="px-3 py-3"><ChipOrdenSv2 estado={o.status} /></td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/superadmin/supply-v2/compras/${o.id}`} className={boton}>{CERRADA.includes(o.status) ? 'Bitácora' : 'Detalle'}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col divide-y divide-sv2-well @2xl:hidden">
            {ordenes.map((o) => (
              <li key={o.id} className="flex flex-col gap-1.5 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/superadmin/supply-v2/compras/${o.id}`} className={cn(MONO, 'font-semibold hover:underline', CERRADA.includes(o.status) ? 'text-sv2-ink-variant' : 'text-sv2-primary')}>{o.number}</Link>
                  <ChipOrdenSv2 estado={o.status} />
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div className="flex min-w-0 flex-col text-[13px] leading-[18px]">
                    <span className="font-medium text-foreground">{o.proveedor}</span>
                    <span className="text-[12px] leading-4 text-sv2-outline">{subtitulo(o)} · <span className="font-sv2-mono">{o.compradas.toLocaleString('es-DO')} un.</span></span>
                  </div>
                  <Link href={`/superadmin/supply-v2/compras/${o.id}`} className={cn(boton, 'shrink-0')}>{CERRADA.includes(o.status) ? 'Bitácora' : 'Detalle'}</Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </TarjetaSeccion>
  )
}
