import Link from 'next/link'
import { formatDate } from '@/lib/format'
import type { SupplyPorProducto } from '@/modules/supply-v2/pool/queries'
import { Tarjeta } from '../resumen/superficie'
import { AccionesProducto, ChipEstadoStock, dineroProducto, IconoProducto } from './piezas-supply'

function Dato({ etiqueta, children, testId, grande = false }: { etiqueta: string; children: React.ReactNode; testId?: string; grande?: boolean }) {
  return (
    <div className="flex flex-col rounded-[8px] bg-sv2-well p-2">
      <dt className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{etiqueta}</dt>
      <dd className={grande ? 'text-[24px] font-bold leading-8 tracking-[-0.015em] tabular-nums' : 'text-[15px] font-semibold leading-5 tabular-nums'} data-testid={testId}>{children}</dd>
    </div>
  )
}

/** Vista «Cards» de Supply (Stitch): una tarjeta por producto con todas sus cubetas. */
export function TarjetasSupply({ productos, pie }: { productos: SupplyPorProducto[]; pie: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3" data-testid="pool-productos">
        {productos.map((p) => (
          <Tarjeta key={p.catalogItemId} className="flex flex-col gap-3 p-4" data-testid="pool-producto">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <IconoProducto p={p} grande />
                <div className="flex min-w-0 flex-col">
                  <Link href={`/superadmin/supply-v2/supply/${p.catalogItemId}`} className="text-[18px] font-bold leading-6 tracking-[-0.01em] hover:underline">{p.producto}</Link>
                  <span className="text-[13px] leading-[18px] text-sv2-ink-variant">Proveedor: {p.proveedor}</span>
                </div>
              </div>
              <ChipEstadoStock p={p} />
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Dato etiqueta="Disponibles" testId="pool-disponibles" grande>{p.disponibles.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Valor adquirido disponible" grande>{dineroProducto(p, p.valorDisponible)}</Dato>
              <Dato etiqueta="Recibidas">{p.recibidas.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Asignadas" testId="pool-asignadas">{p.asignadas.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Reservadas" testId="pool-reservadas">{p.reservadas.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Emitidas" testId="pool-emitidas">{p.emitidas.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Redimidas" testId="pool-redimidas">{p.redimidas.toLocaleString('es-DO')}</Dato>
              <Dato etiqueta="Lotes">{p.lotes}</Dato>
              <div className="col-span-2">
                <Dato etiqueta="Próximo vencimiento">{p.proximoVencimiento ? formatDate(p.proximoVencimiento) : '—'}</Dato>
              </div>
            </dl>
            <AccionesProducto p={p} />
          </Tarjeta>
        ))}
      </div>
      <Tarjeta className="overflow-hidden">{pie}</Tarjeta>
    </div>
  )
}
