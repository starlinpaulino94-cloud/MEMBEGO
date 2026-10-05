import Link from 'next/link'
import { Archive, Infinity as SinFin, Clock, Package, Sparkles, Tag } from 'lucide-react'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SupplyPorProducto } from '@/modules/supply-v2/pool/queries'
import { MONO } from '../resumen/superficie'
import { diasHasta, ESTADO_STOCK_LABELS, estadoStock } from './estado-stock'

/** Piezas compartidas por la tabla y la vista de tarjetas de Supply. */

export function dineroProducto(p: SupplyPorProducto, n: number): string {
  return p.moneda === 'DOP' ? formatMoneyRD(n) : `${p.moneda} ${n.toLocaleString('es-DO')}`
}

export function IconoProducto({ p, grande = false }: { p: SupplyPorProducto; grande?: boolean }) {
  const Icono = p.tipo === 'PRODUCT' ? Package : Sparkles
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-primary', grande ? 'size-10' : 'size-9')}>
      <Icono className="size-5" strokeWidth={1.75} />
    </span>
  )
}

const ESTADO = {
  EN_STOCK: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  SIN_ASIGNAR: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  AGOTADO: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
} as const

export function ChipEstadoStock({ p }: { p: SupplyPorProducto }) {
  const e = estadoStock(p)
  return (
    <span className={cn('inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', ESTADO[e].fondo)} data-testid="estado-stock">
      <span aria-hidden className={cn('size-1.5 rounded-full', ESTADO[e].punto)} />
      {ESTADO_STOCK_LABELS[e]}
    </span>
  )
}

export function Vencimiento({ p, ahora }: { p: SupplyPorProducto; ahora: Date }) {
  if (!p.proximoVencimiento) {
    return (
      <div className="flex flex-col">
        <span className="flex items-center gap-1 text-[13px] font-medium leading-[18px] text-foreground">
          <SinFin aria-hidden className="size-4 text-sv2-primary" />
          Indefinido
        </span>
        <span className="text-[12px] leading-4 text-sv2-outline">Sin caducidad</span>
      </div>
    )
  }
  const dias = diasHasta(p.proximoVencimiento, ahora)
  const pronto = dias <= 7
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1 whitespace-nowrap text-[13px] font-medium leading-[18px] text-foreground">
        <Clock aria-hidden className={cn('size-4', pronto ? 'text-sv2-error' : 'text-sv2-tertiary')} />
        {formatDate(p.proximoVencimiento)}
      </span>
      <span className={cn('text-[12px] font-semibold leading-4 tracking-[0.04em]', pronto ? 'text-sv2-error' : 'text-sv2-tertiary')}>
        {dias < 0 ? `Venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}` : dias === 0 ? 'Vence hoy' : `En ${dias} ${dias === 1 ? 'día' : 'días'}`}
      </span>
    </div>
  )
}

/** «Crear oferta» (con el producto ya elegido) y el atajo a sus lotes. */
/** `compacto` (tabla): el botón dice «Oferta»; el nombre accesible sigue siendo «Crear oferta». */
export function AccionesProducto({ p, compacto = false }: { p: SupplyPorProducto; compacto?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {p.disponibles > 0 && (
        <Link
          href={`/superadmin/supply-v2/ofertas/nueva?producto=${p.catalogItemId}`}
          data-testid="btn-crear-oferta-producto"
          className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-[8px] bg-sv2-accent px-2.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-white shadow-sm transition-colors hover:bg-sv2-accent-hover"
        >
          <Tag aria-hidden className="size-3.5" />
          {compacto ? <><span className="sr-only">Crear </span>Oferta</> : 'Crear oferta'}
        </Link>
      )}
      <Link
        href={`/superadmin/supply-v2/supply/${p.catalogItemId}`}
        aria-label={`Ver lotes de ${p.producto}`}
        title="Ver lotes"
        className="flex size-8 items-center justify-center rounded-[8px] text-sv2-outline transition-colors hover:bg-sv2-soft hover:text-foreground"
      >
        <Archive aria-hidden className="size-[18px]" />
      </Link>
    </div>
  )
}

/** Reservadas · emitidas · redimidas: lo que la tabla de Stitch no tiene columna y la pantalla sí mostraba. */
export function Movimientos({ p }: { p: SupplyPorProducto }) {
  return (
    <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-outline" title="Reservadas · emitidas · redimidas">
      <span data-testid="pool-reservadas">{p.reservadas.toLocaleString('es-DO')}</span> res · <span data-testid="pool-emitidas">{p.emitidas.toLocaleString('es-DO')}</span> emi · <span data-testid="pool-redimidas">{p.redimidas.toLocaleString('es-DO')}</span> red
    </span>
  )
}

export const ETIQUETA_MOVIL = 'text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline @4xl:hidden'
export { MONO }
