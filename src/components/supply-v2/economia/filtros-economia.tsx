import Link from 'next/link'
import { CalendarDays, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { RUTA_ECONOMIA } from '@/modules/supply-v2/core/catalogo'
import type { VentanaEconomia } from '@/modules/supply-v2/economics/domain'
import { Tarjeta } from '../resumen/superficie'

export const VENTANAS: { v: VentanaEconomia; label: string }[] = [
  { v: 'HOY', label: 'Hoy' },
  { v: '7D', label: '7 días' },
  { v: '30D', label: '30 días' },
  { v: 'MES', label: 'Mes' },
  { v: 'RANGO', label: 'Rango' },
]

const CAMPO = 'h-10 w-full rounded-[8px] border border-sv2-border bg-card px-3 text-[14px] leading-5 text-foreground focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15'
const ETIQUETA = 'text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant'

/** Selector de ventana (enlaces) para la cabecera; conserva proveedor y producto. */
export function SelectorVentana({ ventana, href }: { ventana: VentanaEconomia; href: (v: VentanaEconomia) => string }) {
  return (
    <div className="flex w-fit items-center rounded-[8px] bg-sv2-soft p-1" data-testid="ventanas-economia">
      {VENTANAS.map((v) => (
        <Link
          key={v.v}
          href={href(v.v)}
          aria-current={ventana === v.v ? 'page' : undefined}
          className={cn('whitespace-nowrap rounded-[6px] px-3 py-1 text-[13px] font-semibold leading-4 transition-colors', ventana === v.v ? 'bg-card text-foreground shadow-sm' : 'text-sv2-ink-variant hover:text-foreground')}
        >
          {v.label}
        </Link>
      ))}
    </div>
  )
}

/** Filtros del reporte: formulario GET (la URL guarda el filtro) y el periodo que se está viendo. */
export function FiltrosEconomia({
  ventana,
  proveedor,
  producto,
  desde,
  hasta,
  opciones,
  periodo,
}: {
  ventana: VentanaEconomia
  proveedor: string
  producto: string
  desde: string
  hasta: string
  opciones: { proveedores: { id: string; nombre: string }[]; productos: { id: string; nombre: string; proveedor: string }[] }
  periodo: { desde: Date; hasta: Date }
}) {
  return (
    <Tarjeta className="flex flex-col gap-3 bg-sv2-well p-3 shadow-none">
      <form method="get" className="grid grid-cols-1 items-end gap-3 @xl:grid-cols-2 @5xl:grid-cols-[1fr_1fr_160px_160px_auto]" data-testid="filtros-economia">
        <input type="hidden" name="ventana" value={ventana === 'RANGO' || desde || hasta ? 'RANGO' : ventana} />
        <div className="flex flex-col gap-1">
          <label htmlFor="proveedor" className={ETIQUETA}>Proveedor</label>
          <select id="proveedor" name="proveedor" defaultValue={proveedor} className={CAMPO}>
            <option value="">Todos</option>
            {opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="producto" className={ETIQUETA}>Producto</label>
          <select id="producto" name="producto" defaultValue={producto} className={CAMPO}>
            <option value="">Todos</option>
            {opciones.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.proveedor}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className={ETIQUETA}>Desde</label>
          <input id="desde" name="desde" type="date" defaultValue={desde} className={CAMPO} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className={ETIQUETA}>Hasta</label>
          <input id="hasta" name="hasta" type="date" defaultValue={hasta} className={CAMPO} />
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2">
            <Check aria-hidden className="size-4" />
            Aplicar
          </button>
          <Link href={RUTA_ECONOMIA} className="inline-flex h-10 items-center rounded-[8px] bg-sv2-soft px-3 text-[14px] font-semibold leading-5 transition-colors hover:bg-sv2-soft-hover">Limpiar</Link>
        </div>
      </form>
      <p className="flex items-center gap-1.5 text-[12px] leading-4 text-sv2-ink-variant">
        <CalendarDays aria-hidden className="size-3.5" />
        Periodo: {formatDate(periodo.desde)} – {formatDate(periodo.hasta)}
      </p>
    </Tarjeta>
  )
}
