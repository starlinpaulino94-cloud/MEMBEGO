import Link from 'next/link'
import { ChevronRight, Package, Shapes, Sparkles } from 'lucide-react'
import { formatMoneyRD } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SupplyPorProducto } from '@/modules/supply-v2/pool/queries'
import { MONO, TarjetaSeccion } from './superficie'

/**
 * Inventario de Supply Activo: una fila por producto con su valor y la barra
 * de distribución (libres / comprometidas en ofertas / ya emitidas o
 * reservadas) sobre lo recibido.
 */
export function InventarioActivo({
  productos,
  total,
  coincidencias,
  filtro,
  vacio,
}: {
  /** Los que se pintan (ya filtrados y recortados). */
  productos: SupplyPorProducto[]
  /** Productos en el pool, sin filtro: 0 significa que todavía no hay supply. */
  total: number
  /** Productos que pasan el filtro rápido. */
  coincidencias: number
  filtro: string
  vacio: React.ReactNode
}) {
  return (
    <TarjetaSeccion
      icono={Shapes}
      titulo="Inventario de Supply Activo"
      data-testid="resumen-inventario"
      extra={
        <Link href="/superadmin/supply-v2/supply" className="flex shrink-0 items-center gap-0.5 text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
          <span>Ver Supply completo</span>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {productos.length === 0 ? (
          total === 0 ? (
            vacio
          ) : (
            <p className="rounded-[8px] bg-sv2-well p-3 text-[13px] leading-[18px] text-sv2-ink-variant">Ningún producto coincide con «{filtro}».</p>
          )
        ) : (
          productos.map((p) => <FilaInventario key={p.catalogItemId} p={p} />)
        )}
        {productos.length > 0 && coincidencias > productos.length && (
          <p className="text-right text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">
            Mostrando {productos.length} de {coincidencias} productos
          </p>
        )}
      </div>
    </TarjetaSeccion>
  )
}

function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0
}

function FilaInventario({ p }: { p: SupplyPorProducto }) {
  const Icono = p.tipo === 'PRODUCT' ? Package : Sparkles
  const otras = Math.max(0, p.recibidas - p.disponibles - p.asignadas)
  const libres = pct(p.disponibles, p.recibidas)
  const comprometidas = pct(p.asignadas, p.recibidas)
  const resto = p.recibidas > 0 ? Math.max(0, 100 - libres - comprometidas) : 0
  return (
    <div className="flex flex-col gap-2 rounded-[8px] bg-sv2-well p-3" data-testid="resumen-producto">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/superadmin/supply-v2/supply/${p.catalogItemId}`} className="group flex min-w-0 items-center gap-2">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-on-primary-fixed">
            <Icono className="size-6" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-[15px] font-bold leading-5 tracking-[-0.005em] text-foreground group-hover:underline">{p.producto}</span>
              {p.disponibles > 0 ? (
                <span className="rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-on-secondary-container">Disponible</span>
              ) : (
                <span className="rounded-full bg-sv2-soft-hover px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">Sin disponibles</span>
              )}
            </span>
            <span className="text-[13px] leading-[18px] text-sv2-ink-variant">
              Proveedor: {p.proveedor}
              {p.sku && <> · SKU: {p.sku}</>}
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 flex-col text-right">
          <span className="text-[15px] font-bold leading-5 text-foreground tabular-nums">{formatMoneyRD(p.valorDisponible)}</span>
          <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">Valor de compra</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">
          <span>
            Distribución: <strong className="text-foreground">{p.disponibles.toLocaleString('es-DO')} disp.</strong> ({libres}%) / <strong className="text-foreground">{p.asignadas.toLocaleString('es-DO')} asignadas</strong> ({comprometidas}%)
          </span>
          <span className={cn(MONO, 'font-medium text-sv2-outline')}>Total: {p.recibidas.toLocaleString('es-DO')} unidades</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-sv2-track" role="img" aria-label={`${libres}% libres, ${comprometidas}% comprometidas en ofertas`}>
          <span className="h-full bg-sv2-primary" style={{ width: `${libres}%` }} />
          <span className="h-full bg-sv2-secondary" style={{ width: `${comprometidas}%` }} />
          {resto > 0 && <span className="h-full bg-sv2-outline/60" style={{ width: `${resto}%` }} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-sv2-primary" />
            Libres en almacén ({p.disponibles.toLocaleString('es-DO')})
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-sv2-secondary" />
            Comprometidas en ofertas ({p.asignadas.toLocaleString('es-DO')})
          </span>
          {otras > 0 && (
            <span className="flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-sv2-outline/60" />
              Reservadas o emitidas ({otras.toLocaleString('es-DO')})
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
