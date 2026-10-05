import Link from 'next/link'
import { ArrowRight, Package, QrCode, Store, Undo2, Keyboard } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RUTA_REDENCIONES } from '@/modules/supply-v2/core/catalogo'
import type { RedencionDetallada } from '@/modules/supply-v2/redemption/queries'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'

function dinero(monto: string, moneda: string): string {
  const n = Number(monto).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'DOP' ? `RD$${n}` : `${moneda} ${n}`
}

function iniciales(nombre: string): string {
  const p = nombre.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (p.length > 1 ? p[0]![0]! + p[1]![0]! : (p[0] ?? '?').slice(0, 2)).toUpperCase()
}

/** Mismos textos y tonos que `ChipRedencion` (y el mismo identificador), con la geometría Stitch. */
function ChipEstado({ reversada }: { reversada: boolean }) {
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', reversada ? 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed' : 'bg-sv2-secondary-container text-sv2-on-secondary-container')}
      data-testid="estado-redencion"
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', reversada ? 'bg-sv2-tertiary' : 'bg-sv2-secondary')} />
      {reversada ? 'Reversada' : 'Entregada'}
    </span>
  )
}

function Canal({ r }: { r: RedencionDetallada }) {
  const Icono = r.canal === 'QR_SCAN' ? QrCode : Keyboard
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold leading-4 text-sv2-ink-variant">
      <Icono aria-hidden className="size-3.5" />
      {r.canal === 'QR_SCAN' ? 'QR' : 'Código manual'}
    </span>
  )
}

/**
 * Registro de entregas (Stitch, propuesta A). Una sola tabla que en
 * contenedores estrechos reacomoda cada fila como tarjeta, para que cada
 * redención exista una vez (las pruebas cuentan las filas `redencion`).
 */
export function TablaRedenciones({ filas, total, pie }: { filas: RedencionDetallada[]; total: number; pie: React.ReactNode }) {
  const th = 'px-2 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-2 @4xl:py-3 @4xl:align-middle'
  return (
    <Tarjeta className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-sv2-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">Registro de Entregas &amp; Auditoría</h2>
          <span className={cn(MONO, 'rounded-full border border-sv2-border px-2 py-0.5 text-sv2-ink-variant')}>{total.toLocaleString('es-DO')} {total === 1 ? 'registro' : 'registros'}</span>
        </div>
      </div>
      <div className="@4xl:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table" data-testid="tabla-redenciones">
          <thead className="hidden @4xl:table-header-group">
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'pl-4')}>Código</th>
              <th scope="col" className={th}>Beneficiario / cliente</th>
              <th scope="col" className={cn(th, 'min-w-[150px]')}>Servicio / producto</th>
              <th scope="col" className={cn(th, 'min-w-[130px]')}>Punto de canje</th>
              <th scope="col" className={th}>Fecha y valor</th>
              <th scope="col" className={th}>Estado</th>
              <th scope="col" className={cn(th, 'pr-4 text-right')}>Acción</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((r) => (
              <tr key={r.id} data-testid="redencion" className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-3 @4xl:table-row @4xl:p-0">
                <td className={cn(td, '@4xl:pl-4')}>
                  <div className="flex flex-col">
                    <Link href={`${RUTA_REDENCIONES}/${r.id}`} className={cn(MONO, 'whitespace-nowrap font-bold hover:underline', r.reversada ? 'text-sv2-ink-variant' : 'text-sv2-primary')}>{r.number}</Link>
                    {r.orden && <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>Ord: {r.orden}</span>}
                  </div>
                </td>
                <td className={cn(td, '@xl:col-span-2 @4xl:col-span-1')}>
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sv2-border bg-sv2-primary-fixed text-[12px] font-bold text-sv2-primary">{iniciales(r.cliente)}</span>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-semibold">{r.cliente}</span>
                      <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-sv2-ink-variant">
                        <span className="max-w-[180px] truncate" title={r.clienteCorreo}>{r.clienteCorreo}</span>
                      </span>
                      <span className="mt-0.5">
                        <Canal r={r} />
                      </span>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <div className="flex flex-col">
                    <span className="font-medium">{r.producto}</span>
                    <span className="flex items-center gap-1 text-[12px] leading-4 text-sv2-ink-variant">
                      <Package aria-hidden className="size-3.5 shrink-0" />
                      {r.proveedor}
                    </span>
                  </div>
                </td>
                <td className={td}>
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1 font-medium">
                      <Store aria-hidden className="size-3.5 shrink-0 text-sv2-ink-variant" />
                      {r.sucursal ?? 'Sin sucursal'}
                    </span>
                    <span className={cn(MONO, 'text-sv2-outline')}>Entregó: {r.empleado}</span>
                  </div>
                </td>
                <td className={cn(td, '@4xl:max-w-[170px]')}>
                  <div className="flex flex-col">
                    <span>{formatDateTime(r.redeemedAt)}</span>
                    {r.reversada && (
                      <span className="flex items-start gap-1 text-[12px] font-medium leading-4 text-sv2-error">
                        <Undo2 aria-hidden className="mt-px size-3.5 shrink-0" />
                        {r.motivoReversa ? `Reversada: ${r.motivoReversa}` : 'Reversada'}
                      </span>
                    )}
                    <span className={cn('mt-1 whitespace-nowrap font-bold tabular-nums', r.reversada && 'text-sv2-outline line-through')}>{dinero(r.valor, r.moneda)}</span>
                    <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>{r.modelo === 'COMMISSION' ? 'A comisión' : `Costo: ${dinero(r.costo, r.moneda)}`}</span>
                  </div>
                </td>
                <td className={td}><ChipEstado reversada={r.reversada} /></td>
                <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:pr-4 @4xl:text-right')}>
                  <Link href={`${RUTA_REDENCIONES}/${r.id}`} data-testid="link-redencion" className={cn(claseBotonSuave, 'h-8 gap-1 whitespace-nowrap border border-sv2-border bg-card px-3 text-[13px] leading-4 hover:bg-sv2-soft')}>
                    Ver <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pie}
    </Tarjeta>
  )
}
