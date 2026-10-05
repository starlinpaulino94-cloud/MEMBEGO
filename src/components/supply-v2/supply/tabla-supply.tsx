import Link from 'next/link'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SupplyPorProducto } from '@/modules/supply-v2/pool/queries'
import { Tarjeta } from '../resumen/superficie'
import { AccionesProducto, ChipEstadoStock, dineroProducto, ETIQUETA_MOVIL, IconoProducto, MONO, Movimientos, Vencimiento } from './piezas-supply'

function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0
}

/**
 * Tabla del pool (Stitch). Es UNA sola estructura: en contenedores estrechos
 * cada fila se reacomoda como tarjeta (grid) en vez de pintar una lista
 * aparte; así cada producto existe una vez en la página y los identificadores
 * que leen las pruebas (`pool-producto`, `pool-disponibles`…) no se duplican.
 */
export function TablaSupply({ productos, ahora, pie }: { productos: SupplyPorProducto[]; ahora: Date; pie: React.ReactNode }) {
  const th = 'px-1.5 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-1.5 @4xl:py-3 @4xl:align-middle'
  return (
    <Tarjeta className="overflow-hidden" data-testid="pool-productos">
      <div className="@4xl:overflow-x-auto">
      <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table">
        <thead className="hidden @4xl:table-header-group">
          <tr className="h-11 border-b border-sv2-border bg-sv2-head">
            <th scope="col" className={cn(th, 'min-w-[170px] pl-3')}>Producto / Servicio</th>
            <th scope="col" className={th}>Proveedor</th>
            <th scope="col" className={th}>Lotes activos</th>
            <th scope="col" className={cn(th, 'text-center')}>Disponibles</th>
            <th scope="col" className={cn(th, 'text-right')}>Asignadas</th>
            <th scope="col" className={cn(th, 'text-right')}>Valor stock</th>
            <th scope="col" className={th}>Estado</th>
            <th scope="col" className={th}>Próximo vencimiento</th>
            <th scope="col" className={cn(th, 'pr-3 text-right')}>Acciones</th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
          {productos.map((p) => {
            const disp = pct(p.disponibles, p.recibidas)
            return (
              <tr key={p.catalogItemId} data-testid="pool-producto" className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-4 @4xl:table-row @4xl:p-0">
                <td className={cn(td, 'col-span-2 @xl:col-span-4 @4xl:pl-3')}>
                  <div className="flex items-start gap-2">
                    <IconoProducto p={p} />
                    <div className="flex min-w-0 flex-col">
                      <Link href={`/superadmin/supply-v2/supply/${p.catalogItemId}`} className="text-[15px] font-bold leading-5 text-foreground hover:underline">{p.producto}</Link>
                      <span className="flex flex-wrap items-center gap-1">
                        {p.sku && <span className={cn(MONO, 'rounded-[4px] bg-sv2-soft px-1 text-sv2-outline')}>{p.sku}</span>}
                        {p.descripcion && <span className="line-clamp-2 text-[12px] leading-4 text-sv2-ink-variant">{p.descripcion}</span>}
                      </span>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <span className={ETIQUETA_MOVIL}>Proveedor</span>
                  <Link href={`/superadmin/supply-v2/proveedores/${p.proveedorId}`} className="block font-semibold leading-[18px] hover:underline">{p.proveedor}</Link>
                </td>
                <td className={td}>
                  <span className={ETIQUETA_MOVIL}>Lotes</span>
                  <div className="flex flex-col">
                    <span className="font-medium">{p.lotes} {p.lotes === 1 ? 'lote' : 'lotes'}</span>
                    {p.ultimoLote && (
                      <>
                        <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>{p.ultimoLote.code}</span>
                        <span className="whitespace-nowrap text-[12px] font-semibold leading-4 text-sv2-ink-variant">{formatDate(p.ultimoLote.receivedAt)}</span>
                      </>
                    )}
                  </div>
                </td>
                <td className={cn(td, '@4xl:text-center')}>
                  <span className={ETIQUETA_MOVIL}>Disponibles</span>
                  <div className="flex flex-col items-start gap-1 @4xl:items-center">
                    <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[15px] font-bold leading-5', p.asignadas > 0 ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed')}>
                      <span data-testid="pool-disponibles">{p.disponibles.toLocaleString('es-DO')}</span> <span className="text-[12px] font-semibold">u.</span>
                    </span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-sv2-track">
                      <div className={cn('h-full rounded-full', p.asignadas > 0 ? 'bg-sv2-secondary' : 'bg-sv2-tertiary')} style={{ width: `${disp}%` }} />
                    </div>
                    <span className="whitespace-nowrap text-[12px] font-semibold leading-4 text-sv2-ink-variant">{p.asignadas > 0 ? `${disp}% de ${p.recibidas.toLocaleString('es-DO')}` : `sin asignar · de ${p.recibidas.toLocaleString('es-DO')}`}</span>
                  </div>
                </td>
                <td className={cn(td, '@4xl:text-right')}>
                  <span className={ETIQUETA_MOVIL}>Asignadas</span>
                  <div className="flex flex-col @4xl:items-end">
                    <span className={cn('text-[15px] font-bold leading-5', p.asignadas > 0 ? 'text-sv2-primary' : 'text-sv2-outline')}>
                      <span data-testid="pool-asignadas">{p.asignadas.toLocaleString('es-DO')}</span> u.
                    </span>
                    {p.ofertaActiva ? (
                      <>
                        <span className={cn(MONO, 'whitespace-nowrap text-foreground')}>{p.ofertaActiva.code}</span>
                        <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-ink-variant">PVP: {dineroProducto(p, p.ofertaActiva.salePrice)}</span>
                      </>
                    ) : (
                      <span className="text-[12px] font-semibold leading-4 text-sv2-tertiary">Sin oferta activa</span>
                    )}
                    <Movimientos p={p} />
                  </div>
                </td>
                <td className={cn(td, '@4xl:text-right')}>
                  <span className={ETIQUETA_MOVIL}>Valor stock</span>
                  <div className="flex flex-col @4xl:items-end">
                    <span className="whitespace-nowrap text-[15px] font-bold leading-5">{dineroProducto(p, p.valorDisponible)}</span>
                    <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-outline">@ {dineroProducto(p, p.costoUnitario)}/u</span>
                  </div>
                </td>
                <td className={td}>
                  <span className={ETIQUETA_MOVIL}>Estado</span>
                  <ChipEstadoStock p={p} />
                </td>
                <td className={td}>
                  <span className={ETIQUETA_MOVIL}>Próximo vencimiento</span>
                  <Vencimiento p={p} ahora={ahora} />
                </td>
                <td className={cn(td, 'col-span-2 @xl:col-span-4 @4xl:pr-3')}>
                  <AccionesProducto p={p} compacto />
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
