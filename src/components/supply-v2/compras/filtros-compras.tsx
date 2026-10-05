import Link from 'next/link'
import Form from 'next/form'
import { ChevronDown, Filter, Search, X } from 'lucide-react'
import type { SupplyV2PaymentMode, SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import { PO_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import { Tarjeta } from '../resumen/superficie'
import { CONDICION_CORTA } from './condicion'

export interface FiltrosCompras {
  q: string
  proveedor: string
  estado: SupplyV2PurchaseOrderStatus | ''
  pago: SupplyV2PaymentMode | ''
}

const RUTA = '/superadmin/supply-v2/compras'
const CAMPO = 'h-9 w-full rounded-[8px] bg-sv2-well text-[13px] leading-[18px] text-foreground placeholder:text-sv2-outline focus:bg-card focus:outline-none focus:ring-1 focus:ring-sv2-accent'

/** Enlace a Compras con estos filtros (sin los vacíos). */
export function hrefCompras(f: Partial<FiltrosCompras> & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.estado) p.set('estado', f.estado)
  if (f.pago) p.set('pago', f.pago)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA}?${qs}` : RUTA
}

function Selector({ name, valor, etiqueta, opciones }: { name: string; valor: string; etiqueta: string; opciones: { valor: string; texto: string }[] }) {
  return (
    <div className="relative flex items-center @5xl:col-span-2">
      <select name={name} defaultValue={valor} aria-label={etiqueta} className={cn(CAMPO, 'cursor-pointer appearance-none pl-2 pr-7')}>
        <option value="">{etiqueta}: Todos</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 size-[18px] text-sv2-ink-variant" />
    </div>
  )
}

/**
 * Barra de filtros de Compras (Stitch): búsqueda, proveedor, estado y forma de
 * pago; los filtros activos como chips que se quitan con ✕. Es un GET: la URL
 * guarda el filtro y se puede compartir.
 */
export function FiltrosComprasBarra({ f, proveedores, total }: { f: FiltrosCompras; proveedores: { id: string; nombre: string }[]; total: number }) {
  const chips: { texto: string; sin: Partial<FiltrosCompras> }[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, sin: { q: '' } })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.nombre ?? '—'}`, sin: { proveedor: '' } })
  if (f.estado) chips.push({ texto: `Estado: ${PO_STATUS_LABELS[f.estado]}`, sin: { estado: '' } })
  if (f.pago) chips.push({ texto: `Pago: ${CONDICION_CORTA[f.pago]}`, sin: { pago: '' } })
  return (
    <Tarjeta className="flex flex-col gap-3 p-3" data-testid="filtros-compras">
      <Form action={RUTA} className="grid grid-cols-1 items-center gap-2 @xl:grid-cols-2 @5xl:grid-cols-12">
        <div className="relative flex items-center @xl:col-span-2 @5xl:col-span-4">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-[18px] text-sv2-ink-variant" />
          <input name="q" type="search" defaultValue={f.q} aria-label="Buscar órdenes" placeholder="Buscar PO (ej. MBG-PO-...), proveedor, producto..." className={cn(CAMPO, 'pl-9 pr-3')} data-testid="buscar-compras" />
        </div>
        <Selector name="proveedor" valor={f.proveedor} etiqueta="Proveedor" opciones={proveedores.map((p) => ({ valor: p.id, texto: p.nombre }))} />
        <Selector name="estado" valor={f.estado} etiqueta="Estado" opciones={Object.entries(PO_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto }))} />
        <Selector name="pago" valor={f.pago} etiqueta="Pago" opciones={Object.entries(CONDICION_CORTA).map(([valor, texto]) => ({ valor, texto }))} />
        <div className="flex items-center justify-end gap-1 @5xl:col-span-2">
          <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-[8px] bg-foreground px-3 text-[13px] font-medium leading-4 text-background shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent" data-testid="btn-filtrar">
            <Filter aria-hidden className="size-4" />
            Filtrar
          </button>
          <Link href={RUTA} className="inline-flex h-9 items-center rounded-[8px] px-2 text-[13px] font-medium leading-4 text-sv2-outline transition-colors hover:text-foreground">
            Limpiar
          </Link>
        </div>
      </Form>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px] font-semibold leading-4 tracking-[0.04em]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sv2-outline">{chips.length > 0 ? 'Filtros aplicados:' : 'Sin filtros aplicados'}</span>
          {chips.map((c) => (
            <span key={c.texto} className="inline-flex items-center gap-1 rounded-full bg-sv2-soft px-2 py-0.5 font-medium text-sv2-ink-variant">
              {c.texto}
              <Link href={hrefCompras({ ...f, ...c.sin })} aria-label={`Quitar ${c.texto}`} className="hover:text-sv2-error">
                <X aria-hidden className="size-3.5" />
              </Link>
            </span>
          ))}
        </div>
        <span className="font-sv2-mono font-normal tracking-normal text-sv2-outline" data-testid="total-compras">
          {total.toLocaleString('es-DO')} {total === 1 ? 'orden de compra registrada' : 'órdenes de compra registradas'}
        </span>
      </div>
    </Tarjeta>
  )
}
