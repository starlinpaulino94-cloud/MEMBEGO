import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CATALOG_ITEM_TYPE_LABELS } from '@/modules/supply-v2/core/catalogo'
import { ORDEN_POR_RECIBIR } from '@/modules/supply-v2/core/estados'
import type { OrdenEnLista } from '@/modules/supply-v2/procurement/queries'
import { ChipOrdenSv2 } from '../resumen/ordenes-recientes'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'
import { textoCondicion } from './condicion'

function dinero(monto: string, moneda: string): string {
  const n = Number(monto).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'DOP' ? `RD$${n}` : `${moneda} ${n}`
}

function iniciales(nombre: string): string {
  const palabras = nombre.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (palabras.length > 1 ? palabras[0]![0]! + palabras[1]![0]! : (palabras[0] ?? '?').slice(0, 2)).toUpperCase()
}

function detalleProducto(o: OrdenEnLista): string | null {
  const tipo = o.categoria ?? (o.tipoProducto ? CATALOG_ITEM_TYPE_LABELS[o.tipoProducto] : null)
  return [o.sku, tipo].filter(Boolean).join(' · ') || null
}

const CERRADA = new Set(['CANCELLED', 'CLOSED', 'REJECTED'])

/** `compacto`: sin la palabra «recibidas» (en la tabla ya la dice el encabezado). */
function Recepcion({ o, compacto = false }: { o: OrdenEnLista; compacto?: boolean }) {
  const pct = o.compradas > 0 ? Math.round((o.recibidas / o.compradas) * 100) : 0
  const tono = CERRADA.has(o.status) || pct === 0 ? 'text-sv2-outline' : pct >= 100 ? 'text-sv2-secondary' : 'text-sv2-tertiary'
  const barra = pct >= 100 ? 'bg-sv2-secondary' : 'bg-sv2-tertiary'
  return (
    <div className={cn('flex flex-col gap-1', compacto ? 'w-[130px]' : 'w-[170px]')}>
      <div className={cn('flex items-center justify-between gap-2 text-[12px] leading-4 tracking-[0.04em]', tono)}>
        <span className="whitespace-nowrap font-semibold">{o.recibidas.toLocaleString('es-DO')} / {o.compradas.toLocaleString('es-DO')}{compacto ? '' : ' recibidas'}</span>
        <span className="font-bold">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sv2-track">
        <div className={cn('h-full rounded-full', barra)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

function Accion({ o }: { o: OrdenEnLista }) {
  const href = `/superadmin/supply-v2/compras/${o.id}`
  return ORDEN_POR_RECIBIR.includes(o.status) ? (
    <Link href={href} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-[8px] bg-sv2-accent px-2.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-white shadow-sm transition-colors hover:bg-sv2-accent-hover">
      Recepción
      <Inbox aria-hidden className="size-3.5" />
    </Link>
  ) : (
    <Link href={href} className={cn(claseBotonSuave, 'h-8 whitespace-nowrap px-2.5 text-[12px] leading-4 tracking-[0.04em]')}>
      Ver orden
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  )
}

function Avatar({ o }: { o: OrdenEnLista }) {
  return (
    <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-[4px] text-[12px] font-bold leading-none', o.proveedorEnMembego ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : 'bg-sv2-soft-hover text-foreground')}>
      {iniciales(o.proveedor)}
    </span>
  )
}

function Importe({ o }: { o: OrdenEnLista }) {
  return (
    <div className="flex flex-col items-end">
      <span className={cn(MONO, 'whitespace-nowrap font-bold', CERRADA.has(o.status) ? 'text-sv2-outline line-through' : 'text-foreground')}>{dinero(o.total, o.currency)}</span>
      {o.costoUnitario && <span className="whitespace-nowrap text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">{dinero(o.costoUnitario, o.currency)} / u</span>}
    </div>
  )
}

/**
 * Tabla de Compras (Stitch): densa en escritorio; en tarjetas cuando el
 * contenido no da para nueve columnas.
 */
export function TablaCompras({ ordenes, pie }: { ordenes: OrdenEnLista[]; pie: React.ReactNode }) {
  return (
    <Tarjeta className="overflow-hidden" data-testid="lista-compras">
      <div className="hidden w-full overflow-x-auto @4xl:block">
        <table className="w-full border-collapse text-left text-[13px] leading-[18px] text-foreground">
          <thead>
            <tr className="h-10 select-none bg-sv2-well text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">
              <th scope="col" className="min-w-[140px] px-2 font-bold">Compra &amp; Emisión</th>
              <th scope="col" className="min-w-[150px] px-2 font-bold">Proveedor</th>
              <th scope="col" className="min-w-[120px] px-2 font-bold">Producto / SKU</th>
              <th scope="col" className="px-2 text-center font-bold">Cant.</th>
              <th scope="col" className="px-2 font-bold">Recepción física</th>
              <th scope="col" className="whitespace-nowrap px-2 text-right font-bold">Importe total</th>
              <th scope="col" className="px-2 font-bold">Condición</th>
              <th scope="col" className="px-2 font-bold">Estado</th>
              <th scope="col" className="px-2 text-right font-bold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sv2-well">
            {ordenes.map((o) => (
              <tr key={o.id} className="transition-colors hover:bg-sv2-well/60" data-testid="fila-compra">
                <td className="px-2 py-2 align-middle">
                  <div className="flex flex-col">
                    <Link href={`/superadmin/supply-v2/compras/${o.id}`} className={cn(MONO, 'whitespace-nowrap font-bold text-sv2-primary hover:underline')}>{o.number}</Link>
                    <span className="whitespace-nowrap text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">{formatDate(o.createdAt)}</span>
                    {o.creadaPor && <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">Creada por {o.creadaPor}</span>}
                  </div>
                </td>
                <td className="px-2 py-2 align-middle">
                  <div className="flex items-center gap-1">
                    <Avatar o={o} />
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{o.proveedor}</span>
                      <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">{o.proveedorEnMembego ? 'Empresa en Membego' : 'Proveedor externo'}</span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 align-middle">
                  <div className="flex flex-col">
                    <span className="font-medium">{o.producto}</span>
                    {detalleProducto(o) && <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">{detalleProducto(o)}</span>}
                  </div>
                </td>
                <td className={cn(MONO, 'whitespace-nowrap px-2 py-2 text-center align-middle font-medium')}>{o.compradas.toLocaleString('es-DO')} uds</td>
                <td className="px-2 py-2 align-middle"><Recepcion o={o} compacto /></td>
                <td className="px-2 py-2 text-right align-middle"><Importe o={o} /></td>
                <td className="px-2 py-2 align-middle">
                  <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sv2-soft-hover px-2 py-0.5 text-[12px] font-medium leading-4 tracking-[0.04em]">{textoCondicion(o.paymentMode, o.plazoDias)}</span>
                </td>
                <td className="px-2 py-2 align-middle"><ChipOrdenSv2 estado={o.status} className="whitespace-normal" /></td>
                <td className="px-2 py-2 text-right align-middle"><Accion o={o} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-sv2-well @4xl:hidden">
        {ordenes.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 p-3" data-testid="tarjeta-compra">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <Link href={`/superadmin/supply-v2/compras/${o.id}`} className={cn(MONO, 'font-bold text-sv2-primary hover:underline')}>{o.number}</Link>
                <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">
                  {formatDate(o.createdAt)}
                  {o.creadaPor && <> · {o.creadaPor}</>}
                </span>
              </div>
              <ChipOrdenSv2 estado={o.status} />
            </div>
            <div className="flex items-center gap-1 text-[13px] leading-[18px]">
              <Avatar o={o} />
              <span className="min-w-0 font-medium">{o.proveedor}</span>
              <span className="text-sv2-outline">·</span>
              <span className="min-w-0 text-sv2-ink-variant">{o.producto}</span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <Recepcion o={o} />
              <Importe o={o} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-sv2-soft-hover px-2 py-0.5 text-[12px] font-medium leading-4 tracking-[0.04em]">{textoCondicion(o.paymentMode, o.plazoDias)}</span>
              <Accion o={o} />
            </div>
          </li>
        ))}
      </ul>
      {pie}
    </Tarjeta>
  )
}
