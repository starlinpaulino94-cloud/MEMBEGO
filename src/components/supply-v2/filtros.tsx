import Link from 'next/link'
import Form from 'next/form'
import { ChevronDown, Filter, RotateCcw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tarjeta } from './resumen/superficie'

const CAMPO = 'h-9 w-full rounded-[8px] bg-sv2-well text-[13px] leading-[18px] text-foreground placeholder:text-sv2-outline focus:bg-card focus:outline-none focus:ring-1 focus:ring-sv2-accent'

export interface SelectorFiltro {
  name: string
  etiqueta: string
  valor: string
  /** Texto de la opción vacía (por defecto «Todos»). */
  todos?: string
  opciones: { valor: string; texto: string }[]
}

export interface ChipFiltro {
  texto: string
  /** Enlace a la misma pantalla sin este filtro. */
  quitar: string
}

/**
 * Barra de filtros de las pestañas de Supply 2.0 (Stitch): búsqueda, selectores
 * y los filtros activos como chips. Es un formulario GET: la URL guarda el
 * filtro. `variante` replica las dos versiones de la maqueta: Compras («Filtrar»
 * oscuro + «Limpiar») y Proveedores («Aplicar» suave + ↺).
 */
export function BarraFiltrosSupplyV2({
  ruta,
  busqueda,
  selectores,
  chips,
  resumen,
  variante = 'oscura',
  extra,
  testId,
}: {
  ruta: string
  busqueda: { valor: string; placeholder: string; etiqueta: string; testId?: string }
  selectores: SelectorFiltro[]
  chips: ChipFiltro[]
  /** Texto a la derecha de los chips (p. ej. «4 órdenes de compra registradas»). */
  resumen?: React.ReactNode
  variante?: 'oscura' | 'suave'
  /** Controles adicionales junto a los botones (p. ej. el interruptor «Vencimientos» de Supply). Van dentro del formulario. */
  extra?: React.ReactNode
  testId?: string
}) {
  return (
    <Tarjeta className="flex flex-col gap-3 p-3" data-testid={testId}>
      <Form action={ruta} className="grid grid-cols-1 items-center gap-2 @xl:grid-cols-2 @5xl:grid-cols-12">
        <div className={cn('relative flex items-center @xl:col-span-2', extra ? '@5xl:col-span-3' : '@5xl:col-span-4')}>
          <Search aria-hidden className="pointer-events-none absolute left-2 size-[18px] text-sv2-ink-variant" />
          <input name="q" type="search" defaultValue={busqueda.valor} aria-label={busqueda.etiqueta} placeholder={busqueda.placeholder} className={cn(CAMPO, 'pl-9 pr-3')} data-testid={busqueda.testId} />
        </div>
        {selectores.map((s) => (
          <div key={s.name} className="relative flex items-center @5xl:col-span-2">
            <select name={s.name} defaultValue={s.valor} aria-label={s.etiqueta} className={cn(CAMPO, 'cursor-pointer appearance-none pl-2 pr-7')}>
              <option value="">{s.etiqueta}: {s.todos ?? 'Todos'}</option>
              {s.opciones.map((o) => (
                <option key={o.valor} value={o.valor}>{o.texto}</option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 size-[18px] text-sv2-ink-variant" />
          </div>
        ))}
        <div className={cn('flex items-center justify-end gap-1', extra ? '@xl:col-span-2 @5xl:col-span-3' : selectores.length >= 3 ? '@5xl:col-span-2' : '@5xl:col-span-4')}>
          {extra}
          {variante === 'oscura' ? (
            <>
              <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-[8px] bg-foreground px-3 text-[13px] font-medium leading-4 text-background shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent" data-testid="btn-filtrar">
                <Filter aria-hidden className="size-4" />
                Filtrar
              </button>
              <Link href={ruta} className="inline-flex h-9 items-center rounded-[8px] px-2 text-[13px] font-medium leading-4 text-sv2-outline transition-colors hover:text-foreground">
                Limpiar
              </Link>
            </>
          ) : (
            <>
              <button type="submit" className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-[8px] bg-sv2-soft px-3 text-[13px] font-semibold leading-4 text-foreground transition-colors hover:bg-sv2-soft-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent" data-testid="btn-filtrar">
                <Filter aria-hidden className="size-4" />
                Aplicar
              </button>
              <Link href={ruta} aria-label="Reiniciar filtros" title="Reiniciar filtros" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-sv2-well text-sv2-ink-variant transition-colors hover:bg-sv2-soft hover:text-foreground">
                <RotateCcw aria-hidden className="size-4" />
              </Link>
            </>
          )}
        </div>
      </Form>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px] font-semibold leading-4 tracking-[0.04em]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sv2-outline">{chips.length > 0 ? 'Filtros aplicados:' : 'Sin filtros aplicados'}</span>
          {chips.map((c) => (
            <span key={c.texto} className="inline-flex items-center gap-1 rounded-full bg-sv2-soft px-2 py-0.5 font-medium text-sv2-ink-variant">
              {c.texto}
              <Link href={c.quitar} aria-label={`Quitar ${c.texto}`} className="hover:text-sv2-error">
                <X aria-hidden className="size-3.5" />
              </Link>
            </span>
          ))}
        </div>
        {resumen}
      </div>
    </Tarjeta>
  )
}
