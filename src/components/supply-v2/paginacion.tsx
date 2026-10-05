import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SelectorFilas } from './selector-filas'

const BOTON = 'flex size-8 items-center justify-center rounded-[8px] text-sv2-outline transition-colors hover:bg-sv2-soft hover:text-foreground'

/**
 * Pie de tabla de Supply 2.0 (Stitch): «Mostrando a – b de N», filas por
 * página y saltos de página. Todo por URL: `href(pagina, filas)` arma el enlace.
 */
export function PaginacionSupplyV2({
  pagina,
  filas,
  total,
  sustantivo,
  href,
  extra,
}: {
  pagina: number
  filas: number
  total: number
  /** «órdenes de compra», «productos»… */
  sustantivo: string
  href: (pagina: number, filas: number) => string
  /** Dato adicional junto al contador (p. ej. «Total unidades acumuladas»). */
  extra?: React.ReactNode
}) {
  const paginas = Math.max(1, Math.ceil(total / filas))
  const desde = total === 0 ? 0 : (pagina - 1) * filas + 1
  const hasta = Math.min(total, pagina * filas)
  const salto = (n: number, etiqueta: string, Icono: typeof ChevronLeft, oculto?: boolean) => {
    const deshabilitado = n < 1 || n > paginas || n === pagina
    return deshabilitado ? (
      <span aria-hidden className={cn(BOTON, 'opacity-40 hover:bg-transparent hover:text-sv2-outline', oculto && 'hidden @xl:flex')}>
        <Icono className="size-[18px]" />
      </span>
    ) : (
      <Link href={href(n, filas)} aria-label={etiqueta} className={cn(BOTON, oculto && 'hidden @xl:flex')}>
        <Icono className="size-[18px]" />
      </Link>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sv2-divider bg-card px-3 py-2 text-[13px] leading-4">
      <div className="flex flex-wrap items-center gap-2 font-medium text-sv2-ink-variant">
        <span>
          Mostrando <strong className="text-foreground">{desde} - {hasta}</strong> de <strong className="text-foreground">{total.toLocaleString('es-DO')}</strong> {sustantivo}
        </span>
        {extra && (
          <>
            <span aria-hidden className="hidden h-4 w-px bg-sv2-outline/40 @xl:block" />
            {extra}
          </>
        )}
        <span aria-hidden className="hidden h-4 w-px bg-sv2-outline/40 @xl:block" />
        <SelectorFilas filas={filas} opciones={[10, 25, 50]} hrefs={Object.fromEntries([10, 25, 50].map((n) => [n, href(1, n)]))} />
      </div>
      <nav aria-label="Paginación" className="flex items-center gap-1">
        {salto(1, 'Primera página', ChevronsLeft, true)}
        {salto(pagina - 1, 'Página anterior', ChevronLeft)}
        <span aria-current="page" className="flex size-8 items-center justify-center rounded-[8px] bg-sv2-accent text-[13px] font-semibold text-white">{pagina}</span>
        {salto(pagina + 1, 'Página siguiente', ChevronRight)}
        {salto(paginas, 'Última página', ChevronsRight, true)}
      </nav>
    </div>
  )
}
